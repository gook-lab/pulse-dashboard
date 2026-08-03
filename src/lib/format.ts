// 거래량·거래대금 축약 표기 — Watchlist·RankingBoard 공용
export const fmtVol = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e4 ? `${Math.round(v / 1e4)}만` : String(v));
export const fmtAmt = (v: number) => (v >= 1e12 ? `${(v / 1e12).toFixed(1)}조` : v >= 1e8 ? `${Math.round(v / 1e8)}억` : `${Math.round(v / 1e4)}만`);

/**
 * KIS 시가총액(억원) → "1,552조" / "4,821억". 값이 없으면 "-".
 * 목값으로 메우지 않는다 — 삼성전자 목 468조 vs 실제 1,552조로 3배 이상 벌어진다.
 */
export const fmtMarketCapEok = (eok: number | null | undefined): string => {
  if (eok == null || !Number.isFinite(eok)) return '-';
  return eok >= 10000
    ? `${Math.round(eok / 10000).toLocaleString('ko-KR')}조`
    : `${Math.round(eok).toLocaleString('ko-KR')}억`;
};
