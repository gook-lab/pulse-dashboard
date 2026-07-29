import Badge from './Badge';
import { signColor, type ColorMode } from '../../lib/colors';

/** 호재/악재 근거 리스트 — 제목은 Badge(signColor), 항목 앞 4px 점, 본문은 sub. */
export default function ReasonList({ label, items, sign, mode }: { label: string; items: string[]; sign: 1 | -1; mode: ColorMode }) {
  const color = signColor(sign, mode);
  return (
    <div>
      <div style={{ marginBottom: 9 }}><Badge color={color}>{label}</Badge></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {items.map((x, i) => (
          <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--text-sub)', lineHeight: 1.5 }}>
            <span style={{ flex: 'none', width: 4, height: 4, borderRadius: '50%', background: color, marginTop: 7 }} />
            <span>{x}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
