import { describe, it, expect } from 'vitest';
import { screen, attachPrices, seriesRows, seriesValueAt, columnize } from './index.mjs';
import { idxOfAgo } from './signals.mjs';
import { NOW_OFFSET_MONTHS } from './lawd.mjs';

/** 스크리닝 대상 최소 단지. 시그널 값과 거래건수만 제어한다. */
const cx = (aptSeq, { trade = {}, rent = {}, jeonseRatio = null, gu = '강남구', areaTier = '60~85' } = {}) => ({
  aptSeq, aptNm: aptSeq, gu, umdNm: 'X', areaTier, lat: null, lng: null,
  signals: {
    trade: { momentum3: null, momentum6: null, momentum12: null, high52wPct: null, volumeRatio: null, rs: null, dealCount: 0, ...trade },
    rent: { momentum3: null, momentum6: null, momentum12: null, high52wPct: null, volumeRatio: null, rs: null, dealCount: 0, ...rent },
    jeonseRatio, jeonseRatioTier: jeonseRatio != null ? areaTier : null,
  },
});

describe('screen — jeonseRatio 표본 규칙', () => {
  it('전세가율은 매매·전세 양쪽 최소 건수로 거른다 — 거래유형 토글이 순위를 못 바꾼다', () => {
    const pool = [
      cx('a', { trade: { dealCount: 10 }, rent: { dealCount: 2 }, jeonseRatio: 0.8 }),  // 전세 표본 부족
      cx('b', { trade: { dealCount: 5 }, rent: { dealCount: 5 }, jeonseRatio: 0.7 }),   // 양쪽 충족
    ];
    for (const dealType of ['trade', 'rent']) {
      const r = screen(pool, { signal: 'jeonseRatio', dealType, minDeals: 3 });
      expect(r.ranked.map((x) => x.id)).toEqual(['b']);
    }
  });

  it('다른 시그널은 기존대로 현재 거래유형 건수를 쓴다', () => {
    const pool = [cx('a', { rent: { momentum6: 5, dealCount: 4 }, trade: { dealCount: 0 } })];
    expect(screen(pool, { signal: 'momentum6', dealType: 'rent', minDeals: 3 }).ranked).toHaveLength(1);
    expect(screen(pool, { signal: 'momentum6', dealType: 'trade', minDeals: 3 }).ranked).toHaveLength(0);
  });

  it('null 시그널은 여전히 모집단 제외 — nullCount 로 나간다', () => {
    const pool = [
      cx('a', { trade: { dealCount: 9 }, rent: { dealCount: 9 }, jeonseRatio: null }),
      cx('b', { trade: { dealCount: 9 }, rent: { dealCount: 9 }, jeonseRatio: 0.6 }),
    ];
    const r = screen(pool, { signal: 'jeonseRatio', dealType: 'rent', minDeals: 3 });
    expect(r.ranked.map((x) => x.id)).toEqual(['b']);
    expect(r.nullCount).toBe(1);
  });
});

describe('attachPrices — 순위 행 기준월 평당가', () => {
  const MONTHS = Array.from({ length: 17 }, (_, i) => String(202502 + i));
  const cxs = [{
    aptSeq: 'a',
    series: {
      t: MONTHS.map((_, i) => (i === 13 ? [3211.7, 2] : [null, 0])),  // 기준월(idx 14) 직전 달에만 거래
      r: MONTHS.map(() => [null, 0]),
    },
  }];
  it('기준월에 거래가 없으면 직전 유효값으로 backfill, 반올림', () => {
    const out = attachPrices([{ id: 'a', value: 1, deals: 2, rank: 1 }], cxs, MONTHS, 'trade');
    expect(out[0].price).toBe(3212);
  });
  it('해당 유형 거래가 전혀 없으면 null — 0 이 아니다', () => {
    const out = attachPrices([{ id: 'a', value: 1, deals: 2, rank: 1 }], cxs, MONTHS, 'rent');
    expect(out[0].price).toBeNull();
  });
});

