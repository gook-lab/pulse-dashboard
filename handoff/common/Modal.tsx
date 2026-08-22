import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/** 중앙 모달. 백드롭 블러 · ESC/바깥클릭 닫기 · framer-motion 등장/퇴장. */
export default function Modal({ open, onClose, title, children, footer, width = 460 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: 'rgba(6,8,13,0.6)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full bg-panel border border-line rounded-card overflow-hidden shadow-2xl"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="flex items-center justify-between px-5 py-4 border-b border-line">
                <span className="text-sm font-bold text-fg">{title}</span>
                <button onClick={onClose} className="text-mut hover:text-fg text-lg leading-none" aria-label="닫기">×</button>
              </div>
            )}
            <div className="px-5 py-4 text-[13px] text-sub leading-relaxed">{children}</div>
            {footer && <div className="flex justify-end gap-2 px-5 py-4 border-t border-line">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
