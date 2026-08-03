import type { PaperOrder } from '@/data/types';

/**
 * 수수료 계산 (0.015%, 반올림)
 */
export function fee(amount: number): number {
  return Math.round(amount * 0.00015);
}

/**
 * 매도 주문 검증. 수량은 KIS 보유수량 기준 — 로컬 원장으로 다시 세지 않는다.
 */
export function validateSell(
  qty: number,
  heldQty: number
): { ok: true } | { ok: false; error: string } {
  if (heldQty < qty) {
    return { ok: false, error: `보유 수량이 부족합니다. (보유: ${heldQty}주)` };
  }
  return { ok: true };
}

/**
 * 매수 주문 검증. KIS 주문가능현금(inquire-psbl-order) 기준.
 * 최종 판단은 KIS가 한다 — 여기서 통과해도 거부될 수 있고 그 사유는 그대로 노출한다.
 */
export function validateBuy(
  qty: number,
  price: number,
  orderableCash: number
): { ok: true } | { ok: false; error: string } {
  const totalCost = price * qty + fee(price * qty);
  if (orderableCash < totalCost) {
    return { ok: false, error: `주문가능금액이 부족합니다. (필요: ${totalCost.toLocaleString()}원, 가능: ${orderableCash.toLocaleString()}원)` };
  }
  return { ok: true };
}

/**
 * 칩 수량 계산 (10/25/50/100%)
 * @param pct 칩 퍼센트 (10, 25, 50, 100)
 * @param side 'buy' | 'sell'
 * @param price 주문 단가 (매수 시)
 * @param orderableCash KIS 주문가능현금 (매수 시)
 * @param heldQty KIS 보유수량 (매도 시)
 */
export function chipQty(
  pct: number,
  side: 'buy' | 'sell',
  price: number,
  orderableCash: number,
  heldQty: number
): number {
  if (side === 'buy') {
    if (!(price > 0)) return 0;
    return Math.floor(((orderableCash * pct) / 100) / price);
  }
  return Math.floor(heldQty * (pct / 100));
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
 * 지정가 기본값으로 쓸 기준가. 실호가 → 최근 체결가 순으로 고르고, 둘 다 없으면 0.
 *
 * `detail.price`(목 데이터)로 폴백하지 않는 게 핵심이다. getStockDetail이 아직 목이라
 * 25만원 종목에 7.8만원이 기본으로 채워질 수 있고, 그대로 주문하면 시장에서 한참 떨어진
 * 지정가가 계좌에 들어간다. 실가가 없으면 0을 돌려 주문을 막는 편이 낫다.
 */
export function referencePrice(orderbook: Orderbook | undefined, lastTradePrice: number): number {
  const ask = orderbook?.asks.find((l) => l.price > 0)?.price ?? 0;
  const bid = orderbook?.bids.find((l) => l.price > 0)?.price ?? 0;
  if (ask > 0 && bid > 0) return Math.round((ask + bid) / 2);
  if (ask > 0) return ask;
  if (bid > 0) return bid;
  return lastTradePrice > 0 ? lastTradePrice : 0;
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
