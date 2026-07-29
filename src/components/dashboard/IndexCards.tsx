import { useStore } from '../../store/useStore';
import { signColor, fmt } from '../../lib/colors';
import s from './Dashboard.module.css';

export default function IndexCards() {
  const indices = useStore((st) => st.indices);
  const mode = useStore((st) => st.colorMode);

  return (
    <section className="card">
      <div className="card-h"><span className="t">주요 지수</span><span className="tag">폴링</span></div>
      <div className={s.cards}>
        {indices.map((q) => {
          const col = signColor(q.changePct, mode);
          if (q.unavailable) return (
            <div key={q.code} className={s.cardTile}>
              <div className={s.cardName}>{q.name}</div>
              {/* 카드 본문 "-"는 sub 대비 — mut은 대비 미달(사전 학습) */}
              <div className={`${s.cardPx} mono`} style={{ color: 'var(--text-sub)' }}>-</div>
              <div className={`${s.cardChg} mono`} style={{ color: 'var(--text-mut)' }}>-</div>
            </div>
          );
          return (
            <div key={q.code} className={s.cardTile}>
              <div className={s.cardName}>{q.name}</div>
              <div className={`${s.cardPx} mono`}>{fmt(q.price, q.dec)}</div>
              <div className={`${s.cardChg} mono`} style={{ color: col }}>
                {q.changePct >= 0 ? '▲' : '▼'} {fmt(Math.abs(q.change), q.dec)} ({q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%)
              </div>
              <Spark points={q.spark} color={col} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Spark({ points, color }: { points: number[]; color: string }) {
  const w = 120, h = 24;
  const step = w / (points.length - 1);
  const d = points.map((y, i) => `${i * step},${(y / 26) * h}`).join(' ');
  return (
    <svg className={s.spark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="1.6" points={d} />
    </svg>
  );
}
