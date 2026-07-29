import { describe, it, expect } from 'vitest';
import {
  colors, signColor, heatColor, fmt,
  scaleColor, lerpHex, legendStops, SIGNAL_DOMAIN, MUTED,
} from './colors';

describe('colors', () => {
  it('global 모드: 상승 초록 / 하락 빨강', () => {
    expect(colors('global')).toEqual({ up: '#16C784', down: '#EA3943' });
  });
  it('korea 모드: 상승 빨강 / 하락 파랑', () => {
    expect(colors('korea')).toEqual({ up: '#F6465D', down: '#4C82FB' });
  });

  it('signColor: 0은 상승색으로 취급', () => {
    expect(signColor(0, 'global')).toBe('#16C784');
    expect(signColor(-0.1, 'global')).toBe('#EA3943');
  });

  it('signColor: korea면 부호별 색이 스왑', () => {
    expect(signColor(1, 'korea')).toBe('#F6465D');
    expect(signColor(-1, 'korea')).toBe('#4C82FB');
  });

  it('heatColor: 상승은 global/korea에서 서로 다른 색(초록 vs 빨강 계열)', () => {
    expect(heatColor(3, 'global')).not.toBe(heatColor(3, 'korea'));
  });

  it('heatColor: 범위를 -3..+3으로 클램프', () => {
    expect(heatColor(99, 'global')).toBe(heatColor(3, 'global'));
    expect(heatColor(-99, 'global')).toBe(heatColor(-3, 'global'));
  });

  it('fmt: 소수 자리수 고정 + 천단위 구분', () => {
    expect(fmt(1378.4, 1)).toBe('1,378.4');
    expect(fmt(78400, 0)).toBe('78,400');
  });
});

describe('lerpHex', () => {
  it('양 끝은 원본 색', () => {
    expect(lerpHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(lerpHex('#000000', '#ffffff', 1)).toBe('#FFFFFF');
  });
  it('0..1 밖은 클램프', () => {
    expect(lerpHex('#000000', '#ffffff', -5)).toBe('#000000');
    expect(lerpHex('#000000', '#ffffff', 9)).toBe('#FFFFFF');
  });
  it('중간은 중간값', () => {
    expect(lerpHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('scaleColor — signColor 가 못 하던 것', () => {
  it('null/NaN 은 MUTED — 계산 불가를 0 으로 칠하지 않는다', () => {
    expect(scaleColor(null, SIGNAL_DOMAIN.momentum6, 'global')).toBe(MUTED);
    expect(scaleColor(undefined, SIGNAL_DOMAIN.momentum6, 'global')).toBe(MUTED);
    expect(scaleColor(NaN, SIGNAL_DOMAIN.momentum6, 'global')).toBe(MUTED);
  });

  it('jeonseRatio: 항상 양수지만 값에 따라 색이 달라진다', () => {
    const lo = scaleColor(0.42, SIGNAL_DOMAIN.jeonseRatio, 'global');
    const hi = scaleColor(0.84, SIGNAL_DOMAIN.jeonseRatio, 'global');
    expect(lo).not.toBe(hi);
    // signColor 였다면 둘 다 상승색으로 같았을 것
    expect(signColor(0.42, 'global')).toBe(signColor(0.84, 'global'));
  });

  it('volumeRatio: 거래 절벽(0.3배)과 급증(3배)이 다른 색', () => {
    expect(scaleColor(0.3, SIGNAL_DOMAIN.volumeRatio, 'global'))
      .not.toBe(scaleColor(3, SIGNAL_DOMAIN.volumeRatio, 'global'));
  });

  it('high52wPct: 0(신고가)이 상승색 쪽, -30 이 하락색 쪽', () => {
    const atHigh = scaleColor(0, SIGNAL_DOMAIN.high52wPct, 'global');
    const deep = scaleColor(-30, SIGNAL_DOMAIN.high52wPct, 'global');
    expect(atHigh).toBe(colors('global').up);
    expect(deep).toBe(colors('global').down);
    // signColor 였다면 신고가(0)도 음수 구간도 전부 한 색이었을 것
  });

  it('도메인 밖은 클램프 — 극단값이 색을 깨지 않는다', () => {
    const d = SIGNAL_DOMAIN.momentum6;
    expect(scaleColor(999, d, 'global')).toBe(scaleColor(d.max, d, 'global'));
    expect(scaleColor(-999, d, 'global')).toBe(scaleColor(d.min, d, 'global'));
  });

  it('양극형 시그널은 korea 모드에서 반전된다', () => {
    const d = SIGNAL_DOMAIN.momentum6;
    expect(scaleColor(20, d, 'global')).toBe(colors('global').up);
    expect(scaleColor(20, d, 'korea')).toBe(colors('korea').up);
    expect(scaleColor(20, d, 'global')).not.toBe(scaleColor(20, d, 'korea'));
  });

  it('강도형 시그널은 korea 모드에서 반전되지 않는다 (좋고 나쁨이 없다)', () => {
    for (const k of ['volumeRatio', 'jeonseRatio'] as const) {
      const d = SIGNAL_DOMAIN[k];
      expect(scaleColor(d.max, d, 'global')).toBe(scaleColor(d.max, d, 'korea'));
    }
  });

  it('mid 는 중립색 — 상승색도 하락색도 아니다', () => {
    const d = SIGNAL_DOMAIN.momentum6;
    const midC = scaleColor(d.mid, d, 'global');
    expect(midC).not.toBe(colors('global').up);
    expect(midC).not.toBe(colors('global').down);
  });
});

describe('SIGNAL_DOMAIN', () => {
  it('7개 시그널이 전부 정의돼 있다', () => {
    expect(Object.keys(SIGNAL_DOMAIN)).toHaveLength(7);
  });
  it('모든 도메인이 min < mid <= max', () => {
    for (const [k, d] of Object.entries(SIGNAL_DOMAIN)) {
      expect(d.min, k).toBeLessThan(d.mid);
      expect(d.mid, k).toBeLessThanOrEqual(d.max);
    }
  });
});

describe('legendStops', () => {
  it('눈금 5개에 실제 숫자와 색이 함께 온다', () => {
    const s = legendStops(SIGNAL_DOMAIN.jeonseRatio, 'global');
    expect(s).toHaveLength(5);
    expect(s[0].value).toBe(0.4);
    expect(s[4].value).toBe(0.85);
    expect(s[0].color).not.toBe(s[4].color);
  });
});
