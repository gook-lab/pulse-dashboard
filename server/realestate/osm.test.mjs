import { describe, it, expect } from 'vitest';
import {
  CELL_M, cellIndex, cellCenter, inKorea, shiftCell,
  classify, roadWidth, polygonArea, toLocalMeters, normalizeGround,
  isHidden, clipRuns, buildingLevels, normalizeBuildings, clipPolygon, outerRings,
  classifyPoi, normalizePois, NAMED_ROAD,
} from './osm.mjs';

const SEOUL = { lat: 37.5665, lng: 126.978 };

describe('격자 — 같은 칸을 두 번 받지 않기 위한 기준', () => {
  it('칸 중심은 원래 좌표에서 반 칸 이내다', () => {
    const { i, j } = cellIndex(SEOUL.lat, SEOUL.lng);
    const c = cellCenter(i, j);
    const dy = Math.abs(c.lat - SEOUL.lat) * 111_320;
    const dx = Math.abs(c.lng - SEOUL.lng) * 111_320 * Math.cos((SEOUL.lat * Math.PI) / 180);
    expect(dy).toBeLessThanOrEqual(CELL_M / 2);
    expect(dx).toBeLessThanOrEqual(CELL_M / 2);
  });

  it('칸 중심을 다시 넣으면 같은 칸이 나온다 — 경계에서 흔들리면 무한히 다시 받는다', () => {
    const a = cellIndex(SEOUL.lat, SEOUL.lng);
    const c = cellCenter(a.i, a.j);
    expect(cellIndex(c.lat, c.lng)).toEqual(a);
  });

  it('한 칸 안에서 움직이면 같은 칸이다', () => {
    const base = cellIndex(SEOUL.lat, SEOUL.lng);
    const c = cellCenter(base.i, base.j);
    for (const [dLat, dLng] of [[0.0002, 0], [0, 0.0002], [-0.0002, -0.0002]]) {
      expect(cellIndex(c.lat + dLat, c.lng + dLng)).toEqual(base);
    }
  });

  it('한 칸(200m) 넘게 가면 다른 칸이다', () => {
    const a = cellIndex(SEOUL.lat, SEOUL.lng);
    const b = cellIndex(SEOUL.lat + 250 / 111_320, SEOUL.lng);
    expect(b.i).not.toBe(a.i);
  });

  it('이웃 칸은 인덱스가 1 만 다르다 — 칸 사이에 틈이 생기면 안 된다', () => {
    const a = cellIndex(SEOUL.lat, SEOUL.lng);
    const north = cellIndex(SEOUL.lat + CELL_M / 111_320, SEOUL.lng);
    expect(Math.abs(north.i - a.i)).toBe(1);
  });
});

describe('inKorea — 임의 지역 Overpass 중계기가 되지 않게', () => {
  it('국내는 통과', () => {
    expect(inKorea(37.5665, 126.978)).toBe(true);
    expect(inKorea(35.1796, 129.0756)).toBe(true);   // 부산
    expect(inKorea(33.4996, 126.5312)).toBe(true);   // 제주
  });

  it('국외는 거부', () => {
    expect(inKorea(48.8566, 2.3522)).toBe(false);    // 파리
    expect(inKorea(0, 0)).toBe(false);
    expect(inKorea(37.5665, 0)).toBe(false);
  });
});

