import { create } from 'zustand';
import type {
  IndexQuote, HeatmapNode, FearGreed, CryptoFG, MacroItem, WatchItem, NewsItem, AiOpinion, StockDetail,
  Portfolio, Report, SeoulRent, Market, ScreenQuery, ScreenResult, ComplexesResult, PaperOrder, RankingItem,
  PriceAlert, AppNotification,
} from '../data/types';

export interface DetailHint { code: string; name: string; market?: Market; cur?: string; dec?: number; changePct?: number }
import { httpApi } from '../data/httpApi';
import type { ColorMode } from '../lib/colors';
import { appendOrder } from '../lib/paperOrders';
import toast from '../lib/toast';

// 데이터 소스 주입 지점. httpApi = 백엔드 준비된 엔드포인트는 실연동, 나머지는 목.
const api = httpApi;

export type Tab = 'dashboard' | 'detail' | 'news' | 'portfolio' | 'research' | 'realestate';

// ── 페이퍼 주문 ──────────────────────────────────────────────────────────────
const PAPER_ORDERS_KEY = 'pulse.paper-orders';

// ── 가격 알림 ──────────────────────────────────────────────────────────────
const ALERTS_KEY = 'pulse.alerts';
const NOTIFICATIONS_KEY = 'pulse.notifications';

// ── 부동산 스크리너 ─────────────────────────────────────────────────────────────
/** 워치리스트 + "지난 갱신 대비" 스냅샷 localStorage 영속. */
const APT_WATCH_KEY = 'pulse.apt-watchlist';
const APT_SNAP_KEY = 'pulse.apt-watch-snapshot';

/** generatedAt 세대별 시그널 값 스냅샷. 배치가 갱신되면 prev ← cur 로 민다.
 *  signal/dealType 을 함께 기록 — 다른 시그널의 값끼리 Δ 를 내면 안 된다. */
interface AptSnapshot { generatedAt: string; signal: string; dealType: string; values: Record<string, number | null> }

const readJson = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
};
const writeJson = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 시크릿 모드 등 — 영속만 포기 */ }
};

/** 매매 API 미승인 상태에서 기본 매매를 주면 빈 화면이 뜬다 → 기본 전세. */
const DEFAULT_QUERY: ScreenQuery = { signal: 'momentum6', dealType: 'rent', minDeals: 3, sortDir: 'desc' };

let screenToken = 0; // 연타 시 stale 응답 무시용

