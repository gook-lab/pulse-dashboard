import { useStore } from '../../store/useStore';
import { CardSkeleton, ErrorState } from '@/components/common';
import IndexCards from './IndexCards';
import Heatmap from './Heatmap';
import SeoulRentMap from './SeoulRentMap';
import Watchlist from './Watchlist';
import FearGreedGauge from './FearGreedGauge';
import MacroList from './MacroList';
import AiOpinion from './AiOpinion';
import NewsFeed from './NewsFeed';
import s from './Dashboard.module.css';

export default function Dashboard() {
  const loaded = useStore((st) => st.loaded);
  const error = useStore((st) => st.error);
  const reload = useStore((st) => st.reload);

  // 로드 실패(전체) — 그리드 대신 재시도 카드.
  if (error && !loaded) {
    return (
      <div className={s.dash}>
        <section className="card"><ErrorState desc="시황 데이터를 불러오지 못했습니다. 백엔드 연결을 확인하세요." onRetry={reload} /></section>
      </div>
    );
  }

  // 그리드는 처음부터 그대로 — 각 슬롯이 로드 전 카드 스켈레톤을 채운다(레이아웃 점프 없음).
  return (
    <div className={s.dash}>
      <div className={s.grid}>
        <div className={s.left}>
          {loaded ? <IndexCards /> : <CardSkeleton title="주요 지수" variant="cards" tiles={7} />}
          {loaded ? <Heatmap /> : <CardSkeleton title="마켓 맵" variant="block" height={620} />}
          {loaded ? <Watchlist /> : <CardSkeleton title="관심종목 실시간" rows={5} />}
        </div>
        <div className={s.right}>
          {loaded ? <FearGreedGauge /> : <CardSkeleton title="Fear & Greed" variant="gauge" />}
          {loaded ? <MacroList /> : <CardSkeleton title="매크로 지수" rows={7} />}
          {loaded ? <AiOpinion /> : <CardSkeleton title="AI 종합 투자의견" rows={3} />}
          {loaded ? <NewsFeed /> : <CardSkeleton title="뉴스 헤드라인" rows={4} />}
        </div>
      </div>
      {loaded ? <SeoulRentMap /> : <CardSkeleton title="서울 아파트 전세 데이터센터" variant="block" height={320} />}
    </div>
  );
}
