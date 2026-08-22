import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  type: ToastType;
  title: string;
  desc?: string;
}
interface ToastInput {
  type?: ToastType;
  title: string;
  desc?: string;
  /** 자동 닫힘(ms). 기본 3500 */
  duration?: number;
}

const ACCENT: Record<ToastType, string> = {
  success: '#16c784',
  error: '#ea3943',
  info: '#7c6cff',
};

const ToastCtx = createContext<(t: ToastInput) => void>(() => {});

/** 어디서든 toast를 띄우는 훅. */
export function useToast() {
  return useContext(ToastCtx);
}

/** 앱 최상단(App.tsx)에서 감싸기: <ToastProvider>…</ToastProvider> */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const push = useCallback(
    ({ type = 'info', title, desc, duration = 3500 }: ToastInput) => {
      const id = ++seq.current;
      setToasts((prev) => [...prev, { id, type, title, desc }]);
      window.setTimeout(() => remove(id), duration);
    },
    [remove],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortalStack(toasts, remove)}
    </ToastCtx.Provider>
  );
}

// 포털 없이 fixed 컨테이너로도 충분(z-index 60). 필요 시 createPortal로 감싸도 됨.
function createPortalStack(toasts: Toast[], remove: (id: number) => void) {
  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2.5 w-[320px] pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="pointer-events-auto flex gap-3 p-3.5 bg-panel border border-line rounded-xl shadow-xl"
            style={{ borderLeft: `3px solid ${ACCENT[t.type]}` }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-fg">{t.title}</div>
              {t.desc && <div className="text-xs text-sub mt-0.5 leading-snug">{t.desc}</div>}
            </div>
            <button onClick={() => remove(t.id)} className="text-mut hover:text-fg text-base leading-none shrink-0" aria-label="닫기">×</button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