describe('shiftCell — 칸 캐시를 다른 원점으로 옮기기', () => {
  const cell = {
    i: 1, j: 2,
    center: { lat: SEOUL.lat, lng: SEOUL.lng },
    buildings: [{ id: '1', ring: [[0, 0], [10, 0], [10, 10], [0, 10]], area: 100, levels: 5, name: null, dist: 7, apartment: true }],
    ground: [{ kind: 'road', closed: false, width: 8, pts: [[0, 0], [50, 0]] }],
  };

  it('같은 원점이면 좌표가 그대로다', () => {
    const out = shiftCell(cell, SEOUL.lat, SEOUL.lng);
    expect(out.buildings[0].ring[0]).toEqual([0, 0]);
    expect(out.buildings[0].ring[1]).toEqual([10, 0]);
  });

  it('원점이 남쪽으로 가면 좌표는 북쪽(+y)으로 밀린다', () => {
    const out = shiftCell(cell, SEOUL.lat - 200 / 111_320, SEOUL.lng);
    expect(out.buildings[0].ring[0][1]).toBeCloseTo(200, 0);
    expect(out.buildings[0].ring[0][0]).toBeCloseTo(0, 1);
  });

  it('평행이동이므로 모양(면적)이 보존된다 — 기하를 다시 계산하지 않는 근거', () => {
    const before = polygonArea(cell.buildings[0].ring.map(([x, y]) => ({ x, y })));
    const out = shiftCell(cell, SEOUL.lat + 0.01, SEOUL.lng - 0.01);
    const after = polygonArea(out.buildings[0].ring.map(([x, y]) => ({ x, y })));
    expect(after).toBeCloseTo(before, 1);
  });

  it('dist 는 새 원점 기준으로 다시 잰다 — near/far 판정의 근거', () => {
    const out = shiftCell(cell, SEOUL.lat - 500 / 111_320, SEOUL.lng);
    expect(out.buildings[0].dist).toBeGreaterThan(490);
    expect(out.buildings[0].dist).toBeLessThan(520);
  });

  it('지면도 함께 옮기고 종류·폭은 유지한다', () => {
    const out = shiftCell(cell, SEOUL.lat, SEOUL.lng - 100 / (111_320 * Math.cos((SEOUL.lat * Math.PI) / 180)));
    expect(out.ground[0].kind).toBe('road');
    expect(out.ground[0].width).toBe(8);
    expect(out.ground[0].pts[0][0]).toBeCloseTo(100, 0);
  });

  it('키는 칸 인덱스로 만든다 — 프론트가 중복 병합을 판단하는 값', () => {
    expect(shiftCell(cell, SEOUL.lat, SEOUL.lng).key).toBe('1_2');
  });
});

describe('toLocalMeters ↔ 위경도', () => {
  it('북쪽 1도는 약 111km', () => {
    expect(toLocalMeters(SEOUL.lat + 1, SEOUL.lng, SEOUL.lat, SEOUL.lng).y).toBeCloseTo(111_320, 0);
  });

  it('서울 위도에서 경도 1도는 위도 1도보다 짧다', () => {
    const east = toLocalMeters(SEOUL.lat, SEOUL.lng + 1, SEOUL.lat, SEOUL.lng).x;
    expect(east).toBeLessThan(111_320);
    expect(east).toBeGreaterThan(80_000);
  });
});

describe('classify / roadWidth — 지면 분류', () => {
  it('건물이 먼저다 — building 태그가 있으면 조경으로 새지 않는다', () => {
    expect(classify({ building: 'apartment', landuse: 'grass' })).toBe('building');
  });

  it('공원·녹지는 green, 물은 water, 길은 road', () => {
    expect(classify({ leisure: 'park' })).toBe('green');
    expect(classify({ landuse: 'grass' })).toBe('green');
    expect(classify({ natural: 'water' })).toBe('water');
    expect(classify({ highway: 'residential' })).toBe('road');
  });

  it('관심 없는 태그는 null', () => {
    expect(classify({ amenity: 'cafe' })).toBeNull();
    expect(classify({})).toBeNull();
  });

  it('차로 수가 있으면 그것으로, 없으면 등급으로 폭을 추정한다', () => {
    expect(roadWidth({ lanes: '4', highway: 'residential' })).toBeCloseTo(12.8);
    expect(roadWidth({ highway: 'residential' })).toBe(7);
    expect(roadWidth({ highway: 'footway' })).toBe(2.2);
    expect(roadWidth({})).toBe(6);
  });
});

