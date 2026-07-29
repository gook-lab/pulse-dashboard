import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from './formatRelativeTime';

describe('formatRelativeTime', () => {
  const now = Date.now();

  it('방금 전 (30초 미만)', () => {
    const ts = now - 15 * 1000; // 15초 전
    expect(formatRelativeTime(ts)).toBe('방금 전');
  });

  it('분 단위 (1분)', () => {
    const ts = now - 1 * 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('1분 전');
  });

  it('분 단위 (30분)', () => {
    const ts = now - 30 * 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('30분 전');
  });

  it('시간 단위 (1시간)', () => {
    const ts = now - 1 * 60 * 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('1시간 전');
  });

  it('시간 단위 (12시간)', () => {
    const ts = now - 12 * 60 * 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('12시간 전');
  });

  it('어제', () => {
    const ts = now - 24 * 60 * 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('어제');
  });

  it('며칠 전 (3일)', () => {
    const ts = now - 3 * 24 * 60 * 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('3일 전');
  });

  it('7일 이상: 날짜 포맷', () => {
    const ts = now - 10 * 24 * 60 * 60 * 1000;
    const result = formatRelativeTime(ts);
    // 날짜 포맷은 YYYY-MM-DD
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
