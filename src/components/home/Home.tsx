import { useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { CardSkeleton } from '@/components/common';
import HeroCard from './HeroCard';
import AllocationCard from './AllocationCard';
import MoversCard from './MoversCard';
import FeedCard from './FeedCard';
import s from './Home.module.css';

/**
 * 홈(W2) — 자산 중심 홈. "am I okay?"에 30초 안에 답한다:
 * 순자산(히어로) · 자산 배분 · 밤사이 일어난 일(피드) · 내 무버.
 * 기존 시황 대시보드는 '마켓' 탭으로 유지된다.
 */
export default function Home() {
  const home = useStore((st) => st.home);
  const homeLoading = useStore((st) => st.homeLoading);
  const loadHome = useStore((st) => st.loadHome);
  const refreshWatchlist = useStore((st) => st.refreshWatchlist);

  useEffect(() => { void loadHome(); void refreshWatchlist(); }, [loadHome, refreshWatchlist]);
  // 순자산·배분·무버 30초 폴링(잔고·포트폴리오 SLI와 동일) — 백그라운드 탭은 스킵(RADIO 폴링 게이트).
  // 관심종목도 함께 갱신: 초기 일괄 로드가 순간 실패하면 무버가 탭 전환 전까지 "-"로 남는다.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      void loadHome();
      void refreshWatchlist();
    }, 30_000);
    return () => clearInterval(id);
  }, [loadHome, refreshWatchlist]);

  const ready = !!home && !homeLoading;
  return (
    <div className={s.home}>
      <div className={s.grid}>
        <div className={s.left}>
          {ready ? <HeroCard /> : <CardSkeleton title="내 순자산" variant="block" height={150} />}
          {ready ? <AllocationCard /> : <CardSkeleton title="자산 배분" rows={2} />}
          {ready ? <MoversCard /> : <CardSkeleton title="내 무버" rows={5} />}
        </div>
        <div className={s.right}>
          <FeedCard />
        </div>
      </div>
    </div>
  );
}
