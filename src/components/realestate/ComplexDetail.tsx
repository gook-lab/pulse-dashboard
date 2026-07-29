import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { Modal, Badge, EmptyState, SkeletonText, PriceChart, HorizontalBars } from '@/components/common';
import toast from '@/lib/toast';
import { httpApi } from '@/data/httpApi';
import type { AptComplexDetail, SignalKey } from '@/data/types';
import { fmt, scaleColor, SIGNAL_DOMAIN, WARN } from '@/lib/colors';
import s from './ComplexDetail.module.css';

/** 상세 모달. selectedComplexId 열림 기준, useEffect로 데이터 조회. */
export default function ComplexDetail() {
  const selectedComplexId = useStore((st) => st.selectedComplexId);
  const selectComplex = useStore((st) => st.selectComplex);
  const screenerQuery = useStore((st) => st.screenerQuery);
  const aptScreen = useStore((st) => st.aptScreen);
  const colorMode = useStore((st) => st.colorMode);
  const aptWatchlist = useStore((st) => st.aptWatchlist);
  const toggleAptWatch = useStore((st) => st.toggleAptWatch);

  const [detail, setDetail] = useState<AptComplexDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef<string | null>(null); // 응답 도착 시점에 최신 요청인지 — stale 응답 버림

  useEffect(() => {
    if (!selectedComplexId) { reqId.current = null; return; }
    const id = selectedComplexId;
    reqId.current = id;
    setLoading(true);
    setDetail(null);
    httpApi.getAptComplex(id)
      .then((d) => { if (reqId.current === id) { setDetail(d); setLoading(false); } })
      .catch((e) => {
        if (reqId.current !== id) return;
        setLoading(false);
        toast.error({ message: `단지 상세 조회 실패: ${String((e as Error)?.message || e)}` });
      });
  }, [selectedComplexId]);

  const open = selectedComplexId != null;
  const handleClose = () => selectComplex(null);

  if (!open) return null;

  // 로딩 중
  if (loading) {
    return (
      <Modal open={open} onOpenChange={handleClose} width={720}>
        <SkeletonText lines={8} />
      </Modal>
    );
  }

  // null 응답: 데이터 없음 (재건축·개명으로 소멸한 단지)
  if (detail === null) {
    return (
      <Modal open={open} onOpenChange={handleClose} width={720}>
        <EmptyState
          title="데이터 없음"
          desc="재건축이나 개명으로 인해 조회할 수 없는 단지입니다."
        />
      </Modal>
    );
  }

  // ──── 렌더링 시작 ────

  const dealType = screenerQuery.dealType;
  const signal = screenerQuery.signal;
  const currentSignals = detail.signals[dealType];
  const signalDomain = SIGNAL_DOMAIN[signal];
  // jeonseRatio 는 거래유형과 무관하게 단지 레벨 — KindSignals 에 없다
  const valueOf = (key: SignalKey): number | null =>
    key === 'jeonseRatio' ? detail.signals.jeonseRatio : currentSignals[key];
  const signalValue = valueOf(signal);

  // 순위 조회
  const rank = aptScreen?.ranked.find((r) => r.id === selectedComplexId);
  const rankText = rank && aptScreen
    ? `${rank.rank}위 / ${aptScreen.ranked.length}개`
    : `순위 밖 — 조건 미충족`;

  // 시계열 데이터 분해: [평당가중앙값, 건수]
  const timeseriesData = detail.series[dealType === 'trade' ? 't' : 'r'];
  const seriesValues = timeseriesData.map(([price]) => price);
  const volumesValues = timeseriesData.map(([, count]) => count);

  // 미확정 구간: 최근 2개월(마지막 2개 인덱스)
  const provisionalFrom = Math.max(0, timeseriesData.length - 2);

  // 평형별 바: 현재 dealType에서 거래가 있는 평형만
  const tierBars = Object.entries(detail.tiers)
    .filter(([_, tierData]) => {
      const prices = dealType === 'trade' ? tierData.t : tierData.r;
      return prices[0] != null && prices[1] > 0;
    })
    .map(([tier, tierData]) => {
      const [price, count] = dealType === 'trade' ? tierData.t : tierData.r;
      return {
        label: `${tier}㎡ · ${count}건`,
        value: price ?? 0,
      };
    });

  // 거래 건수
  const dealCount = currentSignals.dealCount;

  // 최근 거래 10건
  const recentDeals = detail.recent.slice(0, 10);

  // 신호값 포맷 — 셀마다 그 시그널의 형식으로 (현재 시그널 형식으로 뭉개면 안 된다)
  const formatSignal = (key: SignalKey, v: number | null): string => {
    if (v == null) return '—';
    switch (key) {
      case 'momentum3': case 'momentum6': case 'momentum12':
        return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
      case 'high52wPct':
        return v === 0 ? '신고가' : `${v.toFixed(1)}%`;
      case 'volumeRatio':
        return `${v.toFixed(2)}×`;
      case 'jeonseRatio':
        return `${Math.round(v * 100)}%`;
      case 'rs':
        return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%p`;
    }
  };

  const signalLabels: Record<SignalKey, string> = {
    momentum3: '3개월 모멘텀',
    momentum6: '6개월 모멘텀',
    momentum12: '12개월 모멘텀',
    high52wPct: '신고가 근접',
    volumeRatio: '거래량 돌파',
    jeonseRatio: '전세가율',
    rs: '상대강도',
  };
  const gridSignals = (Object.keys(signalLabels) as SignalKey[]).map((key) => ({
    key,
    label: key === 'jeonseRatio' && detail.signals.jeonseRatioTier
      ? `전세가율 · ${detail.signals.jeonseRatioTier}㎡`
      : signalLabels[key],
  }));

  const dealTypeLabel = dealType === 'trade' ? '매매' : '전세/월세';
  const buildYearText = detail.buildYear ? `${detail.buildYear}년 준공` : '준공연도 미상';

  return (
    <Modal open={open} onOpenChange={handleClose} width={720}>
      <div className={s.container}>
        {/* ① 헤더 */}
        <div className={s.header}>
          <div className={s.titleGroup}>
            <h2 className={s.title}>{detail.aptNm}</h2>
            <button
              onClick={() => toggleAptWatch(detail.aptSeq)}
              className={`${s.watchBtn} ${aptWatchlist.includes(detail.aptSeq) ? s.watchBtnActive : ''}`}
              title={aptWatchlist.includes(detail.aptSeq) ? '워치리스트에서 제거' : '워치리스트에 추가'}
              aria-pressed={aptWatchlist.includes(detail.aptSeq)}
              aria-label="관심단지 담기"
            >
              ★
            </button>
          </div>
          <div className={s.badges}>
            {detail.source === 'mock' && <Badge color={WARN}>목 데이터</Badge>}
            {detail.areaTier && <Badge>{detail.areaTier}㎡ 중심</Badge>}
            {detail.lat == null && <Badge>좌표없음</Badge>}
          </div>
          <div className={s.subline}>
            <span>{detail.gu} {detail.umdNm}</span>
            <span>·</span>
            <span>{detail.roadnm}</span>
            <span>·</span>
            <span>{buildYearText}</span>
          </div>
        </div>

        {/* ② 현재 시그널 */}
        <div className={s.signalSection}>
          <div className={s.currentSignal}>
            <span className={s.signalLabel}>{signalLabels[signal]}</span>
            <div className={s.signalValue} style={{
              color: scaleColor(signalValue, signalDomain, colorMode),
            }}>
              {formatSignal(signal, signalValue)}
            </div>
            <div className={s.rankText}>{rankText}</div>
          </div>

          {/* 시그널 그리드 */}
          <div className={s.signalGrid}>
            {gridSignals.map(({ key, label }) => {
              const v = valueOf(key);
              return (
                <div key={key} className={s.gridCell}>
                  <div className={s.gridLabel}>{label}</div>
                  <div
                    className={s.gridValue}
                    style={{ color: scaleColor(v, SIGNAL_DOMAIN[key], colorMode) }}
                  >
                    {formatSignal(key, v)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 거래건수 */}
          <div className={s.dealCount}>
            {dealCount}건 거래
          </div>
        </div>

        {/* ③ PriceChart */}
        <div className={s.chartSection}>
          <PriceChart
            name={detail.aptNm}
            code={detail.aptSeq}
            cur=""
            dec={0}
            series={{ '1년': seriesValues }}
            volumes={{ '1년': volumesValues }}
            labels={{ '1년': detail.months.map((m) => `${m.slice(2, 4)}.${m.slice(4)}`) }}
            mode={colorMode}
            defaultPeriod="1년"
            height={220}
            provisionalFrom={provisionalFrom}
            liveBadge="월별 실거래"
          />
          <div className={s.chartCaption}>
            {dealTypeLabel} 평당가(만원) · 최근 2개월은 신고지연으로 미확정{detail.outliers ? ` · 이상치 제외 ${detail.outliers}건` : ''}
          </div>
        </div>

        {/* ④ HorizontalBars (평형별) */}
        {tierBars.length > 0 && (
          <div className={s.tiersSection}>
            <div className={s.tiersLabel}>평형별 {dealTypeLabel}</div>
            <HorizontalBars
              data={tierBars}
              highlight={tierBars.find((b) => detail.areaTier && b.label.startsWith(`${detail.areaTier}㎡`))?.label}
              format={(v) => `${fmt(v, 0)}만`}
              labelWidth={110}
            />
          </div>
        )}

        {/* ⑤ 최근 거래 테이블 */}
        {recentDeals.length > 0 && (
          <div className={s.tableSection}>
            <div className={s.tableLabel}>최근 거래</div>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>계약일</th>
                  <th className={s.th}>유형</th>
                  <th className={s.th}>전용</th>
                  <th className={s.th}>층</th>
                  <th className={s.th}>금액</th>
                </tr>
              </thead>
              <tbody>
                {recentDeals.map((deal, i) => {
                  const ym = deal.ym.slice(0, 4) + '.' + deal.ym.slice(4);
                  const dateStr = deal.day ? `${ym}.${String(deal.day).padStart(2, '0')}` : ym;
                  const kindLabel = deal.kind === 'trade'
                    ? '매매'
                    : deal.monthlyRent && deal.monthlyRent > 0
                      ? '월세'
                      : '전세';
                  const areaStr = deal.area ? deal.area.toFixed(1) : '—';
                  const floorStr = deal.floor ? String(deal.floor) : '—';
                  const priceStr = deal.kind === 'trade' || deal.monthlyRent === 0 || deal.monthlyRent == null
                    ? `${fmt(deal.price, 0)}만`
                    : `${fmt(deal.price, 0)}/${fmt(deal.monthlyRent, 0)}`;

                  return (
                    <tr key={i} className={s.tr}>
                      <td className={s.td}>{dateStr}</td>
                      <td className={s.td}>{kindLabel}</td>
                      <td className={s.td}>{areaStr}㎡</td>
                      <td className={s.td}>{floorStr}</td>
                      <td className={`${s.td} ${s.tdMoney}`}>{priceStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
