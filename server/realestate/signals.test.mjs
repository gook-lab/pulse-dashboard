import { describe, it, expect } from 'vitest';
import {
  sourceIdxAt,
  areaTier, pricePerPyeong, median, buildSeries, valueAt, pctChange,
  computeKindSignals, computeJeonseRatio, computeAll, getSignal, idxOfAgo, PYEONG, filterOutliers, buildSmoothed, tierSummary, recentDeals, floorProfile,
} from './signals.mjs';
import { NOW_OFFSET_MONTHS, CONFIRMED_MONTHS } from './lawd.mjs';

// oldest → newest 17개월. idxOfAgo(months, 3) = 14 가 기준월.
const MONTHS = Array.from({ length: 17 }, (_, i) => {
  const d = new Date(2025, 2 + i, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
});
const NOW = idxOfAgo(MONTHS, NOW_OFFSET_MONTHS);   // 14

/** 지정한 인덱스들에 거래를 심는다. ppy 는 평당가 목표치. */
const deal = (idx, ppy, over = {}) => ({
  aptSeq: '11680-1', aptNm: 'T', sggCd: '11680', umdNm: 'X', roadnm: 'r', jibun: '1',
  buildYear: 2000, ym: MONTHS[idx], day: 1, area: 84, floor: 5,
  kind: 'trade', price: ppy * (84 / PYEONG), monthlyRent: null, ...over,
});

describe('areaTier', () => {
  it('경계값은 하한 포함·상한 미포함', () => {
    expect(areaTier(59.9)).toBe('~60');
    expect(areaTier(60)).toBe('60~85');
    expect(areaTier(84.99)).toBe('60~85');
    expect(areaTier(85)).toBe('85~135');
    expect(areaTier(134.9)).toBe('85~135');
    expect(areaTier(135)).toBe('135~');
  });
  it('면적이 없거나 0이면 null', () => {
    expect(areaTier(0)).toBeNull();
    expect(areaTier(null)).toBeNull();
    expect(areaTier(undefined)).toBeNull();
  });
});

describe('pricePerPyeong / median', () => {
  it('평당가 = 금액 ÷ (면적/3.3058)', () => {
    expect(pricePerPyeong(10000, 84)).toBeCloseTo(10000 / (84 / PYEONG), 6);
  });
  it('금액·면적이 0 이하면 null', () => {
    expect(pricePerPyeong(0, 84)).toBeNull();
    expect(pricePerPyeong(10000, 0)).toBeNull();
  });
  it('median: 짝수 개는 가운데 둘의 평균, 빈 배열은 null', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([NaN, undefined, 5])).toBe(5);
  });
});

describe('buildSeries', () => {
  it('거래 없는 달은 [null, 0] — 보간하지 않는다', () => {
    const s = buildSeries([deal(0, 1000), deal(2, 2000)], MONTHS);
    expect(s[0]).toEqual([1000, 1]);
    expect(s[1]).toEqual([null, 0]);
    expect(s[2]).toEqual([2000, 1]);
  });
  it('같은 달 여러 건은 중앙값', () => {
    const s = buildSeries([deal(3, 1000), deal(3, 2000), deal(3, 3000)], MONTHS);
    expect(s[3][0]).toBeCloseTo(2000, 6);
    expect(s[3][1]).toBe(3);
  });
});

describe('valueAt — 직전 유효값', () => {
  const s = buildSeries([deal(2, 1000)], MONTHS);
  it('해당 달이 비면 과거로 거슬러 올라간다', () => {
    expect(valueAt(s, 5)).toBe(1000);
  });
  it('과거에도 없으면 null — 미래 값을 끌어오지 않는다', () => {
    expect(valueAt(s, 1)).toBeNull();
  });
});

describe('pctChange', () => {
  it('한쪽이라도 null 이면 null (0 아님)', () => {
    expect(pctChange(null, 100)).toBeNull();
    expect(pctChange(100, null)).toBeNull();
  });
  it('분모가 0 이하면 null', () => {
    expect(pctChange(0, 100)).toBeNull();
  });
  it('정상 계산', () => {
    expect(pctChange(100, 120)).toBe(20);
    expect(pctChange(100, 80)).toBe(-20);
  });
});

