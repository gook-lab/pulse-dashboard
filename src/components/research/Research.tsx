import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { signColor, fmt, type ColorMode } from '../../lib/colors';
import { Badge, Skeleton, SkeletonRows, SkeletonText } from '@/components/common';
import type { Report } from '../../data/types';
import { fmtMarketCapEok } from '@/lib/format';
import s from './Research.module.css';

// 투자의견 배지: 매수=signColor(+1), 매도=signColor(-1), 중립=회색(색 미지정).
const STANCE: Record<string, { label: string; sign: number }> = {
  buy: { label: '매수', sign: 1 },
  hold: { label: '중립', sign: 0 },
  sell: { label: '매도', sign: -1 },
};
const stanceColor = (stance: string, mode: ColorMode) => {
  const st = STANCE[stance] ?? STANCE.hold;
  return st.sign ? signColor(st.sign, mode) : undefined;
};

export default function Research() {
  const reports = useStore((st) => st.research);
  const mode = useStore((st) => st.colorMode);
  const [sel, setSel] = useState(0);
  if (!reports.length) return <ResearchSkeleton />;
  const r = reports[sel];

  return (
    <div className={s.grid}>
      {/* 좌: 리스트 */}
      <aside className="card">
        <div className="card-h"><span className="t">AI 리포트</span><span className="tag mono">{reports.length}</span></div>
        <div
          className={s.list}
          role="listbox"
          aria-label="AI 리포트 목록"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, reports.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
          }}
        >
          {reports.map((rep, i) => (
              <button key={rep.code} role="option" aria-selected={i === sel} className={i === sel ? `${s.li} ${s.liOn}` : s.li} onClick={() => setSel(i)}>
                <div className={s.liTop}>
                  <span className={s.liName}>{rep.name}</span>
                  <Badge color={stanceColor(rep.stance, mode)}>{(STANCE[rep.stance] ?? STANCE.hold).label}</Badge>
                </div>
                <div className={s.liBot}>
                  <span className={`mono`} style={{ color: (rep.unavailable || !rep.targetReal) ? 'var(--text-sub)' : signColor(rep.upsidePct, mode) }}>{(rep.unavailable || !rep.targetReal) ? '목표 -' : `목표 ${rep.upsidePct >= 0 ? '+' : ''}${rep.upsidePct}%`}</span>
                  <span className={s.liDate}>{rep.date}</span>
                </div>
              </button>
          ))}
        </div>
      </aside>

      {/* 우: 리더 */}
      <main className={s.reader}>
        <Reader r={r} mode={mode} />
      </main>
    </div>
  );
}

function Reader({ r, mode }: { r: Report; mode: ColorMode }) {
  return (
    <>
      <section className="card">
        <div className={s.head}>
          <div className={s.hLeft}>
            <span className={s.hName}>{r.name}</span>
            <span className={`${s.hCode} mono`}>{r.code}</span>
            <Badge color={stanceColor(r.stance, mode)}>{(STANCE[r.stance] ?? STANCE.hold).label}</Badge>
          </div>
          <div className={s.conf}>신뢰도 <span className="mono">{r.confidence}</span></div>
        </div>

        <div className={s.priceCards}>
          <PC k="현재가" v={r.unavailable ? '-' : `${r.cur}${fmt(r.price, r.dec)}`} />
          {/* 목표주가: KR=기술적 산출(볼린저 상단·60일 고가 클램프), 소스 없으면 '-' */}
          <PC k={r.targetReal ? '목표주가 · 기술적' : '목표주가'} v={r.targetReal ? `${r.cur}${fmt(r.target, r.dec)}` : '-'} accent />
          <PC k="상승여력" v={(r.unavailable || !r.targetReal) ? '-' : `${r.upsidePct >= 0 ? '+' : ''}${r.upsidePct}%`} color={(r.unavailable || !r.targetReal) ? undefined : signColor(r.upsidePct, mode)} />
        </div>

        <div className={s.scoreWrap}>
          <div className={s.scoreLabel}>AI 종합 스코어 <span className="mono">{r.confidence}/100</span></div>
          <div className={s.scoreBar}><div className={s.scoreFill} style={{ width: `${r.confidence}%` }} /></div>
        </div>

        <p className={s.summary}>{r.summary}</p>
      </section>

      <div className={s.two}>
        <section className="card">
          <div className="card-h"><span className="t">투자 포인트</span></div>
          <ul className={s.bullets}>{r.points.map((p, i) => <li key={i} className={s.bull}><span className={s.bullMark} style={{ color: signColor(1, mode) }}>▲</span>{p}</li>)}</ul>
        </section>
        <section className="card">
          <div className="card-h"><span className="t">리스크 요인</span></div>
          <ul className={s.bullets}>{r.risks.map((p, i) => <li key={i} className={s.risk}><span className={s.bullMark} style={{ color: signColor(-1, mode) }}>▼</span>{p}</li>)}</ul>
        </section>
      </div>

      <section className="card">
        <div className="card-h"><span className="t">밸류에이션</span></div>
        <div className={s.val}>
          {/* 실 펀더멘털이 없으면 '-'. 목 PER·시총을 실데이터처럼 보이면 안 된다
              (미국은 무료 소스가 없어 항상 '-'). */}
          <V k="PER" v={r.fundamentalsReal ? `${r.per.toFixed(1)}배` : '-'} />
          <V k="PBR" v={r.fundamentalsReal ? `${r.pbr.toFixed(2)}배` : '-'} />
          <V k="시가총액" v={r.fundamentalsReal ? fmtMarketCapEok(r.marketCapEok) : '-'} />
          <V k="목표가" v={r.targetReal ? `${r.cur}${fmt(r.target, r.dec)}` : '-'} />
        </div>
      </section>
    </>
  );
}

function PC({ k, v, accent, color }: { k: string; v: string; accent?: boolean; color?: string }) {
  return (
    <div className={accent ? `${s.pc} ${s.pcAccent}` : s.pc}>
      <div className={s.pcK}>{k}</div>
      <div className={`${s.pcV} mono`} style={{ color: color ?? 'var(--text)' }}>{v}</div>
    </div>
  );
}

function V({ k, v }: { k: string; v: string }) {
  return <div className={s.vItem}><span className={s.vK}>{k}</span><span className={`${s.vV} mono`}>{v}</span></div>;
}

function ResearchSkeleton() {
  return (
    <div className={s.grid}>
      <aside className="card">
        <div className="card-h"><span className="t">AI 리포트</span></div>
        <SkeletonRows rows={5} />
      </aside>
      <main className={s.reader}>
        <section className="card">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <Skeleton width={120} height={20} /><Skeleton width={60} height={14} />
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={54} />)}
          </div>
          <SkeletonText lines={4} />
        </section>
      </main>
    </div>
  );
}
