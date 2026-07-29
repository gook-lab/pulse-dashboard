import { useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { signColor, fmt, STATUS_LIVE, type ColorMode } from '../../lib/colors';
import { Skeleton, SkeletonRows, ErrorState } from '@/components/common';
import MarketChip from '@/components/common/MarketChip';
import { useKisTrade } from '../../lib/kisSocket';
import type { Holding } from '../../data/types';
import s from './Portfolio.module.css';

const DONUT_COLORS = ['#7c6cff', '#16c784', '#ea3943', '#e0a838', '#4c82fb', '#4bd0d0'];
const CASH_COLOR = '#5b667a'; // 예수금(현금) 슬라이스 — 중립 슬레이트

export default function Portfolio() {
  const pf = useStore((st) => st.portfolio);
  const mode = useStore((st) => st.colorMode);
  const reloadPortfolio = useStore((st) => st.reloadPortfolio);

  // 보유종목 평가액 30초 폴링 — 1회 로드로 끝나면 장중 내내 정적(소켓 감사 S4)
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) reloadPortfolio(); }, 30_000);
    return () => clearInterval(id);
  }, [reloadPortfolio]);

  if (!pf) return <PortfolioSkeleton />;
  // 실데이터 연결 실패 → 목 대신 "-" (모든 페이지 동일 룰)
  if (pf.unavailable) return <PortfolioUnavailable onRetry={reloadPortfolio} />;

  const won = (n: number) => `₩${fmt(Math.round(n), 0)}`;
  const toKrw = (h: Holding, p: number) => (h.market === 'US' ? p * pf.fxUsdKrw : p);
  const cash = pf.cash ?? 0;

  const holdingRows = pf.holdings.map((h) => {
    const valKrw = toKrw(h, h.price) * h.qty;
    const pnlPct = ((h.price - h.avg) / h.avg) * 100;
    return { h, valKrw, pnlPct };
  }).sort((a, b) => b.valKrw - a.valKrw);

  const holdingsSum = holdingRows.reduce((a, r) => a + r.valKrw, 0);
  const totalAsset = pf.summary.totalValue || (holdingsSum + cash);
  const w = (v: number) => (totalAsset > 0 ? (v / totalAsset) * 100 : 0);

  // 자산 배분 = 보유 종목 + 현금(예수금) 슬라이스.
  const donutRows = [
    ...holdingRows.map((r, i) => ({ label: r.h.name, weight: w(r.valKrw), color: DONUT_COLORS[i % DONUT_COLORS.length] })),
    ...(cash > 0 ? [{ label: '현금(예수금)', weight: w(cash), color: CASH_COLOR }] : []),
  ];

  return (
    <div className={s.wrap}>
      <div className={s.summary}>
        <Sum k="총자산" v={won(totalAsset)} />
        {/* 손익 0은 등락색이 아니라 중립(기본)색 — +₩0 초록은 잘못된 신호 */}
        <Sum k="평가손익" v={`${pf.summary.pnl > 0 ? '+' : ''}${won(pf.summary.pnl)}`} sub={`${pf.summary.pnlPct > 0 ? '+' : ''}${pf.summary.pnlPct}%`} color={pf.summary.pnl === 0 ? undefined : signColor(pf.summary.pnl, mode)} />
        <Sum k="일간손익" v={`${pf.summary.dayPnl > 0 ? '+' : ''}${won(pf.summary.dayPnl)}`} sub={`${pf.summary.dayPnlPct > 0 ? '+' : ''}${pf.summary.dayPnlPct}%`} color={pf.summary.dayPnl === 0 ? undefined : signColor(pf.summary.dayPnl, mode)} />
        <Sum k={pf.cash != null ? '예수금' : '투자원금'} v={won(pf.cash != null ? cash : pf.summary.principal)} />
      </div>

      <div className={s.body}>
        <section className="card">
          <div className="card-h">
            <span className="t">보유 종목</span>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              {pf.source && <span className="tag mono" style={{ color: STATUS_LIVE }}>● KIS {pf.source === 'kis-mock' ? '모의' : '실전'} 연동</span>}
              <span className="tag mono">환율 {fmt(pf.fxUsdKrw, 1)}</span>
            </span>
          </div>
          <div className={s.thead}>
            <span>종목</span><span className={s.rt}>수량</span><span className={s.rt}>평단</span><span className={s.rt}>현재가</span><span className={s.rt}>평가액(₩)</span><span className={s.rt}>손익률</span><span className={s.wcol}>비중</span>
          </div>
          {holdingRows.map(({ h }, i) => (
            <HoldingRow key={h.code} h={h} fx={pf.fxUsdKrw} mode={mode} won={won} weightOf={w} color={DONUT_COLORS[i % DONUT_COLORS.length]} />
          ))}
          {/* 예수금(현금)도 자산 한 줄로 노출 → 보유 종목이 없어도 대시보드 유지 */}
          {cash > 0 && (
            <div className={s.trow}>
              <span className={s.name}><span className={s.cashChip}>현금</span>예수금</span>
              <span className={`${s.rt} mono`} style={{ color: 'var(--text-mut)' }}>—</span>
              <span className={`${s.rt} mono`} style={{ color: 'var(--text-mut)' }}>—</span>
              <span className={`${s.rt} mono`} style={{ color: 'var(--text-mut)' }}>—</span>
              <span className={`${s.rt} mono`}>{won(cash)}</span>
              <span className={`${s.rt} mono`} style={{ color: 'var(--text-mut)' }}>—</span>
              <span className={s.wcol}>
                <span className={s.wbar}><span className={s.wfill} style={{ width: `${w(cash)}%`, background: CASH_COLOR }} /></span>
                <span className={`${s.wpct} mono`}>{w(cash).toFixed(1)}%</span>
              </span>
            </div>
          )}
          {!holdingRows.length && cash > 0 && (
            <div style={{ padding: '14px 16px', color: 'var(--text-mut)', fontSize: 12 }}>
              보유 종목이 없어 예수금 전액이 현금입니다. 모의투자에서 매수하면 이곳에 실시간 반영됩니다.
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-h"><span className="t">자산 배분</span></div>
          <Donut rows={donutRows} />
        </section>
      </div>
    </div>
  );
}

// 보유 행 — KR 종목은 웹소켓 체결가 실시간 오버레이(감사 S14).
// 비중/도넛은 30초 폴링 스냅샷 기준을 유지한다(행별 라이브 가중치는 합이 100%를 벗어나 혼란).
function HoldingRow({ h, fx, mode, won, weightOf, color }: {
  h: Holding; fx: number; mode: ColorMode; won: (n: number) => string; weightOf: (v: number) => number; color: string;
}) {
  const trade = useKisTrade(h.market === 'KR' ? h.code : null);
  const price = trade?.price ?? h.price;
  const live = !!trade;
  const valKrw = (h.market === 'US' ? price * fx : price) * h.qty;
  const pnlPct = ((price - h.avg) / h.avg) * 100;
  const wp = weightOf(valKrw);
  return (
    <div className={s.trow}>
      <span className={s.name}>
        <MarketChip market={h.market} />{h.name}
        {live && <span title="실시간 체결" style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_LIVE, marginLeft: 6, display: 'inline-block' }} />}
      </span>
      <span className={`${s.rt} mono`}>{h.qty}</span>
      <span className={`${s.rt} mono`}>{h.cur}{fmt(h.avg, h.dec)}</span>
      <span className={`${s.rt} mono`}>{h.cur}{fmt(price, h.dec)}</span>
      <span className={`${s.rt} mono`}>{won(valKrw)}</span>
      <span className={`${s.rt} mono`} style={{ color: signColor(pnlPct, mode) }}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</span>
      <span className={s.wcol}>
        <span className={s.wbar}><span className={s.wfill} style={{ width: `${wp}%`, background: color }} /></span>
        <span className={`${s.wpct} mono`}>{wp.toFixed(1)}%</span>
      </span>
    </div>
  );
}