describe('computeKindSignals', () => {
  it('momentum: 기준월 대비 N개월 전', () => {
    const s = buildSeries([deal(NOW - 6, 1000), deal(NOW, 1200)], MONTHS);
    const g = computeKindSignals(s, MONTHS);
    expect(g.momentum6).toBe(20);
  });

  it('기준월(3개월 전)을 쓴다 — 미확정 최근 2개월은 시그널에 안 들어간다', () => {
    // 기준월엔 1000, 그 뒤 미확정 구간에만 폭등한 값을 심는다
    const s = buildSeries([deal(NOW - 3, 1000), deal(NOW, 1000), deal(NOW + 2, 9999)], MONTHS);
    const g = computeKindSignals(s, MONTHS);
    expect(g.momentum3).toBe(0);            // 9999 가 새어들어오지 않았다
  });

  it('기준 시점 데이터가 없으면 null — 0 이 아니다', () => {
    const s = buildSeries([deal(NOW, 1000)], MONTHS);   // 과거 없음
    const g = computeKindSignals(s, MONTHS);
    expect(g.momentum12).toBeNull();
    expect(g.momentum12).not.toBe(0);
  });

  it('high52wPct: 0 이 신고가, 고점 대비 하락은 음수', () => {
    const atHigh = computeKindSignals(buildSeries([deal(NOW - 5, 1000), deal(NOW, 1500)], MONTHS), MONTHS);
    expect(atHigh.high52wPct).toBe(0);

    const off = computeKindSignals(buildSeries([deal(NOW - 5, 2000), deal(NOW, 1500)], MONTHS), MONTHS);
    expect(off.high52wPct).toBe(-25);
  });

  it('high52wPct: 유효 월이 2개 미만이면 null', () => {
    const g = computeKindSignals(buildSeries([deal(NOW, 1000)], MONTHS), MONTHS);
    expect(g.high52wPct).toBeNull();
  });

  it('volumeRatio: 12개월 거래 0건이면 null — Infinity/NaN 이 새지 않는다', () => {
    const g = computeKindSignals(buildSeries([], MONTHS), MONTHS);
    expect(g.volumeRatio).toBeNull();
    expect(g.dealCount).toBe(0);
  });

  it('volumeRatio: 최근 3개월에 몰리면 1보다 크다', () => {
    const rows = [];
    for (let i = NOW - 2; i <= NOW; i++) rows.push(deal(i, 1000), deal(i, 1000), deal(i, 1000));
    const g = computeKindSignals(buildSeries(rows, MONTHS), MONTHS);
    expect(g.volumeRatio).toBeGreaterThan(1);
  });

  it('volumeRatio: 12개월에 고르게 퍼지면 1 근처', () => {
    const rows = [];
    for (let i = NOW - CONFIRMED_MONTHS + 1; i <= NOW; i++) rows.push(deal(i, 1000));
    const g = computeKindSignals(buildSeries(rows, MONTHS), MONTHS);
    expect(g.volumeRatio).toBeCloseTo(1, 1);
  });

  it('dealCount 는 확정 12개월 구간만 센다', () => {
    const rows = [deal(NOW, 1000), deal(NOW + 1, 1000), deal(NOW + 2, 1000)];
    const g = computeKindSignals(buildSeries(rows, MONTHS), MONTHS);
    expect(g.dealCount).toBe(1);   // 미확정 2건 제외
  });

  it('rs 는 1패스에서 null (2패스에서 채움)', () => {
    expect(computeKindSignals(buildSeries([deal(NOW, 1000)], MONTHS), MONTHS).rs).toBeNull();
  });
});

