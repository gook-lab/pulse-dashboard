/**
 * 대출 계산 순수 함수.
 * 원리금균등 분할 상환(가장 일반적인 주택담보대출 방식).
 */

/**
 * 월 상환액 계산.
 * @param principal 원금 (원)
 * @param annualRatePct 연 금리 (%)
 * @param years 대출 기간 (년)
 * @returns 월 상환액 (원, 정수)
 *
 * 공식: M = P * [r(1+r)^n] / [(1+r)^n - 1]
 * - M: 월 상환액
 * - P: 원금
 * - r: 월 금리 (연 금리 / 12 / 100)
 * - n: 상환 개월 수
 *
 * 금리 0% 시 단순 분할: P / (years * 12)
 */
export function monthlyPayment(
  principal: number,
  annualRatePct: number,
  years: number,
): number {
  if (principal <= 0 || years <= 0) return 0;

  // 금리 0% 경우: 단순 분할
  if (annualRatePct === 0) {
    return Math.round(principal / (years * 12));
  }

  const monthlyRatePct = annualRatePct / 12;
  const monthlyRate = monthlyRatePct / 100;
  const months = years * 12;

  // 원리금균등: M = P * [r(1+r)^n] / [(1+r)^n - 1]
  const numerator = monthlyRate * Math.pow(1 + monthlyRate, months);
  const denominator = Math.pow(1 + monthlyRate, months) - 1;
  const monthly = principal * (numerator / denominator);

  return Math.round(monthly);
}

/**
 * 최대 대출액 계산.
 * @param price 주택 가격 (원)
 * @param ltvPct LTV 비율 (%)
 * @returns 최대 대출액 (원, 정수)
 *
 * LTV(Loan-to-Value) = 대출액 / 주택가격
 */
export function maxLoan(price: number, ltvPct: number): number {
  if (price <= 0 || ltvPct <= 0) return 0;
  return Math.round(price * (ltvPct / 100));
}
