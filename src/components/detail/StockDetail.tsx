import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Bell } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { signColor, fmt, type ColorMode } from '../../lib/colors';
import type { Candle, Level, TradeTick } from '../../data/types';
import { Loading, EmptyState, Badge, MarketChip, PriceChart, ReasonList, Segmented, SkeletonRows } from '@/components/common';
import { useKisRealtime, useKrChartAll } from '@/lib/kisSocket';
import OrderTicket from './OrderTicket';
import PriceAlertModal from './PriceAlertModal';
import s from './StockDetail.module.css';

const fmtD = (d: string) => (d?.length === 8 ? `${d.slice(4, 6)}/${d.slice(6, 8)}` : d ?? '');
const fmtM = (d: string) => (d?.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}` : d ?? '');
const fmtT = (i: number, n: number) => {
  const min = Math.round((i / Math.max(1, n - 1)) * 390); // 09:00~15:30 = 390분
  return `${String(9 + Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
};

// 일봉 OHLC를 앵커로 장중 서브포인트 k개를 합성 → Toss식 촘촘한 라인/캔들(결정적 시드).
// o/h/l/c(시·고·저·종)는 실제값을 반드시 포함하고, 사이만 채운다.
function densify(daily: Candle[], k: number, labelFn: (d: string) => string = fmtD) {
  const closes: number[] = [], vols: number[] = [], labels: string[] = [];
  const cds: { o: number; h: number; l: number; c: number }[] = [];
  let prev = daily[0]?.o ?? 0;
  for (const d of daily) {
    const rng = (d.h - d.l) || Math.abs(d.c) * 0.006 || 1;
    const seed0 = [...d.date].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const sub: number[] = [];
    for (let i = 0; i < k; i++) {
      const t = k === 1 ? 1 : i / (k - 1);
      let c = d.o + (d.c - d.o) * t;
      const rnd = ((seed0 + i * 2654435761) >>> 0) % 1000;
      c += (rnd / 1000 - 0.5) * rng * 0.55;
      c = Math.max(d.l, Math.min(d.h, c));
      if (i === 0) c = d.o;
      if (i === k - 1) c = d.c;
      sub.push(c);
    }
    // 내부 지점에 실제 일중 고/저가 심기(끝점 o/c는 보존)
    if (k > 2) {
      let hiI = 1, loI = 1;
      for (let i = 1; i < k - 1; i++) { if (sub[i] > sub[hiI]) hiI = i; if (sub[i] < sub[loI]) loI = i; }
      sub[hiI] = d.h; sub[loI] = d.l;
    }
    for (let i = 0; i < k; i++) {
      const o = i === 0 ? prev : sub[i - 1];
      const c = sub[i];
      cds.push({ o, c, h: Math.max(o, c), l: Math.min(o, c) });
      closes.push(c); vols.push(Math.round(d.v / k)); labels.push(labelFn(d.date));
    }
    prev = d.c;
  }
  return { closes, cds, vols, labels };
}

type Densified = ReturnType<typeof densify>;
// 1일 탭: 마지막 일봉을 09:00~15:30 장중 라인(n봉)으로 합성.
function synthIntraday(day: Candle | undefined, n: number): Densified {
  if (!day) return { closes: [], cds: [], vols: [], labels: [] };
  const d = densify([day], n);
  return { ...d, labels: d.closes.map((_, i) => fmtT(i, d.closes.length)) };
}

export default function StockDetail() {
  const watchlist = useStore((st) => st.watchlist);
  const selectedCode = useStore((st) => st.selectedCode);
  const selectStock = useStore((st) => st.selectStock);
  const detail = useStore((st) => st.detail);
  const portfolio = useStore((st) => st.portfolio);
  const loading = useStore((st) => st.detailLoading);
  const loadDetail = useStore((st) => st.loadDetail);
  const mode = useStore((st) => st.colorMode);

  // KIS 실시간/차트는 selectedCode(6자리=국내) 기준 — detail 로드를 기다리지 않고 즉시 전환.
  const isKR = /^\d{6}$/.test(selectedCode);
  const rt = useKisRealtime(isKR ? selectedCode : null);
  const chartAll = useKrChartAll(isKR ? selectedCode : null); // 일/주/월봉(1일~5년 탭)
  const lastClose = chartAll.daily[chartAll.daily.length - 1]?.c;
  const [liveTrades, setLiveTrades] = useState<TradeTick[]>([]);
  useEffect(() => { setLiveTrades([]); }, [selectedCode]);
  /** 호가창 클릭 → 주문 티켓 지정가 채움. seq로 같은 가격 재클릭도 전달된다. */
  const [pickedPrice, setPickedPrice] = useState<{ price: number; seq: number } | null>(null);
  useEffect(() => { setPickedPrice(null); }, [selectedCode]);
  const pickPrice = (price: number) => setPickedPrice((prev) => ({ price, seq: (prev?.seq ?? 0) + 1 }));

  // 모달
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const alerts = useStore((st) => st.alerts);
  const codeAlerts = detail ? alerts.filter((a) => a.code === detail.code) : [];

  // 좌측 리스트: 관심 / 코스피·코스닥 시총 TOP 100 (다음 금융, 실시장 데이터)
  const [listTab, setListTab] = useState<'watch' | 'kospi' | 'kosdaq'>('watch');
  const [top, setTop] = useState<Record<string, { rank: number; code: string; name: string; price: number; changePct: number }[]>>({});
  useEffect(() => {
    if (listTab === 'watch') return;
    let alive = true;
    const load = () => fetch(`/api/kr/top100?market=${listTab}`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => { if (alive && Array.isArray(d)) setTop((p) => ({ ...p, [listTab]: d })); })
      .catch(() => { if (alive) setTop((p) => ({ ...p, [listTab]: p[listTab] ?? [] })); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [listTab]);
  useEffect(() => {
    if (rt.trade) setLiveTrades((p) => [{ time: rt.trade!.time, price: rt.trade!.price, qty: rt.trade!.volume, side: rt.trade!.side }, ...p].slice(0, 30));
  }, [rt.trade]);

  useEffect(() => {
    if (!detail || detail.code !== selectedCode) loadDetail(selectedCode);
  }, [selectedCode, detail, loadDetail]);

  // PriceChart 입력 구성.
  //  KR: 1일=마지막 일봉을 장중 합성, 1주~3개월=일봉 슬라이스, 1년·5년=월봉. densify로 Toss식 촘촘.
  //  US: KIS 데이터 없어 mock 워크(≈50 정규화)를 실가격 스케일로 변환.
  //  소켓 불안정(체결 없음) 시엔 마지막 실제 종가로 폴백(목 금지).
  const live = rt.trade?.price ?? (isKR ? lastClose : undefined) ?? detail?.price ?? 0;
  // 전일 대비(기본 헤더용) — 좌측 관심종목과 동일 소스(REST 등락률)로 일치.
  const wlPct = watchlist.find((w) => w.code === selectedCode)?.changePct;
  const dayPct = wlPct ?? detail?.changePct ?? 0;
  const dayChg = live * dayPct / (100 + dayPct || 1);
  // 소켓 실시간 데이터 유무(KR) — 없으면 호가/체결을 "-"로.
  const krHasOb = isKR && rt.connected && !!rt.orderbook && (rt.orderbook.asks.some((a) => a.price > 0) || rt.orderbook.bids.some((b) => b.price > 0));
  const krHasTrades = isKR && rt.connected && liveTrades.length > 0;
  // 52주 범위: KR은 실제 월봉 12개(없으면 일봉 전체) 고/저로 계산 — 목 low52/high52는
  // 실시간가와 스케일이 달라 도트가 항상 끝에 클램프되는 시각적 거짓말이 됨.
  const finOhlc = (a: Candle[]) => a.filter((c) => Number.isFinite(c.h) && Number.isFinite(c.l));
  const rangeSrc = isKR ? (finOhlc(chartAll.monthly.slice(-12)).length ? finOhlc(chartAll.monthly.slice(-12)) : finOhlc(chartAll.daily)) : [];
  const low52 = rangeSrc.length ? Math.min(...rangeSrc.map((c) => c.l)) : detail?.low52 ?? 0;
  const high52 = rangeSrc.length ? Math.max(...rangeSrc.map((c) => c.h)) : detail?.high52 ?? 0;
  // 기술적 목표가(볼린저 상단 20D+2σ, 60일 고가 클램프) — server/index.mjs '/api/kr/targets'와 동일 공식 유지.
  // 목 고정 목표가는 실시세와 스케일이 어긋나므로 실데이터 없으면 '-' (동일룰).
  const techTarget = (() => {
    if (!isKR) return null;
    const closes = chartAll.daily.slice(-20).map((c) => c.c).filter(Number.isFinite);
    if (closes.length < 5) return null;
    const m = closes.reduce((a, b) => a + b, 0) / closes.length;
    const sd = Math.sqrt(closes.reduce((a, b) => a + (b - m) ** 2, 0) / closes.length);
    const hi60 = Math.max(...chartAll.daily.slice(-60).map((c) => c.h).filter(Number.isFinite));
    const raw = Math.min(m + 2 * sd, Number.isFinite(hi60) ? hi60 : Infinity);
    const tick = raw >= 100000 ? 500 : raw >= 10000 ? 100 : raw >= 1000 ? 10 : 1;
    return Math.round(raw / tick) * tick;
  })();
  const techUpside = techTarget && live > 0 ? +(((techTarget - live) / live) * 100).toFixed(1) : null;
  const pc = useMemo(() => {
    if (!detail) return null;
    const { dec, price } = detail;
    const fin = (arr: Candle[]) => arr.filter((c) => [c.o, c.h, c.l, c.c].every((n) => Number.isFinite(n)));
    const daily = isKR ? fin(chartAll.daily) : [];
    const monthly = isKR ? fin(chartAll.monthly) : [];
    const safeLive = Number.isFinite(live) && live > 0 ? live : (lastClose || detail.price || 0);
    // 끝점 절벽 방지(handoff 함정 #1): 라인 마지막 값과 실시간가 갭이 3%를 넘으면
    // (스테일/목 라인에 실가 강제 캡 = 수직 스파이크) 덮지 않고 라인 그대로 둔다.
    const nearLive = (last: number) => last > 0 && Math.abs(safeLive - last) / last <= 0.03;
    const cap = (d: Densified) => {
      const last = d.closes[d.closes.length - 1];
      if (d.closes.length && nearLive(last)) { d.closes[d.closes.length - 1] = safeLive; d.cds[d.cds.length - 1].c = safeLive; }
      return d;
    };

    if (daily.length) {
      // ⚠️ 서브포인트는 시각화용 합성(o/h/l/c는 실제). 실전 분봉 열리면 실데이터로 교체.
      const dPer = (nDays: number, k: number) => cap(densify(daily.slice(-nDays), k));
      const mPer = (nM: number, k: number) => cap(densify(monthly.slice(-nM), k, fmtM));
      const d1 = cap(synthIntraday(daily[daily.length - 1], 78));   // 1일: 장중
      const wk = dPer(5, 9), mo = dPer(22, 4), q = dPer(Math.min(66, daily.length), 2);
      const yr = monthly.length ? mPer(12, 8) : dPer(daily.length, 2);         // 1년: 월봉 12
      const yr5 = monthly.length ? mPer(monthly.length, 2) : { closes: [], cds: [], vols: [], labels: [] }; // 5년: 전체 월봉
      return {
        series: { '1일': d1.closes, '1주': wk.closes, '1개월': mo.closes, '3개월': q.closes, '1년': yr.closes, '5년': yr5.closes },
        candles: { '1일': d1.cds, '1주': wk.cds, '1개월': mo.cds, '3개월': q.cds, '1년': yr.cds, '5년': yr5.cds },
        volumes: { '1일': d1.vols, '1주': wk.vols, '1개월': mo.vols, '3개월': q.vols, '1년': yr.vols, '5년': yr5.vols },
        labels: { '1일': d1.labels, '1주': wk.labels, '1개월': mo.labels, '3개월': q.labels, '1년': yr.labels, '5년': yr5.labels },
        defaultPeriod: '1일' as const,
      };
    }

    // US: mock 스케일(끝점=현재가 — 단 갭 3% 이내일 때만, 절벽 방지)
    const scale = (arr: number[]) => {
      if (!arr?.length) return [] as number[];
      const out = arr.map((v) => +(price * (1 + (v - 50) / 100)).toFixed(dec));
      if (nearLive(out[out.length - 1])) out[out.length - 1] = safeLive;
      return out;
    };
    return {
      series: { '1일': scale(detail.chart['1D']), '1주': scale(detail.chart['1W']), '1개월': scale(detail.chart['1M']), '1년': scale(detail.chart['1Y']) },
      candles: undefined, volumes: undefined, labels: undefined,
      defaultPeriod: '1일' as const,
    };
  }, [detail, chartAll.daily, chartAll.monthly, isKR, live, lastClose]);

  return (
    <div className={s.grid}>
      {/* 좌: 관심 / 코스피·코스닥 TOP 100 */}
      <aside className="card">
        <div className="card-h" style={{ whiteSpace: 'nowrap' }} title="코스피·코스닥은 시가총액 TOP 100 (실시장 시세)">
          <Segmented
            options={[{ value: 'watch', label: '관심' }, { value: 'kospi', label: '코스피' }, { value: 'kosdaq', label: '코스닥' }] as const}
            value={listTab} onChange={setListTab}
          />
        </div>
        <div
          className={s.list}
          role="listbox"
          aria-label="종목 목록"
          style={listTab !== 'watch' ? { maxHeight: '70vh', overflowY: 'auto' } : undefined}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const rows = listTab === 'watch'
              ? watchlist.map((w) => ({ code: w.code }))
              : (top[listTab] ?? []);
            const idx = rows.findIndex((r) => r.code === selectedCode);
            const next = e.key === 'ArrowDown' ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
            const t = rows[next] as { code: string; name?: string; changePct?: number } | undefined;
            if (t) selectStock(t.code, t.name ? { name: t.name, market: 'KR', cur: '₩', dec: 0, changePct: t.changePct } : undefined);
          }}
        >
          {listTab === 'watch'
            ? watchlist.map((w) => (
              <button
                key={w.code}
                role="option"
                aria-selected={w.code === selectedCode}
                className={w.code === selectedCode ? `${s.li} ${s.liActive}` : s.li}
                onClick={() => selectStock(w.code)}
              >
                <span className={s.liName}><MarketChip market={w.market} /> {w.name}</span>
                <span className="mono" style={{ color: signColor(w.changePct, mode), fontSize: 12 }}>
                  {w.changePct >= 0 ? '+' : ''}{w.changePct.toFixed(2)}%
                </span>
              </button>
            ))
            : top[listTab] === undefined
              ? <SkeletonRows rows={8} />
              : top[listTab]!.length === 0
                ? <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--text-mut)', fontSize: 12 }}>순위를 불러오지 못했습니다</div>
                : top[listTab]!.map((t) => (
                  <button
                    key={t.code}
                    role="option"
                    aria-selected={t.code === selectedCode}
                    className={t.code === selectedCode ? `${s.li} ${s.liActive}` : s.li}
                    onClick={() => selectStock(t.code, { name: t.name, market: 'KR', cur: '₩', dec: 0, changePct: t.changePct })}
                  >
                    <span className={s.liName}>
                      <span className="mono" style={{ flex: 'none', width: 22, textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--text-sub)' }}>{t.rank}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    </span>
                    <span className="mono" style={{ color: signColor(t.changePct, mode), fontSize: 12, flex: 'none' }}>
                      {t.changePct >= 0 ? '+' : ''}{t.changePct.toFixed(2)}%
                    </span>
                  </button>
                ))}
        </div>
      </aside>

      {/* 중: 차트/호가/체결 */}
      <main className={s.center}>
        {(!detail || loading) ? (
          <section className="card">
            {loading ? <Loading /> : <EmptyState title="종목을 선택하세요" desc="좌측에서 종목을 골라보세요." />}
          </section>
        ) : (
          <>
            {pc && (
              <PriceChart
                key={detail.code}
                name={detail.name} code={detail.code} cur={detail.cur} dec={detail.dec} mode={mode}
                series={pc.series} candles={pc.candles} volumes={pc.volumes} labels={pc.labels}
                defaultPeriod={pc.defaultPeriod} height={236}
                dayChange={dayChg} dayChangePct={dayPct}
              />
            )}
            <section className="card">
              <div className="card-h">
                <span className="t">52주 범위</span>
                {isKR && <span className="tag">{rt.connected ? '실시간 연결' : '연결 대기'}</span>}
              </div>
              <Band52 low={low52} high={high52} price={live || detail.price} cur={detail.cur} dec={detail.dec} mode={mode} />
            </section>

            <div className={s.obTrades}>
              <section className="card">
                <div className="card-h"><span className="t">호가</span><span className="tag">{isKR ? (rt.connected ? '실시간 연결' : '연결 대기') : 'M3 · 미국 예정'}</span></div>
                {/* 소켓 불안정(KR 실시간 없음) 시 목 대신 "-" 표시 */}
                {isKR
                  ? (krHasOb
                      ? <Orderbook asks={rt.orderbook!.asks} bids={rt.orderbook!.bids} cur={detail.cur} dec={detail.dec} mode={mode} onPickPrice={pickPrice} />
                      : <DashOrderbook />)
                  : <Orderbook asks={detail.asks} bids={detail.bids} cur={detail.cur} dec={detail.dec} mode={mode} onPickPrice={pickPrice} />}
              </section>
              <section className="card">
                <div className="card-h"><span className="t">체결 내역</span><span className="tag">{isKR ? (krHasTrades ? '실시간' : '연결 대기') : '최근'}</span></div>
                <div className={s.trHead}><span>시간</span><span className={s.rt}>체결가</span><span className={s.rt}>수량</span><span className={s.rt}>구분</span></div>
                <div className={s.trBody}>
                  {isKR && !krHasTrades
                    ? <div className={s.dashNote}>실시간 연결 대기 — 체결 데이터 없음</div>
                    : (isKR ? liveTrades : detail.trades).map((t, i) => (
                      <div key={i} className={s.trRow}>
                        <span className={`${s.trTime} mono`}>{t.time}</span>
                        <span className={`${s.rt} mono`} style={{ color: signColor(t.side === '매수' ? 1 : -1, mode) }}>{detail.cur}{fmt(t.price, detail.dec)}</span>
                        <span className={`${s.rt} mono`} style={{ color: 'var(--text-sub)' }}>{t.qty.toLocaleString()}</span>
                        <span className={s.rt}><Badge color={signColor(t.side === '매수' ? 1 : -1, mode)}>{t.side}</Badge></span>
                      </div>
                    ))}
                </div>
              </section>
            </div>
          </>
        )}
      </main>

      {/* 우: 주문 티켓 + AI + 정보 */}
      <aside className={s.right}>
        {detail && !loading && (
          <>
            {/* 가격 알림 모달 + 헤더 */}
            <div className="flex items-center justify-between mb-4 px-2">
              <div />
              <button
                onClick={() => setAlertModalOpen(true)}
                className={`p-2 rounded-lg transition-colors ${codeAlerts.length > 0 ? 'bg-brand/20 text-brand' : 'text-sub hover:bg-panel2'}`}
                title="가격 알림"
              >
                <Bell size={20} />
              </button>
            </div>
            <PriceAlertModal
              open={alertModalOpen}
              onOpenChange={setAlertModalOpen}
              code={detail.code}
              name={detail.name}
              market={detail.market}
              high52={high52}
            />

            <OrderTicket
              code={detail.code}
              name={detail.name}
              market={detail.market}
              price={live || detail.price}
              orderbook={isKR ? rt.orderbook || undefined : undefined}
              lastTradePrice={lastClose || 0}
              portfolio={portfolio}
              picked={pickedPrice}
            />
            <section className="card">
              <div className="card-h"><span className="t">AI 투자의견</span><span className="tag">M4 · AI</span></div>
              <div className={s.aiScore}><span className={`${s.aiNum} mono`}>{detail.ai.score}</span><span style={{ fontSize: 12, color: 'var(--text-mut)' }}>/ 100</span></div>
              <div className={s.aiBar}><div className={s.aiFill} style={{ width: `${detail.ai.score}%` }} /></div>
              <div className={s.tgt}>
                {/* 목표주가: KR=기술적 산출(실데이터). 없으면 '-' — 목 고정값과 실시세 혼합 금지 */}
                {isKR ? (
                  <>
                    <div><div className={s.tgtK}>목표주가 · 기술적</div><div className={`${s.tgtV} mono`} style={techTarget ? undefined : { color: 'var(--text-sub)' }}>{techTarget ? `${detail.cur}${fmt(techTarget, detail.dec)}` : '-'}</div></div>
                    <div><div className={s.tgtK}>상승여력</div><div className={`${s.tgtV} mono`} style={{ color: techUpside == null ? 'var(--text-sub)' : signColor(techUpside, mode) }}>{techUpside == null ? '-' : `${techUpside >= 0 ? '+' : ''}${techUpside}%`}</div></div>
                  </>
                ) : (
                  <>
                    <div><div className={s.tgtK}>목표주가</div><div className={`${s.tgtV} mono`}>{detail.cur}{fmt(detail.ai.target, detail.dec)}</div></div>
                    <div><div className={s.tgtK}>상승여력</div><div className={`${s.tgtV} mono`} style={{ color: signColor(detail.ai.upsidePct, mode) }}>{detail.ai.upsidePct >= 0 ? '+' : ''}{detail.ai.upsidePct}%</div></div>
                  </>
                )}
              </div>
              <div className={s.reasons}>
                <ReasonList label="호재" items={detail.ai.bull} sign={1} mode={mode} />
                <ReasonList label="악재" items={detail.ai.bear} sign={-1} mode={mode} />
              </div>
            </section>
            <section className="card">
              <div className="card-h"><span className="t">종목 정보</span></div>
              <div className={s.info}>
                <Info k="시가총액" v={detail.info.marketCap} />
                <Info k="PER" v={detail.info.per.toFixed(1)} />
                <Info k="PBR" v={detail.info.pbr.toFixed(2)} />
                <Info k="EPS" v={fmt(detail.info.eps, 0)} />
                <Info k="배당" v={detail.info.div} />
                <Info k="거래량" v={detail.info.volume} />
              </div>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return <div className={s.infoRow}><span className={s.infoK}>{k}</span><span className={`${s.infoV} mono`}>{v}</span></div>;
}

function Band52({ low, high, price, cur, dec, mode }: { low: number; high: number; price: number; cur: string; dec: number; mode: ColorMode }) {
  const pos = Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
  // 저가(왼쪽)=하락색 → 고가(오른쪽)=상승색, colorMode 반영.
  const grad = `linear-gradient(90deg, ${signColor(-1, mode)}33, ${signColor(1, mode)}33)`;
  return (
    <div className={s.band}>
      <span className={`${s.bandV} mono`}>{cur}{fmt(low, dec)}</span>
      <div className={s.bandBar} style={{ background: grad }}><div className={s.bandDot} style={{ left: `${pos}%` }} /></div>
      <span className={`${s.bandV} mono`}>{cur}{fmt(high, dec)}</span>
    </div>
  );
}

// 소켓 불안정 시 호가 자리표시("-") — 목 데이터로 오해 방지.
function DashOrderbook() {
  return (
    <div className={s.ob}>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className={s.obRow}>
          <span className={`${s.obPx} mono`} style={{ color: 'var(--text-mut)' }}>-</span>
          <span className={`${s.obQty} mono`} style={{ color: 'var(--text-mut)' }}>-</span>
        </div>
      ))}
    </div>
  );
}

function Orderbook({ asks, bids, cur, dec, mode, onPickPrice }: { asks: Level[]; bids: Level[]; cur: string; dec: number; mode: 'global' | 'korea'; onPickPrice?: (price: number) => void }) {
  const maxQty = Math.max(1, ...asks.map((l) => l.qty), ...bids.map((l) => l.qty));
  const up = signColor(1, mode), down = signColor(-1, mode);
  return (
    <div className={s.ob}>
      {[...asks].reverse().map((l, i) => <ObRow key={'a' + i} level={l} max={maxQty} color={down} side="ask" cur={cur} dec={dec} onPickPrice={onPickPrice} />)}
      {bids.map((l, i) => <ObRow key={'b' + i} level={l} max={maxQty} color={up} side="bid" cur={cur} dec={dec} onPickPrice={onPickPrice} />)}
    </div>
  );
}

function ObRow({ level, max, color, side, cur, dec, onPickPrice }: { level: Level; max: number; color: string; side: 'ask' | 'bid'; cur: string; dec: number; onPickPrice?: (price: number) => void }) {
  const w = `${Math.round((level.qty / max) * 100)}%`;
  return (
    <div
      className={s.obRow}
      onClick={() => onPickPrice?.(level.price)}
      style={{ cursor: onPickPrice ? 'pointer' : 'default' }}
    >
      <div className={s.obBar} style={{ [side === 'ask' ? 'right' : 'left']: 0, width: w, background: color + '22' } as CSSProperties} />
      <span className={`${s.obPx} mono`} style={{ color }}>{cur}{fmt(level.price, dec)}</span>
      <span className={`${s.obQty} mono`}>{level.qty.toLocaleString()}</span>
    </div>
  );
}
