import { describe, it, expect } from 'vitest';
import { screen } from './index.mjs';

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
