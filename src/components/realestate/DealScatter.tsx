import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { EmptyState, Badge } from '@/components/common';
import { fmt, colors } from '@/lib/colors';
import type { AptDeal } from '@/data/types';
import s from './DealScatter.module.css';

interface DealScatterProps {
  deals: AptDeal[];
  selectedArea: number | null;
  loading?: boolean;
  error?: string | null;
  stale?: boolean;
  onRetry?: () => void;
}

/** 3개월 이동 중앙값 */
function movingMedian(values: (number | null)[], window: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1).filter((v) => v != null) as number[];
    if (slice.length === 0) {
      result.push(null);
    } else {
      slice.sort((a, b) => a - b);
      const mid = slice.length >> 1;
      result.push(slice.length % 2 ? slice[mid] : (slice[mid - 1] + slice[mid]) / 2);
    }
  }
  return result;
}

/**
 * 거래 날짜를 정규화한 수치 (YYYYMM + day로 0~1 범위).
 * day가 null이면 월 시작(0), 숫자면 day/31로 더함.
 */
function normalizeDate(ym: string, day: number | null): number {
  const yy = parseInt(ym.slice(0, 4), 10);
  const mm = parseInt(ym.slice(4, 6), 10);
  const monthValue = yy * 12 + mm;
  return monthValue + (day ? (day - 1) / 31 : 0);
}