interface State {
  tab: Tab;
  colorMode: ColorMode;
  loaded: boolean;
  error: string | null;
  indices: IndexQuote[];
  heatmap: HeatmapNode[];
  fearGreed: FearGreed | null;
  cryptoFg: CryptoFG | null;
  macro: MacroItem[];
  watchlist: WatchItem[];
  news: NewsItem[];
  ai: AiOpinion | null;
  portfolio: Portfolio | null;
  research: Report[];
  seoulRent: SeoulRent | null;
  selectedCode: string;
  detailHint: DetailHint | null;
  detail: StockDetail | null;
  detailLoading: boolean;
  newsFetchedAt: string | null;
  newsRefreshing: boolean;
  // ── 페이퍼 주문 ──
  paperOrders: PaperOrder[];
  // ── 가격 알림 ──
  alerts: PriceAlert[];
  notifications: AppNotification[];
  // ── 부동산 스크리너 ──
  screenerQuery: ScreenQuery;
  /** 단지 마스터. 배치 사이 불변 — 탭 첫 진입에 1회만 요청. */
  aptComplexes: ComplexesResult | null;
  /** 최근 성공한 순위. 재조회 중에도 유지한다(stale-while-revalidate, 디자인 D4). */
  aptScreen: ScreenResult | null;
  aptScreenLoading: boolean;
  aptNeedsCollect: boolean;
  aptError: string | null;
  hoveredComplexId: string | null;
  /** hover 가 어디서 시작됐나. 지도발일 때만 리스트가 scrollIntoView 한다(리스트 자체 hover 스크롤 튐 방지). */
  hoverSource: 'list' | 'map';
  selectedComplexId: string | null;
  /** 선택이 어디서 왔나. 리스트발 선택만 지도가 따라간다 — 지도에서 클릭했는데 지도가 또 움직이면 안 된다. */
  selectionSource: 'list' | 'map';
  /** 지도 동 박스·헤드라인 지역 클릭 → 리스트를 좁히는 클라이언트 필터. 전역 순위는 유지한다. */
  areaFilter: { gu: string; umdNm?: string } | null;
  aptWatchlist: string[];
  /** 지난 갱신 대비 (디자인 D7). cur=이번 배치, prev=직전 배치의 관심단지 시그널 값. */
  aptSnapshot: { cur: AptSnapshot | null; prev: AptSnapshot | null };
  /** 카카오맵 SDK 로드 실패(critical gap 3) → 리스트 전폭 전환. */
  aptMapFailed: boolean;
  /** 실패 사유 — "도메인 미등록"처럼 사용자가 고칠 수 있는 원인은 화면에 그대로 보여준다. */
  aptMapFailReason: string | null;
  setTab: (t: Tab) => void;
  toggleColorMode: () => void;
  setColorMode: (m: ColorMode) => void;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  refreshWatchlist: () => Promise<void>;
  refreshIndices: () => Promise<void>;
  reloadPortfolio: () => Promise<void>;
  refreshNews: () => Promise<void>;
  refreshRanking: (kind: 'up' | 'down' | 'volume' | 'amount') => Promise<RankingItem[]>;
  selectStock: (code: string, hint?: Omit<DetailHint, 'code'>) => void;
  loadDetail: (code: string) => Promise<void>;
  // ── 페이퍼 주문 ──
  placePaperOrder: (order: PaperOrder) => void;
  // ── 가격 알림 ──
  addAlert: (alert: Omit<PriceAlert, 'id' | 'createdAt'>) => void;
  removeAlert: (id: string) => void;
  pushNotification: (n: Omit<AppNotification, 'id' | 'at'>) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  // ── 부동산 스크리너 ──
  loadRealestate: () => Promise<void>;
  setScreenerQuery: (patch: Partial<ScreenQuery>) => void;
  runScreen: () => Promise<void>;
  setHoveredComplex: (id: string | null, source?: 'list' | 'map') => void;
  selectComplex: (id: string | null, source?: 'list' | 'map') => void;
  setAreaFilter: (f: { gu: string; umdNm?: string } | null) => void;
  toggleAptWatch: (aptSeq: string) => void;
  setAptMapFailed: (v: boolean, reason?: string) => void;
}

