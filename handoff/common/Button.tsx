import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';
import Spinner from './Spinner';

type Variant = 'primary' | 'subtle' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-transparent font-semibold whitespace-nowrap select-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-[13px]',
  lg: 'px-[18px] py-2.5 text-sm',
};

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-[#6a5aef]',
  subtle: 'bg-panel2 text-sub border-line hover:text-fg hover:border-brand',
  ghost: 'text-sub hover:text-fg hover:bg-panel2',
  danger:
    'text-[#ff6b73] bg-[rgba(234,57,67,0.14)] border-[rgba(234,57,67,0.32)] hover:bg-[rgba(234,57,67,0.22)]',
};

interface ButtonProps extends HTMLMotionProps<'button'> {
  variant?: Variant;
  size?: Size;
  /** 로딩 스피너 표시 + 비활성화 */
  loading?: boolean;
  /** 가로 100% */
  block?: boolean;
  /** 좌측 아이콘 */
  icon?: ReactNode;
  children?: ReactNode;
}

export default function Button({
  variant = 'subtle',
  size = 'md',
  loading = false,
  block = false,
  icon,
  children,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const cls = [BASE, SIZES[size], VARIANTS[variant], block && 'flex w-full', className]
    .filter(Boolean)
    .join(' ');
  return (
    <motion.button
      className={cls}
      disabled={disabled || loading}
      whileTap={disabled || loading ? undefined : { scale: 0.96 }}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 13 : 15} color="currentColor" /> : icon}
      {children}
    </motion.button>
  );
}
