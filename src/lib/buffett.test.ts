import { describe, it, expect } from 'vitest';
import { fmtTril, fmtAsOf, fmtPercentile, barGeometry } from './buffett';

describe('fmtTril', () => {
  it('원화는 정수+콤마', () => {
    expect(fmtTril(4611.5, 'KRW')).toBe('4,612조원');
    expect(fmtTril(2784.7, 'KRW')).toBe('2,785조원');
  });
  it('달러는 소수 한 자리', () => {
    expect(fmtTril(69.51, 'USD')).toBe('$69.5조');
  });
});

describe('fmtAsOf', () => {
  it('한국은 일자', () => {
    expect(fmtAsOf({ asOf: '20260730', currency: 'KRW' })).toBe('26.07.30 기준');
  });
  it('미국은 분기', () => {
    expect(fmtAsOf({ asOf: '2026-01-01', currency: 'USD' })).toBe('26년 1분기 기준');
    expect(fmtAsOf({ asOf: '2026-10-01', currency: 'USD' })).toBe('26년 4분기 기준');
  });
});

describe('fmtPercentile', () => {
  it('백분위를 상위 n%로 뒤집는다', () => {
    expect(fmtPercentile(96.8)).toBe('10년 상위 3%');
    expect(fmtPercentile(50)).toBe('10년 상위 50%');
  });
  it('최상단도 상위 1%까지만 — 상위 0%는 없다', () => {
    expect(fmtPercentile(100)).toBe('10년 상위 1%');
  });
  it('없으면 null', () => {
    expect(fmtPercentile(null)).toBeNull();
  });
});

describe('barGeometry', () => {
  it('min~max를 0~100으로 펼친다', () => {
    expect(barGeometry({ ratio: 150, min: 100, max: 200, median: 125 }))
      .toEqual({ current: 50, median: 25 });
  });
  it('범위를 벗어난 현재값은 clamp — 막대 밖으로 나가지 않는다', () => {
    expect(barGeometry({ ratio: 260, min: 100, max: 200, median: 150 })?.current).toBe(100);
    expect(barGeometry({ ratio: 40, min: 100, max: 200, median: 150 })?.current).toBe(0);
  });
  it('범위가 없거나 0이면 null', () => {
    expect(barGeometry({ ratio: 150, min: null, max: 200, median: 150 })).toBeNull();
    expect(barGeometry({ ratio: 150, min: 200, max: 200, median: 200 })).toBeNull();
  });
  it('중앙값이 없어도 현재값은 낸다', () => {
    expect(barGeometry({ ratio: 150, min: 100, max: 200, median: null }))
      .toEqual({ current: 50, median: null });
  });
});
