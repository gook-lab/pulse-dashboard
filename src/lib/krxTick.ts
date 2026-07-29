/**
 * KRX 가격대별 호가단위 계산 (2023-01 개편 7단계)
 * https://github.com/toss/slash/blob/main/packages/common/src/utils/stock.ts 참고
 */

/**
 * 주가에 따른 호가단위(tick size) 반환
 * - 2,000원 미만: 1원
 * - 2,000~5,000원: 5원
 * - 5,000~20,000원: 10원
 * - 20,000~50,000원: 50원
 * - 50,000~200,000원: 100원
 * - 200,000~500,000원: 500원
 * - 500,000원 이상: 1,000원
 */
export function tickSize(price: number): number {
  if (price < 2000) return 1;
  if (price <= 5000) return 5;
  if (price <= 20000) return 10;
  if (price <= 50000) return 50;
  if (price <= 200000) return 100;
  if (price <= 500000) return 500;
  return 1000;
}

/**
 * 가격을 호가단위에 맞춘다.
 * @param price 원본 가격
 * @param dir 'down'(내림, 기본) | 'up'(올림) | 'nearest'(반올림)
 */
export function snapToTick(price: number, dir: 'down' | 'up' | 'nearest' = 'down'): number {
  const tick = tickSize(price);
  const remainder = price % tick;

  if (remainder === 0) return price;

  if (dir === 'down') {
    return price - remainder;
  }

  if (dir === 'up') {
    return price + (tick - remainder);
  }

  // nearest: round half up
  if (remainder >= tick / 2) {
    return price + (tick - remainder);
  }
  return price - remainder;
}
