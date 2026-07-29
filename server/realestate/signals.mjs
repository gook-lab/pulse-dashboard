// 원시 거래 → 단지 × 월 시계열 → 시그널 13종.
// 전부 순수 함수. 외부 I/O 없음. 시그널이 틀리면 화면은 멀쩡히 돌면서 틀린 단지를 1위로 올린다.
//
//   rows[] ──▶ groupBy(aptSeq) ──▶ buildSeries ──▶ computeSignals ──▶ complexes[]
//                                   (월별 평당가                        │
//                                    중앙값·건수)                       └─▶ guMomentum(2패스) ─▶ rs
//
// ★ 신고지연 보정 (설계 D11)
//   국토부 실거래는 계약 후 30일 이내 신고 의무 → 최근 1~2개월은 구조적으로 과소집계.
//   그대로 momentum3 = p(now)/p(now-3) 을 계산하면 분자가 덜 차 있어 전 단지가 하향 편향된다.
//   그래서 기준월 now 를 3개월 전으로 민다. 미확정 구간은 차트에만 회색으로 노출.
//
//   months(oldest→newest)  [ 0 ............ nowIdx ][ 미확정 2칸 ]
//                            └── 확정 구간 ──┘

import { NOW_OFFSET_MONTHS, CONFIRMED_MONTHS, GU_BY_CODE } from './lawd.mjs';

/** 1평 = 3.3058㎡ */
export const PYEONG = 3.3058;

/** 전용면적 평형대. 60=세제 기준선, 85=국민주택 규모. */
export const AREA_TIERS = ['~60', '60~85', '85~135', '135~'];
export function areaTier(area) {
  if (!(area > 0)) return null;
  if (area < 60) return '~60';
  if (area < 85) return '60~85';
  if (area < 135) return '85~135';
  return '135~';
}

/** 평당가(만원). 이상치에 강하도록 이후 중앙값으로 집계한다. */
export const pricePerPyeong = (price, area) =>
  (price > 0 && area > 0) ? price / (area / PYEONG) : null;

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 'k개월 전'의 시계열 인덱스. months 는 oldest→newest. */
export const idxOfAgo = (months, k) => months.length - k;

/* ── 이상치 제거 ────────────────────────────────────────────────────────────
   실데이터에서 확인된 문제(2026-07-28 첫 배치):
     삼익(금천 시흥동)  202509  전용114㎡  보증금  5,000만 → 평당  144만
     강변현대(광진)     202510  전용130㎡  보증금 10,000만 → 평당  253만
   같은 단지의 다른 달은 평당 1,100~1,800만이다. monthlyRent=0 이라 전세로 잡히지만
   실제로는 갱신계약 증액분만 신고했거나 특수관계 거래로 보인다.

   그 달에 거래가 그 1건뿐이면 중앙값이 곧 그 이상치가 되고, 6개월 전 기준점이 되면
   momentum6 = +977% 같은 값이 나온다. 실제로 나왔다.

   IQR 은 표본 3건짜리 단지에서 데이터를 통째로 죽이므로 쓰지 않는다.
   단지 내 평당가 중앙값 대비 비율로 자른다 — 표본이 적어도 동작하고 설명 가능하다.
   정상 범위(같은 단지 소형 1,656 vs 대형 1,184 = 0.71배)는 여유 있게 살아남는다.
   ────────────────────────────────────────────────────────────────────────── */
export const OUTLIER_LO = 0.4;
export const OUTLIER_HI = 2.5;

export function filterOutliers(rows) {
  const ppys = rows.map((r) => pricePerPyeong(r.price, r.area)).filter((v) => v != null);
  const med = median(ppys);
  if (med == null || med <= 0) return { kept: rows, dropped: [] };
  const kept = [], dropped = [];
  for (const r of rows) {
    const p = pricePerPyeong(r.price, r.area);
    if (p == null) { dropped.push(r); continue; }
    const ratio = p / med;
    (ratio >= OUTLIER_LO && ratio <= OUTLIER_HI ? kept : dropped).push(r);
  }
  return { kept, dropped };
}

