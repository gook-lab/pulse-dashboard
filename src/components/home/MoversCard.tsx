import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { EmptyState } from '@/components/common';
import { signColor, fmt } from '../../lib/colors';
import s from './Home.module.css';

/** 만원 총액 → "15.5억" / "9,800만". */
const fmtManwon = (mw: number) => (mw >= 10000 ? `${(mw / 10000).toFixed(1)}억` : `${Math.round(mw).toLocaleString('ko-KR')}만`);

/**
 * 내 무버 — 관심종목·관심단지 중 오늘/최근 움직임이 큰 것.
 * 관심단지 추정가는 순자산에 합산하지 않는 워치 전용 값이다(설계 W2 정책) — 여기서만 보여준다.
 */
export default function MoversCard() {
  const watchlist = useStore((st) => st.watchlist);
  const aptWatchlist = useStore((st) => st.aptWatchlist);
  const estimates = useStore((st) => st.complexEstimates);
  const mode = useStore((st) => st.colorMode);
  const selectStock = useStore((st) => st.selectStock);
  const selectComplex = useStore((st) => st.selectComplex);
  const setTab = useStore((st) => st.setTab);

  const stockMovers = useMemo(
    () => watchlist.filter((w) => !w.unavailable).slice()
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 5),
    [watchlist],
  );
  const aptMovers = useMemo(
    () => aptWatchlist
      .map((id) => ({ id, e: estimates[id] }))
      .filter((x) => !!x.e)
      .sort((a, b) => Math.abs(b.e!.momentum3 ?? 0) - Math.abs(a.e!.momentum3 ?? 0))
      .slice(0, 5),
    [aptWatchlist, estimates],
  );

  const openComplex = (id: string) => { setTab('realestate'); selectComplex(id, 'list'); };

  return (
    <section className="card">
      <div className="card-h"><b>내 무버</b><span className="tag">관심종목 · 관심단지</span></div>
      <div className={s.moverGrid}>
        <div className={s.moverCol}>
          <div className={s.moverColH}>관심종목 — 오늘 등락 상위</div>
          {stockMovers.length ? stockMovers.map((w) => (
            <button key={w.code} type="button" className={s.moverRow} onClick={() => selectStock(w.code, { name: w.name, market: w.market, cur: w.cur, dec: w.dec })}>
              <span className={s.moverName}>{w.name}</span>
              <span className={`${s.moverPx} mono`}>{w.cur}{fmt(w.price, w.dec)}</span>
              <span className={`${s.moverVal} mono`} style={{ color: signColor(w.changePct, mode) }}>
                {w.changePct > 0 ? '+' : ''}{w.changePct.toFixed(2)}%
              </span>
            </button>
          )) : <EmptyState title="시세 없음" desc="실시세 연결을 확인하세요." />}
        </div>
        <div className={s.moverCol}>
          <div className={s.moverColH}>관심단지 — 매매 3개월 모멘텀</div>
          {aptMovers.length ? aptMovers.map(({ id, e }) => (
            <button key={id} type="button" className={s.moverRow} onClick={() => openComplex(id)}>
              <span className={s.moverName}>
                {e!.aptNm}
                <span className={s.moverSub}> {e!.gu ?? ''}{e!.area ? ` · ${e!.area}㎡` : ''}</span>
              </span>
              <span className={`${s.moverPx} mono`}>{e!.amount != null ? `매 ${fmtManwon(e!.amount)}` : '-'}</span>
              <span
                className={`${s.moverVal} mono`}
                style={e!.momentum3 != null ? { color: signColor(e!.momentum3, mode) } : { color: 'var(--text-mut)' }}
              >
                {e!.momentum3 != null ? `${e!.momentum3 > 0 ? '+' : ''}${e!.momentum3.toFixed(1)}%` : '-'}
              </span>
            </button>
          )) : <EmptyState title="관심단지 없음" desc="부동산 탭에서 ★로 단지를 담아보세요." />}
        </div>
      </div>
    </section>
  );
}
