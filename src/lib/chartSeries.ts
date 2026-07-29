// 종목 차트 시리즈 변환 — 순수 함수. 컴포넌트에서 분리해 단위 테스트로 잠근다.
// 거래량 규칙(중요): 거래량은 "캔들 1개당 1건"만 실재한다. 서브포인트 k개로 균등 분할하면
// 막대가 전부 같은 높이가 되어 아무 정보도 주지 않는다 → 실값은 캔들의 마지막 지점에만 싣고
// 나머지는 null(PriceChart 가 null 을 건너뛴다).
import type { Candle } from '../data/types';

export const fmtD = (d: string) => (d?.length === 8 ? `${d.slice(4, 6)}/${d.slice(6, 8)}` : d ?? '');
export const fmtM = (d: string) => (d?.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}` : d ?? '');
export const fmtT = (i: number, n: number) => {
  const min = Math.round((i / Math.max(1, n - 1)) * 390); // 09:00~15:30 = 390분
  return `${String(9 + Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
};

export interface Densified {
  closes: number[];
  cds: { o: number; h: number; l: number; c: number }[];
  vols: (number | null)[];
  labels: string[];
}

/** 일/월봉 OHLC를 앵커로 서브포인트 k개를 합성 → 촘촘한 라인/캔들(결정적 시드).
 *  o/h/l/c(시·고·저·종)는 실제값을 반드시 포함하고 사이만 채운다. */
export function densify(daily: Candle[], k: number, labelFn: (d: string) => string = fmtD): Densified {
  const closes: number[] = [], vols: (number | null)[] = [], labels: string[] = [];
  const cds: Densified['cds'] = [];
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
      closes.push(c);
      vols.push(i === k - 1 ? d.v : null); // 캔들당 실거래량 1건 (위 주석 규칙)
      labels.push(labelFn(d.date));
    }
    prev = d.c;
  }
  return { closes, cds, vols, labels };
}

/** 1일 탭 폴백(분봉 미수신 시): 마지막 일봉을 09:00~15:30 장중 라인(n봉)으로 합성.
 *  거래량은 합성하지 않는다 — 분봉이 없으면 분 단위 실거래량도 없다(막대 미표시). */
export function synthIntraday(day: Candle | undefined, n: number): Densified {
  if (!day) return { closes: [], cds: [], vols: [], labels: [] };
  const d = densify([day], n);
  return { ...d, vols: d.closes.map(() => null), labels: d.closes.map((_, i) => fmtT(i, d.closes.length)) };
}

/** 1일 탭 정상 경로: KIS 당일 분봉(실 o/h/l/c/v). date='YYYYMMDDHHMMSS'.
 *  v=0(체결 없는 분)은 버린다 — 모의 환경은 아직 오지 않은 분까지 직전가·거래량 0으로 패딩해 보내며,
 *  그걸 점으로 찍으면 "가격이 평탄하게 유지됨"이라는 없는 신호가 그려진다. */
export function fromIntraday(rows: Candle[]): Densified {
  const fin = rows.filter((r) => r.v > 0 && [r.o, r.h, r.l, r.c].every((v) => Number.isFinite(v) && v > 0));
  return {
    closes: fin.map((r) => r.c),
    cds: fin.map((r) => ({ o: r.o, h: r.h, l: r.l, c: r.c })),
    vols: fin.map((r) => r.v),
    labels: fin.map((r) => (r.date?.length >= 12 ? `${r.date.slice(8, 10)}:${r.date.slice(10, 12)}` : '')),
  };
}
