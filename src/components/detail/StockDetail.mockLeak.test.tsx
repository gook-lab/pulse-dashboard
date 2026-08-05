// @vitest-environment jsdom
//
// Regression: 종목 상세의 목 데이터 유출 (2026-08-05 금액 감사)
// getStockDetail 은 아직 목이라 detail.price/low52/high52/info 는 실가와 3~8배 벌어진다
// (삼성전자 목 78,400 vs 실 246,750 · SK하이닉스 목 198,500 vs 실 1,670,000).
// 실데이터가 없을 때 그 목값으로 폴백하면 "현재가"·"52주 범위"가 거짓이 된다 — RADIO #2.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import PriceAlertModal from './PriceAlertModal';
import type { StockDetail as SD } from '../../data/types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** 목 상세 — 실가와 스케일이 어긋난 값들. */
const mockDetail = (): SD => ({
  code: '005930', name: '삼성전자', market: 'KR', cur: '₩', dec: 0,
  price: 78_400, change: -1_100, changePct: -1.4,
  low52: 56_448, high52: 97_216,
  chart: { '1D': [], '1W': [], '1M': [], '1Y': [] },
  asks: [], bids: [], trades: [],
  ai: { score: 0, target: 0, upsidePct: 0, bull: [], bear: [] },
  info: { marketCap: '468조', per: 12.8, pbr: 1.32, eps: 6120, div: '2.1%', volume: '11.4M' },
});

describe('PriceAlertModal — 목 가격 유출 차단', () => {
  it('현재가는 주입된 실가를 쓴다 — 스토어의 목 detail.price(78,400)가 아니다', async () => {
    useStore.setState({ detail: mockDetail(), alerts: [] });
    render(
      <PriceAlertModal open onOpenChange={() => {}} code="005930" name="삼성전자" market="KR" currentPrice={246_750} />,
    );
    const input = await screen.findByPlaceholderText(/현재: 246,750/);
    expect(input).toBeTruthy();
    expect(screen.queryByPlaceholderText(/78,400/)).toBeNull();
  });

  it('실가를 못 받았으면 목값 대신 "현재가 조회 중"', async () => {
    useStore.setState({ detail: mockDetail(), alerts: [] });
    render(
      <PriceAlertModal open onOpenChange={() => {}} code="005930" name="삼성전자" market="KR" currentPrice={0} />,
    );
    expect(await screen.findByPlaceholderText('현재가 조회 중')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/78,400/)).toBeNull();
  });

  it('52주 신고가 알림: 실 high52 없으면 목 97,216 대신 "정보 없음"', async () => {
    useStore.setState({ detail: mockDetail(), alerts: [] });
    const { container } = render(
      <PriceAlertModal open onOpenChange={() => {}} code="005930" name="삼성전자" market="KR" />,
    );
    // '52주 신고가' 조건으로 전환
    const seg = [...container.ownerDocument.querySelectorAll('button')].find((b) => b.textContent === '52주 신고가');
    seg?.click();
    await waitFor(() => expect(screen.getByText('정보 없음')).toBeTruthy());
    expect(screen.queryByText(/97,216/)).toBeNull();
  });
});
