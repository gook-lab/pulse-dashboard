// 버핏지수 표시 헬퍼. 계산 자체는 서버(server/buffett.mjs)가 하고, 여기서는 포맷과
// 분포 막대 좌표만 다룬다.
import type { BuffettMarket } from '@/data/types';

/** 시총·GDP를 조 단위로. 원화는 정수+콤마, 달러는 소수 한 자리. */
export function fmtTril(v: number, currency: BuffettMarket['currency']): string {
  return currency === 'KRW'
    ? `${Math.round(v).toLocaleString('ko-KR')}조원`
    : `$${v.toFixed(1)}조`;
}

/** 기준일 라벨. KR은 일자('20260730'), US는 분기('2026-01-01'). */
export function fmtAsOf(m: Pick<BuffettMarket, 'asOf' | 'currency'>): string {
  if (m.currency === 'KRW') {
    const [y, mo, d] = [m.asOf.slice(2, 4), m.asOf.slice(4, 6), m.asOf.slice(6, 8)];
    return `${y}.${mo}.${d} 기준`;
  }
  const q = Math.floor((+m.asOf.slice(5, 7) - 1) / 3) + 1;
  return `${m.asOf.slice(2, 4)}년 ${q}분기 기준`;
}

/** 백분위를 "상위 n%"로. 96.8 → '상위 3%'. */
export function fmtPercentile(percentile: number | null): string | null {
  if (percentile == null) return null;
  const top = Math.max(1, Math.round(100 - percentile));
  return `10년 상위 ${top}%`;
}

export interface BarGeometry {
  /** 현재값 위치 0~100(%) */
  current: number;
  /** 중앙값 위치 0~100(%) */
  median: number | null;
}

/**
 * min~max를 0~100으로 펼친 좌표. 범위가 0이거나 값이 없으면 null.
 * 현재값이 과거 범위를 벗어날 수 있으므로 clamp 한다.
 */
export function barGeometry(m: Pick<BuffettMarket, 'ratio' | 'min' | 'max' | 'median'>): BarGeometry | null {
  const { ratio, min, max, median } = m;
  if (min == null || max == null || max <= min) return null;
  const at = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
  return { current: at(ratio), median: median == null ? null : at(median) };
}