// 실데이터 연결 실패 — 값은 "-", 재시도 제공(목 데이터 노출 금지).
function PortfolioUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={s.wrap}>
      <div className={s.summary}>
        {['총자산', '평가손익', '일간손익', '예수금'].map((k) => (
          <div key={k} className="card">
            <div className={s.sk}>{k}</div>
            {/* 카드의 유일한 콘텐츠인 "-"는 sub 대비(6:1) — mut(3.3:1)는 미달 */}
            <div className={`${s.sv} mono`} style={{ color: 'var(--text-sub)' }}>-</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-h"><span className="t">보유 종목</span><span className="tag mono" style={{ color: '#ea3943' }}>● 연결 끊김</span></div>
        <ErrorState title="포트폴리오를 불러올 수 없습니다" desc="실시간 데이터에 연결되어 있지 않습니다. 백엔드 연결을 확인한 뒤 다시 시도하세요." onRetry={onRetry} />
      </div>
    </div>
  );
}

function PortfolioSkeleton() {
  return (
    <div className={s.wrap}>
      <div className={s.summary}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card">
            <div className={s.sk}><Skeleton width={64} height={11} /></div>
            <Skeleton width="70%" height={22} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className={s.body}>
        <section className="card">
          <div className="card-h"><span className="t">보유 종목</span></div>
          <SkeletonRows rows={6} />
        </section>
        <section className="card">
          <div className="card-h"><span className="t">자산 배분</span></div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Skeleton circle height={140} /></div>
        </section>
      </div>
    </div>
  );
}

function Sum({ k, v, sub, color }: { k: string; v: string; sub?: string; color?: string }) {
  return (
    <div className="card">
      <div className={s.sk}>{k}</div>
      <div className={`${s.sv} mono`} style={{ color: color ?? 'var(--text)' }}>{v}</div>
      {sub && <div className={`${s.ssub} mono`} style={{ color: color ?? 'var(--text-sub)' }}>{sub}</div>}
    </div>
  );
}

function Donut({ rows }: { rows: { label: string; weight: number; color: string }[] }) {
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className={s.donutWrap}>
      <svg viewBox="0 0 140 140" className={s.donut}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--panel-2)" strokeWidth="18" />
        {rows.map((r) => {
          const len = (r.weight / 100) * C;
          const el = (
            <circle key={r.label} cx="70" cy="70" r={R} fill="none" stroke={r.color} strokeWidth="18"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />
          );
          acc += len;
          return el;
        })}
      </svg>
      <div className={s.legend}>
        {rows.map((r) => (
          <div key={r.label} className={s.lrow}>
            <span className={s.ldot} style={{ background: r.color }} />
            <span className={s.llabel}>{r.label}</span>
            <span className={`${s.lpct} mono`}>{r.weight.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