describe('normalizeGround — 열린 길과 닫힌 면 구분', () => {
  const way = (tags, coords) => ({ type: 'way', id: 1, tags, geometry: coords.map(([lat, lon]) => ({ lat, lon })) });

  it('닫힌 공원은 면으로, 열린 도로는 폭을 가진 선으로 나온다', () => {
    const d = 0.001;
    const out = normalizeGround({
      elements: [
        way({ leisure: 'park' }, [[SEOUL.lat, SEOUL.lng], [SEOUL.lat + d, SEOUL.lng], [SEOUL.lat + d, SEOUL.lng + d], [SEOUL.lat, SEOUL.lng + d], [SEOUL.lat, SEOUL.lng]]),
        way({ highway: 'residential' }, [[SEOUL.lat, SEOUL.lng], [SEOUL.lat, SEOUL.lng + d]]),
      ],
    }, SEOUL.lat, SEOUL.lng);

    const park = out.find((g) => g.kind === 'green');
    const road = out.find((g) => g.kind === 'road');
    expect(park.closed).toBe(true);
    expect(park.width).toBeUndefined();
    expect(road.closed).toBe(false);
    expect(road.width).toBe(7);
  });

  it('아주 작은 닫힌 면(화단)은 버린다 — 화면만 시끄러워진다', () => {
    const t = 0.00002;   // 약 2m
    const out = normalizeGround({
      elements: [way({ leisure: 'park' }, [[SEOUL.lat, SEOUL.lng], [SEOUL.lat + t, SEOUL.lng], [SEOUL.lat + t, SEOUL.lng + t], [SEOUL.lat, SEOUL.lng + t], [SEOUL.lat, SEOUL.lng]])],
    }, SEOUL.lat, SEOUL.lng);
    expect(out).toHaveLength(0);
  });

  it('열린 녹지(경계선만 있는 것)는 버린다 — 띠로 그릴 폭이 없다', () => {
    const d = 0.001;
    const out = normalizeGround({
      elements: [way({ leisure: 'park' }, [[SEOUL.lat, SEOUL.lng], [SEOUL.lat + d, SEOUL.lng]])],
    }, SEOUL.lat, SEOUL.lng);
    expect(out).toHaveLength(0);
  });
});

describe('isHidden — 땅 위에 없는 것', () => {
  it('터널은 그리지 않는다 — 지하철이 단지 위를 지나가 보인다', () => {
    expect(isHidden({ railway: 'subway', tunnel: 'yes' })).toBe(true);
    expect(isHidden({ highway: 'primary', tunnel: 'building_passage' })).toBe(true);
  });

  it('tunnel=no 는 지상이다', () => {
    expect(isHidden({ highway: 'primary', tunnel: 'no' })).toBe(false);
  });

  it('지하 층(layer<0)은 숨기고, 다리(layer>0)는 그린다', () => {
    expect(isHidden({ highway: 'service', layer: '-1' })).toBe(true);
    expect(isHidden({ highway: 'primary', layer: '1', bridge: 'yes' })).toBe(false);
  });

  it('계획·공사 중인 것은 아직 없는 것이다', () => {
    expect(isHidden({ highway: 'proposed' })).toBe(true);
    expect(isHidden({ highway: 'construction' })).toBe(true);
    expect(isHidden({ building: 'construction' })).toBe(true);
  });

  it('폐선·승강장은 지면 피처가 아니다', () => {
    expect(isHidden({ railway: 'abandoned' })).toBe(true);
    expect(isHidden({ railway: 'platform' })).toBe(true);
    expect(isHidden({ railway: 'rail' })).toBe(false);
  });

  it('지하 건물은 압출하지 않는다', () => {
    expect(isHidden({ building: 'yes', location: 'underground' })).toBe(true);
  });
});

describe('classify — 길의 종류를 나눈다', () => {
  it('보행로·자전거도로·계단은 path — 차도와 같이 그리면 인도 그물이 화면을 덮는다', () => {
    for (const h of ['footway', 'path', 'steps', 'cycleway', 'bridleway', 'track']) {
      expect(classify({ highway: h })).toBe('path');
    }
  });

  it('차도는 road', () => {
    for (const h of ['residential', 'primary', 'service', 'busway', 'pedestrian']) {
      expect(classify({ highway: h })).toBe('road');
    }
  });

  it('지상 철도는 rail, 지하 철도는 아무것도 아니다', () => {
    expect(classify({ railway: 'rail' })).toBe('rail');
    expect(classify({ railway: 'subway', tunnel: 'yes' })).toBeNull();
  });

  it('건물 태그가 있으면 지면보다 우선한다', () => {
    expect(classify({ building: 'apartments', highway: 'footway' })).toBe('building');
  });
});

