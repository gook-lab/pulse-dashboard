// @vitest-environment jsdom
//
// Regression: 종목 전환 시 이전 종목 차트 데이터 잔상 (2026-08-05 사용자 실측)
// 새 종목 조회가 KIS 게이트 큐에서 수 초 걸리는 동안 useKrChartAll/useKrIntraday가
// 이전 종목 데이터를 비우지 않아 "SK하이닉스 이름 + 삼성전자 가격·차트"가 렌더됐다.
// 코드가 바뀌면 그 즉시 빈 상태(로딩)여야 한다 — 잔상은 목보다 나쁜 거짓말이다.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useKrChartAll, useKrIntraday } from './kisSocket';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const candle = (c: number) => ({ date: '20260805', o: c, h: c, l: c, c, v: 100 });

describe('종목 전환 시 차트 데이터 잔상 제거', () => {
  it('useKrChartAll: 코드가 바뀌면 새 응답 전에 이전 일봉이 즉시 비워진다', async () => {
    // 005930은 즉시 응답, 000660은 영원히 pending(게이트 큐 지연 재현)
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      String(url).includes('005930')
        ? Promise.resolve({ ok: true, json: async () => ({ daily: [candle(246_750)], weekly: [], monthly: [] }) } as Response)
        : new Promise<Response>(() => { /* pending */ })));

    const { result, rerender } = renderHook(({ code }) => useKrChartAll(code), {
      initialProps: { code: '005930' as string },
    });
    await waitFor(() => expect(result.current.daily).toHaveLength(1));

    rerender({ code: '000660' });
    // 새 조회가 안 끝났어도 이전 종목(246,750) 봉이 남아 있으면 안 된다
    expect(result.current.daily).toHaveLength(0);
    expect(result.current.loading).toBe(true);
  });

  it('useKrIntraday: 코드가 바뀌면 이전 분봉이 즉시 비워진다', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      String(url).includes('005930')
        ? Promise.resolve({ ok: true, json: async () => [candle(246_750)] } as Response)
        : new Promise<Response>(() => { /* pending */ })));

    const { result, rerender } = renderHook(({ code }) => useKrIntraday(code), {
      initialProps: { code: '005930' as string },
    });
    await waitFor(() => expect(result.current.candles).toHaveLength(1));

    rerender({ code: '000660' });
    expect(result.current.candles).toHaveLength(0);
  });
});
