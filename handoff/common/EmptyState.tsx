import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  desc?: string;
  action?: ReactNode;
}

/** 데이터 없음/미선택 상태. '종목을 선택하세요' 같은 안내 통일. */
export default function EmptyState({ icon, title, desc, action }: EmptyStateProps) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-2.5 py-12 px-6 text-center"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {icon && <div className="grid place-items-center w-10 h-10 rounded-xl bg-panel2 text-mut">{icon}</div>}
      <div className="text-[13px] font-bold text-sub">{title}</div>
      {desc && <div className="max-w-[280px] text-xs leading-normal text-mut">{desc}</div>}
      {action}
    </motion.div>
  );
}