describe('컬럼형 시계열 — 중첩 배열을 TypedArray 로 접는다', () => {
  const M = 5;
  // 단지 2개 × 5개월. NaN 이 "그 달 거래 없음"이다.
  const store = {
    monthCount: M,
    cols: {
      t: {
        price: Float64Array.from([100, NaN, 300, NaN, NaN, 10, 20, 30, 40, 50]),
        count: Uint16Array.from([2, 0, 3, 0, 0, 1, 1, 1, 1, 1]),
      },
      r: {
        price: Float64Array.from(new Array(10).fill(NaN)),
        count: Uint16Array.from(new Array(10).fill(0)),
      },
    },
  };
  const a = { aptSeq: 'a', row: 0 };
  const b = { aptSeq: 'b', row: 1 };

  it('응답용으로 되돌리면 [가격|null, 건수] 모양이다', () => {
    expect(seriesRows(store, a, 't')).toEqual([[100, 2], [null, 0], [300, 3], [null, 0], [null, 0]]);
  });

  it('단지마다 자기 구간만 읽는다 — 오프셋이 틀리면 남의 시세를 보여준다', () => {
    expect(seriesRows(store, b, 't')).toEqual([[10, 1], [20, 1], [30, 1], [40, 1], [50, 1]]);
  });

  it('거래 없는 달은 직전 유효값 — signals.valueAt 과 같은 규칙', () => {
    expect(seriesValueAt(store, a, 't', 4)).toBe(300);
    expect(seriesValueAt(store, a, 't', 1)).toBe(100);
  });

  it('앞에도 거래가 없으면 null 이다 — 0 이 아니다', () => {
    expect(seriesValueAt(store, a, 'r', 4)).toBeNull();
  });

  it('범위를 넘겨도 안전하다', () => {
    expect(seriesValueAt(store, a, 't', 99)).toBe(300);
  });

  it('건수 0 인 달의 값은 쓰지 않는다 — 이동중앙값이 퍼뜨린 값과 구분해야 한다', () => {
    const spread = {
      monthCount: 3,
      cols: { t: { price: Float64Array.from([50, 50, 50]), count: Uint16Array.from([1, 0, 0]) } },
    };
    expect(seriesValueAt(spread, { row: 0 }, 't', 2)).toBe(50);   // 값 자체는 같지만 출처는 0번 달
  });
});

describe('컬럼화 + attachPrices 통합 — 실제 서버 경로', () => {
  const MONTHS2 = Array.from({ length: 17 }, (_, i) => String(202502 + i));
  /** 배치가 내려주는 모양(중첩 배열) 그대로 만든다. */
  const raw = () => ({
    months: MONTHS2,
    complexes: [
      { aptSeq: 'a', series: { t: MONTHS2.map((_, i) => (i === 13 ? [3211.7, 2] : [null, 0])), r: MONTHS2.map(() => [null, 0]) } },
      { aptSeq: 'b', series: { t: MONTHS2.map((_, i) => (i === 14 ? [5000, 1] : [null, 0])), r: MONTHS2.map(() => [null, 0]) } },
    ],
  });

  it('컬럼화 후에도 순위 행 평당가가 중첩 배열 경로와 같다', () => {
    const nested = raw();
    const before = attachPrices(
      [{ id: 'a', value: 1, deals: 2, rank: 1 }, { id: 'b', value: 1, deals: 2, rank: 2 }],
      nested.complexes, MONTHS2, 'trade',
    );

    const store = raw();
    columnize(store);
    const nowIdx = idxOfAgo(MONTHS2, NOW_OFFSET_MONTHS);
    const after = attachPrices(
      [{ id: 'a', value: 1, deals: 2, rank: 1 }, { id: 'b', value: 1, deals: 2, rank: 2 }],
      store.complexes, MONTHS2, 'trade',
      (c) => seriesValueAt(store, c, 't', nowIdx),
    );

    expect(after.map((r) => r.price)).toEqual(before.map((r) => r.price));
  });

  it('컬럼화가 중첩 배열을 실제로 버린다 — 안 버리면 메모리가 그대로다', () => {
    const store = raw();
    columnize(store);
    expect(store.complexes[0].series).toBeNull();
    expect(store.cols.t.price).toBeInstanceOf(Float64Array);
  });

  it('단지마다 자기 행만 읽는다 — 오프셋이 틀리면 남의 시세가 나온다', () => {
    const store = raw();
    columnize(store);
    expect(seriesRows(store, store.complexes[0], 't')[13]).toEqual([3211.7, 2]);
    expect(seriesRows(store, store.complexes[1], 't')[14]).toEqual([5000, 1]);
    expect(seriesRows(store, store.complexes[1], 't')[13]).toEqual([null, 0]);
  });
});
