import { describe, it, expect } from 'vitest';
import { trailingSum, quarterOf, seriesStats, percentileOf, buildKr, buildUs } from './buffett.mjs';

describe('trailingSum', () => {
  it('끝 인덱스에서 뒤로 n개를 더한다', () => {
    expect(trailingSum([1, 2, 3, 4, 5], 4, 4)).toBe(14);
    expect(trailingSum([1, 2, 3, 4, 5], 3, 4)).toBe(10);
  });
  it('구간이 모자라면 null — 4분기 안 모인 GDP를 연간으로 쓰면 안 된다', () => {
    expect(trailingSum([1, 2, 3], 2, 4)).toBeNull();
  });
  it('구멍(비수치)이 있으면 null', () => {
    expect(trailingSum([1, null, 3, 4], 3, 4)).toBeNull();
  });
});

describe('quarterOf', () => {
  it('월을 분기 TIME으로 바꾼다', () => {
    expect(quarterOf('202601')).toBe('2026Q1');
    expect(quarterOf('202603')).toBe('2026Q1');
    expect(quarterOf('202604')).toBe('2026Q2');
    expect(quarterOf('202612')).toBe('2026Q4');
  });
});

describe('seriesStats / percentileOf', () => {
  it('짝수 개는 중앙 두 값의 평균', () => {
    expect(seriesStats([10, 20, 30, 40])).toEqual({ min: 10, max: 40, median: 25 });
  });
  it('홀수 개는 가운데 값', () => {
    expect(seriesStats([30, 10, 20])).toEqual({ min: 10, max: 30, median: 20 });
  });
  it('빈 시계열은 null', () => {
    expect(seriesStats([])).toBeNull();
    expect(percentileOf([], 5)).toBeNull();
  });
  it('백분위는 이하 개수 비율', () => {
    expect(percentileOf([10, 20, 30, 40], 30)).toBe(75);
    expect(percentileOf([10, 20, 30, 40], 5)).toBe(0);
    expect(percentileOf([10, 20, 30, 40], 99)).toBe(100);
  });
});

describe('buildKr', () => {
  // GDP 4개 분기 합 = 1,000 십억원, 시총 2,000 십억원 → 200%
  const gdpQ = [
    { time: '2025Q1', value: 200 },
    { time: '2025Q2', value: 250 },
    { time: '2025Q3', value: 250 },
    { time: '2025Q4', value: 300 },
  ];

  it('일별 시총(억원)을 우선 쓰고 최근 4분기 GDP로 나눈다', () => {
    // 20,000,000 억원 = 2,000,000 십억원 ÷ 1,000 십억원 = 200,000%... 단위 확인용으로 맞춰 계산
    const r = buildKr({
      gdpQ,
      capM: [{ time: '202512', value: 2_000 * 1e6 }], // 천원 → 2,000 십억원
      capD: [{ time: '20260130', value: 2_400 * 10 }], // 억원 → 2,400 십억원
    });
    expect(r.ratio).toBe(240); // 2,400 / 1,000
    expect(r.asOf).toBe('20260130');
    expect(r.gdpAsOf).toBe('2025Q4');
    expect(r.currency).toBe('KRW');
    expect(r.cap).toBe(2.4); // 조원
    expect(r.gdp).toBe(1);
  });

  it('일별이 비면 월별 마지막으로 폴백한다', () => {
    const r = buildKr({ gdpQ, capM: [{ time: '202512', value: 2_000 * 1e6 }], capD: [] });
    expect(r.ratio).toBe(200);
    expect(r.asOf).toBe('202512');
  });

  it('GDP가 4분기 미만이면 null — 목값을 만들지 않는다', () => {
    const r = buildKr({
      gdpQ: gdpQ.slice(0, 3),
      capM: [{ time: '202512', value: 2_000 * 1e6 }],
      capD: [{ time: '20260130', value: 24_000 }],
    });
    expect(r).toBeNull();
  });

  it('시총이 아예 없으면 null', () => {
    expect(buildKr({ gdpQ, capM: [], capD: [] })).toBeNull();
  });

  it('히스토리에서 분포와 백분위를 낸다', () => {
    const capM = [
      { time: '202510', value: 1_000 * 1e6 }, // 100%
      { time: '202511', value: 1_500 * 1e6 }, // 150%
      { time: '202512', value: 2_000 * 1e6 }, // 200%
    ];
    const r = buildKr({ gdpQ, capM, capD: [] });
    expect(r.history.map((h) => h.ratio)).toEqual([100, 150, 200]);
    expect(r.median).toBe(150);
    expect(r.min).toBe(100);
    expect(r.max).toBe(200);
    expect(r.percentile).toBe(100); // 현재 200% = 최상단
  });
});

describe('buildUs', () => {
  it('분자·분모를 같은 분기로 맞춘다', () => {
    const r = buildUs({
      gdpQ: [
        { date: '2025-10-01', value: 30_000 },
        { date: '2026-01-01', value: 32_000 },
        { date: '2026-04-01', value: 33_000 }, // 시총 없는 분기 — 무시돼야 한다
      ],
      capQ: [
        { date: '2025-10-01', value: 60_000_000 }, // 백만$ → 60,000 십억$
        { date: '2026-01-01', value: 64_000_000 },
      ],
    });
    expect(r.ratio).toBe(200); // 64,000 / 32,000
    expect(r.asOf).toBe('2026-01-01');
    expect(r.history).toEqual([
      { t: '2025-10-01', ratio: 200 },
      { t: '2026-01-01', ratio: 200 },
    ]);
    expect(r.currency).toBe('USD');
  });

  it('라벨은 미국 — 나스닥이라고 쓰지 않는다', () => {
    const r = buildUs({
      gdpQ: [{ date: '2026-01-01', value: 32_000 }],
      capQ: [{ date: '2026-01-01', value: 64_000_000 }],
    });
    expect(r.label).toBe('미국');
    expect(r.label).not.toContain('나스닥');
  });

  it('겹치는 분기가 없으면 null', () => {
    const r = buildUs({
      gdpQ: [{ date: '2026-01-01', value: 32_000 }],
      capQ: [{ date: '2025-01-01', value: 64_000_000 }],
    });
    expect(r).toBeNull();
  });
});