describe('roadWidth — 폭의 근거 순서', () => {
  it('width 태그가 있으면 그것을 믿는다 (실측: width=1.2 존재)', () => {
    expect(roadWidth({ highway: 'footway', width: '1.2' })).toBeCloseTo(1.2);
    expect(roadWidth({ highway: 'primary', width: '3,5' })).toBeCloseTo(3.5);
  });

  it('말도 안 되는 width 는 무시하고 등급으로 간다', () => {
    expect(roadWidth({ highway: 'residential', width: 'wide' })).toBe(7);
    expect(roadWidth({ highway: 'residential', width: '0.1' })).toBe(7);
  });

  it('보행로는 차도보다 훨씬 좁다', () => {
    expect(roadWidth({ highway: 'footway' })).toBeLessThan(roadWidth({ highway: 'residential' }));
    expect(roadWidth({ highway: 'cycleway' })).toBeLessThan(3);
  });

  it('철도는 선로 수로, 없으면 기본 7m', () => {
    expect(roadWidth({ railway: 'rail' })).toBe(7);
    expect(roadWidth({ railway: 'rail', tracks: '2' })).toBeCloseTo(7.2);
  });

  it('아주 넓은 width 도 상한을 둔다 — 광장이 지도를 덮지 않게', () => {
    expect(roadWidth({ highway: 'primary', width: '400' })).toBe(40);
  });
});

describe('clipRuns — 화면 밖 수 km 를 자른다', () => {
  const line = (n, step = 100) => Array.from({ length: n }, (_, i) => ({ x: (i - n / 2) * step, y: 0 }));

  it('8km 짜리 way 를 상자 크기로 줄인다 (실측 최대 8,188m)', () => {
    const runs = clipRuns(line(80), 200);
    expect(runs).toHaveLength(1);
    expect(runs[0].length).toBeLessThan(10);
  });

  it('경계 밖 점을 하나 남긴다 — 선이 상자 가장자리까지 닿아야 잘린 티가 안 난다', () => {
    const runs = clipRuns(line(80), 200);
    expect(Math.abs(runs[0][0].x)).toBeGreaterThan(200);
    expect(Math.abs(runs[0][runs[0].length - 1].x)).toBeGreaterThan(200);
  });

  it('상자를 두 번 지나가면 런이 둘', () => {
    const zig = [{ x: -500, y: 0 }, { x: 0, y: 0 }, { x: 500, y: 0 },
      { x: 500, y: 500 }, { x: 0, y: 150 }, { x: -500, y: 150 }];
    expect(clipRuns(zig, 200)).toHaveLength(2);
  });

  it('전부 밖이면 아무것도 남지 않는다', () => {
    expect(clipRuns([{ x: 900, y: 900 }, { x: 1000, y: 1000 }], 200)).toHaveLength(0);
  });

  it('전부 안이면 그대로', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    expect(clipRuns(pts, 200)[0]).toHaveLength(3);
  });
});

describe('buildingLevels — 층수를 믿을 수 있는 값만', () => {
  it('정상 값은 그대로', () => {
    expect(buildingLevels({ 'building:levels': '17' })).toBe(17);
  });

  it('오타는 상한으로 — 999층이면 2.8km 짜리 침이 선다', () => {
    expect(buildingLevels({ 'building:levels': '999' })).toBe(123);
  });

  it('숫자가 아니면 null → 프론트가 단지 층수로 채운다', () => {
    expect(buildingLevels({ 'building:levels': '2;3' })).toBeNull();
    expect(buildingLevels({})).toBeNull();
    expect(buildingLevels({ 'building:levels': '-3' })).toBeNull();
  });

  it('지붕 구조물(캐노피·정류장)은 1층 — 층수를 채워 압출하면 없는 건물이 선다', () => {
    expect(buildingLevels({ building: 'roof', 'building:levels': '10' })).toBe(1);
    expect(buildingLevels({ building: 'carport' })).toBe(1);
  });
});