describe('computeJeonseRatio', () => {
  const t = (idx, ppy, area) => deal(idx, ppy, { area, price: ppy * (area / PYEONG), kind: 'trade' });
  const r = (idx, ppy, area) => deal(idx, ppy, { area, price: ppy * (area / PYEONG), kind: 'rent', monthlyRent: 0 });

  it('같은 평형대에서 매매·전세 각 JEONSE_MIN_PER_SIDE(2)건 이상이어야 계산된다', () => {
    const rows = [t(NOW, 1000, 84), t(NOW - 1, 1000, 84), t(NOW - 2, 1000, 84),
                  r(NOW, 600, 84), r(NOW - 1, 600, 84), r(NOW - 2, 600, 84)];
    expect(computeJeonseRatio(rows, MONTHS)).toEqual({ jeonseRatio: 0.6, jeonseRatioTier: '60~85' });
  });

  it('정확히 2+2건이면 계산된다 — 커버리지 게이트(40%) 미달로 완화된 하한', () => {
    const rows = [t(NOW, 1000, 84), t(NOW - 1, 1000, 84),
                  r(NOW, 600, 84), r(NOW - 1, 600, 84)];
    expect(computeJeonseRatio(rows, MONTHS)).toEqual({ jeonseRatio: 0.6, jeonseRatioTier: '60~85' });
  });

  it('한쪽이 2건 미만이면 null', () => {
    const rows = [t(NOW, 1000, 84), t(NOW - 1, 1000, 84), t(NOW - 2, 1000, 84),
                  r(NOW, 600, 84)];
    expect(computeJeonseRatio(rows, MONTHS)).toEqual({ jeonseRatio: null, jeonseRatioTier: null });
  });

  it('평형대가 다르면 짝이 안 맞아 null — 소형·대형을 뭉개지 않는다', () => {
    const rows = [t(NOW, 1000, 59), t(NOW - 1, 1000, 59), t(NOW - 2, 1000, 59),
                  r(NOW, 600, 114), r(NOW - 1, 600, 114), r(NOW - 2, 600, 114)];
    expect(computeJeonseRatio(rows, MONTHS).jeonseRatio).toBeNull();
  });

  it('자격 있는 평형대가 여럿이면 거래 최다 평형대를 대표로', () => {
    const rows = [];
    for (let i = 0; i < 3; i++) { rows.push(t(NOW - i, 1000, 59), r(NOW - i, 500, 59)); }         // 소형 6건
    for (let i = 0; i < 5; i++) { rows.push(t(NOW - i, 2000, 114), r(NOW - i, 1600, 114)); }      // 대형 10건
    const out = computeJeonseRatio(rows, MONTHS);
    expect(out.jeonseRatioTier).toBe('85~135');
    expect(out.jeonseRatio).toBe(0.8);
  });

  it('월세 건은 전세 표본에서 제외', () => {
    const rows = [t(NOW, 1000, 84), t(NOW - 1, 1000, 84), t(NOW - 2, 1000, 84),
                  r(NOW, 600, 84),
                  deal(NOW - 1, 600, { area: 84, price: 600 * (84 / PYEONG), kind: 'rent', monthlyRent: 80 }),
                  deal(NOW - 2, 600, { area: 84, price: 600 * (84 / PYEONG), kind: 'rent', monthlyRent: 80 })];
    expect(computeJeonseRatio(rows, MONTHS).jeonseRatio).toBeNull();   // 월세를 세면 3건이지만 전세는 1건뿐
  });

  it('미확정 구간(최근 2개월) 거래는 쓰지 않는다', () => {
    const rows = [t(NOW + 1, 1000, 84), t(NOW + 2, 1000, 84), t(NOW, 1000, 84),
                  r(NOW + 1, 600, 84), r(NOW + 2, 600, 84), r(NOW, 600, 84)];
    expect(computeJeonseRatio(rows, MONTHS).jeonseRatio).toBeNull();   // 확정 구간엔 각 1건
  });
});

