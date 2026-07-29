import { describe, it, expect } from 'vitest';
import {
  effectiveBalance, validateBuy, validateSell, fee, chipQty, marketOrderPrice, appendOrder,
  type PaperOrder,
} from './paperOrders';
import type { Portfolio } from '@/data/types';

describe('종이 주문 로직', () => {
  const mockPortfolio: Portfolio = {
    fxUsdKrw: 1300,
    source: 'kis-mock',
    cash: 5000000, // 500만원
    summary: { totalValue: 10000000, securities: 5000000, pnl: 0, pnlPct: 0, dayPnl: 0, dayPnlPct: 0, principal: 5000000 },
    holdings: [
      { code: '005930', name: '삼성전자', market: 'KR', qty: 10, avg: 70000, price: 72000, cur: '₩', dec: 0 },
    ],
  };

  describe('effectiveBalance', () => {
    it('주문이 없으면 portfolio 값을 그대로 반환', () => {
      const result = effectiveBalance(mockPortfolio, []);
      expect(result.cash).toBe(5000000);
      expect(result.holdings.get('005930')).toBe(10);
    });

    it('매수 주문 1건: 예수금 감소 + 수수료 포함', () => {
      const orders: PaperOrder[] = [
        {
          id: '1', code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'market',
          price: 70000, qty: 10, fee: 105, at: Date.now(),
        },
      ];
      const result = effectiveBalance(mockPortfolio, orders);
      // 700,000 + 수수료 105 = 700,105 감소
      expect(result.cash).toBe(5000000 - 700000 - 105);
      expect(result.holdings.get('005930')).toBe(10 + 10);
    });

    it('매도 주문: 예수금 증가 + 수수료 차감', () => {
      const orders: PaperOrder[] = [
        {
          id: '1', code: '005930', name: '삼성전자', market: 'KR', side: 'sell', type: 'market',
          price: 72000, qty: 5, fee: 54, at: Date.now(),
        },
      ];
      const result = effectiveBalance(mockPortfolio, orders);
      // 360,000 - 수수료 54 = 359,946 증가
      expect(result.cash).toBe(5000000 + 360000 - 54);
      expect(result.holdings.get('005930')).toBe(10 - 5);
    });

    it('매수 2건 후 매도 1건: 합산이 정확함', () => {
      const orders: PaperOrder[] = [
        { id: '1', code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'market', price: 70000, qty: 5, fee: 53, at: Date.now() },
        { id: '2', code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'market', price: 71000, qty: 3, fee: 32, at: Date.now() },
        { id: '3', code: '005930', name: '삼성전자', market: 'KR', side: 'sell', type: 'market', price: 72000, qty: 2, fee: 29, at: Date.now() },
      ];
      const result = effectiveBalance(mockPortfolio, orders);
      // 매수: (70000*5 + 53) + (71000*3 + 32) = 350,085
      // 매도: (72000*2 - 29) = 143,971
      // 예수금: 5,000,000 - 350,085 + 143,971 = 4,793,886
      expect(result.cash).toBe(5000000 - 350000 - 53 - 213000 - 32 + 144000 - 29);
      expect(result.holdings.get('005930')).toBe(10 + 5 + 3 - 2);
    });

    it('보유하지 않은 종목 매수: holdings에 새로 추가', () => {
      const orders: PaperOrder[] = [
        { id: '1', code: '000660', name: 'SK하이닉스', market: 'KR', side: 'buy', type: 'market', price: 100000, qty: 1, fee: 15, at: Date.now() },
      ];
      const result = effectiveBalance(mockPortfolio, orders);
      expect(result.holdings.get('000660')).toBe(1);
    });
  });

  describe('validateSell', () => {
    it('매도 가능: 보유 수량 > 매도 수량', () => {
      const result = validateSell('005930', 5, mockPortfolio, []);
      expect(result.ok).toBe(true);
    });

    it('매도 불가: 보유 수량 < 매도 수량', () => {
      const result = validateSell('005930', 15, mockPortfolio, []);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('보유');
    });

    it('매도 불가: 보유하지 않은 종목', () => {
      const result = validateSell('000660', 1, mockPortfolio, []);
      expect(result.ok).toBe(false);
    });

    it('페이퍼 매수 중인 종목: 유효 보유 = KIS + 페이퍼', () => {
      const orders: PaperOrder[] = [
        { id: '1', code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'market', price: 70000, qty: 5, fee: 53, at: Date.now() },
      ];
      // KIS: 10, 페이퍼 매수: 5 → 유효: 15
      const result = validateSell('005930', 15, mockPortfolio, orders);
      expect(result.ok).toBe(true);

      const result2 = validateSell('005930', 16, mockPortfolio, orders);
      expect(result2.ok).toBe(false);
    });

    it('페이퍼 매도 중: 유효 보유 = KIS + 페이퍼 매수 - 페이퍼 매도', () => {
      const orders: PaperOrder[] = [
        { id: '1', code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'market', price: 70000, qty: 5, fee: 53, at: Date.now() },
        { id: '2', code: '005930', name: '삼성전자', market: 'KR', side: 'sell', type: 'market', price: 72000, qty: 3, fee: 29, at: Date.now() },
      ];
      // KIS: 10, 매수: +5, 매도: -3 → 유효: 12
      const result = validateSell('005930', 12, mockPortfolio, orders);
      expect(result.ok).toBe(true);

      const result2 = validateSell('005930', 13, mockPortfolio, orders);
      expect(result2.ok).toBe(false);
    });

    it('portfolio.unavailable일 때 주문 불가', () => {
      const unavailablePortfolio = { ...mockPortfolio, unavailable: true };
      const result = validateSell('005930', 1, unavailablePortfolio, []);
      expect(result.ok).toBe(false);
    });
  });

  describe('validateBuy', () => {
    it('매수 가능: 예수금 >= 필요액(가격*수량+수수료)', () => {
      const result = validateBuy(10, 70000, mockPortfolio, []);
      // 필요액: 700,000 + fee(700,000) = 700,105
      expect(result.ok).toBe(true);
    });

    it('매수 불가: 예수금 부족', () => {
      const result = validateBuy(100, 70000, mockPortfolio, []);
      // 필요액: 7,000,000 > 5,000,000
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('부족');
    });

    it('portfolio.unavailable일 때 주문 불가', () => {
      const unavailablePortfolio = { ...mockPortfolio, unavailable: true };
      const result = validateBuy(10, 70000, unavailablePortfolio, []);
      expect(result.ok).toBe(false);
    });

    it('페이퍼 매수 중: 유효 예수금 감소', () => {
      const orders: PaperOrder[] = [
        { id: '1', code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'market', price: 70000, qty: 30, fee: 315, at: Date.now() },
      ];
      // 유효 예수금: 5,000,000 - 2,100,315 = 2,899,685
      // 새 매수: 10 * 70000 + fee = 700,105 필요
      const result = validateBuy(10, 70000, mockPortfolio, orders);
      expect(result.ok).toBe(true);

      // 40개를 더 사려면 2,800,420 필요인데 2,899,685 > 2,800,420이므로 가능... 계산 다시
      // 유효 예수금: 5,000,000 - (70000*30 + 315) = 5,000,000 - 2,100,315 = 2,899,685
      // 40 * 70000 + fee(2,800,000) = 2,800,000 + 42,000 = 2,842,000 < 2,899,685 가능
      const result2 = validateBuy(40, 70000, mockPortfolio, orders);
      expect(result2.ok).toBe(true);

      // 41개: 2,870,000 + 42,000 = 2,912,000 > 2,899,685 불가능
      // 아 계산이 복잡하다. 정확히 계산하자.
      // 41 * 70000 = 2,870,000, fee(2,870,000) = 430.5 ≈ 431
      // 2,870,431 > 2,899,685... 아니다 2,870,431 < 2,899,685이므로 가능
      // 50개: 3,500,000 + 525 = 3,500,525 > 2,899,685이므로 불가능
      const result3 = validateBuy(50, 70000, mockPortfolio, orders);
      expect(result3.ok).toBe(false);
    });

    it('페이퍼 매도로 인해 실질적으로 유효 예수금 증가', () => {
      const orders: PaperOrder[] = [
        { id: '1', code: '005930', name: '삼성전자', market: 'KR', side: 'sell', type: 'market', price: 72000, qty: 5, fee: 54, at: Date.now() },
      ];
      // 유효 예수금: 5,000,000 + (72000*5 - 54) = 5,000,000 + 359,946 = 5,359,946
      const result = validateBuy(70, 70000, mockPortfolio, orders);
      // 70 * 70000 + fee = 4,900,000 + 735 = 4,900,735 < 5,359,946
      expect(result.ok).toBe(true);
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

  describe('chipQty', () => {
    it('매수 10%: 유효 예수금 / 10 / 현재가 = floor', () => {
      // 예수금: 5,000,000, 현재가: 70,000
      // 10% = 500,000 / 70,000 = 7.14... → 7
      const result = chipQty(10, 'buy', 70000, mockPortfolio, []);
      expect(result).toBe(7);
    });

    it('매수 25%', () => {
      // 25% = 1,250,000 / 70,000 = 17.85... → 17
      const result = chipQty(25, 'buy', 70000, mockPortfolio, []);
      expect(result).toBe(17);
    });

    it('매수 50%', () => {
      // 50% = 2,500,000 / 70,000 = 35.71... → 35
      const result = chipQty(50, 'buy', 70000, mockPortfolio, []);
      expect(result).toBe(35);
    });

    it('매수 100%: 전량', () => {
      // 100% = 5,000,000 / 70,000 = 71.42... → 71
      const result = chipQty(100, 'buy', 70000, mockPortfolio, []);
      expect(result).toBe(71);
    });

    it('매도 10%: 유효 보유 * 0.1 = floor', () => {
      // KIS: 10, 페이퍼: 0 → 유효: 10
      // 10% = 10 * 0.1 = 1
      const result = chipQty(10, 'sell', 72000, mockPortfolio, []);
      expect(result).toBe(1);
    });

    it('매도 25%', () => {
      // 25% = 10 * 0.25 = 2.5 → 2
      const result = chipQty(25, 'sell', 72000, mockPortfolio, []);
      expect(result).toBe(2);
    });

    it('매도 50%', () => {
      // 50% = 10 * 0.5 = 5
      const result = chipQty(50, 'sell', 72000, mockPortfolio, []);
      expect(result).toBe(5);
    });

    it('매도 100%: 전량', () => {
      // 100% = 10 * 1.0 = 10
      const result = chipQty(100, 'sell', 72000, mockPortfolio, []);
      expect(result).toBe(10);
    });

    it('페이퍼 매수 후 매도 칩: 유효 보유 기준', () => {
      const orders: PaperOrder[] = [
        { id: '1', code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'market', price: 70000, qty: 5, fee: 53, at: Date.now() },
      ];
      // KIS: 10 + 페이퍼: 5 = 15
      // 50% = 15 * 0.5 = 7.5 → 7
      const result = chipQty(50, 'sell', 72000, mockPortfolio, orders);
      expect(result).toBe(7);
    });
  });

  describe('marketOrderPrice', () => {
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
