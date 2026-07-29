import { useEffect } from 'react';
import { create } from 'zustand';

// viviane 패턴 참고: 열린 모달 수 신호. 모달 Content 마운트 동안 카운트 유지 →
// 전역 단축키/입력 차단 등의 단일 신호원. 개별 다이얼로그 배선 불필요.
interface ModalState {
  openModalCount: number;
  increment: () => void;
  decrement: () => void;
}

export const useModalStore = create<ModalState>()((set) => ({
  openModalCount: 0,
  increment: () => set((s) => ({ openModalCount: s.openModalCount + 1 })),
  decrement: () => set((s) => ({ openModalCount: Math.max(0, s.openModalCount - 1) })), // StrictMode 방어
}));

export const useIsAnyModalOpen = (): boolean => useModalStore((s) => s.openModalCount > 0);

/** 모달 Content 내부에서 호출 — 마운트 동안 전역 카운트 유지. */
export function useModalOpenSignal(): void {
  const increment = useModalStore((s) => s.increment);
  const decrement = useModalStore((s) => s.decrement);
  useEffect(() => {
    increment();
    return () => decrement();
  }, [increment, decrement]);
}
