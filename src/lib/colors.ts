// 등락 색상 컨벤션. 기본 = 국제식(초록 상승 / 빨강 하락).
// korea 모드는 설정 토글(빨강 상승 / 파랑 하락).
export type ColorMode = 'global' | 'korea';

export interface UpDown { up: string; down: string; }

const PALETTE: Record<ColorMode, UpDown> = {
  global: { up: '#16C784', down: '#EA3943' },
  korea: { up: '#F6465D', down: '#4C82FB' },
};

export const colors = (mode: ColorMode): UpDown => PALETTE[mode];

/** 등락률 부호에 따른 색. 0은 상승색으로 취급하지 않고 중립 처리하려면 호출부에서 분기. */
export const signColor = (pct: number, mode: ColorMode): string =>
  pct >= 0 ? PALETTE[mode].up : PALETTE[mode].down;

/** 히트맵 블록 배경색: -3%~+3%를 빨강↔중립↔초록으로 보간 (국제식 기준, korea면 반전). */
export function heatColor(pct: number, mode: ColorMode): string {
  const c = Math.max(-3, Math.min(3, pct)) / 3; // -1..1
  const positiveIsGreen = mode === 'global';
  const g = positiveIsGreen ? c : -c;           // korea면 부호 뒤집어 색만 스왑
  if (g >= 0) {
    const t = g;
    return `rgb(${Math.round(65 - 47 * t)},${Math.round(75 + 83 * t)},${Math.round(94 - 35 * t)})`;
  }
  const t = -g;
  return `rgb(${Math.round(65 + 127 * t)},${Math.round(75 - 18 * t)},${Math.round(94 - 40 * t)})`;
}

export const fmt = (n: number, dec: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

/* ─────────────────────────────────────────────────────────────────────────
   스크리너 시그널 색상 — signColor 로는 안 되는 이유
   signColor 는 부호(pct >= 0)만 본다. 그래서:
     jeonseRatio (0~1, 항상 양수)   → 전부 상승색. 0.4 나 0.9 나 같은 색
     volumeRatio (배수, 1.0=평균)   → 전부 상승색. 거래 절벽 0.2배가 초록
     high52wPct  (0=신고가, 항상 ≤0) → 전부 하락색. 신고가 단지가 빨강
   heatColor 도 ±3% 클램프라 주식 일간 등락 전용이다(±40% 모멘텀에 못 씀).
   → 시그널마다 색 도메인을 명시하고 그 안에서 보간한다.
   ───────────────────────────────────────────────────────────────────────── */

/** 판단 유보(중립·관망 의견) 태그 색. 등락과 무관해 colorMode 영향 없음. */
export const HOLD = '#E0A838';
/** 연결/실시간 상태 표시(도트·태그). 등락 팔레트와 값이 겹쳐도 의미가 달라 별도 상수로 참조. */
export const STATUS_LIVE = '#16C784';
export const STATUS_DOWN = '#EA3943';

/** 데이터 부족(계산 불가)·저거래 단지. 지도에서 회색 마커. */
export const MUTED = '#2c3444';
/** 경고(배치 신선도 등). 등락과 무관해 colorMode 영향 없음. */
export const WARN = '#F0B90B';
/** 양극형 시그널의 중립점. */
const NEUTRAL = '#3d4655';
/** 단극형 시그널의 최대 강도. --brand 와 동일. */
const BRAND = '#7c6cff';

export type SignalKey =
  | 'momentum3' | 'momentum6' | 'momentum12'
  | 'high52wPct' | 'volumeRatio' | 'jeonseRatio' | 'rs';

export interface ColorDomain {
  min: number;
  mid: number;
  max: number;
  /**
   * true  = 등락형. up/down 팔레트를 쓰고 colorMode(korea)에서 반전된다.
   * false = 강도형. 높고 낮음에 좋고 나쁨이 없어 반전하지 않는다(설계 미해결 결정의 기본값).
   *         회색 → 브랜드색 단일 램프로 "세기"만 표현한다.
   */
  bipolar: boolean;
}

export const SIGNAL_DOMAIN: Record<SignalKey, ColorDomain> = {
  momentum3: { min: -15, mid: 0, max: 15, bipolar: true },
  momentum6: { min: -20, mid: 0, max: 20, bipolar: true },
  momentum12: { min: -30, mid: 0, max: 30, bipolar: true },
  // 0 이 신고가라 상단이 곧 최고점. mid 는 "고점 대비 10% 아래".
  high52wPct: { min: -30, mid: -10, max: 0, bipolar: true },
  volumeRatio: { min: 0.3, mid: 1, max: 3, bipolar: false },
  jeonseRatio: { min: 0.4, mid: 0.6, max: 0.85, bipolar: false },
  rs: { min: -15, mid: 0, max: 15, bipolar: true },
};

const hex2rgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];
// PALETTE 가 대문자 hex(#16C784)라 보간 결과도 대문자로 맞춘다.
// 소문자로 두면 `color === colors(mode).up` 같은 문자열 비교가 조용히 실패한다.
const rgb2hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('').toUpperCase();

/** 두 hex 사이 선형 보간. t 는 0..1 로 클램프. */
export function lerpHex(from: string, to: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const a = hex2rgb(from), b = hex2rgb(to);
  return rgb2hex(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
}

/**
 * 시그널 값 → 색. 도메인 밖은 클램프한다.
 *
 *   bipolar    min ──── mid ──── max
 *              하락색   중립     상승색      (korea 모드면 상승/하락 색 스왑)
 *
 *   단극형     min ──────────── max
 *              흐린 회색        브랜드색     (모드와 무관 — 좋고 나쁨이 없다)
 *
 * value 가 null/NaN 이면 MUTED. 계산 불가를 0 으로 칠하지 않는다.
 */
export function scaleColor(value: number | null | undefined, d: ColorDomain, mode: ColorMode): string {
  if (value == null || !Number.isFinite(value)) return MUTED;

  if (!d.bipolar) {
    const t = (value - d.min) / (d.max - d.min || 1);
    return lerpHex(MUTED, BRAND, t);
  }

  const { up, down } = PALETTE[mode];
  if (value >= d.mid) {
    const t = (value - d.mid) / (d.max - d.mid || 1);
    return lerpHex(NEUTRAL, up, t);
  }
  const t = (d.mid - value) / (d.mid - d.min || 1);
  return lerpHex(NEUTRAL, down, t);
}

/** 범례에 찍을 눈금 5개. 실제 숫자를 보여줘야 "이 파란색 = 전세가율 0.5" 가 읽힌다. */
export function legendStops(d: ColorDomain, mode: ColorMode): { value: number; color: string }[] {
  return [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const value = d.min + (d.max - d.min) * t;
    return { value: +value.toFixed(2), color: scaleColor(value, d, mode) };
  });
}