/**
 * 한 단지·한 거래유형의 월별 [평당가중앙값, 건수].
 * 거래가 없는 달은 [null, 0] — 보간하지 않는다.
 */
export function buildSeries(rows, months) {
  const byYm = new Map(months.map((m) => [m, []]));
  for (const r of rows) {
    const ppy = pricePerPyeong(r.price, r.area);
    if (ppy == null) continue;
    byYm.get(r.ym)?.push(ppy);
  }
  return months.map((m) => {
    const v = byYm.get(m);
    return [median(v), v.length];
  });
}

/**
 * idx 시점의 값. 그 달에 거래가 없으면 **직전 유효값**을 쓴다(과거로만 탐색).
 * 미래 값을 끌어오면 존재하지 않는 정보가 새어 들어온다.
 */
export function valueAt(series, idx) {
  for (let i = Math.min(idx, series.length - 1); i >= 0; i--) {
    if (series[i][0] != null) return series[i][0];
  }
  return null;
}

/** 이동 중앙값 창(개월). 3이면 해당 월 + 직전 2개월. */
export const SMOOTH_WINDOW = 3;

/**
 * 구성 변화(mix shift) 완화용 이동 중앙값 시계열.
 *
 * 실데이터에서 확인된 문제(천왕이펜하우스2단지, 구로 천왕동):
 *   202508  평당  679 × 13건     ← 저가 그룹만 거래된 달
 *   202602  평당 1370, 2257      ← 고가 그룹만 거래된 달
 * 한 단지 안에 평당 679만 그룹과 1,984만 그룹이 공존한다(공공임대·장기전세와
 * 일반전세 혼재로 보인다). 둘 다 단지 중앙값 대비 0.5~1.45배라 이상치 컷을 통과하는데,
 * 달마다 어느 그룹이 거래되느냐로 월 중앙값이 널뛰어 momentum6 = +228% 가 나왔다.
 *
 * 이상치 컷을 좁히면 정상 데이터가 죽는다. 대신 인접 달을 섞어 완화한다.
 * 건수는 원본 그대로 둔다 — volumeRatio 와 dealCount 는 실제 거래 수를 세야 한다.
 *
 * ⚠️ 한계: 중앙값은 평균이 아니라 가운데 값이라, 두 가격대가 **완벽히 균형 잡혀 교대**하면
 *    창 안에서도 다수 그룹이 그대로 이겨 완화되지 않는다. 실데이터는 그렇게 규칙적이지 않아
 *    잘 듣는다(천왕이펜하우스2단지 momentum6 227.94% → 101.7%, 전체 p99 = 59.9%).
 *    그래도 공공임대·장기전세가 일반 전세와 같은 aptSeq 로 신고되는 단지는 여전히 값이 크다.
 *    그건 정제 실패가 아니라 데이터의 실제 성질이므로, 화면이 거래건수와 시계열을 보여주고
 *    사용자가 판단하게 한다(설계 D9·D11).
 */
export function buildSmoothed(rows, months, window = SMOOTH_WINDOW) {
  // 월별 원시 평당가 목록. 중앙값의 중앙값이 아니라 창 안의 모든 거래를 함께 본다.
  const byYm = new Map(months.map((m) => [m, []]));
  for (const r of rows) {
    const ppy = pricePerPyeong(r.price, r.area);
    if (ppy != null) byYm.get(r.ym)?.push(ppy);
  }
  return months.map((_, i) => {
    const lo = Math.max(0, i - window + 1);
    const vals = [];
    for (let k = lo; k <= i; k++) vals.push(...byYm.get(months[k]));
    // 건수는 그 달 실제 거래 수 — volumeRatio·dealCount 는 창이 아니라 월 기준이어야 한다.
    return [median(vals), byYm.get(months[i]).length];
  });
}

/** a 대비 b 의 변화율(%). 둘 중 하나라도 없으면 null — 0 이 아니다. */
export function pctChange(from, to) {
  if (from == null || to == null || from <= 0) return null;
  return +(((to - from) / from) * 100).toFixed(2);
}

/**
 * 한 단지·한 거래유형의 시그널.
 * 계산 불가는 전부 null. null 을 0 으로 취급하면 순위가 오염된다.
 */
