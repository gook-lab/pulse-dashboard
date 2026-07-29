/**
 * PriceChart 계산 헬퍼 함수들
 * 순수 함수로 분리하여 테스트 가능하게 함
 */

export interface CompareSeries {
  name: string;
  data: (number | null)[];
  color: string;
}

export interface MinMax {
  min: number;
  max: number;
}

export interface Padding {
  l: number;
  r: number;
  t: number;
  b: number;
}

export interface PathConfig {
  data: (number | null)[];
  n: number;
  minMax: MinMax;
  pad: Padding;
  w: number;
  height: number;
}

/**
 * 메인 데이터와 비교 시리즈로부터 min/max를 계산
 * null 값은 제외하고, compareSeries도 포함
 */
export function calcMinMax(
  data: (number | null)[],
  compareSeries?: CompareSeries[]
): MinMax {
  const allValues: number[] = [];

  // 메인 데이터에서 null 제외
  for (const v of data) {
    if (v != null) allValues.push(v);
  }

  // compareSeries에서 null 제외
  if (compareSeries) {
    for (const cs of compareSeries) {
      for (const v of cs.data) {
        if (v != null) allValues.push(v);
      }
    }
  }

  if (allValues.length === 0) {
    return { min: 0, max: 1 };
  }

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);

  return { min, max };
}

/**
 * 좌표를 계산하는 헬퍼
 */
function calcX(i: number, n: number, pad: Padding, w: number): number {
  return pad.l + ((w - pad.l - pad.r) * i) / Math.max(1, n - 1);
}

function calcY(
  v: number | null,
  minMax: MinMax,
  pad: Padding,
  height: number
): number {
  if (v == null) return pad.t;
  const span = minMax.max - minMax.min || 1;
  return pad.t + (height - pad.t - pad.b) * (1 - (v - minMax.min) / span);
}

/**
 * 데이터로부터 SVG 경로를 생성
 * null 구간은 라인을 끊는다
 */
export function pathFromData(config: PathConfig): string {
  const { data, n, minMax, pad, w, height } = config;

  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (v == null) continue;
    const resume = parts.length === 0 || i === 0 || data[i - 1] == null;
    const x = calcX(i, n, pad, w);
    const y = calcY(v, minMax, pad, height);
    parts.push(`${resume ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return parts.join(' ');
}

/**
 * compareSeries 하나로부터 경로를 생성
 */
export function pathFromCompareSeries(config: PathConfig): string {
  return pathFromData(config);
}
