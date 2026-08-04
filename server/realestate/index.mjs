// 스크리너 요청 경로 + 배치 오케스트레이션.
//
// ★ 요청 경로에 원시 거래를 올리지 않는다
//   부팅 시 apt-signals.json 만 메모리에 상주(단지 × 시그널 13 + 12개월 시계열).
//   스크리닝은 배열 filter+sort 라 캐시 없이도 수 ms. 원시 7만행은 배치 전용.
//
// ★ 엔드포인트가 둘인 이유 (설계 D4)
//   리스트는 상위 50개만, 지도는 전체가 필요하다. 하나로는 limit 을 정할 수 없다.
//   /complexes = 안 변하는 단지 마스터(ETag 캐시)  ·  /screen = 변하는 순위만

import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, rename, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { collectSeoul, writeRaw, formatStats, fetchDealsPage } from './collect.mjs';
import { ymOffset, NOW_OFFSET_MONTHS } from './lawd.mjs';
import { buildMaster, geocodeAll, writeGeocodeReport, detectGeocodeDrop } from './complexes.mjs';
import { computeAll, getSignal, valueAt, idxOfAgo, buildSmoothed, filterOutliers, recentDeals } from './signals.mjs';
import { writeDealShards, readComplexDeals, createDealsLRU } from './deals.mjs';
import { fetchComplexBuildings, fetchAreaCell, shiftCell, cellIndex, inKorea, CELL_M } from './osm.mjs';

const CACHE_DIR = fileURLToPath(new URL('../cache/', import.meta.url));
const TMP_DIR = fileURLToPath(new URL('../cache/.tmp/', import.meta.url));
const SIGNALS_FILE = `${CACHE_DIR}apt-signals.json`;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export const SIGNAL_KEYS = ['momentum3', 'momentum6', 'momentum12', 'high52wPct', 'volumeRatio', 'jeonseRatio', 'rs'];

// ── 메모리 상주 ─────────────────────────────────────────────────────────────
let store = null;   // { generatedAt, dataMonth, months, complexes[], master[], etag }
let dealsCache = null;  // LRU 캐시 for apt-deals 샤드

/**
 * 배치는 별도 프로세스(`pnpm collect`)라 파일을 바꿔도 실행 중인 서버는 모른다.
 * mtime 을 보고 바뀌었으면 다시 읽는다. 안 그러면 배치를 돌리고도 옛 순위를 계속 본다.
 * (첫 배치 후 실제로 겪은 문제. 서버 재시작 없이 갱신되어야 "지금 갱신" 버튼도 성립한다.)
 */
export async function loadStore({ force = false } = {}) {
  const { mtimeMs } = await stat(SIGNALS_FILE);
  if (store && !force && store._mtime === mtimeMs) return store;
  const raw = JSON.parse(await readFile(SIGNALS_FILE, 'utf8'));
  columnize(raw);
  /* 최근 거래 10건은 상세 화면에서만 쓰는데 payload 의 33%(5.3MB)를 차지한다.
     상세는 한 번에 한 단지만 열리고 그때 거래 샤드를 어차피 읽으므로(smoothed 와 같은 경로)
     상주시킬 이유가 없다. 파싱 직후 떨궈서 8,748단지 × 10건이 힙에 남지 않게 한다. */
  for (const c of raw.complexes ?? []) c.recent = null;
  raw.etag = createHash('sha1').update(raw.generatedAt).digest('hex').slice(0, 16);
  raw._mtime = mtimeMs;
  store = raw;
  return store;
}

/**
 * 월별 시계열을 **컬럼형 TypedArray** 로 접는다.
 *
 * 왜: [가격, 건수] 중첩 배열이 힙에서 21.6MB 였다(실측, 필드별 A/B).
 * 8,748단지 × 17개월 × 2종 = 297,432개의 작은 배열이 각각 헤더를 달고 있었다.
 * 같은 값을 Float32/Uint16 두 덩어리로 담으면 2MB 남짓이다.
 *
 * 파일은 그대로 JSON 이다 — 배치와 캐시 형식을 건드리지 않고 로드 시점에만 바꾼다.
 * NaN 이 "그 달 거래 없음"이다(0 이 아니다 — 0 은 실제 가격일 수 있는 값이라 구분해야 한다).
 */
