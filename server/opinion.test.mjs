import { describe, it, expect } from 'vitest';
import {
  momentumScore, rangeScore, valuationScore, sentimentScore,
  blend, stance, buildOpinion,
} from './opinion.mjs';

describe('개별 점수', () => {
  it('모멘텀: 0%면 중립 50, ±20%가 양 끝', () => {
    expect(momentumScore(0)).toBe(50);
    expect(momentumScore(20)).toBe(100);
    expect(momentumScore(-20)).toBe(0);
    expect(momentumScore(40)).toBe(100);   // clamp
  });

  it('52주 위치: 저가=0, 고가=100', () => {
    expect(rangeScore(100, 100, 200)).toBe(0);
    expect(rangeScore(200, 100, 200)).toBe(100);
    expect(rangeScore(150, 100, 200)).toBe(50);
  });

  it('52주 범위가 무의미하면 null', () => {
    expect(rangeScore(150, 200, 200)).toBeNull();
    expect(rangeScore(150, NaN, 200)).toBeNull();
  });

  it('밸류에이션: 적자(음수 PER)는 0', () => {
    expect(valuationScore(-5)).toBe(0);
    expect(valuationScore(10)).toBe(100);
    expect(valuationScore(40)).toBe(0);
  });

  it('뉴스가 없으면 null — 중립 50으로 채우지 않는다', () => {
    expect(sentimentScore(0, 0)).toBeNull();
    expect(sentimentScore(3, 1)).toBe(75);
  });
});

describe('blend', () => {
  it('없는 항목은 빼고 남은 것만 가중평균', () => {
    // 모멘텀만 있으면 그 값이 곧 점수
    expect(blend({ momentum: 80, range: null, valuation: null, sentiment: null }).score).toBe(80);
  });

  it('전부 없으면 null — 점수를 지어내지 않는다', () => {
    expect(blend({ momentum: null, range: null, valuation: null, sentiment: null })).toBeNull();
  });

  it('가중치가 반영된다(모멘텀 0.35 > 밸류 0.15)', () => {
    const a = blend({ momentum: 100, valuation: 0 }).score;   // 0.35/0.5 = 70
    expect(a).toBe(70);
  });
});

describe('stance', () => {
  it('구간별 문구', () => {
    expect(stance(80)).toBe('매수 우위');
    expect(stance(60)).toBe('완만한 매수');
    expect(stance(50)).toBe('중립');
    expect(stance(35)).toBe('완만한 매도');
    expect(stance(10)).toBe('매도 우위');
  });
});

describe('buildOpinion', () => {
  const closes = Array.from({ length: 21 }, (_, i) => 100 + i);   // 100 → 120, +20%

  it('실측에서 점수·근거를 낸다', () => {
    const r = buildOpinion({
      closes, price: 120, low52: 80, high52: 130, per: 12, newsGood: 3, newsBad: 1,
    });
    expect(r.score).toBeGreaterThan(60);
    expect(r.stance).toBeTruthy();
    expect(r.parts.momentum).toBe(100);       // +20%
    expect(r.bull.length).toBeGreaterThan(0);
  });

  it('근거 문장이 실제 잰 숫자를 인용한다', () => {
    const r = buildOpinion({
      closes, price: 120, low52: 80, high52: 130, per: 12, newsGood: 3, newsBad: 1,
    });
    expect(r.bull.join(' ')).toContain('+20.0%');   // 20일 수익률
    expect(r.bull.join(' ')).toContain('12');       // PER
    expect(r.bull.join(' ')).toContain('3건');      // 호재 건수
  });

  it('입력이 하나도 없으면 null → 화면은 "-"', () => {
    expect(buildOpinion({ closes: [], price: NaN, low52: NaN, high52: NaN, per: NaN })).toBeNull();
  });

  it('종가가 21개 미만이면 모멘텀을 빼고 계산한다', () => {
    const r = buildOpinion({ closes: [100, 101], price: 120, low52: 80, high52: 130, per: 12 });
    expect(r.parts.momentum).toBeNull();
    expect(r.score).toBeGreaterThan(0);
  });

  it('하락·고PER·악재면 낮은 점수와 bear 근거', () => {
    const down = Array.from({ length: 21 }, (_, i) => 120 - i);   // -16.7%
    const r = buildOpinion({
      closes: down, price: 100, low52: 95, high52: 200, per: 55, newsGood: 0, newsBad: 4,
    });
    expect(r.score).toBeLessThan(40);
    expect(r.bear.length).toBeGreaterThan(0);
    expect(r.bear.join(' ')).toContain('악재 4건');
  });
});
