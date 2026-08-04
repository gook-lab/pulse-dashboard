/**
 * 축측 투영(axonometric) — 단지 배치도(3D 조감도)의 좌표 변환.
 *
 * 컴포넌트에서 분리한 이유: 회전과 깊이 정렬이 서로 맞물려 있어서 눈으로는 틀린 걸 못 잡는다.
 * 실제로 월드 좌표로 깊이 정렬했을 때 180° 에서 가림 순서가 정확히 뒤집히는 버그가 있었다.
 *
 * 회전은 90° 4단계가 아니라 **연속 각도**다(마우스로 돌리려면 그래야 한다).
 * 고도(pitch)도 함께 바꾼다 — 위에서 내려다보기(80°)부터 눈높이에 가깝게(10°)까지.
 */

const RAD = Math.PI / 180;

/** 가로 확산 계수. 고도와 무관하게 고정 — 축측 투영에서 x 축 압축은 방위만 따른다. */
export const ISO_X = 0.866;
/** 기본 고도(도). 30° 는 기존 2:1 아이소메트릭과 같은 느낌이다. */
export const PITCH_DEFAULT = 30;
export const PITCH_MIN = 8;    // 더 낮추면 지면이 선이 되어 배치를 못 읽는다
export const PITCH_MAX = 85;   // 더 올리면 건물이 사라진 평면도가 된다

export const clampPitch = (deg: number) => Math.min(PITCH_MAX, Math.max(PITCH_MIN, deg));
/** 방위는 0~360 으로 감는다 — 몇 바퀴를 돌려도 같은 화면이어야 한다. */
export const wrapYaw = (deg: number) => ((deg % 360) + 360) % 360;

/** 월드 좌표를 방위각만큼 회전. 반시계(+)가 화면에서 왼쪽으로 도는 방향이다. */
export function spin(x: number, y: number, yawDeg: number): [number, number] {
  const r = yawDeg * RAD;
  const c = Math.cos(r), s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

/**
 * 로컬 미터(x=동, y=북) + 높이 → 화면 좌표.
 *
 * 고도 φ 에서 지면 깊이는 sin φ 로, 높이는 cos φ 로 눌린다.
 * 위에서 볼수록(φ→90°) 평면도에 가까워지고 건물이 낮아 보이며,
 * 눈높이에 가까울수록(φ→0°) 지면이 납작해지고 건물이 솟는다 — 실제 카메라와 같은 거동.
 */
export function project(x: number, y: number, h = 0, yawDeg = 0, pitchDeg = PITCH_DEFAULT) {
  const [rx, ry] = spin(x, y, yawDeg);
  const p = pitchDeg * RAD;
  return { sx: (rx - ry) * ISO_X, sy: -(rx + ry) * Math.sin(p) - h * Math.cos(p) };
}

/**
 * 화면 깊이 — 클수록 뒤쪽(화면 위). sy 의 지면 성분이 -(rx+ry)·sinφ 이므로 rx+ry 가 곧 깊이다.
 * 고도와는 무관하다(sinφ > 0 인 한 순서가 같다). 방위가 돌면 깊이 축도 같이 돌아야
 * painter's algorithm 이 성립한다.
 */
export function depthAt(x: number, y: number, yawDeg: number) {
  const [rx, ry] = spin(x, y, yawDeg);
  return rx + ry;
}

/**
 * 화면 좌표(h=0 평면) → 로컬 미터. project 의 역이다.
 * 시점을 옮긴 뒤 "지금 화면 중앙이 어느 좌표인가"를 알아야 그 지역을 받아올 수 있다.
 */
export function unproject(sx: number, sy: number, yawDeg = 0, pitchDeg = PITCH_DEFAULT) {
  const a = sx / ISO_X;                       // rx - ry
  const b = -sy / Math.sin(pitchDeg * RAD);   // rx + ry
  const [x, y] = spin((a + b) / 2, (b - a) / 2, -yawDeg);
  return { x, y };
}

/**
 * 링이 반시계(CCW)인가 — 신발끈 부호.
 *
 * OSM 건물 외곽선은 방향이 보장되지 않는다(실측: 660동 중 CCW 451 / CW 209).
 * 바깥 법선을 링 방향으로만 구하면 CW 인 32% 는 명암이 정확히 반대로 칠해진다.
 */
export function ringIsCCW(ring: [number, number][]) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a > 0;
}