export function columnize(raw) {
  const M = raw.months?.length ?? 0;
  const N = raw.complexes?.length ?? 0;
  if (!M || !N) return;

  const cols = {
    // Float32 는 유효숫자 7자리라 3189.4999 를 3189.5 로 밀어 반올림 경계를 넘긴다(실측:
    // 순위 행 평당가가 3189 → 3190 으로 바뀌었다). 1MB 더 쓰고 값을 정확히 보존한다.
    t: { price: new Float64Array(N * M), count: new Uint16Array(N * M) },
    r: { price: new Float64Array(N * M), count: new Uint16Array(N * M) },
  };

  raw.complexes.forEach((c, row) => {
    c.row = row;
    for (const k of ['t', 'r']) {
      const src = c.series?.[k] ?? [];
      const off = row * M;
      for (let i = 0; i < M; i++) {
        const cell = src[i];
        const v = cell?.[0];
        cols[k].price[off + i] = v == null ? NaN : v;
        cols[k].count[off + i] = Math.min(65535, cell?.[1] ?? 0);
      }
    }
    c.series = null;   // 중첩 배열은 여기서 버린다
  });

  raw.cols = cols;
  raw.monthCount = M;
}

/** 컬럼형 → 응답용 [가격|null, 건수] 배열. 상세는 한 번에 한 단지라 복원 비용이 없다. */
export function seriesRows(store, c, kind) {
  const M = store.monthCount, off = c.row * M;
  const { price, count } = store.cols[kind];
  const out = [];
  for (let i = 0; i < M; i++) {
    const p = price[off + i];
    out.push([Number.isNaN(p) ? null : p, count[off + i]]);
  }
  return out;
}

/** 컬럼형에서 그 시점 값(거래 없는 달은 직전 유효값) — signals.valueAt 과 같은 규칙. */
export function seriesValueAt(store, c, kind, idx) {
  const M = store.monthCount, off = c.row * M;
  const { price, count } = store.cols[kind];
  for (let i = Math.min(idx, M - 1); i >= 0; i--) {
    if (count[off + i] > 0 && !Number.isNaN(price[off + i])) return price[off + i];
  }
  return null;
}

/** 캐시가 없으면 프론트가 EmptyState 로 안내할 수 있게 구조화된 503. */
export class NeedsCollectError extends Error {
  constructor() { super('cache not built'); this.status = 503; this.needsCollect = true; }
}

async function requireStore() {
  try { return await loadStore(); } catch { throw new NeedsCollectError(); }
}

const isStale = (s) => Date.now() - new Date(s.generatedAt).getTime() > STALE_AFTER_MS;

// ── 스크리닝 ────────────────────────────────────────────────────────────────
/**
 * 조건에 맞는 단지를 시그널 값으로 정렬. 순수 함수라 테스트가 쉽다.
 *
 * null 은 0 이 아니다 — 그 시그널을 계산할 수 없는 단지는 모집단에서 빠지고
 * 빠진 개수가 nullCount 로 나간다. 화면이 "3,012개 중 1,847개 계산 가능" 을 보여줘야 한다.
 */
export function screen(complexes, q = {}) {
  const {
    signal = 'momentum6', dealType = 'trade', minDeals = 3,
    gu = [], areaTier = null, sortDir = 'desc', bbox = null,
  } = q;

  let pool = complexes;
  if (gu.length) pool = pool.filter((c) => gu.includes(c.gu));
  if (areaTier) pool = pool.filter((c) => c.areaTier === areaTier);
  if (bbox) {
    const [swLat, swLng, neLat, neLng] = bbox;
    pool = pool.filter((c) => c.lat != null && c.lat >= swLat && c.lat <= neLat && c.lng >= swLng && c.lng <= neLng);
  }

  const total = pool.length;
  const eligible = pool.filter((c) => {
    // 전세가율은 매매·전세 양쪽 표본으로 계산된다 — 현재 거래유형 하나의 건수로 거르면
    // 매매/전세 토글이 전세가율 순위를 바꾸는 비직관이 생긴다. 양쪽 최소값을 쓴다.
    const dc = signal === 'jeonseRatio'
      ? Math.min(c.signals.trade?.dealCount ?? 0, c.signals.rent?.dealCount ?? 0)
      : c.signals[dealType]?.dealCount ?? 0;
    return dc >= minDeals && getSignal(c, signal, dealType) != null;
  });

  const dir = sortDir === 'asc' ? 1 : -1;
  const ranked = eligible
    .map((c) => ({ id: c.aptSeq, value: getSignal(c, signal, dealType), deals: c.signals[dealType]?.dealCount ?? 0 }))
    .sort((a, b) => (a.value - b.value) * dir)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return { ranked, total, nullCount: total - eligible.length, signal, dealType, minDeals };
}

