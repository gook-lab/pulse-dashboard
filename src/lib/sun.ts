/**
 * 태양 위치 계산 — 일조·그림자 시뮬레이션의 유일한 입력.
 *
 * 외부 데이터가 필요 없다. 위경도와 시각만 있으면 천문학 공식으로 나온다
 * (일조량 API 같은 건 존재하지 않고, 있어도 단지 단위로는 못 쓴다).
 * 알고리즘은 표준 저궤도 근사(NOAA/suncalc 계열) — 건물 그림자 정도의 정밀도에는 충분하다.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
/** 황도 경사각. */
const OBLIQUITY = 23.4397 * RAD;

const toDays = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;

export interface SolarPosition {
  /** 지평선 위 고도(도). 0 이하면 해가 없다. */
  altitude: number;
  /** 방위(도). 북=0, 동=90, 남=180, 서=270. */
  azimuth: number;
}

/** 주어진 시각·지점의 태양 고도·방위. */
export function solarPosition(date: Date, lat: number, lng: number): SolarPosition {
  const d = toDays(date);

  // 태양 황경
  const M = RAD * (357.5291 + 0.985_600_28 * d);                 // 평균 근점이각
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;                     // 황경

  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));       // 적위
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L)); // 적경

  const lw = RAD * -lng;
  const siderealTime = RAD * (280.16 + 360.985_623_5 * d) - lw;
  const H = siderealTime - ra;                                    // 시간각
  const phi = RAD * lat;

  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // atan2 결과는 남쪽 기준이라 180 을 더해 북쪽 기준으로 옮긴다.
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));

  return {
    altitude: altitude / RAD,
    azimuth: (azSouth / RAD + 180 + 360) % 360,
  };
}

/**
 * 그림자 방향과 길이.
 * 그림자는 태양 반대편으로 뻗고, 길이는 고도가 낮을수록 급격히 길어진다(h/tan).
 * 고도가 아주 낮으면 길이가 발산하므로 상한을 둔다 — 화면 밖으로 무한히 뻗는 폴리곤은 의미가 없다.
 */
export function shadowVector(sun: SolarPosition, heightM: number, maxLen = 400) {
  if (sun.altitude <= 1) return null;   // 일출·일몰 근처는 그림자를 그리지 않는다
  const len = Math.min(heightM / Math.tan(sun.altitude * RAD), maxLen);
  const a = sun.azimuth * RAD;
  // 로컬 좌표는 x=동, y=북. 태양이 남(180°)에 있으면 그림자는 북(y+)으로 간다.
  return { dx: -Math.sin(a) * len, dy: -Math.cos(a) * len, len };
}

/** 볼록 껍질(Andrew's monotone chain) — 건물 밑면과 그림자 밑면을 하나의 폴리곤으로 묶는다. */
export function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const p = [...pts].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const build = (src: [number, number][]) => {
    const out: [number, number][] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    return out;
  };

  const lower = build(p);
  const upper = build([...p].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 서울 기준 대표 절기 — 계절별 그림자 차이를 한눈에 보게 하는 프리셋. */
export const SUN_PRESETS = [
  { key: 'winter', label: '동지', month: 11, day: 21 },
  { key: 'equinox', label: '춘분', month: 2, day: 21 },
  { key: 'summer', label: '하지', month: 5, day: 21 },
] as const;

export type SunPresetKey = typeof SUN_PRESETS[number]['key'];

/**
 * KST 기준 시각을 만든다. 브라우저 타임존이 무엇이든 같은 결과가 나와야 한다
 * (서울 아파트의 일조를 보는 화면이므로 로컬 타임존에 흔들리면 안 된다).
 */
export function kstDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month, day, hour - 9, minute));
}
