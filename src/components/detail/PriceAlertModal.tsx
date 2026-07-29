import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { Modal, Button, Segmented } from '@/components/common';
import toast from '@/lib/toast';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  code: string;
  name: string;
  market: 'KR' | 'US';
  high52?: number;  // 52주 최고가 — detail.high52
}

export default function PriceAlertModal({ open, onOpenChange, code, name, market, high52 }: Props) {
  const alerts = useStore((s) => s.alerts);
  const addAlert = useStore((s) => s.addAlert);
  const removeAlert = useStore((s) => s.removeAlert);
  const detail = useStore((s) => s.detail);

  const [kind, setKind] = useState<'target-above' | 'target-below' | 'move-pct' | 'high52'>('target-above');
  const [targetPrice, setTargetPrice] = useState('');
  const [movePct, setMovePct] = useState('');

  const codeAlerts = alerts.filter((a) => a.code === code);
  const currentPrice = detail?.price ?? 0;

  // 조건별 유효성 검사
  const isValidTargetPrice = targetPrice && !isNaN(Number(targetPrice)) && Number(targetPrice) > 0;
  const isValidMovePct = movePct && !isNaN(Number(movePct)) && Math.abs(Number(movePct)) >= 1 && Math.abs(Number(movePct)) <= 30;
  const canSave = kind === 'high52' ? true : kind === 'move-pct' ? isValidMovePct : isValidTargetPrice;

  const handleSave = () => {
    if (!canSave) return;

    if (kind === 'target-above' || kind === 'target-below') {
      const value = Number(targetPrice);
      addAlert({ code, name, market, kind, value });
    } else if (kind === 'move-pct') {
      const value = Number(movePct);
      addAlert({ code, name, market, kind, value });
    } else if (kind === 'high52') {
      const baseline = high52 || detail?.high52 || 0;
      if (!baseline) {
        toast.error({ message: '52주 최고가 정보가 없습니다.' });
        return;
      }
      addAlert({ code, name, market, kind, value: 0, baseline });
    }

    onOpenChange(false);
  };

  const handleRemoveAlert = (id: string) => {
    removeAlert(id);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`${name} 가격 알림`} width={480}>
      <div className="space-y-4">
        {/* 조건 선택 */}
        <div>
          <label className="block text-sm font-semibold text-fg mb-2">알림 조건</label>
          <Segmented
            options={[
              { label: '목표가 이상', value: 'target-above' },
              { label: '목표가 이하', value: 'target-below' },
              { label: '등락률', value: 'move-pct' },
              { label: '52주 신고가', value: 'high52' },
            ]}
            value={kind}
            onChange={(v) => {
              setKind(v as typeof kind);
              setTargetPrice('');
              setMovePct('');
            }}
          />
        </div>

        {/* 목표가 입력 */}
        {(kind === 'target-above' || kind === 'target-below') && (
          <div>
            <label className="block text-sm font-semibold text-fg mb-2">
              목표가 {kind === 'target-above' ? '이상' : '이하'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step={1}
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder={`현재: ${currentPrice.toLocaleString()}`}
                className="flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-fg focus:border-brand focus:outline-none"
              />
              <span className="text-sm text-sub">₩</span>
            </div>
            {targetPrice && !isValidTargetPrice && (
              <p className="text-xs text-red-400 mt-1">유효한 가격을 입력하세요</p>
            )}
          </div>
        )}

        {/* 등락률 입력 */}
        {kind === 'move-pct' && (
          <div>
            <label className="block text-sm font-semibold text-fg mb-2">등락률 (±1~30%)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step={0.1}
                min={-30}
                max={30}
                value={movePct}
                onChange={(e) => setMovePct(e.target.value)}
                placeholder="양수는 상승, 음수는 하락"
                className="flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-fg focus:border-brand focus:outline-none"
              />
              <span className="text-sm text-sub">%</span>
            </div>
            {movePct && !isValidMovePct && (
              <p className="text-xs text-red-400 mt-1">-30 ~ 30 범위의 값을 입력하세요</p>
            )}
          </div>
        )}

        {/* 52주 신고가 */}
        {kind === 'high52' && (
          <div className="p-3 rounded-lg bg-panel2 border border-line">
            <p className="text-sm text-sub">
              52주 최고가{' '}
              {high52 || detail?.high52 ? (
                <span className="text-fg font-semibold">
                  ₩{(high52 || detail?.high52 || 0).toLocaleString()}
                </span>
              ) : (
                <span className="text-red-400">정보 없음</span>
              )}{' '}
              을 초과할 때 알림을 받습니다.
            </p>
          </div>
        )}

        {/* 활성 알림 목록 */}
        {codeAlerts.length > 0 && (
          <div className="border-t border-line pt-4">
            <label className="block text-sm font-semibold text-fg mb-2">활성 알림</label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {codeAlerts.map((alert) => (
                <div key={alert.id} className="flex items-center justify-between p-2 rounded-lg bg-panel2 border border-line">
                  <span className="text-sm text-sub">
                    {alert.kind === 'target-above' && `목표가 이상: ₩${alert.value.toLocaleString()}`}
                    {alert.kind === 'target-below' && `목표가 이하: ₩${alert.value.toLocaleString()}`}
                    {alert.kind === 'move-pct' && `등락률: ${alert.value > 0 ? '+' : ''}${alert.value}%`}
                    {alert.kind === 'high52' && `52주 신고가 초과`}
                  </span>
                  <button
                    onClick={() => handleRemoveAlert(alert.id)}
                    className="text-xs px-2 py-1 rounded bg-panel border border-line text-sub hover:text-fg transition-colors"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="subtle" onClick={() => onOpenChange(false)}>
          닫기
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          알림 저장
        </Button>
      </div>
    </Modal>
  );
}