/**
 * 순위 행에 기준월 평당가를 싣는다 — 시그널 %만으로는 "얼마짜리 단지"인지 알 수 없다.
 * 시그널 계산과 같은 규칙: 기준월 = 3개월 전(신고지연 보정), 거래 없는 달은 직전 유효값.
 */
export function attachPrices(ranked, complexes, months, dealType, priceAt) {
  const byId = new Map(complexes.map((c) => [c.aptSeq, c]));
  const nowIdx = idxOfAgo(months, NOW_OFFSET_MONTHS);
  const key = dealType === 'trade' ? 't' : 'r';
  // priceAt 이 없으면 중첩 배열에서 읽는다(테스트·구형 호출부). 서버는 컬럼형 접근자를 넘긴다.
  const read = priceAt ?? ((c) => (c?.series?.[key] ? valueAt(c.series[key], nowIdx) : null));
  return ranked.map((r) => {
    const c = byId.get(r.id);
    const v = c ? read(c) : null;
    const rep = c?.rep?.[key] ?? null;   // 지도 라벨용 대표 거래(총액·면적)
    return {
      ...r,
      price: v == null ? null : Math.round(v),
      amount: rep?.amount ?? null,
      area: rep?.area ?? null,
    };
  });
}

/**
 * 헤드라인 — 화면 최상단 한 줄 (설계 D10).
 * "어디가" + "얼마나" 를 한 문장에. 단순 카운트는 필터 캡션이 이미 말하고 있다.
 */
export function headline(ranked, complexes, { signal, dealType }) {
  if (!ranked.length) return null;
  const byId = new Map(complexes.map((c) => [c.aptSeq, c]));
  const top = ranked.slice(0, 50);

  const guCount = new Map();
  for (const r of top) {
    const g = byId.get(r.id)?.gu;
    if (g) guCount.set(g, (guCount.get(g) ?? 0) + 1);
  }
  const lead = [...guCount].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g.replace(/구$/, ''));

  const label = { momentum3: '3개월 모멘텀', momentum6: '6개월 모멘텀', momentum12: '12개월 모멘텀',
    high52wPct: '신고가 근접', volumeRatio: '거래량 돌파', jeonseRatio: '전세가율', rs: '상대강도' }[signal] ?? signal;

  let detail;
  if (signal === 'high52wPct') detail = `신고가 ${ranked.filter((r) => r.value === 0).length}개 단지`;
  else if (signal === 'volumeRatio') detail = `평균 3배 이상 ${ranked.filter((r) => r.value >= 3).length}개`;
  else if (signal === 'jeonseRatio') detail = `80% 이상 ${ranked.filter((r) => r.value >= 0.8).length}개`;
  else {
    const up = ranked.filter((r) => r.value > 0).length;
    detail = `상승 ${up} / 하락 ${ranked.length - up}`;
  }

  return {
    text: lead.length ? `${label} — ${lead.join('·')}가 주도` : label,
    detail,
    dealType: dealType === 'rent' ? '전세' : '매매',
  };
}

// ── 라우트 ──────────────────────────────────────────────────────────────────
const parseBbox = (s) => {
  const n = String(s ?? '').split(',').map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? n : null;
};

