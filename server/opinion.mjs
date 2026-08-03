// 종목별 투자 스코어 — 규칙 기반. 모델이 아니라 실측 지표 4개의 가중 혼합이다.
//
// 목값(mockApi DETAIL_META)을 대체하기 위한 것이므로 원칙은 하나다:
//   **근거로 제시하는 문장은 전부 실제로 잰 숫자에서 나와야 한다.**
// 입력이 없으면 그 항목을 빼고 남은 항목만으로 가중평균하며, 하나도 없으면 null(화면은 "-").
//
// 구성(각 0~100):
//   모멘텀 20일 · 52주 위치 · 밸류에이션(PER) · 뉴스 감성
// ⚠️ PER은 업종마다 정상 범위가 달라 비중을 낮게 둔다(15%). 업종 상대 비교가 없으면
//    저PER=저평가로 단정할 수 없다.

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;

/** 20일 수익률(%) → 0~100. -20%면 0, +20%면 100, 0%면 50. */
export function momentumScore(pct) {
  if (!Number.isFinite(pct)) return null;
  return clamp(50 + (pct / 20) * 50);
}

/** 52주 범위 내 위치(0~100). 신고가 근처면 높다. */
export function rangeScore(price, low, high) {
  if (![price, low, high].every(Number.isFinite) || high <= low) return null;
  return clamp(((price - low) / (high - low)) * 100);
}

/** PER → 0~100. 10배 이하 100, 40배 이상 0. 음수(적자)는 0. */
export function valuationScore(per) {
  if (!Number.isFinite(per)) return null;
  if (per <= 0) return 0;
  return clamp(((40 - per) / 30) * 100);
}

/** 뉴스 감성 → 0~100. 기사가 없으면 null(중립 50으로 채우지 않는다). */
export function sentimentScore(good, bad) {
  const n = (good || 0) + (bad || 0);
  if (!n) return null;
  return clamp((good / n) * 100);
}

const WEIGHTS = { momentum: 0.35, range: 0.30, valuation: 0.15, sentiment: 0.20 };

/**
 * 있는 항목만으로 가중평균. 전부 없으면 null.
 * @returns {{score:number, parts:object}|null}
 */
export function blend(parts) {
  let sum = 0, wsum = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    const v = parts[k];
    if (Number.isFinite(v)) { sum += v * w; wsum += w; }
  }
  if (!wsum) return null;
  return { score: Math.round(sum / wsum), parts };
}

export function stance(score) {
  if (score >= 70) return '매수 우위';
  if (score >= 55) return '완만한 매수';
  if (score >= 45) return '중립';
  if (score >= 30) return '완만한 매도';
  return '매도 우위';
}

/**
 * 근거 문장 — 강한 항목은 bull, 약한 항목은 bear. 문장에 잰 숫자를 그대로 넣는다.
 * 임계값(65/35)을 벗어난 항목만 말한다. 할 말이 없으면 빈 배열(억지로 만들지 않는다).
 */
export function reasons({ parts, momentum20, price, low52, high52, per, newsGood, newsBad }) {
  const bull = [], bear = [];
  const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;   // 자리수 고정(+20% / +17.5% 혼재 방지)

  if (Number.isFinite(parts.momentum)) {
    if (parts.momentum >= 65) bull.push(`20일 수익률 ${pct(momentum20)}로 상승 흐름`);
    else if (parts.momentum <= 35) bear.push(`20일 수익률 ${pct(momentum20)}로 하락 흐름`);
  }
  if (Number.isFinite(parts.range)) {
    const p = Math.round(parts.range);
    if (parts.range >= 65) bull.push(`52주 범위 상위 ${100 - p}% 구간(${low52.toLocaleString()}~${high52.toLocaleString()})`);
    else if (parts.range <= 35) bear.push(`52주 범위 하위 ${p}% 구간(${low52.toLocaleString()}~${high52.toLocaleString()})`);
  }
  if (Number.isFinite(parts.valuation)) {
    if (parts.valuation >= 65) bull.push(`PER ${round1(per)}배로 시장 대비 낮은 편`);
    else if (parts.valuation <= 35) bear.push(`PER ${round1(per)}배로 밸류에이션 부담`);
  }
  if (Number.isFinite(parts.sentiment)) {
    const n = newsGood + newsBad;
    if (parts.sentiment >= 65) bull.push(`최근 뉴스 ${n}건 중 호재 ${newsGood}건`);
    else if (parts.sentiment <= 35) bear.push(`최근 뉴스 ${n}건 중 악재 ${newsBad}건`);
  }
  return { bull, bear };
}

/**
 * 전체 산출. 입력은 이미 조회된 실측값만 받는다(여기서 네트워크를 타지 않는다 — 테스트 가능하게).
 * @returns null 이면 근거가 하나도 없다는 뜻 → 화면은 "-"
 */
export function buildOpinion({ closes = [], price, low52, high52, per, newsGood = 0, newsBad = 0 }) {
  // 20일 수익률: 종가 21개(오늘 포함)가 있어야 20일 변화다.
  const momentum20 = closes.length >= 21
    ? ((closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21]) * 100
    : NaN;

  const parts = {
    momentum: momentumScore(momentum20),
    range: rangeScore(price, low52, high52),
    valuation: valuationScore(per),
    sentiment: sentimentScore(newsGood, newsBad),
  };
  const blended = blend(parts);
  if (!blended) return null;

  return {
    score: blended.score,
    stance: stance(blended.score),
    ...reasons({ parts, momentum20, price, low52, high52, per, newsGood, newsBad }),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Number.isFinite(v) ? Math.round(v) : null])),
  };
}
