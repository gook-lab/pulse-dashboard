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
import { calcMinMax, CompareSeries } from './PriceChart.helpers';

export type Period = '1일' | '1주' | '1개월' | '3개월' | '1년' | '5년';
export const PERIODS: Period[] = ['1일', '1주', '1개월', '3개월', '1년', '5년'];

export interface Candle { o: number; h: number; l: number; c: number; }

interface Props {
  name: string;
  code: string;
  cur?: string;
  dec?: number;
  /** 기간별 종가 배열. null 허용 — 거래 없는 달은 선을 끊는다(보간 금지) */
  series: Partial<Record<Period, (number | null)[]>>;
  /** 기간별 거래량 배열(선택). null 허용. */
  volumes?: Partial<Record<Period, (number | null)[]>>;
  /** 기간별 캔들(선택). 있으면 캔들 토글 노출 */
  candles?: Partial<Record<Period, Candle[]>>;
  /** 기간별 X축 라벨(선택). 없으면 인덱스 표시 */
  labels?: Partial<Record<Period, string[]>>;
  /** 기간별 비교 시리즈(선택). 메인 시리즈와 같은 X축을 공유하고 min/max에 포함됨 */
  compareSeries?: Partial<Record<Period, CompareSeries[]>>;
  mode?: 'korea' | 'global';
  defaultPeriod?: Period;
  height?: number;
  /** 전일 대비(기본 헤더 표시용). 기간 탭을 누르면 해당 기간 기준으로 전환. */
  dayChange?: number;
  dayChangePct?: number;
  /** 해당 인덱스부터 끝까지를 미확정 구간으로: 회색 점선 선 + 영역 채움 없음. */
  provisionalFrom?: number;
  /** 헤더 상태 배지 문구. 월별 실거래처럼 "실시간"이 거짓말이 되는 데이터가 덮어쓴다. */
  liveBadge?: string;
  /** 배지 톤. 'warn' = 목/합성 데이터 — 초록(실시간) 배지를 그대로 쓰면 문구만 바꿔도 진짜처럼 보인다. */
  liveBadgeTone?: 'live' | 'warn';
}

const MIN_POINTS = 14;
const MAX_ZOOM = 14;

