/**
 * 종목 상세 화면 예시 — KIS 실시간 훅 연동 (호가 + 체결 + 헤더)
 * 시안(MarketDesk)의 종목 상세 중앙/하단 영역에 대응.
 *
 * 사용:
 *   <StockDetail code="005930" market="KR" name="삼성전자" cur="₩" dec={0} up={UP} down={DOWN}
 *                approvalKey={approvalKey} />
 */
import React from 'react';
import { useKisTrade, useKisOrderbook, useKisTrades, type KisOptions } from './useKisSocket';

interface Props {
  code: string;
  market: 'KR' | 'US';
  name: string;
  cur: string;          // '₩' | '$'
  dec: number;          // 소수 자리수 (KR=0, US=2)
  approvalKey: string;
  /** 색상 컨벤션 (전역 설정에서 주입) */
  up?: string;          // 상승색
  down?: string;        // 하락색
}

const T = {
  panel: '#0F131C', border: '#1B2130', text: '#EDF0F6', sub: '#8A93A6', mut: '#5E6879',
  row: '#12161f', mono: "'JetBrains Mono', ui-monospace, monospace",
};

const fmt = (n: number, d: number) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function StockDetail({ code, market, name, cur, dec, approvalKey, up = '#16C784', down = '#EA3943' }: Props) {
  const opt: KisOptions = { approvalKey, mode: 'real' };
  const trade = useKisTrade(code, market, opt);
  const ob = useKisOrderbook(code, market, opt);
  const trades = useKisTrades(code, market, opt, 30);

  const price = trade?.price ?? 0;
  const pct = trade?.changePct ?? 0;
  const col = pct >= 0 ? up : down;

  // 호가 depth 바 최대 잔량
  const maxQty = Math.max(1, ...(ob ? [...ob.asks, ...ob.bids].map((l) => l.qty) : [1]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, overflow: 'hidden' }}>
      {/* 헤더 */}
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14, padding: '15px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
          <span style={{ fontSize: 19, fontWeight: 800, color: T.text }}>{name}</span>
          <span style={{ fontFamily: T.mono, fontSize: 13, color: T.mut }}>{code}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <span style={{ fontFamily: T.mono, fontSize: 32, fontWeight: 800, lineHeight: 1, color: T.text }}>
            {cur}{fmt(price, dec)}
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 700, marginBottom: 3, color: col }}>
            {pct >= 0 ? '▲' : '▼'} {(pct >= 0 ? '+' : '') + pct.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* 호가 + 체결 */}
      <div style={{ display: 'grid', gridTemplateColumns: '264px minmax(0,1fr)', gap: 12, height: 260 }}>
        {/* 호가창 */}
        <Panel title="호가" meta="실시간 잔량">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '3px 0', minHeight: 0 }}>
            {ob?.asks.slice().reverse().map((l, i) => (
              <ObRow key={'a' + i} level={l} maxQty={maxQty} color={down} side="ask" cur={cur} dec={dec} />
            ))}
            {ob?.bids.map((l, i) => (
              <ObRow key={'b' + i} level={l} maxQty={maxQty} color={up} side="bid" cur={cur} dec={dec} />
            ))}
            {!ob && <Empty label="호가 수신 대기…" />}
          </div>
        </Panel>

        {/* 체결 내역 */}
        <Panel title="체결 내역" meta="최근 체결">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.7fr 0.6fr', gap: 8, padding: '6px 13px', borderBottom: `1px solid ${T.border}`, fontSize: 10, color: T.mut, fontWeight: 600 }}>
            <span>시간</span><span style={{ textAlign: 'right' }}>체결가</span>
            <span style={{ textAlign: 'right' }}>수량</span><span style={{ textAlign: 'right' }}>구분</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {trades.map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.7fr 0.6fr', gap: 8, alignItems: 'center', padding: '5px 13px', borderBottom: `1px solid ${T.row}` }}>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>{t.time}</span>
                <span style={{ textAlign: 'right', fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, color: t.side === '매수' ? up : down }}>{cur}{fmt(t.price, dec)}</span>
                <span style={{ textAlign: 'right', fontFamily: T.mono, fontSize: 11, color: '#C7CEDB' }}>{t.volume.toLocaleString()}</span>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ color: t.side === '매수' ? up : down, background: (t.side === '매수' ? up : down) + '1E', border: `1px solid ${(t.side === '매수' ? up : down)}44`, padding: '2px 7px', borderRadius: 999, fontSize: 9.5, fontWeight: 700 }}>{t.side}</span>
                </span>
              </div>
            ))}
            {trades.length === 0 && <Empty label="체결 수신 대기…" />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 13px', borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{title}</span>
        <span style={{ fontSize: 10, color: T.mut }}>{meta}</span>
      </div>
      {children}
    </div>
  );
}

function ObRow({ level, maxQty, color, side, cur, dec }: { level: { price: number; qty: number }; maxQty: number; color: string; side: 'ask' | 'bid'; cur: string; dec: number }) {
  const w = `${Math.round((level.qty / maxQty) * 100)}%`;
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', flex: '1 1 0', minHeight: 0 }}>
      <div style={{ position: 'absolute', top: 2, bottom: 2, [side === 'ask' ? 'right' : 'left']: 0, width: w, background: color + '20', borderRadius: 3 }} />
      <span style={{ position: 'relative', zIndex: 1, fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, color }}>{cur}{fmt(level.price, dec)}</span>
      <span style={{ position: 'relative', zIndex: 1, fontFamily: T.mono, fontSize: 11, color: T.sub }}>{level.qty.toLocaleString()}</span>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: T.mut, fontSize: 12 }}>{label}</div>;
}
