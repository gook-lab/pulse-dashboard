import { describe, it, expect } from 'vitest';
import { treemap } from './treemap';

interface Item { name: string; w: number; }
const rect = { x: 0, y: 0, w: 400, h: 300 };
const items: Item[] = [
  { name: 'a', w: 50 }, { name: 'b', w: 30 }, { name: 'c', w: 12 }, { name: 'd', w: 5 }, { name: 'e', w: 3 },
];

describe('treemap (squarified)', () => {
  const tiles = treemap(items, (t) => t.w, rect);

  it('모든 양수 항목이 타일로', () => {
    expect(tiles).toHaveLength(items.length);
  });

  it('모든 타일이 rect 경계 안에', () => {
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-6);
      expect(t.y).toBeGreaterThanOrEqual(-1e-6);
      expect(t.x + t.w).toBeLessThanOrEqual(rect.w + 1e-6);
      expect(t.y + t.h).toBeLessThanOrEqual(rect.h + 1e-6);
    }
  });

  it('타일 면적 합 ≈ rect 면적', () => {
    const sum = tiles.reduce((s, t) => s + t.w * t.h, 0);
    expect(sum).toBeCloseTo(rect.w * rect.h, 3);
  });

  it('가중치가 클수록 면적이 큼', () => {
    const area = (n: string) => { const t = tiles.find((x) => x.item.name === n)!; return t.w * t.h; };
    expect(area('a')).toBeGreaterThan(area('b'));
    expect(area('b')).toBeGreaterThan(area('c'));
    expect(area('c')).toBeGreaterThan(area('d'));
  });

  it('면적은 가중치에 비례', () => {
    const t = tiles.find((x) => x.item.name === 'a')!;
    const total = items.reduce((s, i) => s + i.w, 0);
    const expected = (50 / total) * rect.w * rect.h;
    expect(t.w * t.h).toBeCloseTo(expected, 2);
  });

  it('빈 입력·0 면적 rect는 빈 배열', () => {
    expect(treemap([], (t: Item) => t.w, rect)).toEqual([]);
    expect(treemap(items, (t) => t.w, { x: 0, y: 0, w: 0, h: 100 })).toEqual([]);
  });
});