export default function PriceChart({
  name, code, cur = '₩', dec = 0,
  series, volumes, candles, labels, compareSeries,
  mode = 'korea', defaultPeriod = '1개월', height = 250,
  dayChange, dayChangePct, provisionalFrom, liveBadge = '실시간', liveBadgeTone = 'live',
}: Props) {
  const UP = mode === 'korea' ? '#F6465D' : '#16C784';
  const DOWN = mode === 'korea' ? '#4C82FB' : '#EA3943';

  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [touched, setTouched] = useState(false); // 기간 탭을 눌렀는지(누르기 전 기본은 전일 대비)
  const [kind, setKind] = useState<'line' | 'candle'>('line');
  const [idx, setIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [start, setStart] = useState(0);
  const [w, setW] = useState(900);

  const wrapRef = useRef<HTMLDivElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);
  const panX = useRef<number | null>(null);

  const full = useMemo(() => (series[period] ?? []) as (number | null)[], [series, period]);
  const N = full.length;
  const cnt = Math.max(MIN_POINTS, Math.round(N / zoom));
  const clampStart = useCallback((v: number) => Math.max(0, Math.min(N - cnt, v)), [N, cnt]);
  const s0 = clampStart(Math.round(start));

  // 기간 변경 시 초기화
  useEffect(() => { setIdx(null); setZoom(1); setStart(0); }, [period]);

  // 현재 period에 데이터가 없으면(종목 전환으로 기간 세트가 바뀐 경우) 가용 기간으로 보정.
  useEffect(() => {
    if (!series[period]?.length) {
      const a = PERIODS.find((p) => series[p]?.length);
      if (a && a !== period) setPeriod(a);
    }
  }, [series, period]);

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
  // null을 제외하고 min/max 계산 (compareSeries 포함)
  const cmpSeries = compareSeries?.[period] ?? [];
  const minMaxResult = calcMinMax(data, cmpSeries);
  const mn = minMaxResult.min;
  const mx = minMaxResult.max;
  const span = mx - mn || 1;
  const X = (i: number) => pad.l + ((w - pad.l - pad.r) * i) / Math.max(1, n - 1);
  const Y = (v: number | null) => {
    if (v == null) return pad.t;
    return pad.t + (height - pad.t - pad.b) * (1 - (v - mn) / span);
  };

  // 첫 유효값을 base로
  const base = data.find((v) => v != null) ?? 0;
  // idx가 줌/스크롤로 현재 범위를 벗어나도 안전하게(undefined 방지).
  const cur$ = idx == null ? (data[n - 1] ?? 0) : (data[idx] ?? data[n - 1] ?? 0);
  const chg = cur$ - base;
  const pct = base ? (chg / base) * 100 : 0;
  const color = chg >= 0 ? UP : DOWN;

  // 헤더 표시: 스크럽 중=해당 시점, 탭 누르기 전 기본=전일 대비, 탭 선택 후=기간 기준.
  const scrubbing = idx != null;
  const showDay = !scrubbing && !touched && dayChangePct != null;
  const headChg = scrubbing ? chg : showDay ? (dayChange ?? 0) : chg;
  const headPct = scrubbing ? pct : showDay ? (dayChangePct as number) : pct;
  const headColor = headChg >= 0 ? UP : DOWN;

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

  // null 은 선을 끊는다(보간 금지). [from, to) 구간의 경로를 만든다.
  const pathOf = (from: number, to: number): string => {
    const parts: string[] = [];
    for (let i = Math.max(0, from); i < Math.min(to, n); i++) {
      const v = data[i];
      if (v == null) continue;
      const resume = parts.length === 0 || i === from || data[i - 1] == null;
      parts.push(`${resume ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`);
    }
    return parts.join(' ');
  };

  // provisionalFrom 은 전체 시계열 인덱스 — 줌·팬 윈도 좌표계로 변환한다.
  const pvFrom = provisionalFrom != null ? provisionalFrom - s0 : null;
  const confirmedEnd = pvFrom != null ? Math.max(0, Math.min(pvFrom, n)) : n; // exclusive

  const line = pathOf(0, confirmedEnd);
  // 미확정 회색 점선 — 마지막 확정점에서 이어 그려야 선이 끊겨 보이지 않는다
  const provisionalLine = confirmedEnd < n ? pathOf(Math.max(0, confirmedEnd - 1), n) : '';

  // 영역 채움: 확정 구간까지만
  const areaLine = pathOf(0, confirmedEnd);
  const lastConfirmed = (() => {
    for (let i = confirmedEnd - 1; i >= 0; i--) if (data[i] != null) return i;
    return 0;
  })();
  const area = areaLine.length > 0
    ? `${areaLine} L ${X(lastConfirmed).toFixed(1)} ${height} L ${X(0).toFixed(1)} ${height} Z`
    : '';

  // compareSeries 경로 생성 (메인 시리즈와 동일한 스케일 사용)
  const comparePathOf = (cmpData: (number | null)[], from: number = 0, to: number = n): string => {
    const parts: string[] = [];
    for (let i = Math.max(0, from); i < Math.min(to, n); i++) {
      const v = cmpData[i];
      if (v == null) continue;
      const resume = parts.length === 0 || i === from || cmpData[i - 1] == null;
      parts.push(`${resume ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`);
    }
    return parts.join(' ');
  };
  const comparePaths = cmpSeries.map((cs) => ({
    ...cs,
    path: comparePathOf(cs.data),
  }));

  const gid = `pcg-${code}-${mode}`;

  // 거래량 (null 안전 처리)
  const vols = ((volumes?.[period] ?? []) as (number | null)[]).slice(s0, s0 + cnt);
  const validVols = vols.filter((v) => v != null) as number[];
  const vmax = Math.max(1, ...validVols);
  const VH = 58;
  const bw = Math.max(1.4, ((w - pad.l - pad.r) / Math.max(1, n)) * 0.62);

  // 캔들
  const cds = (candles?.[period] ?? []).slice(s0, s0 + cnt);
  const hasCandle = (candles?.[period]?.length ?? 0) > 0;

  // 미니맵 — null 은 min/max 에서 빼고, 경로에서도 건너뛴다
  const BH = 36;
  const fullValid = full.filter((v): v is number => v != null);
  const fmn = fullValid.length ? Math.min(...fullValid) : 0, fmx = fullValid.length ? Math.max(...fullValid) : 1;
  const fsp = fmx - fmn || 1;
  const BX = (i: number) => 6 + ((w - 12) * i) / Math.max(1, N - 1);
  const BY = (v: number) => 5 + (BH - 10) * (1 - (v - fmn) / fsp);
  const stepI = Math.max(1, Math.round(N / 170));
  const bline = (() => {
    const parts: string[] = [];
    for (let i = 0; i < N; i += stepI) {
      const v = full[i];
      if (v == null) continue;
      parts.push(`${parts.length && full[i - stepI] != null ? 'L' : 'M'} ${BX(i).toFixed(1)} ${BY(v).toFixed(1)}`);
    }
    return parts.join(' ');
  })();
  const brushJump = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    setStart(clampStart(((e.clientX - b.left) / Math.max(1, b.width)) * N - cnt / 2));
  };

  // 구간 고·저 마커. 그려진 것과 같은 소스를 쓴다(캔들 모드면 꼬리 고/저, 라인 모드면 종가).
  // 스크럽 중에는 크로스헤어·툴팁과 겹치므로 숨긴다.
  const hiLo = (() => {
    if (n === 0) return null;
    const useCandle = kind === 'candle' && cds.length > 0;
    let hiI = -1, loI = -1, hiV = -Infinity, loV = Infinity;
    for (let i = 0; i < n; i++) {
      const h = useCandle ? cds[i]?.h : data[i];
      const l = useCandle ? cds[i]?.l : data[i];
      if (h != null && Number.isFinite(h) && h > hiV) { hiV = h; hiI = i; }
      if (l != null && Number.isFinite(l) && l < loV) { loV = l; loI = i; }
    }
    if (hiI < 0 || loI < 0 || hiV === loV) return null; // 평탄 구간이면 표시할 게 없다
    return { hiI, hiV, loI, loV };
  })();

  // 목/합성 데이터는 배지 톤까지 경고색으로 — 문구만 바꾸면 초록 배지가 여전히 "실데이터"라고 말한다.
  const badgeWarn = idx == null && liveBadgeTone === 'warn';

  const label = (i: number) => labels?.[period]?.[i] ?? String(i + 1);
  const money = (v: number) => cur + (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
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
              badgeWarn ? ''
                : idx == null
                  ? 'border-[rgba(22,199,132,.3)] bg-[rgba(22,199,132,.14)] text-[#3fe0a0]'
                  : 'border-[rgba(124,108,255,.3)] bg-[rgba(124,108,255,.16)] text-[#9D90FF]'}`}
              style={badgeWarn ? {
                borderColor: 'color-mix(in srgb, var(--warn) 32%, transparent)',
                background: 'color-mix(in srgb, var(--warn) 14%, transparent)',
                color: 'var(--warn)',
              } : undefined}>
              {idx == null ? liveBadge : '과거 시점'}
            </span>
          </div>
          <div className="flex items-end gap-3">
            <span className="font-mono text-[34px] font-extrabold leading-[.92] tracking-tight text-fg">{money(cur$)}</span>
            <span className="mb-[3px] font-mono text-sm font-bold" style={{ color: headColor }}>
              {headChg >= 0 ? '▲' : '▼'} {Math.abs(Math.round(headChg)).toLocaleString()} ({headPct >= 0 ? '+' : ''}{headPct.toFixed(2)}%)
            </span>
          </div>
          <div className="mt-[7px] text-[11.5px] text-mut">
            {scrubbing ? `${label(s0 + idx)} 시점` : showDay ? '전일 대비' : `${period} 기준`}
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
          {n > 0 && base != null && <line x1={pad.l} y1={Y(base)} x2={w - pad.r} y2={Y(base)} stroke="#2a3346" strokeWidth={1} strokeDasharray="4 4" />}
          {n === 0 ? null : kind === 'line' || !cds.length ? (
            <>
              {area && <path d={area} fill={`url(#${gid})`} />}
              {line && <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
              {provisionalLine && <path d={provisionalLine} fill="none" stroke="#5E6879" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 4" />}
              {atEnd && data[n - 1] != null && <circle cx={X(n - 1)} cy={Y(data[n - 1])} r={3.6} fill={color} />}
              {comparePaths.map((cp, i) => (
                cp.path && <path key={`compare-${i}`} d={cp.path} fill="none" stroke={cp.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
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
          {/* 구간 고·저 — 고가는 상단에 붙으므로 라벨을 점 아래로, 저가는 점 위로 둔다(잘림 방지). */}
          {hiLo && !scrubbing && (
            <>
              {([
                { i: hiLo.hiI, v: hiLo.hiV, tag: '최고', dy: 13 },
                { i: hiLo.loI, v: hiLo.loV, tag: '최저', dy: -6 },
              ] as const).map(({ i, v, tag, dy }) => {
                const atRight = X(i) > w * 0.72;
                return (
                  <g key={tag} opacity={0.85}>
                    <circle cx={X(i)} cy={Y(v)} r={2.4} fill="var(--text-sub)" />
                    <text x={atRight ? X(i) - 5 : X(i) + 5} y={Y(v) + dy}
                      textAnchor={atRight ? 'end' : 'start'}
                      className="font-mono" fontSize={10} fill="var(--text-sub)">
                      {tag} {money(v)}
                    </text>
                  </g>
                );
              })}
            </>
          )}
          {idx != null && (
            <>
              <line x1={X(idx)} y1={pad.t - 6} x2={X(idx)} y2={height - pad.b + 4} stroke="#4a5568" strokeWidth={1} strokeDasharray="3 3" />
              {data[idx] != null && <>
                <circle cx={X(idx)} cy={Y(data[idx])} r={8} fill={color} fillOpacity={0.18} />
                <circle cx={X(idx)} cy={Y(data[idx])} r={4.6} fill={color} stroke="var(--bg)" strokeWidth={2.4} />
              </>}
            </>
          )}
        </svg>

        {/* 실거래량이 하나도 없으면 패널 자체를 숨긴다 — 빈 박스에 "평균 0"은 고장처럼 보인다. */}
        {validVols.length > 0 && (
          <>
            <div className="mt-3 flex items-center justify-between px-0.5">
              <span className="text-[10.5px] font-semibold text-mut">거래량</span>
              <span className="font-mono text-[10.5px] text-sub">
                {idx == null
                  ? `평균 ${validVols.length ? Math.round(validVols.reduce((a, b) => a + b, 0) / validVols.length).toLocaleString() : 0}`
                  : (vols[idx]?.toLocaleString() ?? '—')}
              </span>
            </div>
            <svg width="100%" height={VH} viewBox={`0 0 ${w} ${VH}`} className="mt-1.5 block">
              {vols.map((v, i) => {
                if (v == null) return null;
                const up = i === 0 ? true : (data[i] ?? 0) >= (data[i - 1] ?? 0);
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
            className="pointer-events-none absolute z-10 rounded-[10px] border border-[#2a3346] bg-[rgba(19,24,36,.97)] px-2.5 py-2 shadow-2xl"
            style={{ left: tipX, top: -4, minWidth: '124px' }}>
            <div className="mb-0.5 text-[10.5px] text-sub">{label(s0 + idx)}</div>
            {data[idx] == null ? (
              <div className="font-mono text-[13.5px] font-bold text-mut">거래 없음</div>
            ) : (
              <>
                <div className="font-mono text-[13.5px] font-extrabold text-fg">{money(cur$)}</div>
                <div className="mt-0.5 font-mono text-[11px] font-bold" style={{ color }}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                </div>
              </>
            )}
            {comparePaths.map((cp, i) => {
              const v = cp.data[idx];
              return (
                <div key={`compare-tooltip-${i}`} className="mt-1.5 pt-1.5 border-t border-[#3a4454] text-[10px]">
                  <div className="text-sub" style={{ color: cp.color }}>{cp.name}</div>
                  <div className="font-mono text-[11px] font-bold text-fg">
                    {v == null ? '—' : money(v)}
                  </div>
                </div>
              );
            })}
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

      {/* 기간 탭 (데이터 있는 기간만 표시) */}
      <div className="mt-4 flex gap-[3px] rounded-[11px] border border-line bg-row p-1">
        {PERIODS.filter((p) => (series[p]?.length ?? 0) > 0).map((p) => (
          <button key={p} onClick={() => { setPeriod(p); setTouched(true); }}
            className={`flex-1 rounded-lg py-[7px] text-[12.5px] font-bold transition-colors ${
              period === p ? 'bg-[rgba(124,108,255,.18)] text-fg' : 'text-sub hover:text-fg'}`}>
            {p}
          </button>
        ))}
      </div>
    </section>
  );
}
