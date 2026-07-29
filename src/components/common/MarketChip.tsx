import type { Market } from '../../data/types';

// 시안의 마켓 칩(국기 이모지 대체). Windows 국기 깨짐 방지 + 타이포 일관.
const STYLES: Record<Market, { color: string; bg: string; border: string; label: string }> = {
  US: { color: '#7CA7FF', bg: 'rgba(76,130,251,0.16)', border: 'rgba(76,130,251,0.3)', label: 'US' },
  KR: { color: '#E9B44A', bg: 'rgba(233,180,74,0.14)', border: 'rgba(233,180,74,0.28)', label: 'KR' },
};

export default function MarketChip({ market }: { market: Market }) {
  const st = STYLES[market];
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 800, lineHeight: 1, letterSpacing: 0.3,
        padding: '1px 5px', borderRadius: 5,
        color: st.color, background: st.bg, border: `1px solid ${st.border}`,
      }}
    >
      {st.label}
    </span>
  );
}
