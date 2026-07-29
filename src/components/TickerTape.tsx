import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store/useStore';
import { signColor, fmt } from '../lib/colors';
import s from './TickerTape.module.css';

const SPEED = 32; // px/s — CSS 40s 마퀴와 유사한 체감 속도

export default function TickerTape() {
  const indices = useStore((st) => st.indices);
  const mode = useStore((st) => st.colorMode);
  const trackRef = useRef<HTMLDivElement>(null);
  const paused = useRef(false);

  // rAF 기반 마퀴 — CSS 애니메이션은 OS '동작 줄이기'·devtools 에뮬레이션 등
  // 환경 요인으로 멈출 수 있어(실제 발생) JS 루프로 구동한다. 호버 시 일시정지.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !indices.length) return;
    let raf = 0, last = performance.now(), offset = 0, half = 0;
    const measure = () => { half = el.scrollWidth / 2; };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const tick = (now: number) => {
      const dt = Math.min(100, now - last); // 백그라운드 복귀 시 점프 방지
      last = now;
      if (!paused.current && half > 0) {
        offset -= (SPEED * dt) / 1000;
        if (-offset >= half) offset += half; // 복제본 경계에서 무한 루프
        el.style.transform = `translateX(${offset}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [indices.length]);

  if (!indices.length) return null;

  const items = [...indices, ...indices]; // 무한 루프용 2배 복제
  return (
    <motion.div
      className={s.tape}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      onMouseEnter={() => { paused.current = true; }}
      onMouseLeave={() => { paused.current = false; }}
    >
      <div className={s.track} ref={trackRef}>
        {items.map((q, i) => {
          const up = q.changePct >= 0;
          return (
            <span key={i} className={s.item}>
              <span className={s.name}>{q.name}</span>
              {q.unavailable
                ? <span className="mono" style={{ color: 'var(--text-mut)' }}>-</span>
                : <>
                    <span className="mono">{fmt(q.price, q.dec)}</span>
                    <span className="mono" style={{ color: signColor(q.changePct, mode) }}>
                      {up ? '▲' : '▼'} {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
                    </span>
                  </>}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
}
