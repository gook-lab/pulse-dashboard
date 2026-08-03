import { useStore } from '../../store/useStore';
import { signColor, fmt } from '../../lib/colors';
import s from './Dashboard.module.css';

/**
 * 주요 지수 타일.
 *
 * 스파크라인은 없다. 예전에는 그렸지만 그 데이터는 mockApi의 `spark()`가 돌려주는
 * 고정 9점 배열(상승형/하락형 두 종류)이었고 실데이터로 덮이지 않았다. 실제 등락과
 * 무관한 선을 인트라데이 추이처럼 보여주는 건 값을 꾸며내는 것과 같다.
 * 지수 인트라데이 소스가 붙으면 그때 되살린다.
 */
export default function IndexCards() {
  const indices = useStore((st) => st.indices);
  const mode = useStore((st) => st.colorMode);

  return (
    <section className="card">
      <div className="card-h"><span className="t">주요 지수</span><span className="tag">폴링</span></div>
      <div className={s.cards}>
        {indices.map((q) => {
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
              {/* 소스가 전일 대비를 안 주면 "0.00%"로 위장하지 않는다 — 실제 보합과 구별돼야 한다. */}
              {q.changeUnavailable ? (
                <div
                  className={`${s.cardChg} mono`}
                  style={{ color: 'var(--text-mut)' }}
                  title="전일 대비를 제공하지 않는 소스입니다(KIS 모의)"
                >
                  등락 -
                </div>
              ) : (
                <div className={`${s.cardChg} mono`} style={{ color: signColor(q.changePct, mode) }}>
                  {q.changePct >= 0 ? '▲' : '▼'} {fmt(Math.abs(q.change), q.dec)} ({q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%)
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
