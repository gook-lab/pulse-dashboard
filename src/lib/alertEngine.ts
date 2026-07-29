import type { PriceAlert } from '@/data/types';

/**
 * 알림 평가 함수.
 * 현재 시세와 알림 설정을 비교하여 발화 여부 판정.
 */
export function evaluate(
  alert: PriceAlert,
  quote: { price: number; changePct: number }
): boolean {
  switch (alert.kind) {
    case 'target-above':
      return quote.price >= alert.value;

    case 'target-below':
      return quote.price <= alert.value;

    case 'move-pct':
      if (alert.value > 0) {
        return quote.changePct >= alert.value;
      } else {
        return quote.changePct <= alert.value;
      }

    case 'high52':
      // baseline이 없으면 false (기준점 미설정)
      if (alert.baseline === undefined) return false;
      return quote.price > alert.baseline;

    default:
      return false;
  }
}
