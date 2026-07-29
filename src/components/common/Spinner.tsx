import { motion } from 'framer-motion';

interface SpinnerProps {
  /** 지름(px). 기본 18 */
  size?: number;
  /** 선 색. 미지정 시 currentColor(부모 색 상속) */
  color?: string;
  className?: string;
}

/** 회전 스피너. 버튼·행 안에 인라인으로도 사용. */
export default function Spinner({ size = 18, color, className }: SpinnerProps) {
  return (
    <motion.svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ color: color ?? 'var(--brand)' }}
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, ease: 'linear', duration: 0.7 }}
      role="status"
      aria-label="로딩 중"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </motion.svg>
  );
}

/** 패널/카드 중앙 로딩 상태. 기존 '불러오는 중…' 텍스트 대체. */
export function Loading({ label = '불러오는 중…', size = 26 }: { label?: string; size?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-[13px] text-mut">
      <Spinner size={size} />
      <span>{label}</span>
    </div>
  );
}
