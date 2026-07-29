import Modal from './Modal';
import Button from './Button';

// viviane 패턴 참고: 확인/취소 다이얼로그. 파괴적 액션은 danger.
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  desc?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open, onOpenChange, title, desc,
  confirmLabel = '확인', cancelLabel = '취소', danger, onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} desc={desc} width={400}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onOpenChange(false); }}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
