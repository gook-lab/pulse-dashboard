import type { CSSProperties } from 'react';
import { useId } from 'react';

/** SVG 폴리라인 좌표 문자열 생성 (0..w, 0..h 범위, 값 정규화). */
function toPoints(data: number[], w: number, h: number, pad = 2) {
  if (data.length < 2) return { line: '', area: '', lastX: 0, lastY: 0 };
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const X = (i: number) => pad + ((w - 2 * pad) * i) / (data.length - 1);
  const Y = (v: number) => h - pad - ((h - 2 * pad) * (v - min)) / span;
  const pts = data.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const line = pts.join(' ');
  const area = `${pts.join(' ')} ${X(data.length - 1).toFixed(1)},${h} ${X(0).toFixed(1)},${h}`;
  return { line, area, lastX: X(data.length - 1), lastY: Y(data[data.length - 1]) };
}

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}

/** 미니 스파크라인. 지수 카드·관심종목 행 등에서 사용. */
export function Sparkline({ data, width = 64, height = 22, color = '#7c6cff', className, style }: SparklineProps) {
  const { line } = toPoints(data, width, height);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} style={{ overflow: 'visible', ...style }}>
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

interface AreaChartProps {
  data: number[];
  color?: string;
  height?: number;
  /** 가로 기준 그리드 라인 수 */
  grid?: number;
  className?: string;
}

/** 면적 차트(그라디언트 채움 + 마지막 점). 종목 상세 가격 차트용. viewBox 900×300, 컨테이너에 맞춰 스트레치. */
export function AreaChart({ data, color = '#7c6cff', height = 300, grid = 3, className }: AreaChartProps) {
  const W = 900;
  const H = 300;
  const { line, area, lastX, lastY } = toPoints(data, W, H, 6);
  const gid = useId().replace(/:/g, '');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} style={{ width: '100%', height, display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.3" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: grid }).map((_, i) => {
        const y = (H / (grid + 1)) * (i + 1);
        return <line key={i} x1="0" y1={y} x2={W} y2={y} stroke="#1a2130" strokeWidth="1" />;
      })}
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="4.5" fill={color} />
    </svg>
  );
}
