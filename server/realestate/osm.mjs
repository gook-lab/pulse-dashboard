// OSM(Overpass) 건물 외곽선 프록시 — 단지 배치도의 재료.
//
// ★ 왜 프록시인가
//   Overpass 는 공용 무료 서버라 rate limit 이 있고 1콜이 수 초 걸린다. 브라우저가 직접
//   때리면 단지를 열 때마다 느리고, 남의 서버에 우리 사용자 수만큼 부하를 준다.
//   서버가 한 번 받아 파일로 굽고 그 뒤로는 디스크에서 준다(건물 외곽선은 거의 안 변한다).
//
// ★ 층수는 OSM 을 믿지 않는다
//   실사 결과 building:levels 커버리지가 강남에서 0.6%(16,146동 중 107)였다.
//   높이는 우리 실거래의 층 프로필(floorProfile.max)로 채우고, OSM levels 는 있으면 우선한다.

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = fileURLToPath(new URL('../cache/osm/', import.meta.url));
/**
 * Overpass 엔드포인트 — 공용 무료 서버라 붐비면 429/504 를 주고, 아예 연결이 끊기기도 한다
 * (실측: 감사용 질의를 몰아친 뒤 ETIMEDOUT/ECONNREFUSED). 미러를 하나 둬 부하를 나눈다.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
/** 단지 반경(m). 150 이면 대단지 대부분이 들어오고 Overpass 가 타임아웃하지 않는다. */
export const RADIUS_M = 150;

/** 캐시 스키마 버전 — 올리면 기존 파일 캐시를 무시하고 다시 받는다. */
const CACHE_VERSION = 6;

const UA = 'PULSE-realestate/1.0 (personal dashboard; contact: local)';
/** Overpass 응답을 기다리는 한도(ms). 넘으면 끊고 다음 엔드포인트로 넘어간다. */
const HTTP_TIMEOUT_MS = 20_000;

const memo = new Map();

/**
 * 질의 한 번 — 엔드포인트를 돌아가며 재시도한다.
 * 상태코드(429/504)뿐 아니라 **던져진 네트워크 오류**도 재시도해야 한다.
 * 예전 코드는 fetch 가 throw 하면 그대로 502 로 끝나서, 연결이 한 번 튕기면 그 칸이 비었다.
 */
async function askOverpass(query, fetchImpl = fetch) {
  let last = null;
  for (let attempt = 0; attempt < ENDPOINTS.length + 1; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    if (attempt) await new Promise((r) => setTimeout(r, 900 * attempt));
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: `data=${encodeURIComponent(query)}`,
        // 질의 안의 [timeout:25] 는 Overpass 가 계산을 포기하는 시간이지 연결이 끊기는 시간이 아니다.
        // 응답이 50초까지 늘어진 적이 있어(실측) 우리 쪽에서도 상한을 둔다.
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.ok) return res;
      last = new Error(`overpass ${res.status}`);
      last.status = res.status === 429 || res.status === 504 ? 503 : 502;
      if (res.status !== 429 && res.status !== 504 && res.status < 500) throw last;
    } catch (e) {
      // 연결 자체가 실패한 경우 — 다음 엔드포인트로 넘어간다.
      last = e.status ? e : Object.assign(new Error(`overpass unreachable: ${e.message}`), { status: 503 });
      if (e.status && e.status !== 503) throw e;
    }
  }
  throw last ?? Object.assign(new Error('overpass failed'), { status: 502 });
}

/** 위경도 → 단지 중심 기준 로컬 미터 좌표. 화면 범위에선 평면 근사로 충분하다. */
export function toLocalMeters(lat, lng, originLat, originLng) {
  const mPerLat = 111_320;
  const mPerLng = 111_320 * Math.cos((originLat * Math.PI) / 180);
  return { x: (lng - originLng) * mPerLng, y: (lat - originLat) * mPerLat };
}

/** 폴리곤 면적(m²) — 신발끈 공식. 너무 작은 것(창고·주차부스)을 걸러낸다. */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * 지면에 보이지 않는 것 — 그리면 거짓말이 된다.
 * 터널·지하 구간(layer<0)은 땅 위에 없고, proposed/construction 은 아직 존재하지 않는다.
 * (송파 표본에서 지하철 7개가 전부 railway=subway+tunnel 이었다 — 이걸 그리면 단지 위로 선이 지나간다.)
 */