export const routes = {
  /**
   * 단지 마스터. 배치 사이에 안 변한다 — HTTP ETag + no-cache(재검증 필수)로
   * 브라우저가 If-None-Match 를 자동으로 붙이고, 안 바뀌었으면 304 로 3.4MB 를 아낀다.
   * 프론트 fetch 코드는 그대로다(브라우저 HTTP 캐시가 처리).
   */
  '/api/realestate/complexes': async (q, req) => {
    const s = await requireStore();
    const tag = `"${s.etag}"`;
    const headers = { ETag: tag, 'Cache-Control': 'no-cache' };
    if (req?.headers?.['if-none-match'] === tag) return { __notModified: true, __headers: headers };
    return { __headers: headers, generatedAt: s.generatedAt, dataMonth: s.dataMonth, etag: s.etag, items: s.master };
  },

  '/api/realestate/screen': async (q) => {
    const s = await requireStore();
    const signal = SIGNAL_KEYS.includes(q?.get('signal')) ? q.get('signal') : 'momentum6';
    const dealType = q?.get('dealType') === 'rent' ? 'rent' : 'trade';
    const minDeals = Math.max(0, Number(q?.get('minDeals')) || 3);
    const query = {
      signal, dealType, minDeals,
      gu: (q?.get('gu') || '').split(',').filter(Boolean),
      areaTier: q?.get('areaTier') || null,
      sortDir: q?.get('sortDir') === 'asc' ? 'asc' : 'desc',
      bbox: parseBbox(q?.get('bbox')),
    };
    const out = screen(s.complexes, query);
    const nowIdx = idxOfAgo(s.months, NOW_OFFSET_MONTHS);
    const key = dealType === 'trade' ? 't' : 'r';
    out.ranked = attachPrices(out.ranked, s.complexes, s.months, dealType,
      (c) => seriesValueAt(s, c, key, nowIdx));
    return {
      ...out,
      headline: headline(out.ranked, s.complexes, query),
      generatedAt: s.generatedAt,
      dataMonth: s.dataMonth,
      stale: isStale(s),
      // 좌표 확보율 5%p 이상 하락(T16) — 조용한 지오코딩 실패를 화면 경고로 끌어올린다.
      geocodeDrop: s.stats?.geocodeDrop ?? null,
      source: 'live',
    };
  },

  /**
   * 관심단지 추정가(설계 W2, 홈 무버용) — 매매 대표 거래(rep.t)만 쓴다.
   * 대표평형 = 확정 구간 최다 거래 면적(동률이면 큰 면적, repDeal 규칙). 전세만 있는
   * 단지는 amount:null — 전세보증금으로 자산가치를 추정하지 않는다. 순자산 합산에도 안 쓴다.
   */
  '/api/realestate/estimates': async (q) => {
    const ids = (q?.get('ids') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50);
    if (!ids.length) return {};
    const s = await requireStore();
    const byId = new Map(s.complexes.map((c) => [c.aptSeq, c]));
    const out = {};
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) continue;
      const rep = c.rep?.t ?? null;
      out[id] = {
        aptNm: c.aptNm,
        gu: c.gu ?? null,
        /** 대표 거래 총액(만원). null = 매매 표본 없음 → 화면은 "-". */
        amount: rep?.amount ?? null,
        /** 대표 전용면적(㎡). */
        area: rep?.area ?? null,
        /** 매매 3개월 모멘텀(%) — 무버 정렬·등락 표시용. */
        momentum3: c.signals?.trade?.momentum3 ?? null,
      };
    }
    return out;
  },

  /** 단지 상세 — 시계열은 메모리에 있으므로 파일 I/O 없음. */
  '/api/realestate/complex': async (q) => {
    const s = await requireStore();
    const id = q?.get('id');
    const c = s.complexes.find((x) => x.aptSeq === id);
    if (!c) { const e = new Error('not found'); e.status = 404; throw e; }

    /* 3개월 이동 중앙값 — 차트의 추세선.
       월별 중앙값은 거래가 1~2건인 달이 많아 4,093 → 8,141 → 10,648 처럼 튄다(실측).
       시그널이 쓰는 것과 같은 값이어야 하므로 signals.mjs 의 filterOutliers+buildSmoothed 를
       그대로 다시 돌린다. 배치 payload 에 넣지 않는 이유는 메모리다 — 8,748단지 × 2종 × 17개월이
       상주하면 안 되고, 상세는 한 번에 한 단지만 열린다. */
    let smoothed = null;
    let recent = c.recent ?? [];
    try {
      if (!dealsCache) dealsCache = createDealsLRU();
      const { deals } = await readComplexDeals(id, c.sggCd, null, dealsCache);
      const kept = (kind) => filterOutliers(
        kind === 'trade'
          ? deals.filter((d) => d.kind === 'trade')
          : deals.filter((d) => d.kind === 'rent' && d.monthlyRent === 0),
      ).kept;
      smoothed = {
        t: buildSmoothed(kept('trade'), s.months).map(([v]) => v),
        r: buildSmoothed(kept('rent'), s.months).map(([v]) => v),
      };
      recent = recentDeals(deals);
    } catch {
      // 샤드가 없거나 깨졌으면 추세선만 없다 — 상세 화면 전체를 죽일 이유가 없다.
      smoothed = null;
    }

    // series 는 컬럼형으로 접혀 있다 — 응답에서만 원래 모양으로 되돌린다.
    const series = { t: seriesRows(s, c, 't'), r: seriesRows(s, c, 'r') };
    return { ...c, series, months: s.months, smoothed, recent, generatedAt: s.generatedAt };
  },

  /**
   * 단지 배치도 재료 — 주변 건물 외곽선(OSM). 층수는 우리 실거래 층 프로필로 채운다.
   * Overpass 는 느리고 rate limit 이 있어 서버가 한 번 받아 파일로 굽는다.
   */
  '/api/realestate/complex/buildings': async (q) => {
    const s = await requireStore();
    const aptSeq = q?.get('id');
    if (!aptSeq) { const e = new Error('missing id'); e.status = 400; throw e; }
    const c = s.complexes.find((x) => x.aptSeq === aptSeq);
    if (!c) { const e = new Error('not found'); e.status = 404; throw e; }
    if (c.lat == null || c.lng == null) { const e = new Error('no coordinates'); e.status = 409; throw e; }

    const out = await fetchComplexBuildings(aptSeq, c.lat, c.lng, { log: console.log });
    // 배치도 높이의 기본값 — OSM levels 가 없는 건물은 이 층수로 압출한다.
    const fallbackLevels = c.floors?.t?.max ?? c.floors?.r?.max ?? null;
    return { ...out, fallbackLevels, aptNm: c.aptNm };
  },

  /**
   * 배치도 주변 확장 — 방향키로 밀 때 화면이 들어간 격자 칸을 하나씩 받아온다.
   * 칸 캐시는 원점과 무관하게 굽고(shiftCell) 응답에서만 단지 원점 기준으로 옮긴다.
   */
  '/api/realestate/area': async (q) => {
    const num = (k) => { const v = Number(q?.get(k)); return Number.isFinite(v) ? v : null; };
    const lat = num('lat'), lng = num('lng');
    const originLat = num('originLat'), originLng = num('originLng');
    if (lat == null || lng == null || originLat == null || originLng == null) {
      const e = new Error('missing lat/lng/originLat/originLng'); e.status = 400; throw e;
    }
    // 임의 좌표를 그대로 Overpass 로 넘기면 공개 중계기가 된다. 국내로 제한한다.
    if (!inKorea(lat, lng) || !inKorea(originLat, originLng)) {
      const e = new Error('out of range'); e.status = 400; throw e;
    }

    const { i, j } = cellIndex(lat, lng);
    const cell = await fetchAreaCell(i, j, { log: console.log });
    return { ...shiftCell(cell, originLat, originLng), cellSize: CELL_M };
  },

  /** 단지별 거래 이력 — aptSeq로 조회하여 구별 샤드에서 로드. */
  '/api/realestate/complex/deals': async (q) => {
    const s = await requireStore();
    const aptSeq = q?.get('id');
    if (!aptSeq) { const e = new Error('missing id'); e.status = 400; throw e; }

    const c = s.complexes.find((x) => x.aptSeq === aptSeq);
    if (!c) { const e = new Error('not found'); e.status = 404; throw e; }

    // LRU 캐시 초기화
    if (!dealsCache) dealsCache = createDealsLRU();

    // 샤드 로드 (LRU 캐시 활용)
    const result = await readComplexDeals(aptSeq, c.sggCd, null, dealsCache);

    return result;
  },

  /**
   * 프론트 설정. JS 키는 도메인 제한이 걸린 공개 키지만
   * 소스에 커밋하지 않는 원칙을 지키기 위해 server/.env 에서 내려준다.
   */
  '/api/realestate/config': async () => ({ kakaoJsKey: process.env.KAKAO_JS_KEY ?? null }),

  /**
   * 카카오 SDK 사전 점검 — 미등록 도메인이면 카카오가 Referer 를 보고 401 을 준다.
   * 브라우저에서 직접 fetch 하면 CORS 로 원인이 안 보이므로 서버가 대신 물어봐 준다.
   * 지도 실패 배지에 "도메인 등록 필요" 같은 고칠 수 있는 이유를 띄우기 위한 것.
   */
  '/api/realestate/kakao-probe': async (q) => {
    const key = process.env.KAKAO_JS_KEY;
    if (!key) return { ok: false, reason: 'no-key' };
    const origin = q?.get('origin') || 'http://localhost:5180';
    try {
      const r = await fetch(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`,
        { headers: { Referer: `${origin}/` } });
      const body = r.ok ? '' : await r.text();
      return { ok: r.ok, status: r.status, domainMismatch: body.includes('domain mismatched') };
    } catch (e) {
      return { ok: false, status: 0, error: String(e?.message || e) };
    }
  },

  /**
   * "지금 갱신" (설계 D12). 배치를 백그라운드로 돌리고 즉시 응답한다.
   * 서버 디스패치가 메서드를 보지 않으므로 GET/POST 모두 동작 — 프론트는 POST 를 쓴다.
   * 진행 중 재요청은 새로 시작하지 않고 현재 상태만 돌려준다(중복 실행 방지).
   */
  '/api/realestate/collect': async () => {
    if (collectJob?.running) return { started: false, ...collectStatus() };
    collectJob = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: null, message: '수집 시작…', error: null };
    void detectKinds()
      .then((kinds) => runBatch({ kinds, log: (line) => { collectJob.message = String(line); console.log(line); } }))
      .then((r) => { collectJob.running = false; collectJob.ok = r.ok; collectJob.finishedAt = new Date().toISOString(); })
      .catch((e) => { collectJob.running = false; collectJob.ok = false; collectJob.error = String(e?.message || e); collectJob.finishedAt = new Date().toISOString(); });
    return { started: true, ...collectStatus() };
  },

  '/api/realestate/collect/status': async () => collectStatus(),
};

// ── "지금 갱신" 잡 상태 ─────────────────────────────────────────────────────
/**
 * 매매 활용신청 승인 여부를 1콜로 감지해 수집 종류를 정한다.
 * 미승인(403) 상태에서 무작정 매매를 넣으면 배치 전체가 실패 처리되어
 * 캐시 교체가 영원히 안 된다 — 그래서 하드코딩이 아니라 런타임 감지다.
 */
async function detectKinds() {
  try {
    await fetchDealsPage('trade', '11110', ymOffset(1), 1);
    return ['rent', 'trade'];
  } catch {
    console.log('[collect] 매매 API 미승인(403) — 전월세만 수집');
    return ['rent'];
  }
}

let collectJob = null;
const collectStatus = () => collectJob
  ? { running: collectJob.running, startedAt: collectJob.startedAt, finishedAt: collectJob.finishedAt, ok: collectJob.ok, message: collectJob.message, error: collectJob.error }
  : { running: false, startedAt: null, finishedAt: null, ok: null, message: null, error: null };

// ── 배치 ────────────────────────────────────────────────────────────────────
/**
 * 수집 → 마스터 → 좌표 → 시그널 → 원자적 교체.
 * 실패한 (구,월)이 하나라도 있으면 캐시를 바꾸지 않는다.
 * 구멍 난 시계열이 조용히 배포되면 시그널이 전부 거짓말이 된다.
 */
export async function runBatch({ kinds = ['rent'], log = console.log } = {}) {
  log(`[collect] 시작 — 종류 ${kinds.join(', ')}`);
  const { rows, stats } = await collectSeoul({ kinds, log });
  log(`[collect] ${formatStats(stats)}`);

  if (stats.failed.length) {
    const fatal = stats.failed.filter((f) => f.fatal);
    log(`[collect] ✗ 실패 ${stats.failed.length}건 — 캐시를 교체하지 않는다.`);
    for (const f of stats.failed.slice(0, 5)) log(`    ${f.kind} ${f.gu} ${f.ym}: ${f.error}`);
    if (fatal.length) log(`    ⚠ ${fatal.length}건은 권한 문제(403/401). data.go.kr 활용신청을 확인할 것.`);
    return { ok: false, stats };
  }

  await writeRaw(rows, stats);
  await writeDealShards(rows);
  log(`[deals] 구별 거래 이력 샤드 저장`);

  const master = buildMaster(rows);
  log(`[complexes] 단지 ${master.length.toLocaleString()}개 (aptSeq 기준)`);
  const geo = await geocodeAll(master, { log });
  if (!geo.skipped) log(`[complexes] 좌표 확보 ${geo.resolved}/${geo.total} (${geo.rate}%)`);
  const drop = await detectGeocodeDrop(geo);
  if (drop.drop) log(`[complexes] ⚠ 좌표 확보율 하락 ${drop.from}% → ${drop.to}%`);
  await writeGeocodeReport(geo);

  const months = [...stats.months].reverse();          // ymRange 는 최신순 → 시계열은 과거→현재
  const complexes = computeAll(rows, months);
  log(`[signals] ${complexes.length.toLocaleString()}개 단지 시그널 계산`);

  const coord = new Map(master.map((m) => [m.aptSeq, m]));
  for (const c of complexes) {
    const m = coord.get(c.aptSeq);
    c.lat = m?.lat ?? null; c.lng = m?.lng ?? null;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    dataMonth: months[months.length - 1],
    months,
    complexes,
    master: master.map(({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear }) =>
      ({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear })),
    stats: { ...stats, geocode: geo, geocodeDrop: drop.drop ? { from: drop.from, to: drop.to } : null },
  };
  await mkdir(TMP_DIR, { recursive: true });
  const tmp = `${TMP_DIR}apt-signals.json`;
  await writeFile(tmp, JSON.stringify(payload));
  await rename(tmp, SIGNALS_FILE);

  store = null;   // 다음 요청에서 다시 읽는다
  log(`[done] apt-signals.json 교체 완료 · 기준월 ${payload.dataMonth}`);
  return { ok: true, stats, geo, complexes: complexes.length };
}

/**
 * 재수집 없이 시그널만 다시 계산한다. apt-raw.json.gz 가 이미 있을 때 쓴다.
 * 시그널 로직을 고칠 때마다 575콜을 다시 쏠 이유가 없다.
 */
export async function rebuildFromRaw({ log = console.log } = {}) {
  const { gunzipSync } = await import('node:zlib');
  const buf = await readFile(`${CACHE_DIR}apt-raw.json.gz`);
  const { rows, stats } = JSON.parse(gunzipSync(buf));
  log(`[rebuild] 원시 ${rows.length.toLocaleString()}건 로드 (수집 ${stats.generatedAt})`);

  await writeDealShards(rows);
  log(`[deals] 구별 거래 이력 샤드 재생성`);

  const master = buildMaster(rows);

  // rebuild 는 지오코딩을 하지 않는다 — 이전 산출물의 좌표를 병합하지 않으면
  // 시그널 로직 하나 고칠 때마다 지도 좌표가 통째로 증발한다(실제로 겪은 사고).
  try {
    const prev = JSON.parse(await readFile(SIGNALS_FILE, 'utf8'));
    const prevCoord = new Map((prev.master ?? []).map((m) => [m.aptSeq, m]));
    let kept = 0;
    for (const m of master) {
      const p = prevCoord.get(m.aptSeq);
      if (m.lat == null && p?.lat != null) { m.lat = p.lat; m.lng = p.lng; kept++; }
    }
    log(`[rebuild] 이전 좌표 보존 ${kept.toLocaleString()}개 (신규 단지는 pnpm geocode 로 채움)`);
  } catch { /* 첫 실행 — 보존할 좌표 없음 */ }

  const months = [...stats.months].reverse();
  const complexes = computeAll(rows, months);
  const outliers = complexes.reduce((s, c) => s + (c.outliers ?? 0), 0);
  log(`[rebuild] 단지 ${complexes.length.toLocaleString()}개 · 이상치 제외 ${outliers.toLocaleString()}건`);

  let geo = { skipped: true };
  try { geo = JSON.parse(await readFile(`${CACHE_DIR}geocode-report.json`, 'utf8')); } catch { /* 없으면 무시 */ }
  const coord = new Map(master.map((m) => [m.aptSeq, m]));
  for (const c of complexes) {
    const m = coord.get(c.aptSeq);
    c.lat = m?.lat ?? null; c.lng = m?.lng ?? null;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    dataMonth: months[months.length - 1],
    months, complexes,
    master: master.map(({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear }) =>
      ({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear })),
    stats: { ...stats, geocode: geo, outliers },
  };
  await mkdir(TMP_DIR, { recursive: true });
  const tmp = `${TMP_DIR}apt-signals.json`;
  await writeFile(tmp, JSON.stringify(payload));
  await rename(tmp, SIGNALS_FILE);
  store = null;
  log(`[rebuild] apt-signals.json 교체 완료 · 기준월 ${payload.dataMonth}`);
  return { ok: true, complexes: complexes.length, outliers };
}

/**
 * 재수집 없이 지오코딩만 다시 돈다. KAKAO_REST_KEY 를 나중에 넣었을 때
 * 575콜 6분짜리 수집을 반복하지 않고 좌표만 채우기 위한 경로다.
 * (rebuildFromRaw 는 이전 report 를 읽기만 할 뿐 지오코딩을 하지 않는다.)
 */
export async function geocodeFromRaw({ log = console.log } = {}) {
  if (!process.env.KAKAO_REST_KEY) {
    log('[geocode] ✗ KAKAO_REST_KEY 가 server/.env 에 없다. 카카오 콘솔에서 REST 키를 발급해 넣을 것.');
    return { ok: false };
  }
  const { gunzipSync } = await import('node:zlib');
  const buf = await readFile(`${CACHE_DIR}apt-raw.json.gz`);
  const { rows, stats } = JSON.parse(gunzipSync(buf));
  log(`[geocode] 원시 ${rows.length.toLocaleString()}건 로드 → 단지 마스터 재구성`);

  const master = buildMaster(rows);
  const geo = await geocodeAll(master, { log });
  log(`[geocode] 좌표 확보 ${geo.resolved}/${geo.total} (${geo.rate}%)`);
  const drop = await detectGeocodeDrop(geo);
  if (drop.drop) log(`[geocode] ⚠ 좌표 확보율 하락 ${drop.from}% → ${drop.to}%`);
  await writeGeocodeReport(geo);

  const months = [...stats.months].reverse();
  const complexes = computeAll(rows, months);
  const coord = new Map(master.map((m) => [m.aptSeq, m]));
  for (const c of complexes) {
    const m = coord.get(c.aptSeq);
    c.lat = m?.lat ?? null; c.lng = m?.lng ?? null;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    dataMonth: months[months.length - 1],
    months, complexes,
    master: master.map(({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear }) =>
      ({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear })),
    stats: { ...stats, geocode: geo, geocodeDrop: drop.drop ? { from: drop.from, to: drop.to } : null },
  };
  await mkdir(TMP_DIR, { recursive: true });
  const tmp = `${TMP_DIR}apt-signals.json`;
  await writeFile(tmp, JSON.stringify(payload));
  await rename(tmp, SIGNALS_FILE);
  store = null;
  log(`[geocode] apt-signals.json 교체 완료 · 좌표 확보율 ${geo.rate}%`);
  return { ok: true, geo };
}

/**
 * 배치·재계산 직후 눈검증용 — momentum6 상위 10개를 표로 찍는다.
 * 시그널 로직을 고칠 때마다 curl + node -e 를 손으로 조합하던 것을 대체.
 * 이상치(+977%)·mix shift(+228%) 류의 회귀는 이 표에서 바로 눈에 띈다.
 */
async function printTopSignals(dealType = 'rent', signal = 'momentum6') {
  const s = await loadStore({ force: true });
  const top = s.complexes
    .filter((c) => getSignal(c, signal, dealType) != null && (c.signals[dealType]?.dealCount ?? 0) >= 3)
    .sort((a, b) => getSignal(b, signal, dealType) - getSignal(a, signal, dealType))
    .slice(0, 10)
    .map((c, i) => ({
      순위: i + 1, 단지: c.aptNm, 구: c.gu,
      [signal]: getSignal(c, signal, dealType),
      거래: c.signals[dealType].dealCount, 이상치제외: c.outliers ?? 0,
    }));
  console.log(`\n[검증] ${dealType} ${signal} 상위 10 (minDeals=3):`);
  console.table(top);
}

// `pnpm collect` 로 직접 실행될 때만 배치를 돈다.
//   --rebuild     재수집 없이 시그널만 다시 계산
//   --geocode     재수집 없이 지오코딩만 다시 (KAKAO_REST_KEY 를 나중에 넣었을 때)
//   --with-trade  매매까지 수집 (data.go.kr 활용신청 승인 후)
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.includes('--rebuild')) {
    const r = await rebuildFromRaw();
    if (r.ok) await printTopSignals();
    process.exit(r.ok ? 0 : 1);
  }
  if (process.argv.includes('--geocode')) {
    const r = await geocodeFromRaw();
    process.exit(r.ok ? 0 : 1);
  }
  const kinds = process.argv.includes('--with-trade') ? ['rent', 'trade'] : ['rent'];
  const r = await runBatch({ kinds });
  if (r.ok) await printTopSignals(kinds.includes('trade') ? 'trade' : 'rent');
  process.exit(r.ok ? 0 : 1);
}