describe('normalizeGround — 실제 응답 모양', () => {
  const S = { lat: 37.5, lng: 127.0 };
  const way = (tags, coords) => ({ type: 'way', id: Math.random(), tags, geometry: coords.map(([lat, lon]) => ({ lat, lon })) });
  const km = (m) => m / 111_320;

  it('긴 도로는 잘려서 나온다', () => {
    const long = [];
    for (let i = -40; i <= 40; i++) long.push([S.lat, S.lng + km(i * 100) * 1.26]);
    const out = normalizeGround({ elements: [way({ highway: 'primary' }, long)] }, S.lat, S.lng, { clipHalf: 200 });
    expect(out).toHaveLength(1);
    const xs = out[0].pts.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1200);
  });

  it('터널 도로는 아예 안 나온다', () => {
    const out = normalizeGround({
      elements: [way({ highway: 'primary', tunnel: 'yes' }, [[S.lat, S.lng], [S.lat, S.lng + km(50)]])],
    }, S.lat, S.lng);
    expect(out).toHaveLength(0);
  });

  it('도시 전체를 덮는 면은 버리지 않고 화면 상자로 자른다', () => {
    // 예전에는 통째로 버렸는데, 그 규칙 때문에 한강·큰 공원이 지도에서 아예 사라졌다.
    const d = km(2000);
    const huge = [[S.lat, S.lng], [S.lat + d, S.lng], [S.lat + d, S.lng + d], [S.lat, S.lng + d], [S.lat, S.lng]];
    const out = normalizeGround({ elements: [way({ landuse: 'grass' }, huge)] }, S.lat, S.lng, { clipHalf: 200 });
    expect(out).toHaveLength(1);
    const xs = out[0].pts.map((p) => p[0]);
    expect(Math.max(...xs)).toBeLessThan(400);
  });

  it('보행로도 지면으로 나오되 폭이 다르다', () => {
    const out = normalizeGround({
      elements: [
        way({ highway: 'footway' }, [[S.lat, S.lng], [S.lat, S.lng + km(50)]]),
        way({ highway: 'residential' }, [[S.lat, S.lng], [S.lat + km(50), S.lng]]),
      ],
    }, S.lat, S.lng);
    const p = out.find((g) => g.kind === 'path');
    const r = out.find((g) => g.kind === 'road');
    expect(p.width).toBeLessThan(r.width);
  });
});

describe('normalizeBuildings — 압출 대상', () => {
  const S = { lat: 37.5, lng: 127.0 };
  const km = (m) => m / 111_320;
  const box = (size) => {
    const d = km(size);
    return [[S.lat, S.lng], [S.lat + d, S.lng], [S.lat + d, S.lng + d * 1.26], [S.lat, S.lng + d * 1.26], [S.lat, S.lng]]
      .map(([lat, lon]) => ({ lat, lon }));
  };

  it('공사 중인 건물은 세우지 않는다', () => {
    const out = normalizeBuildings({
      elements: [{ type: 'way', id: 1, tags: { building: 'construction' }, geometry: box(30) }],
    }, S.lat, S.lng);
    expect(out).toHaveLength(0);
  });

  it('지하 건물은 세우지 않는다', () => {
    const out = normalizeBuildings({
      elements: [{ type: 'way', id: 2, tags: { building: 'yes', location: 'underground' }, geometry: box(30) }],
    }, S.lat, S.lng);
    expect(out).toHaveLength(0);
  });

  it('층수 오타는 상한을 받는다', () => {
    const out = normalizeBuildings({
      elements: [{ type: 'way', id: 3, tags: { building: 'yes', 'building:levels': '9999' }, geometry: box(30) }],
    }, S.lat, S.lng);
    expect(out[0].levels).toBe(123);
  });
});

