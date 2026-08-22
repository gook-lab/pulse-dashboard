import { motion } from 'framer-motion';
import { useId } from 'react';

interface Option<T> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: Option<T>[] | readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * 세그먼트 컨트롤. 활성 표시는 framer-motion layoutId로 부드럽게 슬라이드.
 * 기간 탭(1D/1W/1M/1Y), 감성 필터(전체/호재/악재/중립), 지도 지표 등 반복 토글 통일.
 *   <Segmented options={PERIODS} value={period} onChange={setPeriod} />
 */
export default function Segmented<T extends string>({ options, value, onChange, className }: SegmentedProps<T>) {
  const id = useId();
  return (
    <div
      role="tablist"
      className={['inline-flex gap-[3px] p-[3px] bg-row border border-line rounded-[10px]', className]
        .filter(Boolean)
        .join(' ')}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`relative px-[11px] py-[5px] rounded-[7px] text-xs font-semibold transition-colors ${
              active ? 'text-fg' : 'text-sub hover:text-fg'
            }`}
          >
            {active && (
              <motion.span
                layoutId={id}
                className="absolute inset-0 rounded-[7px] bg-[rgba(124,108,255,0.18)]"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
