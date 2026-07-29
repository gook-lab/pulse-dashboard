// Squarified treemap (Bruls, Huizing, van Wijk 2000).
// 시총(value) 비례로 사각형을 채우되 정사각형에 가깝게 배치 → Finviz 맵 느낌.

export interface Rect { x: number; y: number; w: number; h: number; }
export interface Tile<T> extends Rect { item: T; }

function worstRatio(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = sum * sum;
  return Math.max((side * side * max) / s2, s2 / (side * side * min));
}

/** value 비례로 items를 rect 안에 squarified 배치. */
export function treemap<T>(items: T[], value: (t: T) => number, rect: Rect): Tile<T>[] {
  const total = items.reduce((s, it) => s + Math.max(0, value(it)), 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const data = items
    .map((it) => ({ item: it, area: Math.max(0, value(it)) * scale }))
    .filter((d) => d.area > 0)
    .sort((a, b) => b.area - a.area);

  const out: Tile<T>[] = [];
  let { x, y, w, h } = rect;
  let i = 0;

  while (i < data.length) {
    const shorter = Math.min(w, h);
    const rowStart = i;
    let best = Infinity;
    // worst-ratio가 개선되는 동안 행에 타일을 추가.
    while (i < data.length) {
      const areas = data.slice(rowStart, i + 1).map((d) => d.area);
      const wst = worstRatio(areas, shorter);
      if (wst <= best) { best = wst; i++; } else break;
    }
    const row = data.slice(rowStart, i);
    const rowArea = row.reduce((s, d) => s + d.area, 0);

    if (w >= h) {
      const stripW = rowArea / h;
      let yy = y;
      for (const d of row) {
        const tileH = d.area / stripW;
        out.push({ item: d.item, x, y: yy, w: stripW, h: tileH });
        yy += tileH;
      }
      x += stripW; w -= stripW;
    } else {
      const stripH = rowArea / w;
      let xx = x;
      for (const d of row) {
        const tileW = d.area / stripH;
        out.push({ item: d.item, x: xx, y, w: tileW, h: stripH });
        xx += tileW;
      }
      y += stripH; h -= stripH;
    }
  }
  return out;
}
