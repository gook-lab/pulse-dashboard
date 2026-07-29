import { describe, it, expect } from 'vitest';
import { tickSize, snapToTick } from './krxTick';

describe('KRX 가격대별 호가단위', () => {
  describe('tickSize — 2023-01 7단계', () => {
    it('2,000원 미만 = 1원', () => {
      expect(tickSize(1)).toBe(1);
      expect(tickSize(1999)).toBe(1);
    });

    it('2,000원 이상 5,000원 이하 = 5원', () => {
      expect(tickSize(2000)).toBe(5);
      expect(tickSize(3500)).toBe(5);
      expect(tickSize(5000)).toBe(5);
    });

    it('5,000원 초과 20,000원 이하 = 10원', () => {
      expect(tickSize(5001)).toBe(10);
      expect(tickSize(10000)).toBe(10);
      expect(tickSize(20000)).toBe(10);
    });

    it('20,000원 초과 50,000원 이하 = 50원', () => {
      expect(tickSize(20001)).toBe(50);
      expect(tickSize(35000)).toBe(50);
      expect(tickSize(50000)).toBe(50);
    });

    it('50,000원 초과 200,000원 이하 = 100원', () => {
      expect(tickSize(50001)).toBe(100);
      expect(tickSize(100000)).toBe(100);
      expect(tickSize(200000)).toBe(100);
    });

    it('200,000원 초과 500,000원 이하 = 500원', () => {
      expect(tickSize(200001)).toBe(500);
      expect(tickSize(350000)).toBe(500);
      expect(tickSize(500000)).toBe(500);
    });

    it('500,000원 초과 = 1,000원', () => {
      expect(tickSize(500001)).toBe(1000);
      expect(tickSize(100000000)).toBe(1000);
    });
  });

  describe('snapToTick — 가격 스냅', () => {
    it('기본값(down): 가격을 호가단위 이하로 내림', () => {
      expect(snapToTick(1999)).toBe(1999); // 1원 단위 → 그대로
      expect(snapToTick(2001)).toBe(2000); // 5원 단위 → 2000으로 내림
      expect(snapToTick(2003)).toBe(2000); // 5원 단위 → 2000으로 내림
      expect(snapToTick(2004)).toBe(2000); // 5원 단위 → 2000으로 내림
    });

    it('매수 시나리오: 81,234원을 100원 단위로 내림', () => {
      // 81,234는 50,000~200,000 범위 → 100원 단위
      expect(snapToTick(81234, 'down')).toBe(81200);
    });

    it('up: 가격을 호가단위 이상으로 올림', () => {
      expect(snapToTick(2001, 'up')).toBe(2005); // 5원 단위 → 2005로 올림
      expect(snapToTick(2000, 'up')).toBe(2000); // 정확히 스냅 → 그대로
      expect(snapToTick(81234, 'up')).toBe(81300); // 100원 단위 → 81300으로 올림
    });

    it('nearest: 가장 가까운 호가단위로 반올림', () => {
      expect(snapToTick(2002, 'nearest')).toBe(2000); // 2.5보다 작으면 내림
      expect(snapToTick(2003, 'nearest')).toBe(2005); // 2.5보다 크면 올림
      expect(snapToTick(81234, 'nearest')).toBe(81200); // 50보다 작으면 내림
      expect(snapToTick(81250, 'nearest')).toBe(81300); // 50 이상이면 올림(round half up)
    });

    it('이미 스냅된 가격은 변하지 않는다', () => {
      expect(snapToTick(2000)).toBe(2000);
      expect(snapToTick(100000)).toBe(100000);
      expect(snapToTick(501000)).toBe(501000);
    });
  });
});
