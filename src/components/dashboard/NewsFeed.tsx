import { useStore } from '../../store/useStore';
import { Badge, EmptyState } from '@/components/common';
import { signColor } from '../../lib/colors';
import s from './Dashboard.module.css';

// 감성 배지는 colorMode 기반 signColor(±1) — 하드코딩 색 금지, 중립은 회색.
const SENT: Record<string, { label: string; sign: number }> = {
  good: { label: '호재', sign: 1 },
  bad: { label: '악재', sign: -1 },
  neutral: { label: '중립', sign: 0 },
};

function ago(min: number): string {
  if (min >= 60) return `${Math.floor(min / 60)}시간 전`;
  return `${min}분 전`;
}

export default function NewsFeed() {
  const news = useStore((st) => st.news);
  const mode = useStore((st) => st.colorMode);

  return (
    <section className="card">
      <div className="card-h"><span className="t">뉴스 헤드라인</span><span className="tag">최신</span></div>
      <div className={s.news}>
        {news.length === 0 && <EmptyState title="뉴스 데이터를 불러오지 못했습니다" />}
        {news.slice(0, 4).map((n) => {
          const sent = SENT[n.sentiment] ?? SENT.neutral;
          return (
            <div key={n.id} className={s.nitem}>
              {n.url
                ? <a className={s.nhl} href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a>
                : <div className={s.nhl}>{n.headline}</div>}
              <div className={s.nmeta}>
                <Badge color={sent.sign ? signColor(sent.sign, mode) : undefined}>{sent.label}</Badge>
                <span>{n.source}</span>
                <span>·</span>
                <span>{ago(n.minutesAgo)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
