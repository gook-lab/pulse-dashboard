import { describe, it, expect } from 'vitest';
import { calculateReturns, calculateExcessReturn } from './returns';

describe('calculateReturns', () => {
  it('simple return calculation: [100,110,121] → [0,+10,+21]%', () => {
    const entries = [
      { date: '2024-01-01', totalValue: 100, principal: 100, kospi: 1000, spx: 400 },
      { date: '2024-01-02', totalValue: 110, principal: 100, kospi: 1010, spx: 404 },
      { date: '2024-01-03', totalValue: 121, principal: 100, kospi: 1020.1, spx: 408.08 },
    ];
    const result = calculateReturns(entries);
    expect(result.my).toEqual([0, 10, 21]);
    expect(result.kospi[0]).toBe(0);
    expect(result.kospi[1]).toBeCloseTo(1, 2);
    expect(result.kospi[2]).toBeCloseTo(2.01, 2);
    expect(result.spx[0]).toBe(0);
    expect(result.spx[1]).toBeCloseTo(1, 2);
    expect(result.spx[2]).toBeCloseTo(2.02, 2);
  });

  it('handles first null value properly — normalizes to first valid value', () => {
    const entries = [
      { date: '2024-01-01', totalValue: null, principal: null, kospi: 1000, spx: 400 },
      { date: '2024-01-02', totalValue: 100, principal: 100, kospi: 1010, spx: 404 },
      { date: '2024-01-03', totalValue: 110, principal: 100, kospi: 1020, spx: 408 },
    ];
    const result = calculateReturns(entries);
    // First valid baseline for totalValue is 100 at index 1
    expect(result.my[0]).toBeNull();
    expect(result.my[1]).toBe(0); // First valid = baseline
    expect(result.my[2]).toBe(10); // (110-100)/100*100
    // For kospi: first valid baseline is 1000 at index 0
    expect(result.kospi[0]).toBe(0); // First valid is baseline
    expect(result.kospi[1]).toBeCloseTo(1, 2); // (1010-1000)/1000*100
    expect(result.kospi[2]).toBeCloseTo(2, 2); // (1020-1000)/1000*100
  });

  it('maintains null in the middle to break lines', () => {
    const entries = [
      { date: '2024-01-01', totalValue: 100, principal: 100, kospi: 1000, spx: 400 },
      { date: '2024-01-02', totalValue: null, principal: 100, kospi: 1010, spx: 404 },
      { date: '2024-01-03', totalValue: 100, principal: 100, kospi: 1020, spx: 408 },
    ];
    const result = calculateReturns(entries);
    expect(result.my[0]).toBe(0);
    expect(result.my[1]).toBeNull(); // Middle null preserved
    expect(result.my[2]).toBe(0); // (100-100)/100*100
  });

  it('all null values returns all null', () => {
    const entries = [
      { date: '2024-01-01', totalValue: null, principal: null, kospi: null, spx: null },
      { date: '2024-01-02', totalValue: null, principal: null, kospi: null, spx: null },
    ];
    const result = calculateReturns(entries);
    expect(result.my).toEqual([null, null]);
    expect(result.kospi).toEqual([null, null]);
    expect(result.spx).toEqual([null, null]);
  });

  it('handles empty entries array', () => {
    const result = calculateReturns([]);
    expect(result.my).toEqual([]);
    expect(result.kospi).toEqual([]);
    expect(result.spx).toEqual([]);
  });
});

describe('calculateExcessReturn', () => {
  it('computes period excess return: +12.5% vs +1.8% = +10.7%p', () => {
    const myReturnPct = 12.5;
    const benchmarkReturnPct = 1.8;
    const excess = calculateExcessReturn(myReturnPct, benchmarkReturnPct);
    expect(excess).toBeCloseTo(10.7, 1);
  });

  it('handles null benchmark gracefully', () => {
    const myReturnPct = 12.5;
    const excess = calculateExcessReturn(myReturnPct, null);
    expect(excess).toBeNull();
  });

  it('handles null my return', () => {
    const excess = calculateExcessReturn(null, 1.8);
    expect(excess).toBeNull();
  });

  it('both null returns null', () => {
    const excess = calculateExcessReturn(null, null);
    expect(excess).toBeNull();
  });

  it('negative excess works', () => {
    const myReturnPct = 5;
    const benchmarkReturnPct = 10;
    const excess = calculateExcessReturn(myReturnPct, benchmarkReturnPct);
    expect(excess).toBeCloseTo(-5, 1);
  });
});
