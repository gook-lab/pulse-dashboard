import { describe, it, expect } from 'vitest';
import { parseTrade, parseOrderbook } from './kisSocket';

// KIS 실시간 체결/호가 파서 계약 잠금(골든 프레임).
// ⚠️ 필드 인덱스는 KIS 대표값 — 실계좌 연동 시 최신 명세로 이 픽스처를 갱신할 것.

// 체결(H0STCNT0): [0]코드 [1]시간HHMMSS [2]현재가 [5]전일대비율 [12]체결량 [21]매수매도(5=매도)
function tradeFrame(over: Record<number, string>): string[] {
  const f = new Array(30).fill('0');
  f[0] = '005930'; f[1] = '093015'; f[2] = '252000'; f[5] = '-6.67'; f[12] = '150'; f[21] = '2';
  Object.entries(over).forEach(([i, v]) => { f[+i] = v; });
  return f;
}

describe('parseTrade', () => {
  it('필드 인덱스 매핑 + 시간 포맷', () => {
    expect(parseTrade(tradeFrame({}))).toEqual({
      code: '005930', time: '09:30:15', price: 252000, changePct: -6.67, volume: 150, side: '매수',
    });
  });
  it('구분: f[21]===5 → 매도, 그 외 → 매수', () => {
    expect(parseTrade(tradeFrame({ 21: '5' })).side).toBe('매도');
    expect(parseTrade(tradeFrame({ 21: '1' })).side).toBe('매수');
  });
  it('빈 문자열은 0으로', () => {
    expect(parseTrade(tradeFrame({ 2: '', 5: '', 12: '' }))).toMatchObject({ price: 0, changePct: 0, volume: 0 });
  });
});

// 호가(H0STASP0): [3..7]매도호가1~5 [13..17]매수호가1~5 [23..27]매도잔량 [33..37]매수잔량
function obFrame(): string[] {
  const f = new Array(45).fill('0');
  f[0] = '005930';
  for (let i = 0; i < 5; i++) {
    f[3 + i] = String(252100 + i * 100);  // 매도호가
    f[13 + i] = String(251900 - i * 100);  // 매수호가
    f[23 + i] = String(10 + i);            // 매도잔량
    f[33 + i] = String(20 + i);            // 매수잔량
  }
  return f;
}

describe('parseOrderbook', () => {
  const ob = parseOrderbook(obFrame());
  it('매도/매수 각 5호가 파싱', () => {
    expect(ob.asks).toHaveLength(5);
    expect(ob.bids).toHaveLength(5);
  });
  it('호가·잔량 인덱스 매핑 정확', () => {
    expect(ob.asks[0]).toEqual({ price: 252100, qty: 10 });
    expect(ob.asks[4]).toEqual({ price: 252500, qty: 14 });
    expect(ob.bids[0]).toEqual({ price: 251900, qty: 20 });
    expect(ob.bids[4]).toEqual({ price: 251500, qty: 24 });
  });
});
