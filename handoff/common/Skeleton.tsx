import { motion } from 'framer-motion';
import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** 기본 스켈레톤 블록(shimmer). */
export default function Skeleton({ width, height = 14, radius, circle, className, style }: SkeletonProps) {
  return (
    <span
      className={['relative block overflow-hidden bg-panel2', circle ? 'rounded-full' : 'rounded-md', className]
        .filter(Boolean)
        .join(' ')}
      style={{ width: circle ? height : width ?? '100%', height, borderRadius: radius, ...style }}
    >
      <motion.span
        className="absolute inset-0"
        style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)' }}
        animate={{ x: ['-100%', '100%'] }}
        transition={{ repeat: Infinity, duration: 1.3, ease: 'linear' }}
      />
    </span>
  );
}

/** 여러 줄 텍스트 스켈레톤. 마지막 줄은 짧게. */
export function SkeletonText({ lines = 3, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <span className="flex flex-col" style={{ gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '55%' : '100%'} />
      ))}
    </span>
  );
}

/** 테이블/리스트 로딩용 행 스켈레톤. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3.5 py-[11px] border-b border-row">
          <Skeleton circle height={22} />
          <div className="flex-1">
            <SkeletonText lines={2} gap={6} />
          </div>
          <Skeleton width={64} height={12} />
        </div>
      ))}
    </>
  );
}
