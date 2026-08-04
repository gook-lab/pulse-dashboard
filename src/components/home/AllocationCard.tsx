import { useStore } from '../../store/useStore';
import { Button, EmptyState } from '@/components/common';
import s from './Home.module.css';

// 카테고리 색(등락색 아님) — 주식은 브랜드, 현금은 포트폴리오 CASH_COLOR 와 동일한 중립 슬레이트.
const SEGS = [
  { key: 'stocks' as const, label: '주식', color: 'var(--brand)' },
  { key: 'cash' as const, label: '예수금', color: '#5b667a' },
  { key: 'manual' as const, label: '수동자산', color: '#4a90d9' },
];

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

/** 자산 배분 스택바 — 3항목뿐이라 도넛 대신 스택바(설계 W2 확정). */
export default function AllocationCard() {
  const home = useStore((st) => st.home);
  const setTab = useStore((st) => st.setTab);

  const a = home?.allocation ?? null;
  const total = a ? a.stocks + a.cash + a.manual : 0;

  return (
    <section className="card">
      <div className="card-h"><b>자산 배분</b></div>
      {a && total > 0 ? (
        <>
          <div className={s.allocBar} role="img" aria-label="자산 배분 스택바">
            {SEGS.map((g) => (a[g.key] > 0
              ? <span key={g.key} className={s.allocSeg} style={{ width: `${(a[g.key] / total) * 100}%`, background: g.color }} />
              : null))}
          </div>
          <div className={s.allocLegend}>
            {SEGS.map((g) => (
              <span key={g.key} className={s.allocItem}>
                <span className={s.allocDot} style={{ background: g.color }} />
                {g.label} <span className={`${s.allocVal} mono`}>{won(a[g.key])}</span>
                <span>({total ? Math.round((a[g.key] / total) * 100) : 0}%)</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <EmptyState title="자산 데이터 없음" desc="KIS 백엔드 연결 또는 수동 자산 입력이 필요합니다." />
      )}
      <div className={s.allocLink}>
        <Button variant="subtle" size="sm" onClick={() => setTab('portfolio')}>수동 자산 관리 →</Button>
      </div>
    </section>
  );
}
