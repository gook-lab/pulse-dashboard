import { describe, it, expect } from 'vitest';
import { monthlyPayment, maxLoan } from './loan';

describe('loan', () => {
  describe('monthlyPayment', () => {
    it('계산한다: 3.6억 · 3.8% · 30년', () => {
      const principal = 360_000_000;
      const annualRatePct = 3.8;
      const years = 30;
      const result = monthlyPayment(principal, annualRatePct, years);
      // 원리금균등: M = P * [r(1+r)^n] / [(1+r)^n - 1]
      // r = 3.8% / 12 = 0.3167%, n = 360개월
      // 약 1,677,446원
      expect(result).toBeGreaterThan(1_670_000);
      expect(result).toBeLessThan(1_690_000);
    });

    it('금리 0%일 때 단순 분할', () => {
      const principal = 120_000_000;
      const result = monthlyPayment(principal, 0, 10);
      // 120,000,000 / 120개월 = 1,000,000
      expect(result).toBe(1_000_000);
    });

    it('1년 단기', () => {
      const principal = 120_000_000;
      const annualRatePct = 3.8;
      const years = 1;
      const result = monthlyPayment(principal, annualRatePct, years);
      expect(result).toBeGreaterThan(10_200_000);
      expect(result).toBeLessThan(10_220_000);
    });
  });

  describe('maxLoan', () => {
    it('계산한다: 가격 3.6억 · LTV 60%', () => {
      const price = 360_000_000;
      const ltvPct = 60;
      const result = maxLoan(price, ltvPct);
      // 360,000,000 * 0.6 = 216,000,000
      expect(result).toBe(216_000_000);
    });

    it('LTV 70%', () => {
      const price = 500_000_000;
      const ltvPct = 70;
      const result = maxLoan(price, ltvPct);
      expect(result).toBe(350_000_000);
    });

    it('정수로 반환', () => {
      const price = 333_333_333;
      const ltvPct = 60;
      const result = maxLoan(price, ltvPct);
      expect(Number.isInteger(result)).toBe(true);
    });
  });
});
