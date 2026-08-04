/**
 * 배치도 **뷰 정책** — 줌 한계·상세도·라벨 배치처럼 화면이 어떻게 보일지 정하는 순수 규칙.
 *
 * 컴포넌트 파일에서 분리한 이유가 둘이다:
 *  ① Fast Refresh — 컴포넌트 모듈이 컴포넌트 아닌 것을 함께 export 하면 HMR 이 통째로
 *     리마운트된다("Could not Fast Refresh" 경고 + 편집할 때마다 카메라·구역 상태가 날아간다).
 *  ② 여기 값들은 눈으로 검증하기 어려운 임계값이라 테스트로 잠가야 한다.
 */

/** 주변 인프라. 역세권·학군·편의시설은 사람이 실제로 판단하는 근거다. */
export interface Poi {
  kind: 'station' | 'school' | 'hospital' | 'mart' | 'park';
  name: string | null;
  x: number;
  y: number;
}

/** 자리가 모자랄 때 먼저 살아남는 순서. */
export const POI_ORDER: Poi['kind'][] = ['station', 'school', 'hospital', 'mart', 'park'];

/** 같은 시설로 볼 거리(m). 인접 칸이 겹쳐 주거나 노드+면으로 두 번 매핑되는 일이 흔하다. */
const POI_SAME_M = 40;

/** 라벨 상자가 겹치는가 — 중심 간 거리가 두 상자 반폭의 합보다 작으면 겹친다. */
export function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

/** 여러 칸에서 온 POI 를 합친다. 종류·이름이 같고 가까우면 같은 시설로 본다. */
export function dedupePois(list: Poi[]): Poi[] {
  const out: Poi[] = [];
  for (const p of list) {
    const dup = out.some((q) => q.kind === p.kind && q.name === p.name
      && Math.hypot(q.x - p.x, q.y - p.y) < POI_SAME_M);
    if (!dup) out.push(p);
  }
  return out;
}

/**
 * 인프라 아이콘 — 16×16 기준, 중심 (0,0). 이모지를 쓰지 않는다(플랫폼마다 모양·크기가 달라진다).
 * 모양만으로 종류가 읽혀야 하므로 관습적인 기호를 쓴다: 역=원과 가로줄, 병원=십자, 나무=삼각형.
 */
export const POI_GLYPH: Record<Poi['kind'], string> = {
  station: 'M -3.4 0 L 3.4 0 M 0 -3.4 A 3.4 3.4 0 1 1 -0.01 -3.4',
  school: 'M -4 -1.2 L 0 -3.4 L 4 -1.2 L 0 1 Z M 2.6 -0.4 L 2.6 2.4',
  hospital: 'M 0 -3.4 L 0 3.4 M -3.4 0 L 3.4 0',
  mart: 'M -3 -1.4 L 3 -1.4 L 2.4 3 L -2.4 3 Z M -1.6 -1.4 A 1.6 2 0 0 1 1.6 -1.4',
  park: 'M 0 -3.6 L 2.8 1.2 L -2.8 1.2 Z M 0 1.2 L 0 3.4',
};

export const POI_LABEL: Record<Poi['kind'], string> = {
  station: '역', school: '학교', hospital: '병원', mart: '마트', park: '공원',
};


/** 줌 한계. 0.3× 면 반경 1km 가 들어오고, 8× 면 동 하나를 들여다본다. */
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 8;
/** 드래그 감도 — 화면 100px 에 방위 90°, 고도 45°. */
export const YAW_PER_PX = 0.9;
export const PITCH_PER_PX = 0.45;

/** 투영된 화면 좌표. */
export type XY = { sx: number; sy: number };


/** 칸 하나를 기다리는 한도(ms). Overpass 콜드 응답이 50초까지 갔다 — 그 동안 큐가 멈춘다. */
export const CELL_TIMEOUT_MS = 18_000;
/** 동시에 받을 구역 수. Overpass 는 공용 무료 서버라 무한정 늘릴 수 없다. */
export const MAX_INFLIGHT = 3;
/** 세로 1px 당 확대 지수. 100px 끌면 약 2.2배. */
export const DRAG_ZOOM_RATE = 0.008;

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/**
 * 드래그가 무엇을 하는가. 3D 뷰어 관례를 따른다.
 *   왼쪽 = 궤도 회전 · 가운데/Shift = 이동 · 오른쪽/Alt = 확대
 * 버튼은 누른 순간 정해지지만 보조키는 끄는 도중에도 바뀐다 — 그래서 둘을 나눠 받는다.
 */
export function dragMode(button: number, mods: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) {
  if (button === 2 || mods.altKey || mods.ctrlKey || mods.metaKey) return 'zoom' as const;
  if (button === 1 || mods.shiftKey) return 'pan' as const;
  return 'orbit' as const;
}

/**
 * 세로 드래그 → 확대 배율. 위로 끌면 가까워진다(휠 위로 = 확대와 같은 방향).
 * 지수를 쓰는 이유: 배율은 곱셈이라 같은 픽셀을 끌면 어느 배율에서든 같은 비율로 변해야 한다.
 */
export const dragZoomFactor = (dy: number) => Math.exp(-dy * DRAG_ZOOM_RATE);

/** 퇴출 여유 배수 — 상한을 이만큼 넘겨야 실제로 버린다. */
export const EVICT_SLACK = 1.6;

export const cellBudget = (zoom: number) => Math.round(Math.min(56, Math.max(10, 16 / zoom)));

/**
 * 줌에 따른 상세도. 축소하면 화면에 수백 동이 들어오는데 전부 그림자까지 그리면
 * 회전이 끊긴다. 멀리서는 큰 덩어리만, 가까이서는 전부.
 */
export function levelOfDetail(zoom: number) {
  return {
    shadows: zoom >= 0.75,          // 그림자 = 볼록껍질 계산, 가장 비싸다
    paths: zoom >= 0.7,             // 보행로는 축소하면 실뭉치가 된다
    labels: zoom >= 0.9,            // 층수 라벨
    floors: zoom >= 1.1,            // 층 구분선 — 확대했을 때만(선 수가 층수 × 벽 수로 늘어난다)
    farFloors: zoom >= 1.8,         // 주변 건물까지 층을 넣으면 장면 전체에 질감이 생긴다
    pois: zoom >= 0.45,             // 인프라 아이콘
    poiNames: zoom >= 0.9,          // 아이콘 옆 이름
    roadNames: zoom >= 1.1,         // 큰길 이름
    edges: zoom >= 1.5,             // 겹친 회색 덩어리를 떼어놓는 외곽선
    minArea: zoom >= 0.7 ? 0 : zoom >= 0.45 ? 150 : 400,   // 작은 부속건물 제외
  };
}

