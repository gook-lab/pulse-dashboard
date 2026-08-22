/**
 * PriceChart — 토스 증권 스타일 가격 차트
 *
 * 기간 탭 · 좌우 드래그 스크럽 · 크로스헤어 툴팁 · 휠/핀치 줌 · 팬 · 구간 미니맵
 * 라인 / 캔들 전환, 거래량 바(스크럽 연동) 포함.
 *
 * 입력 분리 (제스처 충돌 방지)
 *   마우스 : 호버 = 스크럽, 드래그 = 팬, 휠 = 줌
 *   터치   : 드래그 = 스크럽, 두 손가락 = 핀치 줌
 *
 * 사용:
 *   <PriceChart
 *     name="삼성전자" code="005930" cur="₩" dec={0}
 *     series={{ '1일': [...], '1개월': [...] }}
 *     volumes={{ '1일': [...], '1개월': [...] }}
 *     candles={{ '1개월': [{o,h,l,c}, ...] }}   // 선택
 *     mode={colorMode}                          // 'korea' | 'global'
 *   />
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';

export type Period = '1일' | '1주' | '1개월' | '3개월' | '1년' | '5년';
export const PERIODS: Period[] = ['1일', '1주', '1개월', '3개월', '1년', '5년'];

export interface Candle { o: number; h: number; l: number; c: number; }

interface Props {
  name: string;
  code: string;
  cur?: string;
  dec?: number;
  /** 기간별 종가 배열 */
  series: Partial<Record<Period, number[]>>;
  /** 기간별 거래량 배열(선택) */
  volumes?: Partial<Record<Period, number[]>>;
  /** 기간별 캔들(선택). 있으면 캔들 토글 노출 */
  candles?: Partial<Record<Period, Candle[]>>;
  /** 기간별 X축 라벨(선택). 없으면 인덱스 표시 */
  labels?: Partial<Record<Period, string[]>>;
  mode?: 'korea' | 'global';
  defaultPeriod?: Period;
  height?: number;
}

const MIN_POINTS = 14;
const MAX_ZOOM = 14;