export function isHidden(t = {}) {
  if (t.tunnel && t.tunnel !== 'no') return true;
  if (t.covered === 'yes' && t.highway === 'corridor') return true;
  if (t.location === 'underground' || t.location === 'underwater') return true;
  if (Number(t.layer) < 0 && !t.bridge) return true;
  if (t.highway === 'proposed' || t.highway === 'construction') return true;
  if (t.building === 'construction' || t.building === 'proposed') return true;
  if (/^(abandoned|disused|razed|proposed|construction|platform|subway_entrance)$/.test(t.railway ?? '')) return true;
  return false;
}

/**
 * OSM 태그 → 배치도 카테고리. 지면(조경·물·길)은 압출하지 않고 바닥에 깐다.
 *
 * 보행로를 도로와 나눠야 하는 이유: 송파 400m 표본에서 보행로·자전거도로가 전체 길의 절반이었다
 * (footway 17 + cycleway 17 vs residential 43). 같은 색·같은 굵기로 깔면 골목이 아니라
 * 인도 그물이 화면을 덮는다.
 */
export function classify(t = {}) {
  if (isHidden(t)) return null;
  if (t.building) return 'building';
  if (t.natural === 'water' || t.waterway || t.landuse === 'reservoir') return 'water';
  if (/^(park|playground|garden|pitch|sports_centre|recreation_ground)$/.test(t.leisure ?? '')) return 'green';
  if (/^(grass|forest|meadow|recreation_ground|village_green|cemetery)$/.test(t.landuse ?? '')) return 'green';
  if (/^(wood|scrub|grassland|tree_row)$/.test(t.natural ?? '')) return 'green';
  if (t.railway) return 'rail';
  if (/^(footway|path|steps|cycleway|bridleway|corridor|track)$/.test(t.highway ?? '')) return 'path';
  if (t.highway) return 'road';
  return null;
}

/** 폭 등급표(m). 없는 값은 6m — 이름 없는 길은 골목 정도로 본다. */
const WIDTH_BY_HIGHWAY = {
  motorway: 20, motorway_link: 9, trunk: 18, trunk_link: 8,
  primary: 15, primary_link: 7, secondary: 12, secondary_link: 6,
  tertiary: 10, tertiary_link: 6, unclassified: 6, residential: 7,
  living_street: 6, service: 5, busway: 7, pedestrian: 4,
  footway: 2.2, path: 1.8, steps: 1.6, cycleway: 2, bridleway: 1.8,
  corridor: 1.8, track: 3,
};

/**
 * 길 폭(m) 근사. width → lanes → 등급 순으로 믿는다.
 * width 태그는 "1.2", "1.2 m", "3;4" 처럼 들어와서 숫자만 뽑아낸다(실측: width=1.2 존재).
 */
export function roadWidth(t = {}) {
  const explicit = parseFloat(String(t.width ?? '').replace(',', '.'));
  if (Number.isFinite(explicit) && explicit >= 0.5) return Math.min(40, explicit);

  if (t.railway) {
    const tracks = Number(t.tracks);
    return Number.isFinite(tracks) && tracks > 0 ? Math.min(24, tracks * 3.6) : 7;
  }

  const lanes = Number(t.lanes);
  if (Number.isFinite(lanes) && lanes > 0) return Math.min(24, lanes * 3.2);
  return WIDTH_BY_HIGHWAY[t.highway] ?? 6;
}

/**
 * 열린 선을 상자 안으로 자른다.
 * Overpass 는 `out geom` 에서 way 를 자르지 않고 통째로 준다 — 실측으로 한 way 가 8,188m 였다.
 * 그대로 두면 화면 밖 수 km 를 계산·전송·렌더하고, 캐시도 그만큼 부풀어 오른다.
 * 경계를 넘는 점 하나는 남겨서 선이 상자 가장자리까지 닿게 한다(잘린 티가 나지 않게).
 */
