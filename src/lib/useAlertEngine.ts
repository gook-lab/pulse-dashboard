import { useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { evaluate } from './alertEngine';
import toast from './toast';

/**
 * 가격 알림 전역 폴링 엔진.
 * 30초마다 활성 알림의 종목 시세를 배치 조회하고 평가한다.
 * document.hidden이면 폴링을 중단한다.
 */
export function useAlertEngine() {
  const alerts = useStore((s) => s.alerts);

  useEffect(() => {
    if (alerts.length === 0) return; // 알림이 없으면 폴링 불필요

    let intervalId: number | undefined;

    async function poll() {
      // document.hidden이면 스킵 (탭이 비활성)
      if (document.hidden) return;

      try {
        const krCodes = alerts.filter((a) => a.market === 'KR').map((a) => a.code);
        const usSymbols = alerts.filter((a) => a.market === 'US').map((a) => a.code);

        const [krQuotes, usQuotes] = await Promise.all([
          krCodes.length ? fetch(`/api/kr/quotes?codes=${krCodes.join(',')}`).then((r) => r.json()) : Promise.resolve({}),
          usSymbols.length ? fetch(`/api/us/quotes?symbols=${usSymbols.join(',')}`).then((r) => r.json()) : Promise.resolve({}),
        ]) as [Record<string, { price: number; changePct: number } | null>, Record<string, { price: number; changePct: number } | null>];

        // 현재 상태의 알림 다시 조회 (그 사이 removeAlert 될 수 있음)
        const currentAlerts = useStore.getState().alerts;

        for (const alert of currentAlerts) {
          const quote = alert.market === 'KR' ? krQuotes?.[alert.code] : usQuotes?.[alert.code];
          if (!quote) continue; // 시세 없으면 스킵

          if (evaluate(alert, quote)) {
            // 발화!
            const conditionDesc = getConditionDesc(alert, quote);
            toast.info({
              message: `${alert.name} ${conditionDesc}`,
              duration: 3000,
            });

            // 알림 센터에 기록
            useStore.getState().pushNotification({
              kind: 'price',
              title: `${alert.name} 가격 알림`,
              desc: conditionDesc,
              code: alert.code,
              read: false,
            });

            // 해당 알림 즉시 삭제 (1회성)
            useStore.getState().removeAlert(alert.id);
          }
        }
      } catch (err) {
        // 폴링 실패는 조용히 무시 (스로틀 등 일시적 실패 가능)
        console.debug('[useAlertEngine] poll error:', err);
      }
    }

    // 초기 한 번 실행
    void poll();

    // 30초마다 폴링
    intervalId = window.setInterval(() => {
      void poll();
    }, 30_000);

    // visibility 변경 감지 — hidden → visible로 돌아올 때 즉시 폴링
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void poll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalId !== undefined) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [alerts]);
}

function getConditionDesc(alert: { kind: string; value: number; baseline?: number }, quote: { price: number; changePct: number }): string {
  switch (alert.kind) {
    case 'target-above':
      return `목표가 이상 도달 (${quote.price.toLocaleString()})`;
    case 'target-below':
      return `목표가 이하 도달 (${quote.price.toLocaleString()})`;
    case 'move-pct':
      return `${alert.value > 0 ? '상승' : '하락'} ${Math.abs(alert.value)}% 도달 (${quote.changePct.toFixed(2)}%)`;
    case 'high52':
      return `52주 신고가 돌파 (${quote.price.toLocaleString()})`;
    default:
      return '조건 도달';
  }
}
