import type { ReactNode } from 'react';

interface BadgeProps {
  /** 배지 색(hex). 미지정 시 중립 회색. 등락색은 signColor(pct, mode)와 함께 사용. */
  color?: string;
  dot?: boolean;
  children: ReactNode;
}

const BASE =
  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold leading-[1.55] whitespace-nowrap border';

/**
 * 호재/악재/중립, 매수/중립/매도, 상승/하락 태그 배지.
 *   <Badge color={signColor(pct, mode)}>{pct >= 0 ? '매수' : '매도'}</Badge>
 */
export default function Badge({ color, dot, children }: BadgeProps) {
  if (!color) {
    return (
      <span className={`${BASE} text-sub bg-[rgba(138,147,166,0.12)] border-[rgba(138,147,166,0.28)]`}>
        {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
        {children}
      </span>
    );
  }
  return (
    <span className={`${BASE} border-transparent`} style={{ color, background: `${color}1E`, borderColor: `${color}44` }}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
