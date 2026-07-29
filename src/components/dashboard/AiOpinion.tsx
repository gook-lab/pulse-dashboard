import { useStore } from '../../store/useStore';
import { ReasonList } from '@/components/common';
import s from './Dashboard.module.css';

export default function AiOpinion() {
  const ai = useStore((st) => st.ai);
  const mode = useStore((st) => st.colorMode);
  if (!ai) return null;
  if (ai.unavailable) return (
    <section className="card">
      <div className="card-h"><span className="t">AI 종합 투자의견</span><span className="tag mono" style={{ color: '#ea3943' }}>● 연결 끊김</span></div>
      <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-mut)', fontSize: 13 }}>
        <div className="mono" style={{ fontSize: 36, lineHeight: 1 }}>-</div>
        <div style={{ marginTop: 8 }}>실시간 데이터 연결 안됨</div>
      </div>
    </section>
  );

  return (
    <section className="card">
      <div className="card-h"><span className="t">AI 종합 투자의견</span><span className="tag">M4 · AI</span></div>
      <div className={s.aiScore}>
        <span className={`${s.aiNum} mono`}>{ai.score}</span>
        <span style={{ fontSize: 12, color: 'var(--text-mut)' }}>/ 100</span>
      </div>
      <div className={s.aiStance}>{ai.stance}</div>
      {ai.markets.map((m) => (
        <div key={m.name} className={s.aiMkt}>
          <span className={s.aiMktName}>{m.name}</span>
          <div className={s.aiBar} style={{ flex: 1 }}>
            <div className={s.aiBarFill} style={{ width: `${m.strength}%` }} />
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-sub)', width: 26 }}>{m.strength}</span>
        </div>
      ))}
      <div className={s.aiCol}>
        <ReasonList label="호재" items={ai.bull} sign={1} mode={mode} />
        <ReasonList label="악재" items={ai.bear} sign={-1} mode={mode} />
      </div>
    </section>
  );
}
