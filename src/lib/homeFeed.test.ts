import { describe, it, expect } from 'vitest';
import { buildHomeFeed } from './homeFeed';
import type { PaperOrder, AppNotification, NewsItem, Holding } from '@/data/types';

const NOW = 1_754_200_000_000;

const order = (over: Partial<PaperOrder> = {}): PaperOrder => ({
  id: 'o1', code: '005930', name: '삼성전자', market: 'KR', side: 'buy', type: 'limit',
  price: 251_000, qty: 3, fee: 0, at: NOW - 60_000, ...over,
});
const notif = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1', kind: 'price', title: '삼성전자 목표가 도달', desc: '₩251,000 상향 돌파',
  code: '005930', at: NOW - 120_000, read: false, ...over,
});
const newsItem = (over: Partial<NewsItem> = {}): NewsItem => ({
  id: 'nw1', headline: 'Samsung beats earnings', source: 'CNN', minutesAgo: 5,
  tickers: ['005930'], sentiment: 'good', group: '오늘', ...over,
});
const holding = (code = '005930'): Holding => ({
  code, name: '삼성전자', market: 'KR', qty: 3, avg: 250_000, price: 251_000, cur: '₩', dec: 0,
});

describe('buildHomeFeed', () => {
  it('주문·알림·보유종목 뉴스를 시간 역순으로 병합한다', () => {
    const feed = buildHomeFeed({
      orders: [order()],
      notifications: [notif()],
      news: [newsItem()],
      holdings: [holding()],
      now: NOW,
    });
    // 1분 전(order) → 2분 전(alert) → 5분 전(news) 역순
    expect(feed.map((f) => f.type)).toEqual(['order', 'alert', 'news']);
    expect(feed[2].ts).toBe(NOW - 5 * 60_000);
    expect(feed[0].title).toBe('삼성전자 3주 매수');
    expect(feed[0].detail).toContain('지정가');
    expect(feed[0].ref).toEqual({ kind: 'stock', id: '005930' });
  });

  it('뉴스는 보유종목 관련만 — 무관 뉴스는 제외', () => {
    const feed = buildHomeFeed({
      orders: [], notifications: [],
      news: [newsItem(), newsItem({ id: 'nw2', tickers: ['AAPL'] })],
      holdings: [holding()],
      now: NOW,
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].id).toBe('news-nw1');
  });

  it('보유가 없으면 뉴스 항목 0 — 시장 뉴스로 홈을 채우지 않는다', () => {
    const feed = buildHomeFeed({ orders: [], notifications: [], news: [newsItem()], holdings: [], now: NOW });
    expect(feed).toHaveLength(0);
  });

  it('부동산 알림(kind apt)은 type apt 로 구분된다', () => {
    const feed = buildHomeFeed({
      orders: [], news: [], holdings: [],
      notifications: [notif({ id: 'n2', kind: 'apt', title: '래미안 시그널 상승', code: undefined })],
      now: NOW,
    });
    expect(feed[0].type).toBe('apt');
    expect(feed[0].ref).toBeUndefined();
  });

  it('limit 초과분은 잘린다(기본 30)', () => {
    const orders = Array.from({ length: 40 }, (_, i) => order({ id: `o${i}`, at: NOW - i * 1000 }));
    const feed = buildHomeFeed({ orders, notifications: [], news: [], holdings: [], now: NOW });
    expect(feed).toHaveLength(30);
    expect(feed[0].ts).toBe(NOW); // 최신부터
  });

  it('시장가 미국 주문은 $ 표기', () => {
    const feed = buildHomeFeed({
      orders: [order({ market: 'US', code: 'AAPL', name: 'Apple', type: 'market', side: 'sell', price: 230 })],
      notifications: [], news: [], holdings: [], now: NOW,
    });
    expect(feed[0].title).toBe('Apple 3주 매도');
    expect(feed[0].detail).toBe('시장가 $230');
  });
});
