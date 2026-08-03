import { describe, it, expect } from 'vitest';
import { fmtVol, fmtMarketCapEok } from './format';

describe('fmtMarketCapEok', () => {
  it('1조 이상은 조 단위 + 콤마', () => {
    expect(fmtMarketCapEok(15521870)).toBe('1,552조');   // 삼성전자 실측
    expect(fmtMarketCapEok(12549859)).toBe('1,255조');   // SK하이닉스 실측
  });

  it('1조 미만은 억 단위', () => {
    expect(fmtMarketCapEok(4821)).toBe('4,821억');
    expect(fmtMarketCapEok(9999)).toBe('9,999억');
  });

  it('값이 없으면 "-" — 목값으로 메우지 않는다', () => {
    expect(fmtMarketCapEok(null)).toBe('-');
    expect(fmtMarketCapEok(undefined)).toBe('-');
    expect(fmtMarketCapEok(NaN)).toBe('-');
  });
});

describe('fmtVol', () => {
  it('억·만으로 축약', () => {
    expect(fmtVol(49428501)).toBe('4943만');
    expect(fmtVol(120000000)).toBe('1.2억');
  });

  it('1만 미만은 그대로', () => {
    expect(fmtVol(850)).toBe('850');
  });
});