export function computeKindSignals(series, months) {
  const nowIdx = idxOfAgo(months, NOW_OFFSET_MONTHS);
  const now = valueAt(series, nowIdx);

  const mom = (k) => {
    const i = nowIdx - k;
    if (i < 0) return null;
    return pctChange(valueAt(series, i), now);
  };

  // 확정 12개월 구간 [lo..nowIdx]
  const lo = Math.max(0, nowIdx - CONFIRMED_MONTHS + 1);
  const window = series.slice(lo, nowIdx + 1);
  const valid = window.map((s) => s[0]).filter((v) => v != null);
  const high52wPct = (now != null && valid.length >= 2)
    ? pctChange(Math.max(...valid), now)   // 0 = 신고가, 음수 = 고점 대비 하락
    : null;

  const dealCount = window.reduce((s, x) => s + x[1], 0);
  const recent3 = series.slice(Math.max(0, nowIdx - 2), nowIdx + 1).reduce((s, x) => s + x[1], 0);
  const volumeRatio = dealCount > 0
    ? +((recent3 / 3) / (dealCount / window.length)).toFixed(2)   // 1.0 = 12개월 평균 수준
    : null;                                                       // 0으로 나누지 않는다

  return {
    momentum3: mom(3), momentum6: mom(6), momentum12: mom(12),
    high52wPct, volumeRatio,
    rs: null,          // 2패스에서 채운다 (구 지수가 있어야 계산 가능)
    dealCount,
  };
}

/**
 * 전세가율 = 같은 평형대 안에서 (12개월 전세 평당가 중앙값 ÷ 매매 평당가 중앙값).
 * 매매·전세가 각각 3건 이상인 평형대만 계산 대상. 여러 개면 거래 최다 평형대를 대표로.
 * 단지 전체를 뭉개면 소형·대형이 섞여 비율이 무의미해진다.
 */
export function computeJeonseRatio(rows, months) {
  const confirmed = new Set(months.slice(0, idxOfAgo(months, NOW_OFFSET_MONTHS) + 1));
  const byTier = new Map();
  for (const r of rows) {
    if (!confirmed.has(r.ym)) continue;
    if (r.kind === 'rent' && r.monthlyRent !== 0) continue;   // 전세만 (월세 제외)
    const tier = areaTier(r.area);
    const ppy = pricePerPyeong(r.price, r.area);
    if (!tier || ppy == null) continue;
    if (!byTier.has(tier)) byTier.set(tier, { trade: [], rent: [] });
    byTier.get(tier)[r.kind].push(ppy);
  }

  let best = null;
  for (const [tier, v] of byTier) {
    if (v.trade.length < 3 || v.rent.length < 3) continue;
    const total = v.trade.length + v.rent.length;
    if (!best || total > best.total) best = { tier, total, v };
  }
  if (!best) return { jeonseRatio: null, jeonseRatioTier: null };

  const t = median(best.v.trade), r = median(best.v.rent);
  if (!t || !r) return { jeonseRatio: null, jeonseRatioTier: null };
  return { jeonseRatio: +(r / t).toFixed(3), jeonseRatioTier: best.tier };
}

/**
 * 평형대별 [평당가중앙값, 건수] 요약 — 상세 모달 ④(HorizontalBars).
 * 이상치 제외 후 rows 기준. 거래가 없는 평형대는 키 자체를 만들지 않는다.
 */
export function tierSummary(tradeRows, rentRows) {
  const out = {};
  const put = (rows, kind) => {
    const byTier = new Map();
    for (const r of rows) {
      const tier = areaTier(r.area);
      const ppy = pricePerPyeong(r.price, r.area);
      if (!tier || ppy == null) continue;
      if (!byTier.has(tier)) byTier.set(tier, []);
      byTier.get(tier).push(ppy);
    }
    for (const [tier, v] of byTier) {
      if (!out[tier]) out[tier] = { t: [null, 0], r: [null, 0] };
      out[tier][kind] = [Math.round(median(v)), v.length];
    }
  };
  put(tradeRows, 't');
  put(rentRows, 'r');
  return out;
}

