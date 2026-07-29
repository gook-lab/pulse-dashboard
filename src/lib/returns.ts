import type { PortfolioHistoryEntry } from '@/data/types';

/**
 * 포트폴리오 수익률 계산 유틸리티
 *
 * 포트폴리오 히스토리 엔트리 배열을 받아서
 * 첫 유효값 기준 누적 수익률(%) 시리즈 3개 변환.
 * - my: totalValue 기준 내 포트폴리오 수익률
 * - kospi: KOSPI 지수 수익률
 * - spx: S&P500 지수 수익률
 *
 * null 값은 해당 지점에서 null 유지(라인 끊김 허용).
 */

export interface ReturnSeries {
  my: (number | null)[];
  kospi: (number | null)[];
  spx: (number | null)[];
}

/**
 * 포트폴리오 히스토리 엔트리 배열 → 수익률(%) 시리즈 3개
 *
 * 각 시리즈는:
 * - 첫 유효값(non-null)을 기준값(0%)으로 정규화
 * - null 값은 유지 (라인 끊김)
 * - (value - baseline) / baseline * 100 로 계산
 */
export function calculateReturns(entries: PortfolioHistoryEntry[]): ReturnSeries {
  if (entries.length === 0) {
    return { my: [], kospi: [], spx: [] };
  }

  // 각 필드별로 첫 유효값 찾기
  const findFirstValid = (key: 'totalValue' | 'kospi' | 'spx'): number | null => {
    for (const entry of entries) {
      const val = entry[key];
      if (val != null) return val;
    }
    return null;
  };

  const myBaseline = findFirstValid('totalValue');
  const kospiBaseline = findFirstValid('kospi');
  const spxBaseline = findFirstValid('spx');

  // null baseline 감지 — 모두 null인 경우
  if (myBaseline == null && kospiBaseline == null && spxBaseline == null) {
    return {
      my: entries.map(() => null),
      kospi: entries.map(() => null),
      spx: entries.map(() => null),
    };
  }

  const normalize = (value: number | null, baseline: number | null): number | null => {
    if (value == null || baseline == null) return null;
    return ((value - baseline) / baseline) * 100;
  };

  return {
    my: entries.map((e) => normalize(e.totalValue, myBaseline)),
    kospi: entries.map((e) => normalize(e.kospi, kospiBaseline)),
    spx: entries.map((e) => normalize(e.spx, spxBaseline)),
  };
}

/**
 * 기간 수익률 기반 초과 수익 계산
 *
 * @param myReturnPct 내 기간 수익률 (%)
 * @param benchmarkReturnPct 벤치마크 기간 수익률 (%)
 * @returns 초과 수익 (%p). null 인자가 있으면 null 반환.
 */
export function calculateExcessReturn(
  myReturnPct: number | null,
  benchmarkReturnPct: number | null
): number | null {
  if (myReturnPct == null || benchmarkReturnPct == null) return null;
  return myReturnPct - benchmarkReturnPct;
}