describe('computeAll — 단지 그룹핑과 rs', () => {
  const mk = (aptSeq, aptNm, sggCd, idx, ppy) => ({
    ...deal(idx, ppy), aptSeq, aptNm, sggCd,
  });

  it('aptSeq 로 묶는다 — 같은 이름 다른 단지가 합쳐지지 않는다', () => {
    // 실사에서 확인된 실제 충돌: 강남구 "삼성" 3개 단지
    const rows = [
      mk('11680-330', '삼성', '11680', NOW - 6, 1000), mk('11680-330', '삼성', '11680', NOW, 1200),
      mk('11680-316', '삼성', '11680', NOW - 6, 1000), mk('11680-316', '삼성', '11680', NOW, 800),
    ];
    const out = computeAll(rows, MONTHS);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.aptNm)).toEqual(['삼성', '삼성']);
    expect(out.find((c) => c.aptSeq === '11680-330').signals.trade.momentum6).toBe(20);
    expect(out.find((c) => c.aptSeq === '11680-316').signals.trade.momentum6).toBe(-20);
  });

  it('aptSeq 가 없는 행은 버린다', () => {
    expect(computeAll([{ ...deal(NOW, 1000), aptSeq: '' }], MONTHS)).toHaveLength(0);
  });

  it('rs = 단지 momentum6 − 구 momentum6 중앙값', () => {
    const rows = [];
    // 같은 구에 세 단지: +10, +20, +30 → 구 중앙값 +20
    [['a', 1100], ['b', 1200], ['c', 1300]].forEach(([id, end]) => {
      rows.push(mk(`11680-${id}`, id, '11680', NOW - 6, 1000), mk(`11680-${id}`, id, '11680', NOW, end));
    });
    const out = computeAll(rows, MONTHS);
    const rs = Object.fromEntries(out.map((c) => [c.aptNm, c.signals.trade.rs]));
    expect(rs.b).toBe(0);      // 중앙값 단지
    expect(rs.a).toBe(-10);
    expect(rs.c).toBe(10);
  });

  it('momentum6 가 null 인 단지는 rs 도 null', () => {
    const rows = [mk('11680-x', 'x', '11680', NOW, 1000)];
    expect(computeAll(rows, MONTHS)[0].signals.trade.rs).toBeNull();
  });

  it('구 코드가 이름으로 매핑된다', () => {
    const out = computeAll([mk('11680-1', 'x', '11680', NOW, 1000)], MONTHS);
    expect(out[0].gu).toBe('강남구');
  });
});

describe('getSignal', () => {
  const c = { signals: { trade: { momentum6: 5, rs: 1 }, rent: { momentum6: -2, rs: null }, jeonseRatio: 0.7 } };
  it('dealType 별로 다른 값을 준다', () => {
    expect(getSignal(c, 'momentum6', 'trade')).toBe(5);
    expect(getSignal(c, 'momentum6', 'rent')).toBe(-2);
  });
  it('jeonseRatio 는 dealType 과 무관한 단일 값', () => {
    expect(getSignal(c, 'jeonseRatio', 'trade')).toBe(0.7);
    expect(getSignal(c, 'jeonseRatio', 'rent')).toBe(0.7);
  });
  it('없는 시그널은 null', () => {
    expect(getSignal(c, 'nope', 'trade')).toBeNull();
  });
});

