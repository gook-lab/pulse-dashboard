import Skeleton, { SkeletonRows } from './Skeleton';

type Variant = 'rows' | 'block' | 'gauge' | 'cards';

interface CardSkeletonProps {
  title?: string;
  rows?: number;
  variant?: Variant;
  /** block variant 높이 */
  height?: number;
  /** cards variant 타일 수 */
  tiles?: number;
}

/** 카드 골격 유지용 스켈레톤 — 로딩→로드 시 레이아웃 점프 없음. */
export default function CardSkeleton({ title, rows = 5, variant = 'rows', height = 200, tiles = 6 }: CardSkeletonProps) {
  return (
    <section className="card">
      {title && <div className="card-h"><span className="t">{title}</span></div>}
      {variant === 'rows' && <SkeletonRows rows={rows} />}
      {variant === 'block' && <div style={{ padding: 12 }}><Skeleton height={height} /></div>}
      {variant === 'gauge' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 24 }}>
          <Skeleton circle height={150} />
          <Skeleton width="60%" height={12} />
        </div>
      )}
      {variant === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: 12 }}>
          {Array.from({ length: tiles }).map((_, i) => <Skeleton key={i} height={64} />)}
        </div>
      )}
    </section>
  );
}
