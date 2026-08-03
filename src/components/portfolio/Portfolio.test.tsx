// @vitest-environment jsdom
//
// 일간손익도 지수 등락과 같은 함정이 있다: KIS는 장 시작 전 fltt_rt·bfdy_cprs_icdc 를 0으로 준다.
// 그 0을 "₩0 / 0%"로 찍으면 실제 보합과 구별되지 않는다(실측으로 있었던 버그).
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import Portfolio from './Portfolio';
import type { Portfolio as PortfolioT } from '../../data/types';

// 하위 위젯은 이 테스트의 관심사가 아니다(소켓·차트 fetch를 끌고 온다).
vi.mock('./ReturnChart', () => ({ default: () => null }));
vi.mock('../../lib/kisSocket', () => ({ useKisTrade: () => null }));

const base: PortfolioT = {
  fxUsdKrw: 1441.1,
  source: 'kis-mock',
  cash: 9_486_373,
  summary: {
    totalValue: 10_011_373, securities: 525_000,
    pnl: 12_750, pnlPct: 2.49,
    dayPnl: 0, dayPnlPct: 0,
    principal: 512_250,
  },
  holdings: [
    { code: '005930', name: '삼성전자', market: 'KR', qty: 2, avg: 256_125, price: 262_500, cur: '₩', dec: 0 },
  ],
};

const mount = (pf: PortfolioT) => {
  useStore.setState({ portfolio: pf, colorMode: 'global', paperOrders: [] });
  return render(<Portfolio />);
};

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Portfolio — 일간손익 표시', () => {
  it('소스가 일간 등락을 안 주면 "-" 와 사유를 보여준다', () => {
    mount({ ...base, summary: { ...base.summary, dayPnlUnavailable: true } });
    expect(screen.getByText('장 시작 전 · 소스 미제공')).toBeTruthy();
    expect(screen.queryByText('₩0')).toBeNull();
  });

  it('장중에는 실제 일간손익을 숫자로 보여준다', () => {
    mount({ ...base, summary: { ...base.summary, dayPnl: -18_243, dayPnlPct: -7.47 } });
    expect(screen.getByText('₩-18,243')).toBeTruthy();
    expect(screen.getByText('-7.47%')).toBeTruthy();
    expect(screen.queryByText('장 시작 전 · 소스 미제공')).toBeNull();
  });

  it('평가손익은 장 전에도 실값이라 그대로 표시한다', () => {
    mount({ ...base, summary: { ...base.summary, dayPnlUnavailable: true } });
    expect(screen.getByText('+₩12,750')).toBeTruthy();
    // +2.49%는 요약(평가손익)과 보유 행(손익률) 양쪽에 나온다 — 둘 다 같은 실값이라 개수만 본다.
    expect(screen.getAllByText('+2.49%').length).toBeGreaterThan(0);
  });
});

describe('Portfolio — 평가액 정합', () => {
  it('평가액은 수량 × 현재가, 총자산은 예수금 + 평가액', () => {
    mount(base);
    expect(screen.getByText('₩525,000')).toBeTruthy();      // 2주 × 262,500
    expect(screen.getByText('₩10,011,373')).toBeTruthy();   // 9,486,373 + 525,000
  });
});