// 2026-07-28 첫 실배치에서 momentum6 = +977% 가 나온 원인. 회귀 방지.
describe('filterOutliers — 실데이터에서 나온 문제', () => {
  const row = (ppy, area = 84) => ({ price: ppy * (area / PYEONG), area, kind: 'rent', monthlyRent: 0 });

  it('중앙값 대비 0.4배 미만은 잘라낸다 (보증금 5천만원짜리 "전세")', () => {
    // 삼익(금천 시흥동) 실제 케이스: 평당 1,100~1,800 사이인데 한 건만 144
    const rows = [row(1500), row(1600), row(1400), row(1550), row(144)];
    const { kept, dropped } = filterOutliers(rows);
    expect(kept).toHaveLength(4);
    expect(dropped).toHaveLength(1);
    expect(Math.round(pricePerPyeong(dropped[0].price, dropped[0].area))).toBe(144);
  });

  it('중앙값 대비 2.5배 초과도 잘라낸다', () => {
    const { kept, dropped } = filterOutliers([row(1500), row(1600), row(1400), row(9000)]);
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(1);
  });

  it('같은 단지의 정상적인 평형 차이는 살아남는다', () => {
    // 실데이터: 소형 평당 1,656 / 대형 평당 1,184 = 0.71배
    const rows = [row(1656, 59.9), row(1184, 114.5), row(1500, 84.9), row(1400, 84.9)];
    expect(filterOutliers(rows).dropped).toHaveLength(0);
  });

  it('표본이 3건이어도 동작한다 — IQR 과 달리 데이터를 다 죽이지 않는다', () => {
    const { kept } = filterOutliers([row(1500), row(1600), row(1400)]);
    expect(kept).toHaveLength(3);
  });

  it('평당가를 못 구하는 행은 제외', () => {
    const { kept, dropped } = filterOutliers([row(1500), row(1600), { price: 0, area: 84 }]);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(1);
  });

  it('빈 입력은 그대로', () => {
    expect(filterOutliers([]).kept).toEqual([]);
  });

  it('★회귀★ 이상치 한 건이 기준월에 걸려도 momentum 이 폭발하지 않는다', () => {
    const mk = (idx, ppy) => ({
      ...deal(idx, ppy), aptSeq: '11545-41', aptNm: '삼익', sggCd: '11545',
      kind: 'rent', monthlyRent: 0,
    });
    // 6개월 전에 이상치 1건만, 기준월에 정상값
    const rows = [mk(NOW - 6, 144), mk(NOW, 1500), mk(NOW - 1, 1550), mk(NOW - 2, 1450), mk(NOW - 3, 1480)];
    const out = computeAll(rows, MONTHS)[0];
    expect(out.outliers).toBe(1);
    // 이상치가 살아있었다면 (1500/144-1)*100 = +941%.
    // 제거하면 6개월 전에 유효값이 남지 않으므로 null 이 맞다 — 비교할 게 없으면 계산 불가.
    const m6 = out.signals.rent.momentum6;
    expect(m6 === null || m6 <= 200).toBe(true);
    expect(m6).toBeNull();
  });

  it('★회귀★ 이상치를 빼도 비교 대상이 남으면 정상 계산된다', () => {
    const mk = (idx, ppy) => ({
      ...deal(idx, ppy), aptSeq: '11545-41', aptNm: '삼익', sggCd: '11545',
      kind: 'rent', monthlyRent: 0,
    });
    const rows = [mk(NOW - 6, 1400), mk(NOW - 6, 144), mk(NOW, 1540)];
    const out = computeAll(rows, MONTHS)[0];
    expect(out.outliers).toBe(1);
    expect(out.signals.rent.momentum6).toBe(10);   // 1540/1400 - 1
  });
});

describe('buildSmoothed — 구성 변화(mix shift) 완화', () => {
  const r = (idx, ppy) => ({ ...deal(idx, ppy), kind: 'rent', monthlyRent: 0 });

  it('창 안의 원시 거래를 모두 모아 중앙값을 낸다 (중앙값의 중앙값이 아니다)', () => {
    // idx 2 창 = [0,1,2] 의 모든 거래: 100, 200, 300 → 중앙값 200
    const s = buildSmoothed([r(0, 100), r(1, 200), r(2, 300)], MONTHS);
    expect(s[2][0]).toBeCloseTo(200, 6);
  });

  it('건수는 창이 아니라 해당 월 실제 거래 수 — volumeRatio 가 부풀지 않는다', () => {
    const s = buildSmoothed([r(0, 100), r(1, 100), r(2, 100)], MONTHS);
    expect(s[2][1]).toBe(1);
  });

  it('★회귀★ 거래가 적은 달의 다른 가격대는 이웃 달의 무게에 끌려온다', () => {
    const rows = [];
    // 실데이터 패턴: 대부분 달은 1,984 대인데 한 달만 679 대가 소수 거래됨.
    // 그 달이 기준월이 되면 원시 중앙값은 679 로 튀어 momentum 이 폭발한다.
    for (let i = NOW - 5; i <= NOW - 1; i++) rows.push(r(i, 1984), r(i, 1984));
    rows.push(r(NOW, 679));                       // 기준월에 소수 거래 1건
    const raw = buildSeries(rows, MONTHS);
    const sm = buildSmoothed(rows, MONTHS);
    expect(raw[NOW][0]).toBeCloseTo(679, 0);      // 원시는 그대로 튄다
    expect(sm[NOW][0]).toBeCloseTo(1984, 0);      // 평활은 이웃에 끌려온다
    // 그 결과 momentum6 이 폭발하지 않는다
    const swing = (s) => Math.abs(s[NOW][0] / s[NOW - 5][0] - 1);
    expect(swing(sm)).toBeLessThan(swing(raw));
  });

  it('한계: 두 가격대가 완벽히 균형 교대하면 중앙값 평활로는 못 잡는다', () => {
    // 중앙값은 평균이 아니라 가운데 값이라, 창 안에서도 다수 그룹이 그대로 이긴다.
    // 실데이터는 이렇게 규칙적이지 않아 잘 듣지만, 한계는 명시해 둔다.
    const rows = [];
    for (let i = NOW - 8; i <= NOW; i++) { const ppy = i % 2 === 0 ? 679 : 1984; rows.push(r(i, ppy), r(i, ppy)); }
    const raw = buildSeries(rows, MONTHS);
    const sm = buildSmoothed(rows, MONTHS);
    const swing = (s, a, b) => Math.abs(s[a][0] / s[b][0] - 1);
    expect(swing(sm, NOW, NOW - 1)).toBeCloseTo(swing(raw, NOW, NOW - 1), 6);
  });

  it('거래가 아예 없는 구간은 여전히 null', () => {
    expect(buildSmoothed([], MONTHS)[5][0]).toBeNull();
  });

  it('창 크기를 1로 주면 원시 월별 중앙값과 같다', () => {
    const rows = [r(3, 100), r(5, 200)];
    const raw = buildSeries(rows, MONTHS);
    const sm = buildSmoothed(rows, MONTHS, 1);
    expect(sm.map((x) => x[0])).toEqual(raw.map((x) => x[0]));
  });
});

