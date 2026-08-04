import { useStore } from '../../store/useStore';
import { signColor, STATUS_DOWN, STATUS_LIVE } from '../../lib/colors';
import s from './Dashboard.module.css';

function minutesAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const h = Math.floor(diff / 3_600_000);
  if (h >= 24) return `${Math.floor(h / 24)}일 전`;
  if (h >= 1) return `${h}시간 전`;
  return `${Math.floor(diff / 60_000)}분 전`;
}

export default function FearGreedGauge() {
  const fg = useStore((st) => st.fearGreed);
  const crypto = useStore((st) => st.cryptoFg);
  const mode = useStore((st) => st.colorMode);
  if (!fg) return null;
  if (fg.unavailable) return (
    <section className="card">
      <div className="card-h"><span className="t">Fear &amp; Greed</span><span className="tag mono" style={{ color: signColor(-1, mode) }}>● 연결 끊김</span></div>
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-mut)', fontSize: 13 }}>
        <div className="mono" style={{ fontSize: 40, lineHeight: 1 }}>-</div>
        <div style={{ marginTop: 10 }}>실시간 데이터 연결 안됨</div>
      </div>
    </section>
  );

  const cx = 160, cy = 165, R = 118;
  const ang = ((180 - fg.value * 1.8) * Math.PI) / 180;
  const nx = cx + R * Math.cos(ang);
  const ny = cy - R * Math.sin(ang);

  return (
    <section className="card">
      <div className="card-h"><span className="t">Fear &amp; Greed</span><span className="tag">CNN</span></div>
      <div className={s.fg}>
        <div className={s.gauge}>
          <svg viewBox="0 0 320 190" aria-label={`Fear and Greed ${fg.value} ${fg.label}`}>
            <defs>
              <linearGradient id="fgGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={STATUS_DOWN} />
                <stop offset="0.5" stopColor="#e0a838" />
                <stop offset="1" stopColor={STATUS_LIVE} />
              </linearGradient>
            </defs>
            <path d="M 30 165 A 130 130 0 0 1 290 165" fill="none" stroke="var(--border)" strokeWidth="20" strokeLinecap="round" />
            <path d="M 30 165 A 130 130 0 0 1 290 165" fill="none" stroke="url(#fgGrad)" strokeWidth="20" strokeLinecap="round" opacity="0.9" />
            <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--text)" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx={cx} cy={cy} r="7" fill="var(--panel)" stroke="var(--text)" strokeWidth="3" />
          </svg>
          <div className={s.fgCenter}>
            <div className={`${s.fgVal} mono`} style={{ color: 'var(--brand)' }}>{fg.value}</div>
            <div className={s.fgLabel}>{fg.label}</div>
          </div>
        </div>
        <div className={s.fgMeta}>
          <div><div className={s.fgK}>1주 전</div><div className={`${s.fgV} mono`}>{fg.prevWeek}</div></div>
          <div><div className={s.fgK}>1달 전</div><div className={`${s.fgV} mono`} style={{ color: signColor(fg.value - fg.prevMonth, mode) }}>{fg.prevMonth}</div></div>
          <div><div className={s.fgK}>1년 전</div><div className={`${s.fgV} mono`}>{fg.prevYear}</div></div>
        </div>
        {crypto && !crypto.unavailable && (
          <div className={s.crypto}>
            <span className={s.cryptoK}>크립토 F&amp;G</span>
            <span className={`${s.cryptoV} mono`} style={{ color: signColor(crypto.value - 50, mode) }}>{crypto.value}</span>
            <span className={s.cryptoLabel}>{crypto.label}</span>
            <span className={s.attr}>alternative.me</span>
          </div>
        )}
        <div className={s.stale}>증시 업데이트: {minutesAgo(fg.updatedAt)} · 출처 CNN</div>
      </div>
    </section>
  );
}
