import { describe, it, expect } from 'vitest';
import {
  validateBuy, validateSell, fee, chipQty, marketOrderPrice, referencePrice, appendOrder,
  type PaperOrder,
} from './paperOrders';

describe('종이 주문 로직', () => {
  describe('validateSell', () => {
    it('보유 수량 이내면 통과', () => {
      expect(validateSell(5, 10).ok).toBe(true);
      expect(validateSell(10, 10).ok).toBe(true);
    });

    it('보유 수량을 넘으면 거부', () => {
      const r = validateSell(15, 10);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('보유');
    });

    it('미보유(0주)는 거부', () => {
      expect(validateSell(1, 0).ok).toBe(false);
    });

    it('수량은 KIS 보유수량만 본다 — 로컬 주문으로 부풀리지 않는다', () => {
      // 예전 구조는 로컬 페이퍼 매수분을 더해 15주까지 매도를 허용했다(계좌엔 10주뿐).
      expect(validateSell(15, 10).ok).toBe(false);
    });
  });

  describe('validateBuy', () => {
    it('주문가능금액이 충분하면 통과', () => {
      // 필요액: 700,000 + fee(700,000)=105 → 700,105
      expect(validateBuy(10, 70000, 5_000_000).ok).toBe(true);
      expect(validateBuy(10, 70000, 700_105).ok).toBe(true);
    });

    it('1원이라도 모자라면 거부', () => {
      const r = validateBuy(10, 70000, 700_104);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('주문가능금액');
    });

    it('수수료를 빼먹지 않는다', () => {
      // 원금만 딱 맞으면 수수료 때문에 부족해야 한다
      expect(validateBuy(10, 70000, 700_000).ok).toBe(false);
    });
  });

  describe('chipQty', () => {
    it('매수는 주문가능금액의 pct%를 단가로 나눈 수량', () => {
      expect(chipQty(100, 'buy', 70000, 700_000, 0)).toBe(10);
      expect(chipQty(50, 'buy', 70000, 700_000, 0)).toBe(5);
      expect(chipQty(10, 'buy', 70000, 700_000, 0)).toBe(1);
    });

    it('매수 수량은 내림 — 예수금을 넘기지 않는다', () => {
      expect(chipQty(100, 'buy', 70000, 699_999, 0)).toBe(9);
    });

    it('매도는 보유수량의 pct%', () => {
      expect(chipQty(100, 'sell', 0, 0, 10)).toBe(10);
      expect(chipQty(50, 'sell', 0, 0, 10)).toBe(5);
      expect(chipQty(25, 'sell', 0, 0, 10)).toBe(2); // 2.5 → 내림
    });

    it('단가 0에 나누지 않는다', () => {
      expect(chipQty(100, 'buy', 0, 1_000_000, 0)).toBe(0);
    });
  });

  describe('fee', () => {
    it('0.015% 계산', () => {
      expect(fee(1000000)).toBe(150);
      expect(fee(100000000)).toBe(15000);
    });

    it('소수점은 버림', () => {
      // 1234 * 0.015% = 0.1851 → 0 (버림)
      expect(fee(1234)).toBe(0);
      // 10000 * 0.015% = 1.5 → 1 (버림)
      expect(fee(10000)).toBe(1);
    });
  });

  describe('referencePrice', () => {
    it('양쪽 호가가 있으면 중간값', () => {
      expect(referencePrice({ asks: [{ price: 253000, qty: 5 }], bids: [{ price: 252500, qty: 5 }] }, 0))
        .toBe(252750);
    });

    it('한쪽만 있으면 그 호가', () => {
      expect(referencePrice({ asks: [{ price: 253000, qty: 5 }], bids: [] }, 0)).toBe(253000);
      expect(referencePrice({ asks: [], bids: [{ price: 252500, qty: 5 }] }, 0)).toBe(252500);
    });

    it('상한가처럼 가격 0인 호가는 무시하고 체결가로 내려간다', () => {
      expect(referencePrice({ asks: [{ price: 0, qty: 0 }], bids: [{ price: 0, qty: 0 }] }, 251000))
        .toBe(251000);
    });

    it('호가·체결가가 전부 없으면 0 — 목 가격으로 폴백하지 않는다', () => {
      // getStockDetail이 목이라 25만원 종목에 7.8만원이 채워지는 사고를 막는다.
      expect(referencePrice(undefined, 0)).toBe(0);
      expect(referencePrice({ asks: [], bids: [] }, 0)).toBe(0);
    });
  });

  describe('marketOrderPrice', () => {
    // Regression: ISSUE-004 — 상한가 종목은 매도호가가 가격 0으로 온다. 0가격 레벨을 채택해 체결금액 ₩0이 되던 버그.
    // Found by /qa on 2026-07-29
    it('상한가(매도호가 전부 0)면 0을 건너뛰고 최근 체결가로 폴백', () => {
      const orderbook = {
        asks: [{ price: 0, qty: 0 }, { price: 0, qty: 0 }],
        bids: [{ price: 422, qty: 124360 }],
      };
      expect(marketOrderPrice('buy', orderbook, 421, 422)).toBe(421);
    });

    it('상한가에서 체결가도 없으면 현재가로 폴백', () => {
      const orderbook = { asks: [{ price: 0, qty: 0 }], bids: [] };
      expect(marketOrderPrice('buy', orderbook, 0, 422)).toBe(422);
    });

    it('중간에 0가격 레벨이 섞여도 첫 유효 호가를 채택', () => {
      const orderbook = {
        asks: [{ price: 0, qty: 0 }, { price: 70100, qty: 10 }],
        bids: [],
      };
      expect(marketOrderPrice('buy', orderbook, 0, 0)).toBe(70100);
    });

    it('매수: 최우선 매도호가 사용', () => {
      const orderbook = {
        asks: [{ price: 70100, qty: 100 }, { price: 70200, qty: 200 }],
        bids: [{ price: 70000, qty: 150 }],
      };
      const result = marketOrderPrice('buy', orderbook, 70000, 70050);
      expect(result).toBe(70100);
    });

    it('매도: 최우선 매수호가 사용', () => {
      const orderbook = {
        asks: [{ price: 70100, qty: 100 }],
        bids: [{ price: 70000, qty: 150 }, { price: 69900, qty: 200 }],
      };
      const result = marketOrderPrice('sell', orderbook, 70000, 70050);
      expect(result).toBe(70000);
    });

    it('매수: 호가 없을 때 최근 체결가 사용', () => {
      const orderbook = {
        asks: [],
        bids: [{ price: 70000, qty: 150 }],
      };
      const result = marketOrderPrice('buy', orderbook, 70050, 70100);
      expect(result).toBe(70050);
    });

    it('매도: 호가 없을 때 최근 체결가 사용', () => {
      const orderbook = {
        asks: [{ price: 70100, qty: 100 }],
        bids: [],
      };
      const result = marketOrderPrice('sell', orderbook, 69950, 70000);
      expect(result).toBe(69950);
    });

    it('호가와 체결가 모두 없을 때 현재가 사용', () => {
      const orderbook = { asks: [], bids: [] };
      const result = marketOrderPrice('buy', orderbook, 0, 70000);
      expect(result).toBe(70000);
    });

    it('3단계 폴백 전체: 호가 → 체결가 → 현재가', () => {
      // 매수: 호가 있음
      expect(marketOrderPrice('buy', { asks: [{ price: 70100, qty: 100 }], bids: [] }, 0, 70000)).toBe(70100);
      // 매수: 호가 없고 체결가 있음
      expect(marketOrderPrice('buy', { asks: [], bids: [] }, 70050, 70000)).toBe(70050);
      // 매수: 호가·체결가 모두 없음
      expect(marketOrderPrice('buy', { asks: [], bids: [] }, 0, 70000)).toBe(70000);
    });
  });

  describe('appendOrder', () => {
    it('주문을 리스트에 추가', () => {
      const orders: PaperOrder[] = [];
      const newOrder: PaperOrder = {
        id: '1', code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'limit',
        price: 70000, qty: 10, fee: 105, at: Date.now(),
      };
      const result = appendOrder(orders, newOrder);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(newOrder);
    });

    it('상한 100건 초과 시 가장 오래된 것 제거', () => {
      const orders: PaperOrder[] = [];
      for (let i = 0; i < 100; i++) {
        orders.push({
          id: String(i), code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'market',
          price: 70000, qty: 1, fee: 11, at: Date.now() - (100 - i) * 1000,
        });
      }
      const newOrder: PaperOrder = {
        id: '100', code: '000660', name: 'SK하이닉스', market: 'KR', side: 'buy', type: 'market',
        price: 100000, qty: 1, fee: 15, at: Date.now(),
      };
      const result = appendOrder(orders, newOrder);
      expect(result).toHaveLength(100);
      expect(result[0].id).toBe('1'); // 가장 오래된 id='0'이 제거됨
      expect(result[99].id).toBe('100'); // 새 주문이 마지막에
    });

    it('기본 상한 100건을 커스텀 상한으로 변경 가능', () => {
      const orders: PaperOrder[] = [];
      for (let i = 0; i < 10; i++) {
        orders.push({
          id: String(i), code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'market',
          price: 70000, qty: 1, fee: 11, at: Date.now() - (10 - i) * 1000,
        });
      }
      const newOrder: PaperOrder = {
        id: '10', code: '000660', name: 'SK하이닉스', market: 'KR', side: 'buy', type: 'market',
        price: 100000, qty: 1, fee: 15, at: Date.now(),
      };
      const result = appendOrder(orders, newOrder, 5);
      expect(result).toHaveLength(5);
      expect(result[0].id).toBe('6');
      expect(result[4].id).toBe('10');
    });
  });
});