/**
 * 최근 거래 n건, 최신순 — 상세 모달 ⑤. 이상치 컷 **이전** 원본이다.
 * 갱신증액·특수관계 의심 거래도 그대로 보인다 — 정제 대상이 아니라 판단 재료다.
 */
export function recentDeals(rows, n = 10) {
  return [...rows]
    .sort((a, b) => (b.ym + String(b.day ?? 0).padStart(2, '0')).localeCompare(a.ym + String(a.day ?? 0).padStart(2, '0')))
    .slice(0, n)
    .map(({ ym, day, kind, area, floor, price, monthlyRent }) =>
      ({ ym, day, kind, area, floor, price, monthlyRent: monthlyRent ?? null }));
}

/**
 * 전체 파이프라인. rows(원시) → complexes[].
 * months 는 oldest→newest.
 */
export function computeAll(rows, months) {
  // 1패스 — 단지별 시계열·시그널
  const byApt = new Map();
  for (const r of rows) {
    if (!r.aptSeq) continue;                      // 키 없는 행은 버린다
    if (!byApt.has(r.aptSeq)) byApt.set(r.aptSeq, []);
    byApt.get(r.aptSeq).push(r);
  }

  const complexes = [];
  for (const [aptSeq, rs] of byApt) {
    // 이상치는 거래유형별로 따로 잘라낸다. 매매가와 전세보증금은 스케일이 다르다.
    const ft = filterOutliers(rs.filter((r) => r.kind === 'trade'));
    const fr = filterOutliers(rs.filter((r) => r.kind === 'rent' && r.monthlyRent === 0));
    // 차트에는 실제 월별 중앙값을, 시그널에는 3개월 이동 중앙값을 쓴다.
    // 화면은 있는 그대로 보여주고, 순위는 구성 변화에 흔들리지 않아야 한다.
    const st = buildSeries(ft.kept, months);
    const sr = buildSeries(fr.kept, months);
    const smT = buildSmoothed(ft.kept, months);
    const smR = buildSmoothed(fr.kept, months);
    const last = rs[rs.length - 1];               // 표시용 메타는 최신 행 기준
    complexes.push({
      aptSeq,
      aptNm: last.aptNm,
      sggCd: last.sggCd,
      gu: GU_BY_CODE[last.sggCd] ?? null,
      umdNm: last.umdNm,
      roadnm: last.roadnm,
      jibun: last.jibun,
      buildYear: last.buildYear,
      areaTier: areaTier(median(rs.map((r) => r.area))),
      /** 이상치로 제외된 거래 수. 투명성을 위해 남긴다. */
      outliers: ft.dropped.length + fr.dropped.length,
      series: { t: st, r: sr },
      tiers: tierSummary(ft.kept, fr.kept),
      recent: recentDeals(rs),
      signals: {
        trade: computeKindSignals(smT, months),
        rent: computeKindSignals(smR, months),
        ...computeJeonseRatio([...ft.kept, ...fr.kept], months),
      },
    });
  }

  // 2패스 — 구 지수(momentum6 중앙값) 대비 상대강도
  // 거래량 가중이 아니라 중앙값. 대단지 하나가 구 지수를 끌면 rs 가 "그 대단지 대비"가 된다.
  for (const kind of ['trade', 'rent']) {
    const byGu = new Map();
    for (const c of complexes) {
      const m6 = c.signals[kind].momentum6;
      if (m6 == null || !c.gu) continue;
      if (!byGu.has(c.gu)) byGu.set(c.gu, []);
      byGu.get(c.gu).push(m6);
    }
    const guIndex = new Map([...byGu].map(([gu, v]) => [gu, median(v)]));
    for (const c of complexes) {
      const m6 = c.signals[kind].momentum6;
      const gi = guIndex.get(c.gu);
      c.signals[kind].rs = (m6 == null || gi == null) ? null : +(m6 - gi).toFixed(2);
    }
  }

  return complexes;
}

/** 시그널 접근자 — screen 이 쓴다. 없는 조합이면 null. */
export function getSignal(complex, signal, dealType = 'trade') {
  if (signal === 'jeonseRatio') return complex.signals.jeonseRatio;
  return complex.signals[dealType]?.[signal] ?? null;
}