describe('clipPolygon — 한강·큰 공원을 버리지 않고 자른다', () => {
  const box = (r) => [{ x: -r, y: -r }, { x: r, y: -r }, { x: r, y: r }, { x: -r, y: r }];

  it('상자보다 큰 면은 상자 크기로 잘린다 (이전에는 통째로 버려졌다)', () => {
    const c = clipPolygon(box(5000), 200);
    const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
    expect(Math.max(...xs)).toBeCloseTo(200);
    expect(Math.min(...xs)).toBeCloseTo(-200);
    expect(Math.max(...ys)).toBeCloseTo(200);
  });

  it('상자 안 폴리곤은 그대로 둔다', () => {
    const tri = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 50 }];
    expect(clipPolygon(tri, 200)).toHaveLength(3);
  });

  it('완전히 밖이면 아무것도 안 남는다', () => {
    expect(clipPolygon([{ x: 900, y: 900 }, { x: 1000, y: 900 }, { x: 1000, y: 1000 }], 200)).toHaveLength(0);
  });

  it('걸친 면은 경계에서 잘린 새 꼭짓점을 만든다', () => {
    const c = clipPolygon([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }, { x: 0, y: 100 }], 200);
    expect(c.every((p) => p.x <= 200 + 1e-9)).toBe(true);
    expect(c.length).toBeGreaterThanOrEqual(4);
  });

  it('잘라도 면적이 남는다 — 0 이면 화면에서 사라진 것과 같다', () => {
    const c = clipPolygon(box(5000), 200);
    expect(polygonArea(c)).toBeCloseTo(400 * 400, 0);
  });
});

describe('outerRings — 멀티폴리곤 relation', () => {
  const w = (coords) => ({ type: 'way', role: 'outer', geometry: coords.map(([lat, lon]) => ({ lat, lon })) });

  it('이어지는 outer 멤버를 하나의 링으로 잇는다', () => {
    const rel = {
      type: 'relation',
      members: [
        w([[0, 0], [0, 1]]),
        w([[0, 1], [1, 1]]),
        w([[1, 1], [0, 0]]),
      ],
    };
    const rings = outerRings(rel);
    expect(rings).toHaveLength(1);
    expect(rings[0].length).toBeGreaterThanOrEqual(4);
  });

  it('멤버가 뒤집혀 있어도 잇는다 — OSM 은 방향을 보장하지 않는다', () => {
    const rel = {
      type: 'relation',
      members: [
        w([[0, 0], [0, 1]]),
        w([[1, 1], [0, 1]]),   // 뒤집힌 방향
        w([[1, 1], [0, 0]]),
      ],
    };
    expect(outerRings(rel)).toHaveLength(1);
  });

  it('inner(구멍) 멤버는 무시한다', () => {
    const rel = {
      type: 'relation',
      members: [
        w([[0, 0], [0, 1]]), w([[0, 1], [1, 1]]), w([[1, 1], [0, 0]]),
        { type: 'way', role: 'inner', geometry: [{ lat: 0.2, lon: 0.2 }, { lat: 0.3, lon: 0.3 }] },
      ],
    };
    expect(outerRings(rel)).toHaveLength(1);
  });

  it('멤버가 없으면 빈 배열', () => {
    expect(outerRings({ type: 'relation' })).toEqual([]);
  });
});

describe('normalizeGround — relation 면도 지면으로 나온다', () => {
  const S = { lat: 37.5, lng: 127.0 };
  const km = (m) => m / 111_320;

  it('한강 같은 거대 water relation 이 잘려서 나온다', () => {
    const d = km(4000);
    const rel = {
      type: 'relation',
      tags: { natural: 'water', name: '한강' },
      members: [{
        type: 'way', role: 'outer',
        geometry: [
          { lat: S.lat - d, lon: S.lng - d }, { lat: S.lat - d, lon: S.lng + d },
          { lat: S.lat + d, lon: S.lng + d }, { lat: S.lat + d, lon: S.lng - d },
          { lat: S.lat - d, lon: S.lng - d },
        ],
      }],
    };
    const out = normalizeGround({ elements: [rel] }, S.lat, S.lng, { clipHalf: 200 });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('water');
    const xs = out[0].pts.map((p) => p[0]);
    expect(Math.max(...xs)).toBeLessThan(400);   // 잘렸다
  });
});

