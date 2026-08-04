import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Button, EmptyState, Modal, ConfirmDialog, Segmented } from '@/components/common';
import type { ManualAsset } from '../../data/types';

const KIND_OPTS: { value: ManualAsset['kind']; label: string }[] = [
  { value: 'cash', label: '현금' },
  { value: 'deposit', label: '보증금·예치금' },
  { value: 'realestate', label: '부동산' },
  { value: 'other', label: '기타' },
];
const KIND_LABEL = Object.fromEntries(KIND_OPTS.map((o) => [o.value, o.label]));

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

interface Draft { id?: string; name: string; kind: ManualAsset['kind']; amount: string; note: string }
const EMPTY: Draft = { name: '', kind: 'cash', amount: '', note: '' };

// 프로젝트에 전역 input 클래스가 없다 — Tailwind 토큰 매핑(bg-panel2·border-line 등)으로 통일.
const INPUT_CLS = 'w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-fg outline-none focus:border-brand';

/**
 * 수동 자산(W2) — 홈 순자산의 KIS 밖 부분. 정의는 여기서 편집하고,
 * 값은 서버 일일 스냅샷이 합산해 시계열로 남긴다. 홈에는 편집 UI를 두지 않는다(설계 확정).
 */
export default function ManualAssets() {
  const manualAssets = useStore((st) => st.manualAssets);
  const loadHome = useStore((st) => st.loadHome);
  const saveManualAsset = useStore((st) => st.saveManualAsset);
  const deleteManualAsset = useStore((st) => st.deleteManualAsset);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<ManualAsset | null>(null);
  const [saving, setSaving] = useState(false);

  // 포트폴리오 탭에 직접 진입한 경우에도 목록이 비어 보이지 않게.
  useEffect(() => { if (!manualAssets.length) void loadHome(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = manualAssets.reduce((a, x) => a + x.amount, 0);
  const amountNum = draft ? Math.round(+draft.amount.replace(/[^0-9]/g, '')) : 0;
  const valid = !!draft && draft.name.trim().length > 0 && amountNum > 0;

  const submit = async () => {
    if (!draft || !valid) return;
    setSaving(true);
    const ok = await saveManualAsset({
      id: draft.id, name: draft.name.trim(), kind: draft.kind, amount: amountNum,
      note: draft.note.trim() || undefined,
    });
    setSaving(false);
    if (ok) setDraft(null);
  };

  return (
    <section className="card">
      <div className="card-h">
        <span className="t">수동 자산</span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {total > 0 && <span className="tag mono">합계 {won(total)}</span>}
          <Button size="sm" variant="subtle" onClick={() => setDraft(EMPTY)}>+ 자산 추가</Button>
        </span>
      </div>
      {manualAssets.length ? (
        <div>
          {manualAssets.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 2px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span className="tag">{KIND_LABEL[a.kind]}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {a.name}
                {a.note && <span style={{ color: 'var(--text-mut)', fontSize: 11 }}> · {a.note}</span>}
              </span>
              <span className="mono" style={{ fontWeight: 600 }}>{won(a.amount)}</span>
              <Button size="sm" variant="ghost" onClick={() => setDraft({ id: a.id, name: a.name, kind: a.kind, amount: String(a.amount), note: a.note ?? '' })}>수정</Button>
              <Button size="sm" variant="ghost" onClick={() => setRemoving(a)}>삭제</Button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="수동 자산 없음" desc="타행 예금·보증금·실보유 부동산을 입력하면 홈 순자산에 합산됩니다." />
      )}

      <Modal
        open={!!draft}
        onOpenChange={(v) => { if (!v) setDraft(null); }}
        title={draft?.id ? '자산 수정' : '자산 추가'}
        desc="여기 입력한 금액은 홈 순자산과 일일 스냅샷 시계열에 합산됩니다."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>취소</Button>
            <Button variant="primary" loading={saving} disabled={!valid} onClick={submit}>{draft?.id ? '수정' : '추가'}</Button>
          </>
        }
      >
        {draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Segmented options={KIND_OPTS} value={draft.kind} onChange={(kind) => setDraft({ ...draft, kind })} />
            <label style={{ fontSize: 12, color: 'var(--text-sub)' }}>
              이름
              <input
                className={INPUT_CLS} value={draft.name} maxLength={40} placeholder="예: 전세 보증금"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                style={{ display: 'block', width: '100%', marginTop: 4 }}
              />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-sub)' }}>
              금액(원)
              <input
                className={INPUT_CLS + ' mono'} inputMode="numeric" value={draft.amount} placeholder="200000000"
                onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(/[^0-9]/g, '') })}
                style={{ display: 'block', width: '100%', marginTop: 4 }}
              />
              {amountNum > 0 && <span style={{ fontSize: 11, color: 'var(--text-mut)' }}>{won(amountNum)}</span>}
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-sub)' }}>
              메모(선택)
              <input
                className={INPUT_CLS} value={draft.note} maxLength={120} placeholder="예: 만기 2027-03"
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                style={{ display: 'block', width: '100%', marginTop: 4 }}
              />
            </label>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => { if (!v) setRemoving(null); }}
        title="자산 삭제"
        desc={removing ? `'${removing.name}' (${won(removing.amount)})을(를) 삭제합니다. 순자산에서 즉시 빠집니다.` : undefined}
        confirmLabel="삭제"
        danger
        onConfirm={() => { if (removing) void deleteManualAsset(removing.id); }}
      />
    </section>
  );
}
