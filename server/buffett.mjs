// 버핏지수(Buffett Indicator) = 주식시장 시가총액 ÷ 명목 GDP
//
//  한국: ECOS 유가증권시장 시가총액(일·월) ÷ 국내총생산(원계열 명목, 최근 4분기 합)
//  미국: FRED 비금융법인 주식 발행잔액(NCBEILQ027S) ÷ GDP(명목·연율)
//
// ⚠️ "나스닥 버핏지수"는 지표로 성립하지 않는다. 버핏지수는 한 나라의 전체 시장 시총을
//    그 나라 GDP로 나눈 값인데, 나스닥은 외국기업을 포함하고 NYSE를 제외하므로 분자·분모의
//    모집단이 어긋난다. 나스닥 단독 시가총액도 무료 소스가 없다. 그래서 미국은 표준 정의
//    (전체 시장)로 계산하고 라벨도 '미국'으로 표기한다 — 나스닥이라고 쓰지 않는다.
//
// 절대 임계값(<75% 저평가 … >135% 거품)은 1970~2000년대에 맞춰진 기준이라 현재
// 200%대 구간에서는 전부 "거품"으로 뭉개져 정보가 없다. 대신 같은 시계열의
// 최근 10년 분포 안에서의 위치(백분위·중앙값 대비)를 함께 돌려준다.

/** values[endIdx]까지 뒤로 n개 합. 구간이 모자라면 null. */
export function trailingSum(values, endIdx, n = 4) {
  if (endIdx < n - 1) return null;
  let sum = 0;
  for (let i = endIdx - n + 1; i <= endIdx; i++) {
    if (!Number.isFinite(values[i])) return null;
    sum += values[i];
  }
  return sum;
}

/** '202606' → '2026Q2' (ECOS 월별 TIME → 분기 TIME) */
export function quarterOf(yyyymm) {
  const y = yyyymm.slice(0, 4);
  const m = +yyyymm.slice(4, 6);
  return `${y}Q${Math.floor((m - 1) / 3) + 1}`;
}

/** 분포 요약. 값이 없으면 null. */
export function seriesStats(ratios) {
  const xs = ratios.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return {
    min: xs[0],
    max: xs[xs.length - 1],
    median: xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2,
  };
}

/** ratios 분포에서 v가 놓인 백분위(0~100). 이하 개수 비율. */
export function percentileOf(ratios, v) {
  const xs = ratios.filter(Number.isFinite);
  if (!xs.length) return null;
  return round1((xs.filter((x) => x <= v).length / xs.length) * 100);
}

const round1 = (v) => Math.round(v * 10) / 10;

/** 분기 GDP 행에서 '해당 분기 이하'의 최근 4분기 합을 찾는다. */
function annualGdpAt(gdpQ, quarter) {
  const idx = gdpQ.reduce((best, r, i) => (r.time <= quarter ? i : best), -1);
  if (idx < 0) return null;
  const sum = trailingSum(gdpQ.map((r) => r.value), idx, 4);
  return sum == null ? null : { value: sum, time: gdpQ[idx].time };
}

/**
 * 한국 버핏지수.
 * @param gdpQ [{time:'2025Q4', value: 십억원}] 오름차순
 * @param capM [{time:'202606', value: 천원}] 오름차순 — 10년 히스토리
 * @param capD [{time:'20260730', value: 억원}] 오름차순 — 최신값 확보용
 */
export function buildKr({ gdpQ, capM, capD }) {
  const history = [];
  for (const m of capM) {
    const gdp = annualGdpAt(gdpQ, quarterOf(m.time));
    if (!gdp) continue;
    history.push({ t: m.time, ratio: round1((m.value / 1e6 / gdp.value) * 100) });
  }

  // 현재값은 일별 시총(억원 → 십억원)이 가장 신선하다. 없으면 월별 마지막.
  const latest = capD.length
    ? { time: capD[capD.length - 1].time, bil: capD[capD.length - 1].value / 10 }
    : capM.length
      ? { time: capM[capM.length - 1].time, bil: capM[capM.length - 1].value / 1e6 }
      : null;
  if (!latest) return null;

  const gdp = annualGdpAt(gdpQ, quarterOf(latest.time.slice(0, 6)));
  if (!gdp) return null;

  return finish({
    label: '코스피',
    note: '유가증권시장 시가총액 ÷ 명목 GDP(최근 4분기)',
    currency: 'KRW',
    capBil: latest.bil,
    gdpBil: gdp.value,
    asOf: latest.time,
    gdpAsOf: gdp.time,
    history,
  });
}

/**
 * 미국 버핏지수 — 분자·분모를 같은 분기로 맞춘다.
 * @param gdpQ [{date:'2026-01-01', value: 십억$}] 오름차순
 * @param capQ [{date:'2026-01-01', value: 백만$}] 오름차순
 */
export function buildUs({ gdpQ, capQ }) {
  const gdpBy = new Map(gdpQ.map((r) => [r.date, r.value]));
  const pts = capQ
    .map((c) => ({ t: c.date, cap: c.value / 1000, gdp: gdpBy.get(c.date) }))
    .filter((p) => Number.isFinite(p.cap) && Number.isFinite(p.gdp));
  if (!pts.length) return null;

  const history = pts.map((p) => ({ t: p.t, ratio: round1((p.cap / p.gdp) * 100) }));
  const last = pts[pts.length - 1];

  return finish({
    label: '미국',
    note: '미국 전체 법인주식 ÷ 명목 GDP — 나스닥 단독 지표는 성립하지 않는다',
    currency: 'USD',
    capBil: last.cap,
    gdpBil: last.gdp,
    asOf: last.t,
    gdpAsOf: last.t,
    history,
  });
}

/** 공통 마무리: 비율·분포·백분위 계산 + 단위를 조 단위로 환산. */
function finish({ label, note, currency, capBil, gdpBil, asOf, gdpAsOf, history }) {
  const ratio = round1((capBil / gdpBil) * 100);
  const ratios = history.map((h) => h.ratio);
  const stats = seriesStats(ratios);
  return {
    label,
    note,
    currency,
    ratio,
    cap: round1(capBil / 1000),   // 조원 / 조달러
    gdp: round1(gdpBil / 1000),
    asOf,
    gdpAsOf,
    min: stats ? round1(stats.min) : null,
    max: stats ? round1(stats.max) : null,
    median: stats ? round1(stats.median) : null,
    percentile: percentileOf(ratios, ratio),
    history,
  };
}
