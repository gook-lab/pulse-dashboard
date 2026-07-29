import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { signColor } from '../../lib/colors';
import { Badge, MarketChip, Segmented, SkeletonRows, ErrorState } from '@/components/common';
import type { ColorMode } from '../../lib/colors';
import type { RankingItem } from '../../data/types';

type Kind = 'up' | 'down' | 'volume' | 'amount';
type KrMarket = 'all' | 'kospi' | 'kosdaq';

const KINDS: { value: Kind; label: string }[] = [
  { value: 'up', label: '급상승' },
  { value: 'down', label: '급하락' },
  { value: 'volume', label: '거래량' },
  { value: 'amount', label: '거래대금' },
];

const MARKETS: { value: KrMarket; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'kospi', label: '코스피' },
  { value: 'kosdaq', label: '코스닥' },
];

import { fmtVol, fmtAmt } from '../../lib/format';

interface RankingState {
  items: RankingItem[] | null; // null=loading, []=error
  loading: boolean;
  error: boolean;
}

export default function RankingBoard() {
  const colorMode = useStore((st) => st.colorMode);
  const selectStock = useStore((st) => st.selectStock);
  const refreshRanking = useStore((st) => st.refreshRanking);
  const [kind, setKind] = useState<Kind>('up');
  const [market, setMarket] = useState<KrMarket>('all');
  const [state, setState] = useState<RankingState>({ items: null, loading: true, error: false });
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 폴링 함수 (15초, document.hidden 체크)
  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (document.hidden) return;
      try {
        const items = await refreshRanking(kind, market);
        if (alive) {
          setState({ items, loading: false, error: false });
        }
      } catch {
        if (alive) {
          setState((prev) => ({ ...prev, loading: false, error: true }));
        }
      }
    };

    // 초기 로드
    load();

    // 15초 폴링
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(() => load(), 15_000);

    // visibility 변화 감지
    const onVisibilityChange = () => {
      if (!document.hidden && pollIntervalRef.current) {
        load(); // 탭이 다시 활성화되면 즉시 갱신
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      alive = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [kind, market, refreshRanking]);

  const handleRowClick = (item: RankingItem) => {
    selectStock(item.code, { name: item.name, market: 'KR', changePct: item.changePct });
  };

  // 초기 로드 또는 에러
  if (state.items === null && state.loading) {
    return (
      <section className="card">
        <div className="card-h">
          <h3 className="text-title">실시간 랭킹</h3>
        </div>
        <SkeletonRows rows={10} />
      </section>
    );
  }

  if (state.error || (state.items !== null && state.items.length === 0 && !state.loading)) {
    return (
      <section className="card">
        <div className="card-h">
          <h3 className="text-title">실시간 랭킹</h3>
        </div>
        <ErrorState desc="순위 데이터를 불러올 수 없습니다." onRetry={() => setState({ items: null, loading: true, error: false })} />
      </section>
    );
  }

  const items = state.items ?? [];

  return (
    <section className="card">
      <div className="card-h">
        <h3 className="text-title">실시간 랭킹</h3>
        <span className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand)', boxShadow: '0 0 4px var(--brand)', opacity: 0.7 }} />
          15초 갱신
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Segmented options={KINDS} value={kind} onChange={setKind} />
        <Segmented
          options={MARKETS}
          value={market}
          onChange={setMarket}
        />
      </div>

      {/* 순위 테이블 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
        {items.map((item) => (
          <RankingRow
            key={item.code}
            item={item}
            colorMode={colorMode}
            kind={kind}
            onClick={() => handleRowClick(item)}
          />
        ))}
      </div>
    </section>
  );
}

interface RankingRowProps {
  item: RankingItem;
  colorMode: ColorMode;
  kind: Kind;
  onClick: () => void;
}

function RankingRow({ item, colorMode, kind, onClick }: RankingRowProps) {
  const { rank, code, name, price, changePct, volume, amount } = item;

  // 순위 1-3 강조 (브랜드 톤 통일)
  const rankBg = rank <= 3 ? 'rgba(124, 108, 255, 0.12)' : 'transparent';
  const rankColor = rank <= 3 ? 'var(--brand)' : 'var(--text-sub)';

  // 거래량/대금 표시
  const metric = kind === 'volume' ? (volume ? fmtVol(volume) : '-') : kind === 'amount' ? (amount ? fmtAmt(amount) : '-') : '-';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-line)',
        cursor: 'pointer',
        backgroundColor: rankBg,
        transition: 'background-color 0.2s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = `${rankBg}rgba(255,255,255,0.05)`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = rankBg;
      }}
    >
      {/* 순위 */}
      <div style={{ width: 30, textAlign: 'center', color: rankColor, fontSize: 13, fontWeight: 700 }}>
        {rank}
      </div>

      {/* 시장 칩 */}
      <div style={{ width: 40, display: 'flex', justifyContent: 'center' }}>
        <MarketChip market="KR" />
      </div>

      {/* 종목명·코드 */}
      <div style={{ flex: 1, paddingLeft: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-base)' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>{code}</div>
      </div>

      {/* 현재가 */}
      <div style={{ width: 80, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>
        {price.toLocaleString('ko-KR')}
      </div>

      {/* 등락률 + 거래량/대금 */}
      <div style={{ width: 120, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        <Badge color={signColor(changePct, colorMode)}>
          {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
        </Badge>
        <div style={{ fontSize: 11, color: 'var(--text-sub)', minWidth: 50, textAlign: 'right' }}>{metric}</div>
      </div>
    </motion.div>
  );
}
