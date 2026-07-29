// 거래량·거래대금 축약 표기 — Watchlist·RankingBoard 공용
export const fmtVol = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e4 ? `${Math.round(v / 1e4)}만` : String(v));
export const fmtAmt = (v: number) => (v >= 1e12 ? `${(v / 1e12).toFixed(1)}조` : v >= 1e8 ? `${Math.round(v / 1e8)}억` : `${Math.round(v / 1e4)}만`);