/**
 * 벽면의 밝기 단계(0=가장 밝음). 빛은 화면에 고정되어 있으므로
 * 회전하면 같은 벽의 밝기가 달라져야 입체로 읽힌다.
 * 연속 각도를 그대로 쓰면 색을 인라인으로 넣어야 해서(토큰 규칙 위반) 단계로 양자화한다.
 */
export function wallTone(
  x1: number, y1: number, x2: number, y2: number,
  yawDeg: number, ccw = true, tones = 3,
) {
  // 바깥 법선: CCW 링이면 (dy, -dx), CW 링이면 그 반대.
  const dx = x2 - x1, dy = y2 - y1;
  const [nx, ny] = spin(ccw ? dy : -dy, ccw ? -dx : dx, yawDeg);
  const len = Math.hypot(nx, ny) || 1;
  // 빛은 화면 왼쪽 위에서. 축측 투영에서 화면 좌우는 (rx-ry), 상하는 (rx+ry) 성분이다.
  const lit = ((nx - ny) / len / Math.SQRT2 + 1) / 2;   // 0(등짐) ~ 1(정면)
  return Math.min(tones - 1, Math.max(0, Math.round((1 - lit) * (tones - 1))));
}

const M_PER_LAT = 111_320;
const mPerLng = (lat: number) => M_PER_LAT * Math.cos((lat * Math.PI) / 180);

/**
 * 로컬 미터 → 위경도. server/realestate/osm.mjs 의 toLocalMeters 역함수이며
 * 같은 평면 근사를 쓴다(화면 범위 수백 m 에서는 오차가 무의미하다).
 */
export function metersToLatLng(x: number, y: number, originLat: number, originLng: number) {
  return { lat: originLat + y / M_PER_LAT, lng: originLng + x / mPerLng(originLat) };
}

/** 위경도 → 로컬 미터. 서버가 내려준 격자 칸 중심을 화면 좌표계로 옮길 때 쓴다. */
export function latLngToMeters(lat: number, lng: number, originLat: number, originLng: number) {
  return { x: (lng - originLng) * mPerLng(originLat), y: (lat - originLat) * M_PER_LAT };
}

/** 화면상 북쪽 각도(0 = 위, 시계방향 +). 나침반 바늘에 그대로 넣는다. */
export function northDegrees(yawDeg: number, pitchDeg = PITCH_DEFAULT) {
  const p = project(0, 1, 0, yawDeg, pitchDeg);
  return (Math.atan2(p.sx, -p.sy) * 180) / Math.PI;
}

/** 열린 선(도로) → 폭을 가진 띠 폴리곤. 선으로 그리면 축측 투영에서 두께가 어긋난다. */
export function ribbon(pts: [number, number][], width: number): [number, number][] {
  const half = width / 2;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [px, py] = pts[Math.max(0, i - 1)];
    const [nx, ny] = pts[Math.min(pts.length - 1, i + 1)];
    const dx = nx - px, dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * half, oy = (dx / len) * half;
    left.push([x + ox, y + oy]);
    right.push([x - ox, y - oy]);
  }
  return [...left, ...right.reverse()];
}

/** 화면 좌표 목록 → 닫힌 SVG path. */
export const path = (pts: { sx: number; sy: number }[]) =>
  pts.map((p, i) => `${i ? 'L' : 'M'} ${p.sx.toFixed(1)} ${p.sy.toFixed(1)}`).join(' ') + ' Z';