export function clipRuns(pts, half) {
  const inside = (p) => Math.abs(p.x) <= half && Math.abs(p.y) <= half;
  const runs = [];
  let cur = null;
  for (let i = 0; i < pts.length; i++) {
    if (inside(pts[i])) {
      if (!cur) { cur = []; if (i > 0) cur.push(pts[i - 1]); }   // 들어오기 직전 점
      cur.push(pts[i]);
    } else if (cur) {
      cur.push(pts[i]);                                          // 나간 직후 점
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}

/**
 * 볼록 상자에 대한 폴리곤 클리핑(Sutherland–Hodgman).
 *
 * 한강·올림픽공원 같은 면은 수 km 라 "너무 크면 버린다" 규칙에 걸려 아예 안 보였다
 * (캐시 24개 파일에 water 가 0개였던 이유). 버리는 대신 화면 상자로 잘라서 남긴다.
 */
export function clipPolygon(pts, half) {
  const inside = (p, edge) =>
    edge === 0 ? p.x >= -half : edge === 1 ? p.x <= half : edge === 2 ? p.y >= -half : p.y <= half;
  const cross = (a, b, edge) => {
    // 변과 경계선의 교점. 경계는 축에 평행하므로 1차 보간이면 정확하다.
    const t = edge === 0 ? (-half - a.x) / (b.x - a.x)
      : edge === 1 ? (half - a.x) / (b.x - a.x)
      : edge === 2 ? (-half - a.y) / (b.y - a.y)
      : (half - a.y) / (b.y - a.y);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  let out = pts;
  for (let edge = 0; edge < 4 && out.length; edge++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const curIn = inside(cur, edge), prevIn = inside(prev, edge);
      if (curIn) {
        if (!prevIn) out.push(cross(prev, cur, edge));
        out.push(cur);
      } else if (prevIn) {
        out.push(cross(prev, cur, edge));
      }
    }
  }
  return out;
}

/* ── 주변 인프라(POI) ─────────────────────────────────────────────────────
   역세권·학군·편의시설은 이 화면에서 사람이 실제로 판단하는 근거다.
   건물 외곽선만으로는 "저 회색 덩어리가 학교인지 상가인지" 알 수 없다. */

/** 표시 우선순위 — 자리가 모자라면 앞쪽이 이긴다. */
export const POI_PRIORITY = ['station', 'school', 'hospital', 'mart', 'park'];

/** OSM 태그 → 인프라 종류. 편의점·카페처럼 너무 흔한 것은 넣지 않는다(아이콘이 지도를 덮는다). */
export function classifyPoi(t = {}) {
  /* isHidden 을 쓰면 안 된다 — 그건 "지면에 그리면 거짓말인 지오메트리"를 거르는 규칙이다.
     지하철역은 대부분 지하(tunnel)라 그 규칙에 걸리는데, 역세권은 이 화면에서 가장 중요한 정보다.
     표시(annotation)는 지하에 있어도 찍는다. 다만 폐역·공사중은 제외한다. */
  if (/^(abandoned|disused|razed|proposed|construction)$/.test(t.railway ?? '')) return null;
  if (t.railway === 'station' || t.station === 'subway'
    || (t.public_transport === 'station' && t.subway === 'yes')) return 'station';
  if (/^(school|kindergarten|university|college)$/.test(t.amenity ?? '')) return 'school';
  if (/^(hospital|clinic)$/.test(t.amenity ?? '')) return 'hospital';
  if (/^(supermarket|department_store|mall)$/.test(t.shop ?? '')) return 'mart';
  if (t.leisure === 'park' && t.name) return 'park';
  return null;
}

/**
 * POI 목록. 노드는 좌표 그대로, 면(학교 부지 등)은 중심점으로 접는다.
 * 같은 시설이 노드와 면으로 중복 매핑되는 경우가 흔해 이름+거리로 합친다.
 */
export function normalizePois(osm, originLat, originLng, { clipHalf = RADIUS_M * 1.4 } = {}) {
  const out = [];
  for (const el of osm?.elements ?? []) {
    const kind = classifyPoi(el.tags);
    if (!kind) continue;

    let x = null, y = null;
    if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
      ({ x, y } = toLocalMeters(el.lat, el.lon, originLat, originLng));
    } else {
      const g = (el.geometry ?? el.members?.flatMap((m) => m.geometry ?? []) ?? [])
        .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
      if (!g.length) continue;
      const c = g.reduce((sum, p) => ({ lat: sum.lat + p.lat / g.length, lon: sum.lon + p.lon / g.length }), { lat: 0, lon: 0 });
      ({ x, y } = toLocalMeters(c.lat, c.lon, originLat, originLng));
    }
    if (Math.abs(x) > clipHalf || Math.abs(y) > clipHalf) continue;

    const name = el.tags?.name ?? null;
    // 노드/면 중복 매핑 — 같은 종류·같은 이름이 30m 안에 있으면 하나로 본다.
    if (out.some((p) => p.kind === kind && p.name === name && Math.hypot(p.x - x, p.y - y) < 30)) continue;
    out.push({ kind, name, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  return out
    .sort((a, b) => POI_PRIORITY.indexOf(a.kind) - POI_PRIORITY.indexOf(b.kind))
    .slice(0, 40);
}

/**
 * 라벨을 붙일 도로 등급.
 * 간선도로만 넣으면 주택가에서는 이름이 하나도 안 뜬다(실측: 상도동 반경 210m 에 0개) —
 * 한국 주소의 ○○로·○○길이 대부분 residential 로 매핑돼 있기 때문이다.
 * 대신 화면에서는 확대(1.1×) + 겹침 회피로 개수를 제어한다.
 */
export const NAMED_ROAD = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$/;

/** 서울 최고층(롯데월드타워 123층). 이보다 큰 값은 OSM 오타로 본다 — 999 면 2.8km 짜리 침이 선다. */
const MAX_LEVELS = 123;
/** 지붕만 있는 구조물(주차장 캐노피·정류장). 층수를 채워 압출하면 없는 건물이 선다. */
const FLAT_BUILDINGS = /^(roof|carport|canopy|shelter|bridge)$/;

/** OSM 층수 → 믿을 수 있는 값만. "2;3" 같은 표기는 NaN 이 되어 걸러진다. */
export function buildingLevels(t = {}) {
  if (FLAT_BUILDINGS.test(t.building ?? '')) return 1;   // 지붕 구조물은 1층 슬래브로
  const n = Number(t['building:levels']);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_LEVELS, Math.round(n));
}

/**
 * Overpass 응답 → 배치도용 건물 목록.
 * 좌표는 단지 중심 기준 로컬 미터로 바꿔 프론트가 투영만 하면 되게 만든다.
 */
export function normalizeBuildings(osm, originLat, originLng, { minArea = 60 } = {}) {
  const out = [];
  for (const el of osm?.elements ?? []) {
    if (classify(el.tags) !== 'building') continue;
    const geom = el.geometry;
    if (!Array.isArray(geom) || geom.length < 4) continue;

    const ring = geom
      .filter((g) => Number.isFinite(g?.lat) && Number.isFinite(g?.lon))
      .map((g) => toLocalMeters(g.lat, g.lon, originLat, originLng));
    if (ring.length < 4) continue;

    const area = polygonArea(ring);
    if (area < minArea) continue;   // 부속 건물·주차부스 제거

    const t = el.tags ?? {};
    const centroid = ring.reduce((s, p) => ({ x: s.x + p.x / ring.length, y: s.y + p.y / ring.length }), { x: 0, y: 0 });

    out.push({
      id: String(el.id),
      ring: ring.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]),
      area: Math.round(area),
      /** OSM 이 층수를 아는 경우만. 없으면 null → 프론트가 단지 층수로 채운다. */
      levels: buildingLevels(t),
      name: t.name ?? null,
      /** 단지 중심에서의 거리(m) — 우리 단지 건물과 이웃 건물을 시각적으로 구분한다. */
      dist: Math.round(Math.hypot(centroid.x, centroid.y)),
      apartment: t.building === 'apartment' || t.building === 'residential',
    });
  }
  // 뒤(중심에서 먼 것)부터가 아니라 큰 것부터 — 프론트가 z-order 를 다시 잡는다.
  return out.sort((a, b) => b.area - a.area).slice(0, 60);
}

/**
 * 지면 피처(조경·물·도로) 정규화.
 * 폴리곤(닫힌 way)은 면으로, 도로처럼 열린 way 는 선+폭으로 내려 프론트가 띠로 그린다.
 */
/** 면을 자를 때 상자를 이만큼 넉넉히 잡는다 — 가장자리가 화면 끝에서 딱 잘려 보이지 않게. */
const AREA_CLIP_SLACK = 1.35;

/**
 * Overpass 의 출력 클리핑 bbox — `out ... geom(bbox)` 로 넘기면 서버가 잘라서 준다.
 * 한강 멀티폴리곤은 멤버 28개에 링 하나가 1,200점이라, 통째로 받으면 질의가 90초를 넘긴다(실측).
 * 자르는 일을 우리 쪽으로 가져오지 말고 애초에 필요한 만큼만 받는다.
 */
function outBbox(lat, lng, radiusM) {
  const dLat = (radiusM * AREA_CLIP_SLACK) / 111_320;
  const dLng = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const f = (v) => v.toFixed(6);
  return `${f(lat - dLat)},${f(lng - dLng)},${f(lat + dLat)},${f(lng + dLng)}`;
}

/**
 * 멀티폴리곤 relation → 바깥 링들.
 * 한강·큰 공원은 way 가 아니라 relation 이라 `way[...]` 질의로는 잡히지 않는다.
 * outer 멤버들을 순서대로 이어 붙여 닫힌 링을 만든다(Overpass 는 대개 순서대로 준다).
 */
export function outerRings(el) {
  const rings = [];
  let cur = [];
  const closeIfPossible = () => {
    if (cur.length >= 4) rings.push(cur);
    cur = [];
  };
  for (const m of el.members ?? []) {
    if (m.type !== 'way' || (m.role && m.role !== 'outer')) continue;
    const g = (m.geometry ?? []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
    if (g.length < 2) continue;
    if (!cur.length) { cur = [...g]; }
    else {
      const tail = cur[cur.length - 1];
      const near = (a, b) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
      if (near(tail, g[0])) cur.push(...g.slice(1));
      else if (near(tail, g[g.length - 1])) cur.push(...[...g].reverse().slice(1));
      else { closeIfPossible(); cur = [...g]; }
    }
    if (cur.length >= 4) {
      const a = cur[0], b = cur[cur.length - 1];
      if (Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7) closeIfPossible();
    }
  }
  closeIfPossible();
  return rings;
}

export function normalizeGround(osm, originLat, originLng, { clipHalf = RADIUS_M * 1.4 } = {}) {
  const out = [];
  const r1 = (v) => Math.round(v * 10) / 10;
  const flat = (ps) => ps.map((p) => [r1(p.x), r1(p.y)]);

  /** 닫힌 면 하나를 상자로 잘라 담는다. 잘린 뒤 남는 게 없으면 버린다. */
  const pushArea = (kind, pts) => {
    if (polygonArea(pts) < 40) return;                 // 화단 수준
    const clipped = clipPolygon(pts, clipHalf * AREA_CLIP_SLACK);
    if (clipped.length < 3 || polygonArea(clipped) < 40) return;
    out.push({ kind, closed: true, pts: flat(clipped) });
  };

  for (const el of osm?.elements ?? []) {
    const kind = classify(el.tags);
    if (!kind || kind === 'building') continue;

    // 멀티폴리곤 relation — 한강·큰 공원이 여기에 들어 있다.
    if (el.type === 'relation') {
      for (const ring of outerRings(el)) {
        pushArea(kind, ring.map((g) => toLocalMeters(g.lat, g.lon, originLat, originLng)));
      }
      continue;
    }

    const geom = el.geometry;
    if (!Array.isArray(geom) || geom.length < 2) continue;

    const pts = geom
      .filter((g) => Number.isFinite(g?.lat) && Number.isFinite(g?.lon))
      .map((g) => toLocalMeters(g.lat, g.lon, originLat, originLng));
    if (pts.length < 2) continue;

    const first = pts[0], last = pts[pts.length - 1];
    const closed = pts.length >= 4 && Math.hypot(first.x - last.x, first.y - last.y) < 1.5;

    if (closed) {
      pushArea(kind, pts);
    } else if (kind === 'road' || kind === 'path' || kind === 'rail') {
      // 선으로 그릴 수 있는 건 길뿐이다. 열린 공원 경계선을 띠로 그리면
      // 폭의 근거가 없는 6m 짜리 초록 띠가 생긴다(면이 아니라 선이므로 면적도 못 쓴다).
      const width = roadWidth(el.tags);
      // 이름은 큰길에만 싣는다 — 골목 이름까지 내리면 payload 도 화면도 지저분해진다.
      const name = kind === 'road' && NAMED_ROAD.test(el.tags?.highway ?? '') ? (el.tags?.name ?? null) : null;
      for (const run of clipRuns(pts, clipHalf)) {
        out.push({ kind, closed: false, width, pts: flat(run), ...(name ? { name } : {}) });
      }
    }
  }
  // 면적 큰 것 먼저 깔고 작은 것을 위에 — 공원 위에 놀이터가 보이게
  return out
    .sort((a, b) => (b.closed ? polygonArea(b.pts.map(([x, y]) => ({ x, y }))) : 0)
                  - (a.closed ? polygonArea(a.pts.map(([x, y]) => ({ x, y }))) : 0))
    .slice(0, 160);
}

const cachePath = (aptSeq) => `${CACHE_DIR}${aptSeq.replace(/[^\w-]/g, '_')}.json`;

/* ─────────────────────────────────────────────────────────────────────────
   격자 셀 — 배치도를 방향키로 밀 때 주변이 계속 이어지게 하는 재료.

   단지 하나당 한 번 받는 방식(fetchComplexBuildings)은 150m 거품 밖이 빈 공간이다.
   그래서 지도를 고정 격자로 나누고 화면이 들어간 칸만 받는다. 격자를 고정해야
   ① 같은 칸을 두 번 받지 않고 ② 옆 단지를 보는 사람과 캐시를 공유한다.
   ───────────────────────────────────────────────────────────────────────── */

/** 셀 한 변(m). 200m 면 반경 150m 한 번으로 칸 전체(중심→모서리 141m)를 덮는다. */
export const CELL_M = 200;
const M_PER_LAT = 111_320;
const cellLatStep = () => CELL_M / M_PER_LAT;
const cellLngStep = (lat) => CELL_M / (M_PER_LAT * Math.cos((lat * Math.PI) / 180));

/** 위경도 → 셀 인덱스. 경도 간격이 위도에 의존하므로 위도를 먼저 확정한다. */
export function cellIndex(lat, lng) {
  const i = Math.round(lat / cellLatStep());
  const latC = i * cellLatStep();
  return { i, j: Math.round(lng / cellLngStep(latC)) };
}

/** 셀 인덱스 → 셀 중심 위경도. cellIndex 의 역이며 반올림 오차는 반 칸 이내다. */
export function cellCenter(i, j) {
  const lat = i * cellLatStep();
  return { lat, lng: j * cellLngStep(lat) };
}

/** 한국 밖 좌표는 받지 않는다 — 이 라우트가 임의 지역 Overpass 중계기가 되면 안 된다. */
export const inKorea = (lat, lng) => lat >= 33 && lat <= 39.6 && lng >= 124 && lng <= 132;

/**
 * Overpass 호출 예산(분당). 공용 무료 서버라 우리가 먼저 자제해야 차단되지 않는다.
 * 클라이언트가 구역 3개를 동시에 받으므로 20 이면 바로 바닥난다 — 미러 2개로 나눠 30.
 */
const BUDGET_PER_MIN = 30;
const callTimes = [];
const inflight = new Map();

function takeBudget() {
  const now = Date.now();
  while (callTimes.length && now - callTimes[0] > 60_000) callTimes.shift();
  if (callTimes.length >= BUDGET_PER_MIN) return false;
  callTimes.push(now);
  return true;
}

/**
 * 셀 하나의 건물·지면. 좌표는 셀 중심 기준 로컬 미터로 굽는다
 * (호출자 원점 기준으로 저장하면 단지마다 캐시가 갈라져 재사용이 안 된다).
 *
 * 같은 셀에 동시 요청이 오면 Overpass 호출은 한 번만 한다 — 팬 중에는 중복 요청이 흔하다.
 */
export async function fetchAreaCell(i, j, { fetchImpl = fetch, log = () => {} } = {}) {
  const key = `cell_${i}_${j}`;
  if (memo.has(key)) return memo.get(key);
  if (inflight.has(key)) return inflight.get(key);

  const run = (async () => {
    const file = `${CACHE_DIR}${key}.json`;
    try {
      const hit = JSON.parse(await readFile(file, 'utf8'));
      if (hit?.v === CACHE_VERSION) { memo.set(key, hit); return hit; }
    } catch { /* 캐시 없음 */ }

    if (!takeBudget()) {
      const e = new Error('overpass budget exhausted');
      e.status = 503;
      throw e;
    }

    const { lat, lng } = cellCenter(i, j);
    const R = Math.round(CELL_M * 0.75);   // 141m + 여유 — 칸을 빠짐없이 덮는 최소 반경
    const query = `[out:json][timeout:25];(`
      + `way["building"](around:${R},${lat},${lng});`
      + `way["leisure"](around:${R},${lat},${lng});`
      + `way["landuse"](around:${R},${lat},${lng});`
      + `way["natural"](around:${R},${lat},${lng});`
      + `way["highway"](around:${R},${lat},${lng});`
      + `way["railway"](around:${R},${lat},${lng});`
      // 주변 인프라 — 대부분 노드다(way 만 물으면 하나도 안 잡힌다).
      + `node["railway"="station"](around:${R},${lat},${lng});`
      + `node["amenity"~"^(school|kindergarten|university|college|hospital|clinic)$"](around:${R},${lat},${lng});`
      + `node["shop"~"^(supermarket|department_store|mall)$"](around:${R},${lat},${lng});`
      + `way["amenity"~"^(school|kindergarten|university|college|hospital)$"](around:${R},${lat},${lng});`
      // relation — 한강·큰 공원은 멀티폴리곤이라 way 질의로는 안 잡힌다.
      // 종류를 좁혀야 한다: relation["landuse"] 를 통으로 걸면 행정구역급 폴리곤까지 끌려와
      // 질의가 타임아웃한다(실측).
      + `relation["natural"="water"](around:${R},${lat},${lng});`
      + `relation["leisure"="park"](around:${R},${lat},${lng});`
      + `relation["landuse"~"^(grass|forest|cemetery|recreation_ground|village_green)$"](around:${R},${lat},${lng});`
      // `out geom tags` 는 relation 의 members 를 빼고 준다(실측: 한강 relation 이 멤버 0개로 왔다).
      // body 모드여야 멤버 + 좌표가 함께 오고, geom(bbox) 로 화면 밖은 서버가 잘라 준다.
      + `);out body geom(${outBbox(lat, lng, R)});`;

    const res = await askOverpass(query, fetchImpl);
    const osm = await res.json();
    const payload = {
      v: CACHE_VERSION, i, j, center: { lat, lng }, radius: R,
      buildings: normalizeBuildings(osm, lat, lng),
      // 칸보다 조금 넓게 잘라 이웃 칸과 이음매가 보이지 않게 한다.
      ground: normalizeGround(osm, lat, lng, { clipHalf: CELL_M }),
      pois: normalizePois(osm, lat, lng, { clipHalf: CELL_M }),
      fetchedAt: new Date().toISOString(),
    };

    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(payload));
    await rename(tmp, file);
    memo.set(key, payload);
    log(`[osm] ${key} 건물 ${payload.buildings.length}개 · 지면 ${payload.ground.length}개 캐시`);
    return payload;
  })().finally(() => inflight.delete(key));

  inflight.set(key, run);
  return run;
}

/**
 * 셀 좌표를 다른 원점 기준으로 옮긴다. 평면 근사에서 원점 변경은 순수 평행이동이라
 * 기하를 다시 계산할 필요가 없다(그래서 셀 캐시를 원점과 무관하게 쓸 수 있다).
 */
export function shiftCell(cell, originLat, originLng) {
  const off = toLocalMeters(cell.center.lat, cell.center.lng, originLat, originLng);
  const r1 = (v) => Math.round(v * 10) / 10;
  const move = (pts) => pts.map(([x, y]) => [r1(x + off.x), r1(y + off.y)]);
  return {
    key: `${cell.i}_${cell.j}`,
    center: cell.center,
    buildings: cell.buildings.map((b) => {
      const ring = move(b.ring);
      const cx = ring.reduce((t, p) => t + p[0], 0) / ring.length;
      const cy = ring.reduce((t, p) => t + p[1], 0) / ring.length;
      // dist 는 새 원점(= 보고 있는 단지) 기준으로 다시 잰다 — near/far 판정의 근거다.
      return { ...b, ring, dist: Math.round(Math.hypot(cx, cy)) };
    }),
    ground: cell.ground.map((g) => ({ ...g, pts: move(g.pts) })),
    pois: (cell.pois ?? []).map((p) => ({ ...p, x: r1(p.x + off.x), y: r1(p.y + off.y) })),
  };
}

/**
 * 단지 주변 건물 조회. 메모리 → 파일 → Overpass 순.
 * 실패는 던진다 — 빈 배열로 돌려주면 "건물이 없는 단지"와 구분되지 않는다.
 */
export async function fetchComplexBuildings(aptSeq, lat, lng, { fetchImpl = fetch, log = () => {} } = {}) {
  if (memo.has(aptSeq)) return memo.get(aptSeq);

  try {
    const hit = JSON.parse(await readFile(cachePath(aptSeq), 'utf8'));
    // 스키마가 바뀌면(조경 추가 등) 옛 캐시를 쓰면 화면이 조용히 반쪽이 된다.
    if (hit?.v === CACHE_VERSION) { memo.set(aptSeq, hit); return hit; }
  } catch { /* 캐시 없음 — 받아온다 */ }

  // 건물 + 지면(조경·물·도로)을 한 번에. 조경은 단지 밖까지 보여야 맥락이 생기므로 반경을 더 넓게.
  const GROUND_R = Math.round(RADIUS_M * 1.4);
  const query = `[out:json][timeout:25];(`
    + `way["building"](around:${RADIUS_M},${lat},${lng});`
    + `way["leisure"](around:${GROUND_R},${lat},${lng});`
    + `way["landuse"](around:${GROUND_R},${lat},${lng});`
    + `way["natural"](around:${GROUND_R},${lat},${lng});`
    + `way["highway"](around:${GROUND_R},${lat},${lng});`
    + `way["railway"](around:${GROUND_R},${lat},${lng});`
    // 주변 인프라 — 대부분 노드다(way 만 물으면 하나도 안 잡힌다).
    + `node["railway"="station"](around:${GROUND_R},${lat},${lng});`
    + `node["amenity"~"^(school|kindergarten|university|college|hospital|clinic)$"](around:${GROUND_R},${lat},${lng});`
    + `node["shop"~"^(supermarket|department_store|mall)$"](around:${GROUND_R},${lat},${lng});`
    + `way["amenity"~"^(school|kindergarten|university|college|hospital)$"](around:${GROUND_R},${lat},${lng});`
    // relation — 한강·큰 공원은 멀티폴리곤이라 way 질의로는 안 잡힌다(종류는 좁게).
    + `relation["natural"="water"](around:${GROUND_R},${lat},${lng});`
    + `relation["leisure"="park"](around:${GROUND_R},${lat},${lng});`
    + `relation["landuse"~"^(grass|forest|cemetery|recreation_ground|village_green)$"](around:${GROUND_R},${lat},${lng});`
    // relation 멤버까지 받으려면 body 모드여야 한다(out geom tags 는 멤버를 뺀다).
    + `);out body geom(${outBbox(lat, lng, GROUND_R)});`;
  const res = await askOverpass(query, fetchImpl);
  const osm = await res.json();
  const buildings = normalizeBuildings(osm, lat, lng);
  const ground = normalizeGround(osm, lat, lng, { clipHalf: GROUND_R });
  const pois = normalizePois(osm, lat, lng, { clipHalf: GROUND_R });
  const payload = {
    v: CACHE_VERSION, aptSeq, origin: { lat, lng }, radius: RADIUS_M,
    buildings, ground, pois, source: 'osm', fetchedAt: new Date().toISOString(),
  };

  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${cachePath(aptSeq)}.tmp`;
  await writeFile(tmp, JSON.stringify(payload));
  await rename(tmp, cachePath(aptSeq));
  memo.set(aptSeq, payload);
  log(`[osm] ${aptSeq} 건물 ${buildings.length}개 · 지면 ${ground.length}개 캐시`);
  return payload;
}
