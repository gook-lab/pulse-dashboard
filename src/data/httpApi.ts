// 실백엔드 소비 어댑터 (strangler): 백엔드가 준비된 엔드포인트만 HTTP로,
// 나머지는 목에 위임. 엔드포인트가 늘면 여기서 하나씩 목→HTTP로 옮긴다.
import type { MarketApi, FearGreed, CryptoFG, MacroItem, IndexQuote, SeoulRent, WatchItem, NewsItem, AiOpinion, Portfolio,
  ScreenQuery, ScreenResult, ComplexesResult, AptComplexDetail, ComplexDealsResult, NeedsCollect, RankingItem, PortfolioHistoryResult } from './types';
import { mockApi } from './mockApi';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    // 503 + needsCollect 는 "배치를 아직 안 돌렸다"는 신호다. 목으로 덮으면 안 된다 —
    // 사용자는 pnpm collect 를 실행해야 하고, 화면은 그걸 안내해야 한다.
    const body = await res.json().catch(() => null) as { needsCollect?: boolean; hint?: string } | null;
    const err = new Error(`${path} → ${res.status}`) as Error & { status: number; needsCollect?: boolean; hint?: string };
    err.status = res.status;
    if (body?.needsCollect) { err.needsCollect = true; err.hint = body.hint; }
    throw err;
  }
  return res.json() as Promise<T>;
}

/** 배치 미실행(503)이면 그대로 알리고, 그 외 실패(백엔드 다운 등)만 목으로 폴백. */
function needsCollectOf(e: unknown): NeedsCollect | null {
  const err = e as { needsCollect?: boolean; hint?: string };
  return err?.needsCollect ? { needsCollect: true, hint: err.hint ?? 'pnpm collect' } : null;
}

type Q = { price: number; change?: number; changePct: number };
const round2 = (n: number) => Math.round(n * 100) / 100;

