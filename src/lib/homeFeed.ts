// 홈 타임라인 피드 조립 — 순수 함수(테스트 대상).
//
// 소스가 전부 로컬(localStorage 주문·알림)이거나 이미 로드된 상태(뉴스)라 서버 병합이
// 불가능하다(서버는 로컬 저장을 모른다). 대신 추가 전송 없이 스토어에 있는 것만 섞는다.
// 정렬은 시간 역순 단일 규칙(중요도 가중 없음, v0) — 설계 W2.
import type { PaperOrder, AppNotification, NewsItem, Holding, HomeFeedItem } from '@/data/types';

const SIDE_KR = { buy: '매수', sell: '매도' } as const;

export function buildHomeFeed(input: {
  orders: PaperOrder[];
  notifications: AppNotification[];
  news: NewsItem[];
  holdings: Holding[];
  /** 뉴스 minutesAgo → 절대시각 환산 기준. 테스트에서 고정 주입. */
  now?: number;
  limit?: number;
}): HomeFeedItem[] {
  const { orders, notifications, news, holdings, now = Date.now(), limit = 30 } = input;
  const items: HomeFeedItem[] = [];

  for (const o of orders) {
    items.push({
      id: `order-${o.id}`,
      ts: o.at,
      type: 'order',
      title: `${o.name} ${o.qty}주 ${SIDE_KR[o.side]}`,
      detail: `${o.type === 'market' ? '시장가' : '지정가'} ${o.market === 'US' ? '$' : '₩'}${o.price.toLocaleString('ko-KR')}`,
      ref: { kind: 'stock', id: o.code },
    });
  }

  for (const n of notifications) {
    items.push({
      id: `notif-${n.id}`,
      ts: n.at,
      type: n.kind === 'apt' ? 'apt' : 'alert',
      title: n.title,
      detail: n.desc,
      ...(n.code ? { ref: { kind: 'stock' as const, id: n.code } } : {}),
    });
  }

  // 뉴스는 보유종목 관련만 — 홈은 "내" 피드다. 시장 전체 뉴스는 뉴스 탭이 담당한다.
  const held = new Set(holdings.map((h) => h.code));
  for (const n of news) {
    const mine = n.tickers.filter((t) => held.has(t));
    if (!mine.length) continue;
    items.push({
      id: `news-${n.id}`,
      ts: now - n.minutesAgo * 60_000,
      type: 'news',
      title: n.headline,
      detail: n.source,
      sentiment: n.sentiment,
      ref: { kind: 'stock', id: mine[0] },
    });
  }

  return items.sort((a, b) => b.ts - a.ts).slice(0, limit);
}
