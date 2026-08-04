// @vitest-environment jsdom
//
// Regression: ISSUE-002 — 히트맵 목 등락률이 실데이터처럼 렌더
// Found by /qa on 2026-08-04
// Report: .gstack/qa-reports/qa-report-localhost-2026-08-04.md
//
// 시세 병합이 성공(HTTP 200)해도 스로틀 순간엔 값이 전부/일부 null이다. 그 타일이
// 목 changePct 색·%로 남으면 실데이터로 오독된다(실측: 삼성전자 실제 -3.44% vs 화면 -6.7%).
// 실시세를 받은 심볼만 %를 그리고, 못 받은 타일은 '-' 인지 잠근다.
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import Heatmap from './Heatmap';
import type { HeatmapNode } from '../../data/types';

// 큰 타일 2개짜리 최소 히트맵 — 라벨·%가 확실히 그려지는 크기.
const node = (symbol: string, changePct: number): HeatmapNode => ({
  symbol, weight: 500, changePct, sector: 'Technology', industry: 'Semiconductors',
  price: 100, market: 'SP500',
});

const mount = () => {
  useStore.setState({ heatmap: [node('NVDA', 2.9), node('AVGO', -6.7)], colorMode: 'global' });
  return render(<Heatmap />);
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });

const fetchReturning = (payload: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => payload }) as Response);

describe('Heatmap — ISSUE-002 실시세 미확보 타일', () => {
  it('시세가 전부 null(빈 성공)이면 목 %를 그리지 않는다 — 연결 안됨 처리', async () => {
    vi.stubGlobal('fetch', fetchReturning({}));   // 200이지만 빈 객체 = 스로틀 순간
    mount();
    await waitFor(() => expect(screen.getByText('실시간 시세 연결 안됨')).toBeTruthy());
    // 목 등락(-6.7%)이 어디에도 없어야 한다
    expect(screen.queryByText(/-6\.7%/)).toBeNull();
    expect(screen.queryByText(/\+2\.9%/)).toBeNull();
  });

  it('일부만 받으면 받은 타일만 % 표시, 못 받은 타일은 "-"', async () => {
    vi.stubGlobal('fetch', fetchReturning({ NVDA: { price: 210.5, changePct: 3.1 } }));
    mount();
    await waitFor(() => expect(screen.getByText('+3.1%')).toBeTruthy());
    // AVGO는 실시세가 없다 — 목 -6.7% 대신 '-'
    expect(screen.queryByText(/-6\.7%/)).toBeNull();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
    // 전체 실패 오버레이는 아니다(부분 성공)
    expect(screen.queryByText('실시간 시세 연결 안됨')).toBeNull();
  });

  it('네트워크 실패면 연결 안됨 오버레이', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    mount();
    await waitFor(() => expect(screen.getByText('실시간 시세 연결 안됨')).toBeTruthy());
  });
});
