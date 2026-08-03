import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import type { NewsGroup, NewsItem } from '../../data/types';
import { Segmented, Button, EmptyState, ErrorState, Badge } from '@/components/common';
import { signColor, type ColorMode } from '../../lib/colors';
import toast from '@/lib/toast';
import s from './News.module.css';

type SentFilter = 'all' | 'good' | 'bad' | 'neutral';
// 감성 배지 색은 하드코딩 금지 — signColor(±1, mode)로 주입, 중립은 회색(색 미지정).
const SENT: Record<string, { label: string; sign: number }> = {
  good: { label: '호재', sign: 1 },
  bad: { label: '악재', sign: -1 },
  neutral: { label: '중립', sign: 0 },
};
const FILTERS: { key: SentFilter; label: string }[] = [
  { key: 'all', label: '전체' }, { key: 'good', label: '호재' }, { key: 'bad', label: '악재' }, { key: 'neutral', label: '중립' },
];
const GROUPS: NewsGroup[] = ['오늘', '어제', '이번주'];

function ago(min: number): string {
  if (min >= 1440) return `${Math.floor(min / 1440)}일 전`;
  if (min >= 60) return `${Math.floor(min / 60)}시간 전`;
  return `${min}분 전`;
}

function fetchedLabel(iso: string | null): string {
  if (!iso) return '배치 데이터';
  const d = new Date(iso);
  return `갱신 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function News() {
  const news = useStore((st) => st.news);
  const mode = useStore((st) => st.colorMode);
  const selectStock = useStore((st) => st.selectStock);
  const fetchedAt = useStore((st) => st.newsFetchedAt);
  const refreshing = useStore((st) => st.newsRefreshing);
  const refreshNews = useStore((st) => st.refreshNews);
  const [sent, setSent] = useState<SentFilter>('all');
  const [source, setSource] = useState<string | null>(null);

  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    news.forEach((n) => m.set(n.source, (m.get(n.source) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [news]);

  const filtered = news.filter((n) => (sent === 'all' || n.sentiment === sent) && (!source || n.source === source));

  return (
    <div className={s.wrap}>
      <div className={s.bar}>
        <div className={s.barLeft}>
          <span className={s.barTitle}>뉴스 · 감성분석</span>
          <span className={s.barSrc}>CNN · CNBC · Reuters · Bloomberg 외 · 1시간 배치</span>
        </div>
        <div className={s.barRight}>
          <span className={s.fetched}>{fetchedLabel(fetchedAt)}</span>
          <Button variant="subtle" size="sm" loading={refreshing}
            onClick={async () => { await refreshNews(); toast.success({ message: '뉴스를 갱신했습니다.' }); }}>
            갱신
          </Button>
        </div>
      </div>
    <div className={s.grid}>
      {/* 좌: 필터 */}
      <aside className={s.side}>
        <section className="card">
          <div className="card-h"><span className="t">감성 필터</span></div>
          <Segmented options={FILTERS.map((f) => ({ value: f.key, label: f.label }))} value={sent} onChange={setSent} />
        </section>
        <section className="card">
          <div className="card-h"><span className="t">출처</span>{source && <button className={s.clear} onClick={() => setSource(null)}>전체</button>}</div>
          <div className={s.sources}>
            {sourceCounts.map(([src, cnt]) => (
              <button key={src} className={source === src ? `${s.srcRow} ${s.srcOn}` : s.srcRow} onClick={() => setSource(source === src ? null : src)}>
                <span>{src}</span><span className={`${s.cnt} mono`}>{cnt}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      {/* 우: 타임라인 */}
      <main className={s.timeline}>
        {/* 아무것도 못 불러온 것과 필터로 걸러진 것을 구분한다. 최초 로드가 한 번 실패하면
            store가 빈 배열로 남아 영구히 비는데, "다른 필터를 선택해보세요"는 원인을 오해시킨다. */}
        {news.length === 0 ? (
          <section className="card">
            <ErrorState
              title="뉴스를 불러오지 못했습니다"
              desc="뉴스 소스 조회가 일시적으로 실패할 수 있습니다. 다시 시도해 주세요."
              onRetry={() => { void refreshNews(); }}
            />
          </section>
        ) : filtered.length === 0 ? (
          <section className="card"><EmptyState title="조건에 맞는 뉴스가 없습니다" desc="감성·출처 필터를 바꿔보세요." /></section>
        ) : null}
        {GROUPS.map((g) => {
          const items = filtered.filter((n) => n.group === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <div className={s.groupHead}>{g} <span className={s.groupCnt}>{items.length}</span></div>
              {items.map((n) => <Card key={n.id} n={n} mode={mode} onTicker={selectStock} />)}
            </div>
          );
        })}
      </main>
    </div>
    </div>
  );
}

function Card({ n, mode, onTicker }: { n: NewsItem; mode: ColorMode; onTicker: (code: string) => void }) {
  const sent = SENT[n.sentiment] ?? SENT.neutral;
  return (
    <section className={`card ${s.card}`}>
      <div className={s.cardTop}>
        <Badge color={sent.sign ? signColor(sent.sign, mode) : undefined}>{sent.label}</Badge>
        <span className={s.src}>{n.source}</span>
        <span className={s.dot}>·</span>
        <span className={`${s.time} mono`}>{ago(n.minutesAgo)}</span>
      </div>
      {n.url
        ? <a className={s.hl} href={n.url} target="_blank" rel="noopener noreferrer">{n.headline} <span className={s.ext} aria-hidden>↗</span></a>
        : <div className={s.hl}>{n.headline}</div>}
      {n.summary && <div className={s.summary}>{n.summary}</div>}
      {n.tickers.length > 0 && (
        <div className={s.tickers}>
          {n.tickers.map((t) => <button key={t} className={s.chip} onClick={() => onTicker(t)}>#{t}</button>)}
        </div>
      )}
    </section>
  );
}