describe('classifyPoi — 주변 인프라', () => {
  it('역·학교·병원·마트를 알아본다', () => {
    expect(classifyPoi({ railway: 'station' })).toBe('station');
    expect(classifyPoi({ amenity: 'school' })).toBe('school');
    expect(classifyPoi({ amenity: 'clinic' })).toBe('hospital');
    expect(classifyPoi({ shop: 'supermarket' })).toBe('mart');
  });

  it('지하 역도 찍는다 — isHidden 은 지오메트리 규칙이지 표시 규칙이 아니다', () => {
    // 지하철역은 대부분 tunnel 이다. 이걸 거르면 역세권이 통째로 사라진다.
    expect(classifyPoi({ railway: 'station', tunnel: 'yes' })).toBe('station');
    expect(classifyPoi({ railway: 'station', location: 'underground' })).toBe('station');
  });

  it('폐역·공사중은 제외', () => {
    expect(classifyPoi({ railway: 'abandoned' })).toBeNull();
    expect(classifyPoi({ railway: 'construction' })).toBeNull();
  });

  it('너무 흔한 것은 넣지 않는다 — 아이콘이 지도를 덮는다', () => {
    expect(classifyPoi({ shop: 'convenience' })).toBeNull();
    expect(classifyPoi({ amenity: 'cafe' })).toBeNull();
    expect(classifyPoi({ highway: 'bus_stop' })).toBeNull();
  });

  it('이름 없는 공원은 아이콘을 달지 않는다 — 이미 초록 면으로 보인다', () => {
    expect(classifyPoi({ leisure: 'park' })).toBeNull();
    expect(classifyPoi({ leisure: 'park', name: '절고개공원' })).toBe('park');
  });
});

describe('normalizePois', () => {
  const S = { lat: 37.5, lng: 127.0 };
  const km = (m) => m / 111_320;
  const node = (tags, dLat = 0, dLng = 0) => ({ type: 'node', id: Math.random(), tags, lat: S.lat + dLat, lon: S.lng + dLng });

  it('노드는 좌표 그대로, 면은 중심점으로 접는다', () => {
    const area = {
      type: 'way', id: 1, tags: { amenity: 'school', name: '중앙초' },
      geometry: [
        { lat: S.lat, lon: S.lng }, { lat: S.lat + km(100), lon: S.lng },
        { lat: S.lat + km(100), lon: S.lng + km(100) }, { lat: S.lat, lon: S.lng + km(100) },
      ],
    };
    const out = normalizePois({ elements: [area] }, S.lat, S.lng, { clipHalf: 300 });
    expect(out).toHaveLength(1);
    expect(out[0].y).toBeGreaterThan(0);   // 중심이 북쪽으로 치우친다
  });

  it('노드와 면으로 중복 매핑된 같은 시설은 하나로 합친다', () => {
    const els = [
      node({ amenity: 'school', name: '중앙초' }),
      { type: 'way', id: 2, tags: { amenity: 'school', name: '중앙초' }, geometry: [{ lat: S.lat, lon: S.lng }, { lat: S.lat + km(10), lon: S.lng }] },
    ];
    expect(normalizePois({ elements: els }, S.lat, S.lng)).toHaveLength(1);
  });

  it('상자 밖은 버린다', () => {
    const out = normalizePois({ elements: [node({ railway: 'station', name: '먼역' }, km(5000))] }, S.lat, S.lng, { clipHalf: 300 });
    expect(out).toHaveLength(0);
  });

  it('우선순위 순으로 정렬된다 — 자리가 모자라면 역이 먼저 살아남는다', () => {
    const els = [
      node({ leisure: 'park', name: '공원' }, km(10)),
      node({ railway: 'station', name: '역' }, km(20)),
      node({ amenity: 'school', name: '학교' }, km(30)),
    ];
    const out = normalizePois({ elements: els }, S.lat, S.lng);
    expect(out.map((p) => p.kind)).toEqual(['station', 'school', 'park']);
  });
});

describe('NAMED_ROAD — 주택가 이름길도 대상', () => {
  it('간선도로만 넣으면 주택가에 이름이 하나도 안 뜬다', () => {
    // 한국 주소의 ○○로·○○길은 대부분 residential 로 매핑된다.
    expect(NAMED_ROAD.test('residential')).toBe(true);
    expect(NAMED_ROAD.test('unclassified')).toBe(true);
    expect(NAMED_ROAD.test('primary')).toBe(true);
  });

  it('보행로·서비스도로는 제외 — 이름을 붙이면 글자가 지도를 덮는다', () => {
    expect(NAMED_ROAD.test('footway')).toBe(false);
    expect(NAMED_ROAD.test('service')).toBe(false);
    expect(NAMED_ROAD.test('path')).toBe(false);
  });
});
