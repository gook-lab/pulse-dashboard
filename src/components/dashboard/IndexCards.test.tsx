// @vitest-environment jsdom
//
// "데이터 없음"과 "실제 보합"이 화면에서 구별되는지 잠근다.
// KIS 모의는 장 시작 전 등락을 0으로 주는데, 그 0을 "0.00%"로 찍으면 진짜 보합과 같아 보인다.
// 실측으로 이 버그가 있었고(코스피가 하루 종일 ▲0 0.00%), changeUnavailable 플래그로 고쳤다.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import IndexCards from './IndexCards';
import type { IndexQuote } from '../../data/types';

const quote = (over: Partial<IndexQuote> = {}): IndexQuote => ({
  code: 'KOSPI', name: 'KOSPI', market: 'KR',
  price: 5593.56, change: 0, changePct: 0, dec: 2, spark: [],
  ...over,
});

const mount = (indices: IndexQuote[]) => {
  useStore.setState({ indices, colorMode: 'global' });
  return render(<IndexCards />);
};

afterEach(cleanup);

describe('IndexCards — 등락 표시', () => {
  it('소스가 등락을 안 주면 "등락 -" (0.00%로 위장하지 않는다)', () => {
    mount([quote({ changeUnavailable: true })]);
    expect(screen.getByText('등락 -')).toBeTruthy();
    expect(screen.queryByText(/0\.00%/)).toBeNull();
  });

  it('실제 보합(0.00%)은 그대로 숫자로 보여준다', () => {
    mount([quote()]);   // changeUnavailable 없음 = 진짜 0%
    expect(screen.getByText(/0\.00%/)).toBeTruthy();
    expect(screen.queryByText('등락 -')).toBeNull();
  });

  it('정상 등락은 값과 부호를 표시한다', () => {
    mount([quote({ change: 996.6, changePct: 17.82 })]);
    expect(screen.getByText(/\+17\.82%/)).toBeTruthy();
    expect(screen.getByText(/▲/)).toBeTruthy();
  });

  it('하락은 ▼', () => {
    mount([quote({ change: -50, changePct: -1.2 })]);
    expect(screen.getByText(/▼/)).toBeTruthy();
    expect(screen.getByText(/-1\.20%/)).toBeTruthy();
  });

  it('전체 실패(unavailable)면 값도 등락도 "-"', () => {
    mount([quote({ unavailable: true })]);
    const dashes = screen.getAllByText('-');
    expect(dashes.length).toBe(2);          // 가격 · 등락
    expect(screen.queryByText('등락 -')).toBeNull();
  });

  it('가격은 항상 실값 — 등락만 없을 때도 지수 레벨은 보여준다', () => {
    mount([quote({ changeUnavailable: true })]);
    expect(screen.getByText('5,593.56')).toBeTruthy();
  });
});