export const useStore = create<State>((set) => ({
  tab: 'dashboard',
  colorMode: 'global',
  loaded: false,
  error: null,
  indices: [],
  heatmap: [],
  fearGreed: null,
  cryptoFg: null,
  macro: [],
  watchlist: [],
  news: [],
  ai: null,
  portfolio: null,
  research: [],
  seoulRent: null,
  newsFetchedAt: null,
  newsRefreshing: false,
  selectedCode: '005930',
  detailHint: null,
  detail: null,
  detailLoading: false,
  paperOrders: readJson<PaperOrder[]>(PAPER_ORDERS_KEY, []),
  alerts: readJson<PriceAlert[]>(ALERTS_KEY, []),
  notifications: readJson<AppNotification[]>(NOTIFICATIONS_KEY, []),
  screenerQuery: DEFAULT_QUERY,
  aptComplexes: null,
  aptScreen: null,
  aptScreenLoading: false,
  aptNeedsCollect: false,
  aptError: null,
  hoveredComplexId: null,
  hoverSource: 'list',
  selectedComplexId: null,
  selectionSource: 'list',
  areaFilter: null,
  aptWatchlist: readJson<string[]>(APT_WATCH_KEY, []),
  aptSnapshot: {
    cur: readJson<AptSnapshot | null>(APT_SNAP_KEY, null),
    prev: readJson<AptSnapshot | null>(`${APT_SNAP_KEY}.prev`, null),
  },
  aptMapFailed: false,
  aptMapFailReason: null,
  setTab: (t) => set({ tab: t }),
  toggleColorMode: () => set((s) => ({ colorMode: s.colorMode === 'global' ? 'korea' : 'global' })),
  setColorMode: (m) => set({ colorMode: m }),
  load: async () => {
    try {
      set({ error: null });
      const [indices, heatmap, fearGreed, cryptoFg, macro, watchlist, news, ai, portfolio, research, seoulRent] = await Promise.all([
        api.getIndices(), api.getHeatmap(), api.getFearGreed(), api.getCryptoFearGreed(), api.getMacro(),
        api.getWatchlist(), api.getNews(), api.getAiOpinion(), api.getPortfolio(), api.getResearch(), api.getSeoulRent(),
      ]);
      set({ indices, heatmap, fearGreed, cryptoFg, macro, watchlist, news, ai, portfolio, research, seoulRent, loaded: true });
    } catch (e) {
      set({ error: String((e as Error)?.message || e) });
    }
  },
  reload: async () => { await useStore.getState().load(); },
  // 관심종목 시세/등락률 주기 동기화(US는 웹소켓 없음 → 폴링, KR은 웹소켓 보완).
  refreshWatchlist: async () => {
    try { const wl = await api.getWatchlist(); if (wl?.length) set({ watchlist: wl }); }
    catch { /* keep current */ }
  },
  // 티커·주요지수 주기 갱신 — 로드 1회로 끝나면 '폴링' 태그가 거짓이 된다(소켓 감사 S2).
  refreshIndices: async () => {
    try { const ix = await api.getIndices(); if (ix?.length) set({ indices: ix }); }
    catch { /* keep current */ }
  },
  reloadPortfolio: async () => {
    try { set({ portfolio: await api.getPortfolio() }); } catch { /* keep */ }
  },
  refreshNews: async () => {
    set({ newsRefreshing: true });
    try {
      const r = await fetch('/api/news/refresh');
      const j = await r.json();
      if (j.items?.length) set({ news: j.items, newsFetchedAt: j.fetchedAt });
    } catch { /* keep current */ }
    finally { set({ newsRefreshing: false }); }
  },
  refreshRanking: async (kind) => {
    return api.getRanking(kind);
  },
  selectStock: (code, hint) => {
    set({ selectedCode: code, tab: 'detail', detailHint: hint ? { code, ...hint } : null });
    void useStore.getState().loadDetail(code);
  },
  loadDetail: async (code) => {
    set({ detailLoading: true, detail: null }); // 이전 종목 데이터 즉시 제거(stale 방지)
    let detail = await api.getStockDetail(code);
    // 힌트(거래량순위 등 임의 종목)로 이름/마켓 보정 → 코드-이름 불일치 방지.
    const h = useStore.getState().detailHint;
    if (h && h.code === code) {
      detail = { ...detail, code, name: h.name, market: h.market ?? detail.market, cur: h.cur ?? detail.cur, dec: h.dec ?? detail.dec, ...(h.changePct != null ? { changePct: h.changePct } : {}) };
    }
    // 사용자가 그 사이 다른 종목을 눌렀으면 stale 응답 무시.
    if (useStore.getState().selectedCode === code) set({ detail, detailLoading: false });
  },

  // ── 페이퍼 주문 ──────────────────────────────────────────────────────────
  placePaperOrder: (order) => {
    set((s) => {
      const paperOrders = appendOrder(s.paperOrders, order);
      // localStorage 영속 — 실패 시 1회 경고
      const prevSize = s.paperOrders.length;
      const showWarning = prevSize > 0 && paperOrders.length < prevSize + 1; // 상한 도달
      try {
        localStorage.setItem(PAPER_ORDERS_KEY, JSON.stringify(paperOrders));
      } catch {
        if (showWarning) {
          toast.error({ message: '주문 저장 실패. 저장소가 가득 찼을 수 있습니다.' });
        }
      }
      return { paperOrders };
    });
  },

  // ── 가격 알림 ──────────────────────────────────────────────────────────
  addAlert: (alert) => {
    set((s) => {
      // 상한 50 — 초과 시 거부
      if (s.alerts.length >= 50) {
        toast.warning({ message: '알림은 최대 50개까지만 저장할 수 있습니다.' });
        return {};
      }
      const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const newAlert: PriceAlert = { ...alert, id, createdAt: Date.now() };
      const alerts = [...s.alerts, newAlert];
      try {
        localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
      } catch {
        toast.error({ message: '알림 저장 실패.' });
        return {};
      }
      return { alerts };
    });
  },

  removeAlert: (id) => {
    set((s) => {
      const alerts = s.alerts.filter((a) => a.id !== id);
      try {
        localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
      } catch {
        toast.error({ message: '알림 삭제 실패.' });
        return {};
      }
      return { alerts };
    });
  },

  pushNotification: (n) => {
    set((s) => {
      const notifications = [...s.notifications, { ...n, id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, at: Date.now() }];
      // 상한 50 — 초과 시 오래된 것 제거
      if (notifications.length > 50) {
        notifications.shift();
      }
      try {
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
      } catch {
        // 영속 실패는 무시 — 사용자가 스크롤한 상태일 수 있음
      }
      return { notifications };
    });
  },

  markNotificationRead: (id) => {
    set((s) => {
      const notifications = s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
      try {
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
      } catch { /* ignore */ }
      return { notifications };
    });
  },

  markAllNotificationsRead: () => {
    set((s) => {
      const notifications = s.notifications.map((n) => ({ ...n, read: true }));
      try {
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
      } catch { /* ignore */ }
      return { notifications };
    });
  },

  // ── 부동산 스크리너 ──────────────────────────────────────────────────────
  loadRealestate: async () => {
    const s = useStore.getState();
    if (!s.aptComplexes) {
      try {
        const r = await api.getAptComplexes();
        if ('needsCollect' in r) { set({ aptNeedsCollect: true }); return; }
        set({ aptComplexes: r, aptNeedsCollect: false });
      } catch (e) {
        set({ aptError: String((e as Error)?.message || e) });
        return;
      }
    }
    if (!useStore.getState().aptScreen) await useStore.getState().runScreen();
  },
  setScreenerQuery: (patch) => {
    set((s) => ({ screenerQuery: { ...s.screenerQuery, ...patch } }));
    void useStore.getState().runScreen();
  },
  runScreen: async () => {
    const token = ++screenToken;
    set({ aptScreenLoading: true, aptError: null });
    try {
      const r = await api.screenApartments(useStore.getState().screenerQuery);
      if (token !== screenToken) return; // 그 사이 조건이 또 바뀜 — 이 응답은 버린다
      if ('needsCollect' in r) { set({ aptNeedsCollect: true, aptScreenLoading: false }); return; }

      // "지난 갱신 대비"(디자인 D7): 배치 세대(generatedAt)가 바뀌었으면 스냅샷을 민다.
      // 값은 관심단지만 저장 — 전체 8천 단지를 localStorage 에 넣을 이유가 없다.
      const { aptSnapshot, aptWatchlist } = useStore.getState();
      let snap = aptSnapshot;
      if (aptWatchlist.length && (!aptSnapshot.cur || aptSnapshot.cur.generatedAt !== r.generatedAt)) {
        const byId = new Map(r.ranked.map((x) => [x.id, x.value]));
        const values: Record<string, number | null> = {};
        for (const id of aptWatchlist) values[id] = byId.get(id) ?? null;
        snap = { cur: { generatedAt: r.generatedAt, signal: r.signal, dealType: r.dealType, values }, prev: aptSnapshot.cur };
        writeJson(APT_SNAP_KEY, snap.cur);
        writeJson(`${APT_SNAP_KEY}.prev`, snap.prev);
      }
      set({ aptScreen: r, aptScreenLoading: false, aptNeedsCollect: false, aptSnapshot: snap });
    } catch (e) {
      if (token !== screenToken) return;
      set({ aptError: String((e as Error)?.message || e), aptScreenLoading: false });
    }
  },
  setHoveredComplex: (id, source = 'list') => {
    if (useStore.getState().hoveredComplexId !== id) set({ hoveredComplexId: id, hoverSource: source });
  },
  selectComplex: (id, source = 'list') => set({ selectedComplexId: id, selectionSource: source }),
  setAreaFilter: (f) => set({ areaFilter: f }),
  toggleAptWatch: (aptSeq) => {
    set((s) => {
      const has = s.aptWatchlist.includes(aptSeq);
      const aptWatchlist = has ? s.aptWatchlist.filter((x) => x !== aptSeq) : [...s.aptWatchlist, aptSeq];
      writeJson(APT_WATCH_KEY, aptWatchlist);
      return { aptWatchlist };
    });
  },
  setAptMapFailed: (v, reason) => set({ aptMapFailed: v, aptMapFailReason: v ? (reason ?? null) : null }),
}));
