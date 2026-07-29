import { useEffect, useMemo, useRef, useState } from 'react';
import { signColor } from '../../lib/colors';
import type { Candle } from '../../data/types';
import type { ColorMode } from '../../lib/colors';
import s from './StockDetail.module.css';

const CW_MIN = 3, CW_MAX = 26, CW_DEFAULT = 7;

// SVG 캔들차트 + 거래량. 실데이터(KIS 일/주/월봉). 줌 인/아웃(버튼·휠) 지원.
export default function CandleChart({ candles, mode, cur, dec }: { candles: Candle[]; mode: ColorMode; cur: string; dec: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [cw, setCw] = useState(CW_DEFAULT);   // 캔들 폭(줌)
  const scrollRef = useRef<HTMLDivElement>(null);
  const PAD = 8, PH = 150, VH = 46, GAP = 10;
  const W = Math.max(candles.length * cw + PAD * 2, 100);
  const H = PH + GAP + VH;

  const { hi, lo, maxV } = useMemo(() => {
    if (!candles.length) return { hi: 1, lo: 0, maxV: 1 };
    return {
      hi: Math.max(...candles.map((c) => c.h)),
      lo: Math.min(...candles.map((c) => c.l)),
      maxV: Math.max(...candles.map((c) => c.v), 1),
    };
  }, [candles]);

  const zoom = (dir: number) => setCw((w) => Math.min(CW_MAX, Math.max(CW_MIN, w + dir)));

  // 휠 줌(가로 스크롤과 구분: Ctrl 또는 세로 휠일 때만). 커서 위치 기준으로 스크롤 보정.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) return; // 순수 가로 스크롤은 통과
      e.preventDefault();
      const before = el.scrollLeft, rectX = e.clientX - el.getBoundingClientRect().left;
      const anchor = (before + rectX) / (candles.length * cw + PAD * 2 || 1);
      const nextCw = Math.min(CW_MAX, Math.max(CW_MIN, cw + (e.deltaY < 0 ? 1 : -1)));
      setCw(nextCw);
      requestAnimationFrame(() => { el.scrollLeft = anchor * (candles.length * nextCw + PAD * 2) - rectX; });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [cw, candles.length]);

  if (!candles.length) return <div className={s.chartEmpty}>차트 데이터 없음</div>;

  const py = (p: number) => PAD + (1 - (p - lo) / ((hi - lo) || 1)) * (PH - PAD * 2);
  const vy = (v: number) => H - (v / maxV) * VH;
  const cx = (i: number) => PAD + i * cw + cw / 2;
  const hc = hover != null ? candles[hover] : candles[candles.length - 1];

  return (
    <div className={s.candleWrap}>
      <div className={s.candleInfo}>
        <span className={s.ciDate}>{fmtDate(hc.date)}</span>
        <span className="mono">시 {cur}{fmt(hc.o, dec)}</span>
        <span className="mono">고 {cur}{fmt(hc.h, dec)}</span>
        <span className="mono">저 {cur}{fmt(hc.l, dec)}</span>
        <span className="mono" style={{ color: signColor(hc.c - hc.o, mode) }}>종 {cur}{fmt(hc.c, dec)}</span>
        <span className={`${s.ciVol} mono`}>거래량 {hc.v.toLocaleString()}</span>
        <span className={s.zoom}>
          <button className={s.zoomBtn} onClick={() => zoom(-2)} disabled={cw <= CW_MIN} aria-label="축소" title="축소">−</button>
          <button className={s.zoomBtn} onClick={() => setCw(CW_DEFAULT)} aria-label="줌 초기화" title="줌 초기화">⟲</button>
          <button className={s.zoomBtn} onClick={() => zoom(2)} disabled={cw >= CW_MAX} aria-label="확대" title="확대">＋</button>
        </span>
      </div>
      <div className={s.candleScroll} ref={scrollRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={s.candleSvg}
          onMouseLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((t) => (
            <line key={t} x1="0" y1={PAD + t * (PH - PAD * 2)} x2={W} y2={PAD + t * (PH - PAD * 2)} stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />
          ))}
          {candles.map((c, i) => {
            const up = c.c >= c.o;
            const col = up ? signColor(1, mode) : signColor(-1, mode);
            const bodyTop = py(Math.max(c.o, c.c)), bodyBot = py(Math.min(c.o, c.c));
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={cx(i) - cw / 2} y="0" width={cw} height={H} fill={hover === i ? 'rgba(255,255,255,.04)' : 'transparent'} />
                <line x1={cx(i)} y1={py(c.h)} x2={cx(i)} y2={py(c.l)} stroke={col} strokeWidth="0.8" />
                <rect x={cx(i) - cw / 2 + 1} y={bodyTop} width={Math.max(1, cw - 2)} height={Math.max(1, bodyBot - bodyTop)} fill={col} />
                <rect x={cx(i) - cw / 2 + 1} y={vy(c.v)} width={Math.max(1, cw - 2)} height={H - vy(c.v)} fill={col} opacity="0.4" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

const fmt = (n: number, d: number) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = (d: string) => (d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : d);