describe('tierSummary — 상세 모달 평형대별 요약', () => {
  it('평형대별 평당가 중앙값·건수, 거래 없는 평형대는 키가 없다', () => {
    const t = [deal(14, 3000, { area: 84 }), deal(14, 3400, { area: 84 }), deal(14, 3200, { area: 84 })];
    const r = [deal(14, 1500, { area: 59, kind: 'rent', monthlyRent: 0, price: 1500 * (59 / PYEONG) })];
    const out = tierSummary(t, r);
    expect(out['60~85'].t).toEqual([3200, 3]);
    expect(out['60~85'].r).toEqual([null, 0]);
    expect(out['~60'].r).toEqual([1500, 1]);
    expect(out['~60'].t).toEqual([null, 0]);
    expect(out['85~135']).toBeUndefined();
  });
  it('면적 없는 행은 조용히 건너뛴다', () => {
    expect(tierSummary([deal(14, 3000, { area: null })], [])).toEqual({});
  });
});

describe('recentDeals — 상세 모달 최근 거래', () => {
  it('ym+day 최신순 10건, 필드 축소', () => {
    const rows = Array.from({ length: 13 }, (_, i) => deal(i % 17, 3000, { day: (i % 27) + 1 }));
    const out = recentDeals(rows);
    expect(out).toHaveLength(10);
    for (let i = 1; i < out.length; i++) {
      const key = (d) => d.ym + String(d.day ?? 0).padStart(2, '0');
      expect(key(out[i - 1]) >= key(out[i])).toBe(true);
    }
    expect(Object.keys(out[0]).sort()).toEqual(['area', 'day', 'floor', 'kind', 'monthlyRent', 'price', 'ym']);
  });
  it('day 가 null 이면 그 달의 맨 뒤로 밀리지 않고 0 취급으로 정렬만 된다', () => {
    const out = recentDeals([deal(16, 1, { day: null }), deal(16, 2, { day: 5 })]);
    expect(out[0].day).toBe(5);
  });
});

describe('computeAll — tiers·recent 포함', () => {
  it('산출물에 tiers 와 recent(≤10)가 실린다', () => {
    const rows = Array.from({ length: 12 }, (_, i) => deal(i, 3000 + i));
    const [c] = computeAll(rows, MONTHS);
    expect(c.tiers['60~85'].t[1]).toBe(12);
    expect(c.recent.length).toBe(10);
    expect(c.recent[0].ym >= c.recent[9].ym).toBe(true);
  });
});

