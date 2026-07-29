/**
 * BarChart — 세로/가로 바 차트
 *
 * VerticalBars : 분기 실적처럼 "당기 + 비교기간" 2줄 세로 바 + YoY 라벨
 * HorizontalBars : 경쟁사·섹터 비교. 기준 항목 하나만 강조.
 */
import { useState } from 'react';

export interface BarDatum {
  label: string;
  value: number;
  /** 비교 기간 값(전년동기 등). 있으면 회색 바를 나란히 그림 */
  compare?: number;
}

interface VProps {
  data: BarDatum[];
  /** 값 포맷 (기본: 소수1자리) */
  format?: (v: number) => string;
  height?: number;
  mode?: 'korea' | 'global';
  /** 범례 라벨 */
  currentLabel?: string;
  compareLabel?: string;
}

export function VerticalBars({
  data, format = (v) => v.toFixed(1), height = 150,
  mode = 'korea', currentLabel = '당분기', compareLabel = '전년동기',
}: VProps) {
  const [hover, setHover] = useState<number | null>(null);
  const UP = mode === 'korea' ? '#F6465D' : '#16C784';
  const DOWN = mode === 'korea' ? '#4C82FB' : '#EA3943';
  const max = Math.max(...data.map((d) => Math.max(d.value, d.compare ?? 0)), 1);
  const hasCompare = data.some((d) => d.compare != null);

  return (
    <div>
      {hasCompare && (
        <div className="mb-3.5 flex items-center justify-end gap-2.5">
          <span className="flex items-center gap-1.5 text-[10.5px] text-sub">
            <span className="h-2 w-2 rounded-sm bg-brand" />{currentLabel}
          </span>
          <span className="flex items-center gap-1.5 text-[10.5px] text-mut">
            <span className="h-2 w-2 rounded-sm bg-[#232b3a]" />{compareLabel}
          </span>
        </div>
      )}
      <div className="flex items-end gap-2.5" style={{ height }}>
        {data.map((d, i) => {
          const on = hover === i;
          const yoy = d.compare ? (d.value / d.compare - 1) * 100 : null;
          return (
            <div key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              className="flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1.5">
              <span className={`font-mono text-[10px] font-bold transition-colors ${on ? 'text-fg' : 'text-mut'}`}>
                {format(d.value)}
              </span>
              <div className="flex h-full w-full items-end gap-0.5">
                {d.compare != null && (
                  <div className="w-full rounded-t transition-colors"
                    style={{ height: `${(d.compare / max) * 100}%`, background: on ? '#33415a' : '#232b3a' }} />
                )}
                <div className="w-full rounded-t transition-colors"
                  style={{ height: `${(d.value / max) * 100}%`, background: on ? '#7C6CFF' : 'rgba(124,108,255,.62)' }} />
              </div>
              <span className="whitespace-nowrap font-mono text-[9.5px] text-mut">{d.label}</span>
              {yoy != null && (
                <span className="font-mono text-[10px] font-bold" style={{ color: yoy >= 0 ? UP : DOWN }}>
                  {yoy >= 0 ? '+' : ''}{yoy.toFixed(1)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface HProps {
  data: BarDatum[];
  /** 강조할 항목 라벨 (기본: 첫 항목) */
  highlight?: string;
  format?: (v: number) => string;
  labelWidth?: number;
}

/**
 * 트랙+채움 단일 바. 리스트 행 안의 시그널 바처럼 라벨·값 레이아웃을
 * 호출부가 직접 잡아야 할 때 쓴다. 애드혹 .track/.fill CSS 를 만들지 말 것.
 * fraction 은 0..1 로 클램프. color 미지정 시 브랜드색.
 */
export function Bar({ fraction, color, className }: { fraction: number; color?: string; className?: string }) {
  const w = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className={['h-[9px] flex-1 overflow-hidden rounded bg-panel2', className].filter(Boolean).join(' ')}>
      <div className="h-full rounded" style={{ width: `${w}%`, background: color ?? '#7C6CFF' }} />
    </div>
  );
}

export function HorizontalBars({ data, highlight, format = (v) => `${v.toFixed(1)}%`, labelWidth = 86 }: HProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const key = highlight ?? data[0]?.label;
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((d) => {
        const on = d.label === key;
        return (
          <div key={d.label} className="flex items-center gap-2.5">
            <span className={`shrink-0 text-xs ${on ? 'font-bold text-fg' : 'text-sub'}`} style={{ width: labelWidth }}>
              {d.label}
            </span>
            <Bar fraction={d.value / max} color={on ? '#7C6CFF' : 'rgba(124,108,255,.34)'} />
            <span className="w-11 text-right font-mono text-[11.5px] font-bold text-fg">{format(d.value)}</span>
          </div>
        );
      })}
    </div>
  );
}
