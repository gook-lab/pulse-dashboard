import type { Portfolio, PaperOrder } from '@/data/types';

/**
 * 수수료 계산 (0.015%, 반올림)
 */
export function fee(amount: number): number {
  return Math.round(amount * 0.00015);
}

/**
 * 유효 잔고 오버레이 계산
 * @param portfolio KIS 포트폴리오
 * @param orders 페이퍼 주문 목록
 * @returns { cash: 유효예수금, holdings: 종목별 유효수량 Map }
 */
export function effectiveBalance(
  portfolio: Portfolio,
  orders: PaperOrder[]
): { cash: number; holdings: Map<string, number> } {
  let effectiveCash = portfolio.cash ?? 0;
  const effectiveHoldings = new Map<string, number>();

  // KIS 보유 종목을 Map에 로드
  for (const h of portfolio.holdings) {
    effectiveHoldings.set(h.code, h.qty);
  }

  // 페이퍼 주문 반영
  for (const order of orders) {
    if (order.side === 'buy') {
      // 매수: 예수금 감소, 보유 증가
      const cost = order.price * order.qty + order.fee;
      effectiveCash -= cost;
      effectiveHoldings.set(order.code, (effectiveHoldings.get(order.code) ?? 0) + order.qty);
    } else {
      // 매도: 예수금 증가, 보유 감소
      const proceeds = order.price * order.qty - order.fee;
      effectiveCash += proceeds;
      effectiveHoldings.set(order.code, (effectiveHoldings.get(order.code) ?? 0) - order.qty);
    }
  }

  return { cash: effectiveCash, holdings: effectiveHoldings };
}

/**
 * 매도 주문 검증
 */
export function validateSell(
  code: string,
  qty: number,
  portfolio: Portfolio,
  orders: PaperOrder[]
): { ok: true } | { ok: false; error: string } {
  if (portfolio.unavailable) {
    return { ok: false, error: '현재 주문 불가 상태입니다.' };
  }

  const { holdings } = effectiveBalance(portfolio, orders);
  const effectiveQty = holdings.get(code) ?? 0;

  if (effectiveQty < qty) {
    return { ok: false, error: `보유 수량이 부족합니다. (보유: ${effectiveQty}주)` };
  }

  return { ok: true };
}

/**
 * 매수 주문 검증
 */
export function validateBuy(
  qty: number,
  price: number,
  portfolio: Portfolio,
  orders: PaperOrder[]
): { ok: true } | { ok: false; error: string } {
  if (portfolio.unavailable) {
    return { ok: false, error: '현재 주문 불가 상태입니다.' };
  }

  const { cash } = effectiveBalance(portfolio, orders);
  const totalCost = price * qty + fee(price * qty);

  if (cash < totalCost) {
    return { ok: false, error: `예수금이 부족합니다. (필요: ${totalCost.toLocaleString()}원, 보유: ${cash.toLocaleString()}원)` };
  }

  return { ok: true };
}

/**
 * 칩 수량 계산 (10/25/50/100%)
 * @param pct 칩 퍼센트 (10, 25, 50, 100)
 * @param side 'buy' | 'sell'
 * @param price 현재가 (매수 시), 또는 사용하지 않음 (매도 시)
 */
export function chipQty(
  pct: number,
  side: 'buy' | 'sell',
  price: number,
  code: string,
  portfolio: Portfolio,
  orders: PaperOrder[]
): number {
  const { cash, holdings } = effectiveBalance(portfolio, orders);

  if (side === 'buy') {
    // 유효 예수금의 pct% 기준
    const amount = (cash * pct) / 100;
    return Math.floor(amount / price);
  } else {
    // 유효 보유(해당 종목)의 pct% 기준
    const effectiveQty = holdings.get(code) ?? 0;
    return Math.floor(effectiveQty * (pct / 100));
  }
}

export interface Orderbook {
  asks: Array<{ price: number; qty: number }>;
  bids: Array<{ price: number; qty: number }>;
}

/**
 * 시장가 주문 가격 결정 (3단계 폴백)
 * @param side 'buy' | 'sell'
 * @param orderbook 호가창
 * @param lastTradePrice 최근 체결가 (0이면 없음)
 * @param currentPrice 현재가
 */
export function marketOrderPrice(
  side: 'buy' | 'sell',
  orderbook: Orderbook,
  lastTradePrice: number,
  currentPrice: number
): number {
  // 상·하한가에서는 반대 호가가 잔량 0·가격 0으로 온다 — 유효(>0) 최우선 호가만 채택하고 아니면 폴백.
  const levels = side === 'buy' ? orderbook.asks : orderbook.bids;
  const best = levels.find((l) => l.price > 0);
  if (best) return best.price;
  if (lastTradePrice > 0) return lastTradePrice;
  return currentPrice;
}

/**
 * 주문을 리스트에 추가하고 상한 초과 시 가장 오래된 것 제거
 * @param orders 기존 주문 목록
 * @param newOrder 새 주문
 * @param maxSize 최대 크기 (기본 100)
 */
export function appendOrder(
  orders: PaperOrder[],
  newOrder: PaperOrder,
  maxSize: number = 100
): PaperOrder[] {
  const result = [...orders, newOrder];

  // 상한 초과 시 가장 오래된 것 제거
  if (result.length > maxSize) {
    return result.slice(result.length - maxSize);
  }

  return result;
}

export type { PaperOrder };
