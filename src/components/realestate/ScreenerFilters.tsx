import { useRef } from 'react';
import { useStore } from '@/store/useStore';
import { Segmented } from '@/components/common';
import type { SignalKey, DealType, AreaTier } from '@/data/types';
import s from './ScreenerFilters.module.css';

/**
 * 필터 패널 — 시그널/거래유형/최소거래 선택
 * 가격 그룹 선택 시 2행 세부 신호(3/6/12개월/신고가) 표시
 */
export default function ScreenerFilters() {
  const query = useStore((st) => st.screenerQuery);
  const screen = useStore((st) => st.aptScreen);
  const setScreenerQuery = useStore((st) => st.setScreenerQuery);

  // 가격 그룹 시 기억할 세부 신호 (컴포넌트 로컬)
  const priceSignalRef = useRef<'momentum3' | 'momentum6' | 'momentum12' | 'high52wPct'>('momentum6');

  // 현재 신호가 가격 그룹인지 판단
  const isPriceSignal = (signal: SignalKey): signal is 'momentum3' | 'momentum6' | 'momentum12' | 'high52wPct' =>
    ['momentum3', 'momentum6', 'momentum12', 'high52wPct'].includes(signal);

  const isCurrentlyPriceGroup = isPriceSignal(query.signal);

  // 신호 그룹 선택 — 가격 그룹은 기억된 세부 신호로 복원
  const handleSignalGroupChange = (group: 'price' | 'volume' | 'jeonse' | 'rs') => {
    let signal: SignalKey;
    switch (group) {
      case 'price':
        signal = priceSignalRef.current;
        break;
      case 'volume':
        signal = 'volumeRatio';
        break;
      case 'jeonse':
        signal = 'jeonseRatio';
        break;
      case 'rs':
        signal = 'rs';
        break;
    }
    setScreenerQuery({ signal });
  };

  // 가격 세부 신호 선택 — 기억하고 쿼리에 반영
  const handlePriceSignalChange = (signal: 'momentum3' | 'momentum6' | 'momentum12' | 'high52wPct') => {
    priceSignalRef.current = signal;
    setScreenerQuery({ signal });
  };

  // 거래유형 선택
  const handleDealTypeChange = (dealType: DealType) => {
    setScreenerQuery({ dealType });
  };

  // 모집단 통계 (데이터가 없으면 렌더 생략)
  const shouldShowStats = screen !== null;
  const total = screen?.total ?? 0;
  const nullCount = screen?.nullCount ?? 0;
  const available = total - nullCount;

  return (
    <div className={s.panel}>
      {/* 1행: 신호 그룹 선택 */}
      <div className={s.row}>
        <label className={s.label}>시그널</label>
        <Segmented<'price' | 'volume' | 'jeonse' | 'rs'>
          options={[
            { value: 'price', label: '가격' },
            { value: 'volume', label: '거래량' },
            { value: 'jeonse', label: '전세' },
            { value: 'rs', label: '상대강도' },
          ]}
          value={
            isCurrentlyPriceGroup ? 'price' :
            query.signal === 'volumeRatio' ? 'volume' :
            query.signal === 'jeonseRatio' ? 'jeonse' :
            'rs'
          }
          onChange={handleSignalGroupChange}
        />
      </div>

      {/* 2행: 가격 그룹 세부 신호 (가격 선택 시만) */}
      {isCurrentlyPriceGroup && (
        <div className={s.row}>
          <div className={s.indent} />
          <Segmented<'momentum3' | 'momentum6' | 'momentum12' | 'high52wPct'>
            options={[
              { value: 'momentum3', label: '3개월' },
              { value: 'momentum6', label: '6개월' },
              { value: 'momentum12', label: '12개월' },
              { value: 'high52wPct', label: '신고가' },
            ]}
            value={query.signal as 'momentum3' | 'momentum6' | 'momentum12' | 'high52wPct'}
            onChange={handlePriceSignalChange}
          />
        </div>
      )}

      {/* 3행: 거래유형 + 최소거래 */}
      <div className={s.row}>
        <label className={s.label}>거래유형</label>
        <Segmented<DealType>
          options={[
            { value: 'trade', label: '매매' },
            { value: 'rent', label: '전세' },
          ]}
          value={query.dealType}
          onChange={handleDealTypeChange}
        />
        <label className={s.label} style={{ marginLeft: 'auto' }}>최소거래</label>
        {/* Segmented 는 string 제약 — 문자열로 오가고 쿼리에는 숫자로 넣는다 */}
        <Segmented<'3' | '5' | '10'>
          options={[
            { value: '3', label: '3건' },
            { value: '5', label: '5건' },
            { value: '10', label: '10건' },
          ]}
          value={String(query.minDeals) as '3' | '5' | '10'}
          onChange={(v) => setScreenerQuery({ minDeals: Number(v) as 3 | 5 | 10 })}
        />
      </div>

      {/* 4행: 평형대 */}
      <div className={s.row}>
        <label className={s.label}>평형대</label>
        {/* Segmented 는 string 제약 — 'all' 또는 AreaTier 문자열로 오가고 쿼리에는 null 또는 AreaTier 로 넣는다 */}
        <Segmented<'all' | AreaTier>
          options={[
            { value: 'all', label: '전체' },
            { value: '~60', label: '~60㎡' },
            { value: '60~85', label: '60~85㎡' },
            { value: '85~135', label: '85~135㎡' },
            { value: '135~', label: '135~㎡' },
          ]}
          value={(query.areaTier ?? 'all') as 'all' | AreaTier}
          onChange={(v) => setScreenerQuery({ areaTier: v === 'all' ? null : v as AreaTier })}
        />
      </div>

      {/* 모집단 통계 (데이터 있을 때만) */}
      {shouldShowStats && (
        <div className={s.stats}>
          <span className={s.statsNum}>{total.toLocaleString()}</span>
          <span className={s.statsText}>개 중</span>
          <span className={s.statsNum}>{available.toLocaleString()}</span>
          <span className={s.statsText}>개 조건 계산 가능</span>
          <span className={s.statsDot}>·</span>
          <span className={s.statsNum}>{nullCount.toLocaleString()}</span>
          <span className={s.statsText}>개 데이터 부족으로 제외</span>
        </div>
      )}
    </div>
  );
}