export const httpApi: MarketApi = {
  ...mockApi,
  // 지수: 미국 3종 = Finnhub ETF(SPY/QQQ/DIA, 무료 티어는 지수레벨 미제공), 환율 = ECOS.
  getIndices: async (): Promise<IndexQuote[]> => {
    const base = await mockApi.getIndices();
    const [us, fx, kr, macro] = await Promise.all([
      getJson<Record<string, Q>>('/api/indices/us').catch(() => null),
      getJson<{ value: number; changePct: number }>('/api/fx/usdkrw').catch(() => null),
      getJson<Record<string, Q>>('/api/kr/indices').catch(() => null),
      getJson<{ vix: { value: number; changePct: number } | null }>('/api/macro').catch(() => null),
    ]);
    const etf: Record<string, { etf: string; name: string }> = {
      SPX: { etf: 'SPY', name: 'S&P500 · SPY' },
      IXIC: { etf: 'QQQ', name: '나스닥 · QQQ' },
      DJI: { etf: 'DIA', name: '다우 · DIA' },
    };
    return base.map((q) => {
      if (us && etf[q.code]) {
        const d = us[etf[q.code].etf];
        if (d) return { ...q, name: etf[q.code].name, price: d.price, change: d.change ?? round2(d.price * d.changePct / 100), changePct: d.changePct };
      }
      if (kr && (q.code === 'KOSPI' || q.code === 'KOSDAQ')) {
        const d = kr[q.code];
        if (d) return { ...q, price: d.price, change: d.change ?? round2(d.price * d.changePct / 100), changePct: d.changePct };
      }
      if (fx && q.code === 'USDKRW') {
        return { ...q, price: fx.value, change: round2(fx.value * fx.changePct / 100), changePct: fx.changePct };
      }
      if (macro?.vix && q.code === 'VIX') {
        return { ...q, price: macro.vix.value, change: round2(macro.vix.value * macro.vix.changePct / 100), changePct: macro.vix.changePct };
      }
      return { ...q, unavailable: true }; // 실데이터 실패 → 값 "-"
    });
  },
  // 관심종목: 국내 = KIS, 미국 = Finnhub 실시세.
  getWatchlist: async (): Promise<WatchItem[]> => {
    const base = await mockApi.getWatchlist();
    const krCodes = base.filter((w) => w.market === 'KR').map((w) => w.code);
    const usSyms = base.filter((w) => w.market === 'US').map((w) => w.code);
    const [krq, usq] = await Promise.all([
      krCodes.length ? getJson<Record<string, Q | null>>(`/api/kr/quotes?codes=${krCodes.join(',')}`).catch(() => null) : Promise.resolve(null),
      usSyms.length ? getJson<Record<string, Q | null>>(`/api/us/quotes?symbols=${usSyms.join(',')}`).catch(() => null) : Promise.resolve(null),
    ]);
    // AI 시그널: 실시간 등락 모멘텀 기반(±1.5% 임계). 실시세 없으면 목 시그널 유지.
    const sig = (pct: number): WatchItem['aiSignal'] => (pct >= 1.5 ? 'buy' : pct <= -1.5 ? 'sell' : 'hold');
    return base.map((w) => {
      const d = w.market === 'KR' ? krq?.[w.code] : usq?.[w.code];
      return d ? { ...w, price: d.price, changePct: d.changePct, aiSignal: sig(d.changePct) } : { ...w, unavailable: true };
    });
  },
  getFearGreed: async (): Promise<FearGreed> => {
    try { return await getJson<FearGreed>('/api/fear-greed'); }
    catch { return { value: 0, label: '', prevWeek: 0, prevMonth: 0, prevYear: 0, updatedAt: '', unavailable: true }; }
  },
  getCryptoFearGreed: async (): Promise<CryptoFG> => {
    try { return await getJson<CryptoFG>('/api/fear-greed/crypto'); }
    catch { return { value: 0, label: '', updatedAt: '', unavailable: true }; }
  },
  // 매크로: BTC(업비트) + 기준금리(ECOS) + 미10Y·유가(FRED) 실연동. 전세/부동산/금은 목(키 발급 후).
  getMacro: async (): Promise<MacroItem[]> => {
    const base = await mockApi.getMacro();
    type V = { value: number; changePct: number };
    type Q2 = { price: number; changePct: number };
    type Econ = { baseRate: number | null; gb3y: number | null; usdkrw: number | null; jpykrw: number | null };
    const [btc, macro, econ] = await Promise.all([
      getJson<{ price: number; changePct: number }>('/api/crypto/btc').catch(() => null),
      getJson<{ us10y: V | null; oil: V | null; vix: V | null; gold: Q2 | null }>('/api/macro').catch(() => null),
      getJson<Econ>('/api/econ/key').catch(() => null),
    ]);
    const num = (n: number) => n.toLocaleString('ko-KR');
    const realKeys = new Set(['btc', 'us10y', 'oil', 'gold', 'rate', 'gb3y', 'usdkrw', 'jpykrw']); // 실소스 보유 키
    return base.map((m) => {
      if (btc && m.key === 'btc') return { ...m, value: `₩${num(btc.price)}`, changePct: btc.changePct };
      if (macro?.us10y && m.key === 'us10y') return { ...m, value: `${macro.us10y.value}%`, changePct: macro.us10y.changePct };
      if (macro?.oil && m.key === 'oil') return { ...m, value: `$${macro.oil.value}`, changePct: macro.oil.changePct };
      if (macro?.gold && m.key === 'gold') return { ...m, value: `$${num(macro.gold.price)}`, changePct: macro.gold.changePct };
      if (econ?.baseRate != null && m.key === 'rate') return { ...m, value: `${econ.baseRate}%` };
      if (econ?.gb3y != null && m.key === 'gb3y') return { ...m, value: `${econ.gb3y}%` };
      if (econ?.usdkrw != null && m.key === 'usdkrw') return { ...m, value: num(econ.usdkrw) };
      if (econ?.jpykrw != null && m.key === 'jpykrw') return { ...m, value: num(econ.jpykrw) };
      return realKeys.has(m.key) ? { ...m, value: '-', changePct: 0, unavailable: true } : m;
    });
  },
  getSeoulRent: async (): Promise<SeoulRent> => {
    try { return await getJson<SeoulRent>('/api/realestate/seoul'); }
    catch { return { month: '', avgManwon: 0, avgEok: 0, districts: [], unavailable: true }; }
  },
  // 리서치: 현재가 = 실시세, 목표주가 = KR 기술적 산출(볼린저 상단, /api/kr/targets).
  // 실목표가 없는 종목(US 등)은 targetReal:false → 화면에서 '-' (목 고정값과 실가 조합 금지).
  getResearch: async () => {
    const base = await mockApi.getResearch();
    const kr = base.filter((r) => /^\d/.test(r.code)).map((r) => r.code);
    const us = base.filter((r) => /^[A-Z]/.test(r.code)).map((r) => r.code);
    const [krq, usq, tgt] = await Promise.all([
      kr.length ? getJson<Record<string, Q | null>>(`/api/kr/quotes?codes=${kr.join(',')}`).catch(() => null) : Promise.resolve(null),
      us.length ? getJson<Record<string, Q | null>>(`/api/us/quotes?symbols=${us.join(',')}`).catch(() => null) : Promise.resolve(null),
      kr.length ? getJson<Record<string, { target: number; close: number }>>(`/api/kr/targets?codes=${kr.join(',')}`).catch(() => null) : Promise.resolve(null),
    ]);
    return base.map((r) => {
      const q = /^\d/.test(r.code) ? krq?.[r.code] : usq?.[r.code];
      const t = tgt?.[r.code];
      // KIS 시세가 순간 스로틀이어도 차트 캐시 기반 close(targets)가 있으면 행을 살린다.
      const price = q?.price ?? t?.close;
      if (!price) return { ...r, unavailable: true };
      if (t?.target) return { ...r, price, target: t.target, targetReal: true, upsidePct: +(((t.target - price) / price) * 100).toFixed(1) };
      return { ...r, price, targetReal: false };
    });
  },
  // AI 종합 투자의견: 백엔드 규칙 기반 산출(F&G+지수+뉴스). 실패 시 "-".
  getAiOpinion: async (): Promise<AiOpinion> => {
    try { return await getJson<AiOpinion>('/api/ai/opinion'); }
    catch { return { score: 0, stance: '', markets: [], bull: [], bear: [], unavailable: true }; }
  },
  // 뉴스: Alpha Vantage 배치(백엔드 1h 캐시). 실패 시 빈 목록("-"/빈상태).
  getNews: async (): Promise<NewsItem[]> => {
    try { const r = await getJson<{ fetchedAt: string; items: NewsItem[] }>('/api/news'); return r.items ?? []; }
    catch { return []; }
  },
  // 포트폴리오: KIS 잔고조회(백엔드). 실데이터가 아니면(계좌 미설정/백엔드 실패) 목 대신 "-" 상태.
  // (모든 페이지 동일 룰: 실데이터 없으면 목이 아니라 '-'로 표기해 오해 방지)
  getPortfolio: async (): Promise<Portfolio> => {
    const dash: Portfolio = { fxUsdKrw: 0, unavailable: true, summary: { totalValue: 0, pnl: 0, pnlPct: 0, dayPnl: 0, dayPnlPct: 0, principal: 0 }, holdings: [] };
    try {
      const p = await getJson<Portfolio & { configured?: boolean }>('/api/portfolio');
      return (p.configured === false || !p.source) ? dash : p;
    } catch { return dash; }
  },

  // ── 부동산 스크리너 ────────────────────────────────────────────────────
  getAptComplexes: async (): Promise<ComplexesResult | NeedsCollect> => {
    try { return await getJson<ComplexesResult>('/api/realestate/complexes'); }
    catch (e) { return needsCollectOf(e) ?? mockApi.getAptComplexes(); }
  },
  screenApartments: async (q: ScreenQuery): Promise<ScreenResult | NeedsCollect> => {
    const p = new URLSearchParams({
      signal: q.signal, dealType: q.dealType, minDeals: String(q.minDeals),
      sortDir: q.sortDir ?? 'desc',
    });
    if (q.gu?.length) p.set('gu', q.gu.join(','));
    if (q.areaTier) p.set('areaTier', q.areaTier);
    if (q.bbox) p.set('bbox', q.bbox.join(','));
    try { return await getJson<ScreenResult>(`/api/realestate/screen?${p}`); }
    catch (e) { return needsCollectOf(e) ?? mockApi.screenApartments(q); }
  },
  getAptComplex: async (aptSeq: string): Promise<AptComplexDetail | null> => {
    try { return await getJson<AptComplexDetail>(`/api/realestate/complex?id=${encodeURIComponent(aptSeq)}`); }
    // 조용한 목 폴백은 위험하다 — source 를 남겨 모달이 목 배지를 강제하게 한다.
    catch {
      const d = await mockApi.getAptComplex(aptSeq);
      return d ? { ...d, source: 'mock' } : null;
    }
  },

  getComplexDeals: async (aptSeq: string): Promise<ComplexDealsResult> => {
    try { return await getJson<ComplexDealsResult>(`/api/realestate/complex/deals?id=${encodeURIComponent(aptSeq)}`); }
    catch { return mockApi.getComplexDeals(aptSeq); }
  },

  // 국내 순위: KIS 급등/급락(by=up|down) + 거래량/대금(by=volume|amount). 30초 캐시(서버).
  getRanking: async (kind: 'up' | 'down' | 'volume' | 'amount'): Promise<RankingItem[]> => {
    try {
      const items = await getJson<RankingItem[]>(`/api/kr/rank?by=${kind}&market=all&limit=10`);
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    }
  },

  getPortfolioHistory: async (days: number): Promise<PortfolioHistoryResult> => {
    try {
      return await getJson<PortfolioHistoryResult>(`/api/portfolio/history?days=${days}`);
    } catch {
      return { entries: [] };
    }
  },
};
