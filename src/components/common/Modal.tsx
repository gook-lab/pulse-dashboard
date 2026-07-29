import * as D from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useModalOpenSignal } from '@/store/useModalStore';

// viviane 패턴 참고: Radix Dialog + framer-motion + 전역 modal 신호.
interface ModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  desc?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}

function Signal() { useModalOpenSignal(); return null; }

export default function Modal({ open, onOpenChange, title, desc, children, footer, width = 440 }: ModalProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount>
            <D.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </D.Overlay>
            <D.Content asChild forceMount aria-describedby={undefined}
              onOpenAutoFocus={(e) => e.preventDefault()}>
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 grid rounded-card border border-line bg-panel p-6 shadow-[0_20px_60px_-12px_rgba(0,0,0,.7)]"
                // -translate-x/y-1/2 클래스는 framer-motion 이 transform 을 통째로 덮어써 무효가 된다
                // (애니메이션 종료 시 transform:none → 모달이 우하단으로 밀림). 템플릿으로 합성한다.
                transformTemplate={(_, generated) => `translate(-50%, -50%) ${generated === 'none' ? '' : generated}`}
                style={{ width, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }}
                initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
                <Signal />
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    {title && <D.Title className="text-[16px] font-bold text-fg leading-tight">{title}</D.Title>}
                    {desc && <D.Description className="mt-1.5 text-[13px] text-sub leading-relaxed">{desc}</D.Description>}
                  </div>
                  <D.Close asChild>
                    <button className="-mr-1 -mt-1 rounded-lg p-1.5 text-mut transition-colors hover:bg-panel2 hover:text-fg" aria-label="닫기">
                      <X size={18} />
                    </button>
                  </D.Close>
                </div>
                {children}
                {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
              </motion.div>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}
