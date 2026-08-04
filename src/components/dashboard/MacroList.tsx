import { useStore } from '../../store/useStore';
import { signColor } from '../../lib/colors';
import s from './Dashboard.module.css';

export default function MacroList() {
  const macro = useStore((st) => st.macro);
  const mode = useStore((st) => st.colorMode);

  return (
    <section className="card">
      <div className="card-h"><span className="t">매크로 지수</span><span className="tag">전세·금리·원자재</span></div>
      <div className={s.macro}>
        {macro.map((m) => (
          <div key={m.key} className={s.mrow}>
            <span className={s.mname}>{m.name}</span>
            <span className={s.mval}>
              <span className="mono" style={m.unavailable ? { color: 'var(--text-sub)' } : undefined}>{m.value}</span>
              {!m.flat && !m.unavailable && (
                <span className="mono" style={{ color: m.changePct === 0 ? 'var(--text-sub)' : signColor(m.changePct, mode), fontSize: 12 }}>
                  {m.changePct > 0 ? '+' : ''}{m.changePct.toFixed(1)}%
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
