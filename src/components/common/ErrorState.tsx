import { motion } from 'framer-motion';
import Button from './Button';

interface ErrorStateProps {
  title?: string;
  desc?: string;
  onRetry?: () => void;
}

/** 데이터 로드 실패 상태. EmptyState와 동일 구조 + 재시도 버튼. */
export default function ErrorState({
  title = '데이터를 불러오지 못했습니다',
  desc = '네트워크 또는 서버 상태를 확인한 뒤 다시 시도하세요.',
  onRetry,
}: ErrorStateProps) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-2.5 py-12 px-6 text-center"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="grid place-items-center w-10 h-10 rounded-xl bg-[rgba(234,57,67,0.14)] text-[#ff6b73] text-lg font-bold">!</div>
      <div className="text-[13px] font-bold text-sub">{title}</div>
      {desc && <div className="max-w-[280px] text-xs leading-normal text-mut">{desc}</div>}
      {onRetry && <Button variant="subtle" size="sm" onClick={onRetry}>다시 시도</Button>}
    </motion.div>
  );
}