export default function PriceChart({
  name, code, cur = '₩', dec = 0,
  series, volumes, candles, labels,
  mode = 'korea', defaultPeriod = '1개월', height = 250,
}: Props) {
  const UP = mode === 'korea' ? '#F6465D' : '#16C784';
  const DOWN = mode === 'korea' ? '#4C82FB' : '#EA3943';

  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [kind, setKind] = useState<'line' | 'candle'>('line');
  const [idx, setIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [start, setStart] = useState(0);
  const [w, setW] = useState(900);

  const wrapRef = useRef<HTMLDivElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);
  const panX = useRef<number | null>(null);

  const full = useMemo(() => series[period] ?? [], [series, period]);
  const N = full.length;
  const cnt = Math.max(MIN_POINTS, Math.round(N / zoom));
  const clampStart = useCallback((v: number) => Math.max(0, Math.min(N - cnt, v)), [N, cnt]);
  const s0 = clampStart(Math.round(start));

  // 기간 변경 시 초기화
  useEffect(() => { setIdx(null); setZoom(1); setStart(0); }, [period]);

  // 폭 측정
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const set = () => setW(Math.max(320, el.clientWidth));
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const applyZoom = useCallback((next: number, anchorT = 0.5) => {
    const z = Math.max(1, Math.min(MAX_ZOOM, next));
    const nextCnt = Math.max(MIN_POINTS, Math.round(N / z));
    const anchor = s0 + anchorT * cnt;
    setZoom(z);
    setStart(Math.max(0, Math.min(N - nextCnt, anchor - anchorT * nextCnt)));
  }, [N, cnt, s0]);

  // 휠 줌 (passive:false 필요 → 네이티브 리스너)
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const t = (e.clientX - b.left) / Math.max(1, b.width);
      applyZoom(zoom * (e.deltaY < 0 ? 1.22 : 1 / 1.22), t);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom, zoom]);

  const data = full.slice(s0, s0 + cnt);
  const n = data.length;
  const atEnd = s0 + cnt >= N;

  const pad = { l: 6, r: 6, t: 16, b: 12 };
  const mn = n ? Math.min(...data) : 0;
  const mx = n ? Math.max(...data) : 1;
  const span = mx - mn || 1;
  const X = (i: number) => pad.l + ((w - pad.l - pad.r) * i) / Math.max(1, n - 1);
  const Y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - (v - mn) / span);

  const base = data[0] ?? 0;
  const cur$ = idx == null ? (data[n - 1] ?? 0) : data[idx];
  const chg = cur$ - base;
  const pct = base ? (chg / base) * 100 : 0;
  const color = chg >= 0 ? UP : DOWN;

  const pick = (clientX: number) => {
    const el = wrapRef.current; if (!el) return;
    const b = el.getBoundingClientRect();
    const t = (clientX - b.left - pad.l) / Math.max(1, b.width - pad.l - pad.r);
    setIdx(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))));
  };
  const doPan = (clientX: number) => {
    const el = wrapRef.current; if (!el || panX.current == null) return;
    const dx = clientX - panX.current; panX.current = clientX;
    setStart((s) => clampStart(s - (dx * cnt) / Math.max(1, el.clientWidth)));
  };
  const doPinch = () => {
    if (ptrs.current.size < 2) return;
    const [a, b2] = [...ptrs.current.values()];
    const d = Math.hypot(a.x - b2.x, a.y - b2.y);
    if (pinchDist.current) {
      const el = wrapRef.current!;
      const r = el.getBoundingClientRect();
      const t = ((a.x + b2.x) / 2 - r.left) / Math.max(1, r.width);
      applyZoom(zoom * (d / pinchDist.current), t);
    }
    pinchDist.current = d;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) { pinchDist.current = 0; doPinch(); return; }
    if (e.pointerType === 'mouse') { panX.current = e.clientX; setIdx(null); }
    else pick(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size >= 2) { doPinch(); return; }
    if (e.pointerType === 'mouse') { panX.current != null ? doPan(e.clientX) : pick(e.clientX); }
    else if (ptrs.current.size === 1) pick(e.clientX);
  };
  const endPointer = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinchDist.current = 0;
    panX.current = null;
  };

  // 경로
  const line = data.map((v, i) => `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${X(n - 1).toFixed(1)} ${height} L ${X(0).toFixed(1)} ${height} Z`;
  const gid = `pcg-${code}-${mode}`;

  // 거래량
  const vols = (volumes?.[period] ?? []).slice(s0, s0 + cnt);
  const vmax = Math.max(1, ...vols);
  const VH = 58;
  const bw = Math.max(1.4, ((w - pad.l - pad.r) / Math.max(1, n)) * 0.62);

  // 캔들
  const cds = (candles?.[period] ?? []).slice(s0, s0 + cnt);
  const hasCandle = (candles?.[period]?.length ?? 0) > 0;

  // 미니맵
  const BH = 36;
  const fmn = N ? Math.min(...full) : 0, fmx = N ? Math.max(...full) : 1;
  const fsp = fmx - fmn || 1;
  const BX = (i: number) => 6 + ((w - 12) * i) / Math.max(1, N - 1);
  const BY = (v: number) => 5 + (BH - 10) * (1 - (v - fmn) / fsp);
  const stepI = Math.max(1, Math.round(N / 170));
  const bline = full.filter((_, i) => i % stepI === 0)
    .map((v, k) => `${k ? 'L' : 'M'} ${BX(k * stepI).toFixed(1)} ${BY(v).toFixed(1)}`).join(' ');
  const brushJump = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    setStart(clampStart(((e.clientX - b.left) / Math.max(1, b.width)) * N - cnt / 2));
  };

  const label = (i: number) => labels?.[period]?.[i] ?? String(i + 1);
  const money = (v: number) => cur + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const tickIdx = [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1];
  const tipX = idx == null ? 0 : Math.max(0, Math.min(w - 124, X(idx) - 62));

  return (
    <section className="rounded-2xl border border-line bg-panel px-[22px] pb-4 pt-5">
      {/* 헤더 */}
      <div className="mb-[18px] flex items-start justify-between gap-4">
        <div>
          <div className="mb-[9px] flex items-center gap-2.5">
            <span className="text-[15px] font-bold text-fg">{name}</span>
            <span className="font-mono text-xs text-mut">{code}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
              idx == null
                ? 'border-[rgba(22,199,132,.3)] bg-[rgba(22,199,132,.14)] text-[#3fe0a0]'
                : 'border-[rgba(124,108,255,.3)] bg-[rgba(124,108,255,.16)] text-[#9D90FF]'}`}>
              {idx == null ? '실시간' : '과거 시점'}
            </span>
          </div>
          <div className="flex items-end gap-3">
            <span className="font-mono text-[34px] font-extrabold leading-[.92] tracking-tight text-fg">{money(cur$)}</span>
            <span className="mb-[3px] font-mono text-sm font-bold" style={{ color }}>
              {chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toLocaleString()} ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)
            </span>
          </div>
          <div className="mt-[7px] text-[11.5px] text-mut">
            {idx == null ? `${period} 기준` : `${label(s0 + idx)} 시점`}
          </div>
        </div>
        {hasCandle && (
          <div className="flex gap-[3px] rounded-[10px] border border-line bg-row p-[3px]">
            {(['line', 'candle'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)}
                className={`rounded-[7px] px-[11px] py-[5px] text-xs font-semibold transition-colors ${
                  kind === k ? 'bg-[rgba(124,108,255,.18)] text-fg' : 'text-sub hover:text-fg'}`}>
                {k === 'line' ? '라인' : '캔들'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 차트 + 거래량 (같은 포인터 영역) */}
      <div ref={wrapRef} className="relative w-full cursor-crosshair select-none"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={endPointer} onPointerCancel={endPointer}
        onPointerLeave={(e) => { endPointer(e); setIdx(null); }}>

        <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} className="block overflow-visible">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.26} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <line x1={pad.l} y1={Y(base)} x2={w - pad.r} y2={Y(base)} stroke="#2a3346" strokeWidth={1} strokeDasharray="4 4" />
          {kind === 'line' || !cds.length ? (
            <>
              <path d={area} fill={`url(#${gid})`} />
              <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
              {atEnd && <circle cx={X(n - 1)} cy={Y(data[n - 1])} r={3.6} fill={color} />}
            </>
          ) : (
            cds.map((c, i) => {
              const up = c.c >= c.o;
              const col = up ? UP : DOWN;
              const top = Y(Math.max(c.o, c.c)), bot = Y(Math.min(c.o, c.c));
              return (
                <g key={i}>
                  <line x1={X(i)} y1={Y(c.h)} x2={X(i)} y2={Y(c.l)} stroke={col} strokeWidth={1} />
                  <rect x={X(i) - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} fill={col} rx={0.8} />
                </g>
              );
            })
          )}
          {idx != null && (
            <>
              <line x1={X(idx)} y1={pad.t - 6} x2={X(idx)} y2={height - pad.b + 4} stroke="#4a5568" strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={X(idx)} cy={Y(cur$)} r={8} fill={color} fillOpacity={0.18} />
              <circle cx={X(idx)} cy={Y(cur$)} r={4.6} fill={color} stroke="var(--bg)" strokeWidth={2.4} />
            </>
          )}
        </svg>

        {!!vols.length && (
          <>
            <div className="mt-3 flex items-center justify-between px-0.5">
              <span className="text-[10.5px] font-semibold text-mut">거래량</span>
              <span className="font-mono text-[10.5px] text-sub">
                {idx == null ? `평균 ${Math.round(vols.reduce((a, b) => a + b, 0) / vols.length).toLocaleString()}` : vols[idx]?.toLocaleString()}
              </span>
            </div>
            <svg width="100%" height={VH} viewBox={`0 0 ${w} ${VH}`} className="mt-1.5 block">
              {vols.map((v, i) => {
                const up = i === 0 ? true : data[i] >= data[i - 1];
                const h = Math.max(1.5, (v / vmax) * (VH - 10));
                return <rect key={i} x={X(i) - bw / 2} y={VH - h} width={bw} height={h} rx={Math.min(1.2, bw / 2)}
                  fill={up ? UP : DOWN} fillOpacity={idx == null ? 0.42 : idx === i ? 1 : 0.16} />;
              })}
              {idx != null && <line x1={X(idx)} y1={0} x2={X(idx)} y2={VH} stroke="#4a5568" strokeWidth={1} strokeDasharray="3 3" />}
            </svg>
          </>
        )}

        {idx != null && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }}
            className="pointer-events-none absolute z-10 w-[124px] rounded-[10px] border border-[#2a3346] bg-[rgba(19,24,36,.97)] px-2.5 py-2 shadow-2xl"
            style={{ left: tipX, top: -4 }}>
            <div className="mb-0.5 text-[10.5px] text-sub">{label(s0 + idx)}</div>
            <div className="font-mono text-[13.5px] font-extrabold text-fg">{money(cur$)}</div>
            <div className="mt-0.5 font-mono text-[11px] font-bold" style={{ color }}>
              {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
            </div>
          </motion.div>
        )}
      </div>

      {/* X축 */}
      <div className="mt-2 flex justify-between px-0.5">
        {tickIdx.map((i, k) => <span key={k} className="font-mono text-[10.5px] text-mut">{label(s0 + i)}</span>)}
      </div>

      {/* 줌 컨트롤 + 미니맵 */}
      <div className="mt-3.5 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold text-mut">구간 선택 · 휠로 확대, 드래그로 이동</span>
        <div className="flex items-center gap-1.5">
          <span className="mr-0.5 font-mono text-[11px] text-sub">{zoom < 1.05 ? '전체' : `${zoom.toFixed(1)}×`}</span>
          <button onClick={() => applyZoom(zoom / 1.5)} className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[#232b3a] bg-panel2 text-sub hover:text-fg">−</button>
          <button onClick={() => applyZoom(zoom * 1.5)} className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[#232b3a] bg-panel2 text-sub hover:text-fg">+</button>
          {zoom > 1.05 && (
            <button onClick={() => { setZoom(1); setStart(0); setIdx(null); }}
              className="h-[26px] rounded-[7px] border border-[#232b3a] bg-panel2 px-2.5 text-[11px] font-bold text-[#9D90FF]">전체</button>
          )}
        </div>
      </div>
      <svg width="100%" height={BH} viewBox={`0 0 ${w} ${BH}`} className="mt-2.5 block cursor-pointer"
        style={{ touchAction: 'none' }}
        onPointerDown={brushJump} onPointerMove={(e) => e.buttons && brushJump(e)}>
        <rect x={0} y={0} width={w} height={BH} rx={8} fill="#0d1119" stroke="var(--border)" />
        <path d={bline} fill="none" stroke="#33415a" strokeWidth={1.3} strokeLinejoin="round" />
        <rect x={BX(s0)} y={1} width={Math.max(7, BX(Math.min(N - 1, s0 + cnt - 1)) - BX(s0))} height={BH - 2}
          rx={6} fill="rgba(124,108,255,.15)" stroke="var(--brand)" strokeWidth={1.2} />
      </svg>

      {/* 기간 탭 */}
      <div className="mt-4 flex gap-[3px] rounded-[11px] border border-line bg-row p-1">
        {PERIODS.filter((p) => series[p]?.length).map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`flex-1 rounded-lg py-[7px] text-[12.5px] font-bold transition-colors ${
              period === p ? 'bg-[rgba(124,108,255,.18)] text-fg' : 'text-sub hover:text-fg'}`}>
            {p}
          </button>
        ))}
      </div>
    </section>
  );
}