describe('floorProfile — 단지투어 층 축', () => {
  const at = (floor, ppy, area = 84) => deal(14, ppy, { floor, area, price: ppy * (area / PYEONG) });

  it('최고층 대비 비율로 저·중·고를 나눈다 — 15층의 5층과 35층의 5층은 다르다', () => {
    const rows = [at(1, 1000), at(4, 1100), at(8, 2000), at(14, 3000), at(15, 3100)];
    const p = floorProfile(rows);
    expect(p.max).toBe(15);
    expect(p.banded).toBe(true);
    expect(p.low.count).toBe(2);    // 1, 4층 (≤5)
    expect(p.mid.count).toBe(1);    // 8층 (≤10)
    expect(p.high.count).toBe(2);   // 14, 15층
    expect(p.low.ppy).toBeLessThan(p.high.ppy);
  });

  it('저층 단지(최고 5층)는 구간을 나누지 않는다고 표시한다', () => {
    expect(floorProfile([at(1, 1000), at(5, 1200)]).banded).toBe(false);
  });

  it('층·면적 없는 행은 제외하고, 전부 없으면 null', () => {
    expect(floorProfile([deal(14, 1000, { floor: null })])).toBeNull();
    expect(floorProfile([])).toBeNull();
  });

  it('computeAll 산출물에 거래유형별로 실린다', () => {
    const rows = [at(3, 2000), at(9, 2400), at(12, 2800)];
    const [c] = computeAll(rows, MONTHS);
    expect(c.floors.t.max).toBe(12);
    expect(c.floors.r).toBeNull();   // 전세 거래 없음
  });
});

describe('모멘텀 — 잴 수 없으면 0 이 아니라 null', () => {
  it('거래가 한 달에만 있으면 모멘텀은 전부 null — 이동중앙값이 퍼뜨린 값도 같은 거래다', () => {
    // 신축처럼 한 달에 거래가 몰린 단지. 시그널은 3개월 이동중앙값 위에서 계산되므로
    // 7월 거래 하나가 7·8·9월 값으로 퍼진다. 값만 보면 관측이 셋처럼 보이지만 거래는 하나다.
    const series = MONTHS.map((_, i) => (i >= 7 && i <= 9 ? [6204, i === 7 ? 36 : 0] : [null, 0]));
    const sig = computeKindSignals(series, MONTHS);
    expect(sig.momentum3).toBeNull();
    expect(sig.momentum6).toBeNull();
    expect(sig.momentum12).toBeNull();
    expect(sig.dealCount).toBeGreaterThan(0);   // 거래 자체는 있었다
  });

  it('서로 다른 관측 두 개면 정상적으로 잰다 — 거래 없는 달 대체는 그대로 유효하다', () => {
    const series = MONTHS.map((_, i) => (i === 8 ? [5000, 3] : i === NOW ? [6000, 2] : [null, 0]));
    expect(computeKindSignals(series, MONTHS).momentum6).toBe(20);
  });

  it('기준월에 거래가 없어도 과거 관측이 다르면 잰다', () => {
    const series = MONTHS.map((_, i) => (i === 5 ? [4000, 2] : i === 12 ? [5000, 2] : [null, 0]));
    // 기준월(14)은 12월 관측으로 대체, 6개월 전(8)은 5월 관측 → 서로 다른 관측이므로 측정된다
    expect(computeKindSignals(series, MONTHS).momentum6).toBe(25);
  });
});

describe('sourceIdxAt — 값이 어느 달에서 왔는가', () => {
  it('그 달에 거래가 있으면 자기 자신', () => {
    const series = [[1, 1], [2, 1], [3, 1]];
    expect(sourceIdxAt(series, 2)).toBe(2);
  });

  it('없으면 직전 유효 달', () => {
    const series = [[1, 1], [null, 0], [null, 0]];
    expect(sourceIdxAt(series, 2)).toBe(0);
  });

  it('앞에도 없으면 -1', () => {
    expect(sourceIdxAt([[null, 0], [null, 0]], 1)).toBe(-1);
  });

  it('값은 있는데 건수가 0 인 달은 건너뛴다 — 이동중앙값이 퍼뜨린 값이다', () => {
    const smoothed = [[100, 2], [100, 0], [100, 0]];
    expect(sourceIdxAt(smoothed, 2)).toBe(0);
  });

  it('범위를 넘겨도 안전하다', () => {
    expect(sourceIdxAt([[5, 1]], 99)).toBe(0);
  });
});