export default function DealScatter({
  deals,
  selectedArea,
  loading = false,
  error = null,
  stale = false,
  onRetry,
}: DealScatterProps) {
  const colorMode = useStore((st) => st.colorMode);
  const c = colors(colorMode);
  // 선택된 평형대의 거래만 필터링
  const filtered = useMemo(() => {
    if (!selectedArea) return deals;
    return deals.filter((d) => d.area && d.area > selectedArea - 5 && d.area < selectedArea + 5);
  }, [deals, selectedArea]);

  // 가격(y), 날짜(x) 추출 및 정렬
  const points = useMemo(() => {
    const pts = filtered.map((d) => ({
      x: normalizeDate(d.ym, d.day),
      y: d.price,
      floor: d.floor,
      ym: d.ym,
      day: d.day,
    }));
    return pts.sort((a, b) => a.x - b.x);
  }, [filtered]);

  // 3개월 이동 중앙값
  const medianLine = useMemo(() => {
    if (points.length === 0) return [];
    const prices = points.map((p) => p.y);
    return movingMedian(prices, 3);
  }, [points]);

  // Y축 범위 계산
  const { minY, maxY } = useMemo(() => {
    if (points.length === 0) return { minY: 0, maxY: 1000 };
    const prices = points.map((p) => p.y);
    let min = Math.min(...prices);
    let max = Math.max(...prices);
    // Y스케일 가드: min === max 일 때
    if (min === max) {
      min = Math.max(0, min - 100);
      max = min + 200;
    }
    const padding = (max - min) * 0.1;
    return { minY: Math.max(0, min - padding), maxY: max + padding };
  }, [points]);

  // SVG 치수
  const SVG_WIDTH = 480;
  const SVG_HEIGHT = 240;
  const MARGIN = { top: 16, right: 16, bottom: 32, left: 48 };
  const chartWidth = SVG_WIDTH - MARGIN.left - MARGIN.right;
  const chartHeight = SVG_HEIGHT - MARGIN.top - MARGIN.bottom;

  // 스케일 함수
  const scaleX = (x: number) => {
    const rangeX =
      points.length > 0 ? points[points.length - 1].x - points[0].x : 1;
    const normalized = rangeX > 0 ? (x - (points[0]?.x ?? 0)) / rangeX : 0;
    return MARGIN.left + normalized * chartWidth;
  };

  const scaleY = (y: number) => {
    const normalized = (y - minY) / (maxY - minY);
    return SVG_HEIGHT - MARGIN.bottom - normalized * chartHeight;
  };

  if (loading) {
    return <div className={s.container} style={{ height: SVG_HEIGHT }}>로딩 중...</div>;
  }

  if (error) {
    return (
      <div className={s.container}>
        <div className={s.error}>
          <p>{error}</p>
          {onRetry && (
            <button className={s.retryBtn} onClick={onRetry}>
              재시도
            </button>
          )}
        </div>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className={s.container}>
        <EmptyState title="거래 기록 없음" desc="이 평형의 거래 기록이 없습니다" />
      </div>
    );
  }

  return (
    <div className={s.container}>
      {stale && <Badge>배치 재수집 필요</Badge>}
      <svg
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        className={s.chart}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      >
        {/* 그리드 배경 */}
        <defs>
          <pattern id="grid" width="40" height="30" patternUnits="userSpaceOnUse">
            <path d={`M 40 0 L 0 0 0 30`} fill="none" stroke="var(--color-border)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="var(--color-bg)" />
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={chartWidth}
          height={chartHeight}
          fill="url(#grid)"
        />

        {/* Y축 */}
        <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={SVG_HEIGHT - MARGIN.bottom} stroke="var(--color-border)" strokeWidth="1" />

        {/* X축 */}
        <line x1={MARGIN.left} y1={SVG_HEIGHT - MARGIN.bottom} x2={SVG_WIDTH - MARGIN.right} y2={SVG_HEIGHT - MARGIN.bottom} stroke="var(--color-border)" strokeWidth="1" />

        {/* 3개월 이동 중앙값 라인 (점선) */}
        {medianLine.length > 1 && (
          <polyline
            points={points
              .map((p, i) => {
                const med = medianLine[i];
                return med !== null ? `${scaleX(p.x)},${scaleY(med)}` : null;
              })
              .filter(Boolean)
              .join(' ')}
            fill="none"
            stroke="var(--color-text-sub)"
            strokeWidth="2"
            strokeDasharray="4,4"
            opacity="0.6"
          />
        )}

        {/* 데이터 포인트 */}
        {points.map((p, i) => {
          const isLowFloor = p.floor && p.floor >= 1 && p.floor <= 5;
          const color = isLowFloor ? c.up : c.down; // 저층=상승색, 중고층=하락색
          const cx = scaleX(p.x);
          const cy = scaleY(p.y);
          const tooltip = `${p.ym}.${String(p.day ?? 1).padStart(2, '0')}: ${fmt(p.y, 0)}만원 · ${p.floor ? p.floor + '층' : '층미상'}`;
          return (
            <g key={i}>
              <circle
                cx={cx}
                cy={cy}
                r="3"
                fill={color}
                opacity="0.7"
                className={s.point}
              />
              <title>{tooltip}</title>
            </g>
          );
        })}

        {/* Y축 레이블 */}
        <text x={MARGIN.left - 8} y={MARGIN.top} textAnchor="end" dominantBaseline="middle" className={s.label}>
          {fmt(maxY, 0)}
        </text>
        <text x={MARGIN.left - 8} y={SVG_HEIGHT - MARGIN.bottom} textAnchor="end" dominantBaseline="middle" className={s.label}>
          {fmt(minY, 0)}
        </text>

        {/* X축 레이블 (첫/끝) */}
        {points.length > 0 && (
          <>
            <text x={scaleX(points[0].x)} y={SVG_HEIGHT - MARGIN.bottom + 16} textAnchor="middle" className={s.label}>
              {points[0].ym.slice(2, 4)}.{points[0].ym.slice(4)}
            </text>
            <text x={scaleX(points[points.length - 1].x)} y={SVG_HEIGHT - MARGIN.bottom + 16} textAnchor="middle" className={s.label}>
              {points[points.length - 1].ym.slice(2, 4)}.{points[points.length - 1].ym.slice(4)}
            </text>
          </>
        )}
      </svg>

      {/* 범례 */}
      <div className={s.legend}>
        <div className={s.legendItem}>
          <span className={`${s.legendDot} ${s.lowFloor}`} />
          <span>저층(1~5층)</span>
        </div>
        <div className={s.legendItem}>
          <span className={`${s.legendDot} ${s.midHighFloor}`} />
          <span>중·고층</span>
        </div>
        <div className={s.legendItem}>
          <span className={s.legendLine} />
          <span>3개월 이동 중앙값</span>
        </div>
      </div>
    </div>
  );
}
