// M0 백엔드 계약의 도메인 타입.
// 프론트는 이 타입에만 의존한다 → 목(mock)에서 실백엔드로 갈아끼워도 화면 코드 불변.

export type Market = 'KR' | 'US';

export interface IndexQuote {
  code: string;        // 'SPX' | 'IXIC' | 'KOSPI' ...
  name: string;
  market: Market | 'GL'; // GL = 글로벌/기타(VIX, FX)
  price: number;
  change: number;      // 전일 대비 값
  changePct: number;   // 전일 대비 %
  dec: number;         // 표시 소수 자리수
  spark: number[];     // 인트라데이 스파크라인 포인트
  unavailable?: boolean; // 실데이터 실패 → 값 "-"
  /** 지수 레벨은 있으나 전일 대비를 소스가 주지 않음(KIS 모의) → 등락만 "-". */
  changeUnavailable?: boolean;
}

export type HeatmapMarket = 'SP500' | 'NASDAQ' | 'KOSPI';

export interface HeatmapNode {
  symbol: string;
  weight: number;      // 시총 비례 (블록 크기)
  changePct: number;   // 색상
  sector: string;
  industry: string;    // 섹터 내 하위 그룹 (Finviz식)
  price: number;
  market: HeatmapMarket;
}

export interface FearGreed {
  value: number;       // 0~100
  label: string;       // 'Extreme Fear' ... 'Extreme Greed'
  prevWeek: number;
  prevMonth: number;
  prevYear: number;
  updatedAt: string;   // ISO — staleness 표시용
  unavailable?: boolean;
}

// 크립토 공포탐욕지수 (alternative.me). ⚠️ 표시 시 출처 'alternative.me' 필수.
export interface CryptoFG {
  value: number;       // 0~100
  label: string;
  updatedAt: string;
  unavailable?: boolean;
}

export interface MacroItem {
  key: string;
  name: string;
  value: string;       // 이미 포맷된 표시값 (단위 다양)
  changePct: number;
  flat?: boolean;      // true면 등락% 미표시(스냅샷 지표: ECOS KeyStat 등)
  unavailable?: boolean;
}

export interface WatchItem {
  code: string;
  name: string;
  market: Market;
  price: number;
  changePct: number;
  dec: number;
  cur: string;         // '₩' | '$'
  aiSignal: 'buy' | 'hold' | 'sell';
  unavailable?: boolean;
}

export type NewsGroup = '오늘' | '어제' | '이번주';

export interface NewsItem {
  id: string;
  headline: string;
  summary?: string;
  url?: string;            // 원문 아웃링크(Alpha Vantage)
  source: string;
  minutesAgo: number;
  tickers: string[];
  sentiment: 'good' | 'bad' | 'neutral';
  group: NewsGroup;
}

export interface Holding {
  code: string;
  name: string;
  market: Market;
  qty: number;
  avg: number;        // 평단(해당 통화)
  price: number;      // 현재가(해당 통화)
  cur: string;
  dec: number;
  /**
   * 매도가능수량(KIS `ord_psbl_qty`). 미체결 매도가 걸려 있으면 보유수량보다 작다.
   * 매도 검증은 이 값을 쓴다 — qty로 검증하면 이미 팔기로 걸어둔 주식을 또 팔 수 있다.
   */
  sellableQty?: number;
}

export interface Portfolio {
  fxUsdKrw: number;
  source?: 'kis-mock' | 'kis-real';  // 실계좌 연동 출처(목이면 없음)
  unavailable?: boolean;             // 실데이터 연결 실패 → 값 "-"로 표시
  cash?: number;                      // 예수금(현금, KRW). 실계좌만 제공.
  // 요약은 모두 원화(KRW) 환산 기준. totalValue=총자산(현금+유가), securities=유가평가액.
  summary: {
    totalValue: number; securities?: number; pnl: number; pnlPct: number;
    dayPnl: number; dayPnlPct: number; principal: number;
    /** 소스가 일간 등락을 안 줌(KIS 장 시작 전) → 화면은 "-". 0%(보합)와 구별해야 한다. */
    dayPnlUnavailable?: boolean;
  };
  holdings: Holding[];
}

export interface Report {
  code: string;
  name: string;
  stance: 'buy' | 'hold' | 'sell';
  confidence: number;  // 0~100
  date: string;        // YYYY-MM-DD
  cur: string;
  dec: number;
  price: number;
  target: number;
  upsidePct: number;
  per: number;
  pbr: number;
  marketCap: string;
  summary: string;
  points: string[];
  risks: string[];
  unavailable?: boolean;
  /** true = 목표주가가 실데이터 기반(기술적 산출). false/미정 = 소스 없음 → 표시는 '-'. */
  targetReal?: boolean;
  /**
   * true = PER·PBR·시총이 KIS 실데이터. false/미정 = 목값이므로 화면에서 '-'.
   * 미국은 무료 펀더멘털 소스가 없어 항상 false다.
   */
  fundamentalsReal?: boolean;
  /** 실 시가총액(억원, 국내만). fundamentalsReal 일 때만 유효. */
  marketCapEok?: number | null;
}

export interface AiOpinion {
  score: number;       // 0~100
  stance: string;      // '위험선호' 등 한 줄
  markets: { name: string; strength: number }[]; // 0~100
  bull: string[];
  bear: string[];
  unavailable?: boolean;
}

export type ChartPeriod = '1D' | '1W' | '1M' | '1Y';

export interface Candle { date: string; o: number; h: number; l: number; c: number; v: number; }

export interface Level { price: number; qty: number; }
export interface TradeTick { time: string; price: number; qty: number; side: '매수' | '매도'; }

export interface StockDetail {
  code: string;
  name: string;
  market: Market;
  cur: string;         // '₩' | '$'
  dec: number;
  price: number;
  change: number;
  changePct: number;
  low52: number;
  high52: number;
  chart: Record<ChartPeriod, number[]>;
  asks: Level[];       // 매도호가 5 (낮은가→높은가)
  bids: Level[];       // 매수호가 5 (높은가→낮은가)
  trades: TradeTick[];
  ai: { score: number; target: number; upsidePct: number; bull: string[]; bear: string[] };
  info: { marketCap: string; per: number; pbr: number; eps: number; div: string; volume: string };
}

/**
 * 종목 기본정보(KIS `inquire-price`). 목 `DETAIL_META`를 대체한다 —
 * 목값은 실제와 3배 넘게 벌어진다(삼성전자 시총 468조 vs 실제 1,546조).
 * 값이 없으면 null: 화면은 "-"로 표시하고 목으로 메우지 않는다.
 */
export interface StockInfo {
  code: string;
  /** 시가총액(억원) */
  marketCapEok: number | null;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  /** 누적 거래량(주) */
  volume: number | null;
  w52High: number | null;
  w52Low: number | null;
  /** KIS 미제공 — 항상 null */
  div: null;
}

/**
 * 종목별 투자 스코어(규칙 기반, `server/opinion.mjs`).
 * 모델이 아니라 실측 4지표(20일 모멘텀·52주 위치·PER·뉴스 감성)의 가중 혼합이다.
 * 근거 문장은 전부 잰 숫자를 인용한다. 근거가 없으면 이 객체 자체가 null → 화면은 "-".
 */
export interface StockOpinion {
  score: number;
  stance: string;
  bull: string[];
  bear: string[];
  /** 항목별 0~100. 입력이 없던 항목은 null. */
  parts: { momentum: number | null; range: number | null; valuation: number | null; sentiment: number | null };
}

export interface SeoulDistrict {
  name: string;        // '강남구'
  code: string;        // LAWD_CD '11680'
  avgManwon: number;   // 평균 전세 보증금(만원)
  avgEok: number;      // 억 단위
  count: number;       // 전세 거래 건수
  changePct: number;   // 전월 대비 %
}
export interface SeoulRent {
  month: string;       // 'YYYYMM'
  avgManwon: number;
  avgEok: number;
  districts: SeoulDistrict[];
  unavailable?: boolean;
}

/* ── 부동산 스크리너 ─────────────────────────────────────────────────────── */

export type SignalKey =
  | 'momentum3' | 'momentum6' | 'momentum12'
  | 'high52wPct' | 'volumeRatio' | 'jeonseRatio' | 'rs';
export type DealType = 'trade' | 'rent';
export type AreaTier = '~60' | '60~85' | '85~135' | '135~';

/** 단지 마스터 — 배치 사이에 안 변한다. ETag 로 브라우저 캐시. */
export interface AptComplex {
  aptSeq: string;        // 단지 고유 ID '11680-4800'. 이름은 충돌하므로 키로 쓰지 말 것
  aptNm: string;
  gu: string | null;
  umdNm: string;
  lat: number | null;    // 지오코딩 실패 시 null → 지도에 안 뜨고 리스트에만
  lng: number | null;
  buildYear: number | null;
}

/** 한 거래유형의 시그널. 계산 불가는 null — 0 이 아니다. */
export interface KindSignals {
  momentum3: number | null;
  momentum6: number | null;
  momentum12: number | null;
  high52wPct: number | null;   // 0 = 신고가
  volumeRatio: number | null;  // 1.0 = 12개월 평균
  rs: number | null;           // 구 중앙값 대비 %p
  dealCount: number;
}

/** 실제 거래 1건 — 상세 모달 최근거래 표. 이상치 컷 이전의 원본이다(진실 노출). */
export interface AptDeal {
  ym: string;
  day: number | null;
  kind: DealType;
  area: number | null;     // 전용면적 ㎡
  floor: number | null;
  price: number;           // 만원. trade=매매가, rent=보증금
  monthlyRent: number | null; // rent 에서 0 이면 전세
}

export interface AptComplexDetail extends AptComplex {
  sggCd: string;
  roadnm: string;
  jibun: string;
  areaTier: AreaTier | null;
  /** [평당가중앙값, 건수] × 개월. 과거→현재. 거래 없는 달은 [null, 0] */
  series: { t: [number | null, number][]; r: [number | null, number][] };
  /**
   * 3개월 이동 중앙값 × 개월 — 차트 추세선. 시그널이 쓰는 값과 같은 정의(창 안의 모든 거래).
   * 상세 요청 시점에 거래 샤드에서 계산한다(배치 payload 에 상주하면 메모리가 커진다).
   * 샤드가 없으면 null — 추세선만 빠지고 화면은 정상 동작한다.
   */
  smoothed?: { t: (number | null)[]; r: (number | null)[] } | null;
  signals: {
    trade: KindSignals;
    rent: KindSignals;
    jeonseRatio: number | null;
    jeonseRatioTier: AreaTier | null;
  };
  months: string[];
  /** 이상치 컷 [0.4, 2.5]×단지중앙값 으로 제외된 거래 수. */
  outliers?: number;
  /** 평형대별 [평당가중앙값, 건수] (전기간, 이상치 제외 후). 거래 없는 평형대는 키가 없다. */
  tiers: Partial<Record<AreaTier, { t: [number | null, number]; r: [number | null, number] }>>;
  /** 최근 거래 10건, 최신순. */
  recent: AptDeal[];
  /**
   * 층 프로필 — 단지투어의 '층' 축. 저·중·고 구간은 그 단지 최고층 대비 비율로 나눈다.
   * 실거래의 aptDong 은 사실상 비어 있어(강남 60건 중 59건 공백) 동 단위는 만들 수 없다.
   */
  floors?: {
    t: FloorProfile | null;
    r: FloorProfile | null;
  };
  /** 'mock' 이면 상세 모달에 목 배지 강제 — 폴백 상세를 진짜로 오해하면 안 된다. */
  source?: 'live' | 'mock';
}

export interface ScreenQuery {
  signal: SignalKey;
  dealType: DealType;
  minDeals: 3 | 5 | 10;
  gu?: string[];
  areaTier?: AreaTier | null;
  sortDir?: 'desc' | 'asc';
  /** 스펙에는 있으나 v1 프론트는 쓰지 않는다. 지도 성능 실측 후 활성화. */
  bbox?: [number, number, number, number] | null;
}

export interface ScreenRank {
  id: string;
  value: number;
  deals: number;
  rank: number;
  /** 기준월(신고지연 보정) 평당가 중앙값, 만원. 해당 유형 거래가 전혀 없으면 null. */
  price?: number | null;
  /** 대표 거래 총액(만원) — 지도 라벨 "매 15.5억". 대표 평형 = 최다 거래 면적. */
  amount?: number | null;
  /** 대표 거래 전용면적(㎡) — 지도 라벨 "59㎡". */
  area?: number | null;
}

export interface ScreenResult {
  ranked: ScreenRank[];
  total: number;
  /** 그 시그널을 계산할 수 없어 모집단에서 빠진 단지 수. 화면에 표시해야 한다. */
  nullCount: number;
  signal: SignalKey;
  dealType: DealType;
  minDeals: number;
  headline: { text: string; detail: string; dealType: string } | null;
  generatedAt: string;
  dataMonth: string;
  stale: boolean;
  /** 좌표 확보율 5%p 이상 하락(T16). null = 정상 또는 측정 전. */
  geocodeDrop?: { from: number; to: number } | null;
  /** 'mock' 이면 화면에 목 배지를 강제 노출한다. 가짜 숫자를 진짜로 오해하면 안 된다. */
  source: 'live' | 'mock';
}

export interface ComplexesResult {
  generatedAt: string;
  dataMonth: string;
  etag: string;
  items: AptComplex[];
  source?: 'live' | 'mock';
}

/** 배치를 한 번도 안 돌렸을 때. 프론트는 EmptyState 로 안내한다. */
export interface NeedsCollect { needsCollect: true; hint: string }

export interface PaperOrder {
  id: string;
  code: string;
  name: string;
  market: Market;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: number;
  qty: number;
  fee: number;
  at: number; // timestamp
  /**
   * KIS 주문번호(ODNO). 실제로 모의계좌에 접수된 주문이라는 증거.
   * 모의계좌는 당일 주문·체결 조회를 제공하지 않아(`inquire-daily-ccld` 빈 응답,
   * `inquire-psbl-rvsecncl` 미제공) 이력만 로컬에 남긴다 — 금액 계산에는 쓰지 않는다.
   */
  orderNo?: string;
}

/* ── KIS 주문 ──────────────────────────────────────────────────────────────── */

export interface OrderRequest {
  code: string;
  side: 'buy' | 'sell';
  qty: number;
  /** 지정가일 때 필수. */
  price?: number;
  ordType: 'limit' | 'market';
}

export interface OrderResult {
  ok: boolean;
  orderNo: string | null;
  orderTime: string | null;
  /** KIS 원문 메시지. 거부 사유(장 시간 외·잔고 부족 등)를 그대로 보여준다. */
  message: string;
}

/** KIS 주문가능금액 — 미체결분이 이미 차감된 값. 로컬에서 다시 빼면 이중 차감이다. */
export interface Orderable {
  cash: number;
  maxQty: number;
  maxAmount: number;
}

export interface RankingItem {
  rank: number;
  code: string;
  name: string;
  market: 'KR';
  price: number;
  changePct: number;
  volume?: number;
  amount?: number;
}

/** 포트폴리오 수익률 이력 엔트리 — 매일 자동 기록(백엔드 배치). null 필드는 실패 지점(과거 미수집·현재 중단 등). */
export interface PortfolioHistoryEntry {
  date: string;         // YYYY-MM-DD
  totalValue: number | null;  // 포트폴리오 총자산 (KRW)
  principal: number | null;   // 투자원금 (KRW) — R15~R16에서는 미사용
  kospi: number | null;       // KOSPI 지수 (비교용)
  spx: number | null;         // S&P500 지수 (비교용)
}

export interface PortfolioHistoryResult {
  entries: PortfolioHistoryEntry[];
}

/** 층 구간 하나 — 평당가 중앙값과 표본 수. */
export interface FloorBand { ppy: number; count: number }

export interface FloorProfile {
  /** 실거래에서 관측된 최고층 — 단지의 실제 층수 근사 */
  max: number;
  /** false = 최고 5층 이하라 저·중·고 구분이 무의미 */
  banded: boolean;
  low: FloorBand | null;
  mid: FloorBand | null;
  high: FloorBand | null;
}

export interface ComplexDealsResult {
  deals: AptDeal[];
  /**
   * true = 구버전 캐시(샤드 부재)나 배치 미실행 → 재수집 필요.
   * 조회 실패와는 구분된다 — 실패는 reject 로 올라온다(빈 배열로 뭉개면
   * "거래 없는 단지"와 "조회 실패"를 화면이 같은 것으로 보여준다).
   */
  stale?: boolean;
}

/** M0 백엔드가 구현할 계약. 목/실백엔드 공통. */
export interface MarketApi {
  getIndices(): Promise<IndexQuote[]>;
  getHeatmap(): Promise<HeatmapNode[]>;
  getFearGreed(): Promise<FearGreed>;
  getCryptoFearGreed(): Promise<CryptoFG>;
  getMacro(): Promise<MacroItem[]>;
  /** 버핏지수(시가총액÷GDP). 소스 실패 시 해당 시장은 null. */
  getBuffett(): Promise<BuffettData>;
  /** KIS 모의계좌에 실제 주문을 넣는다. 거부 시 ok:false + KIS 메시지. */
  placeOrder(req: OrderRequest): Promise<OrderResult>;
  /** 주문가능금액(KIS 기준). 조회 실패 시 null → 화면은 주문 불가로 처리. */
  getOrderable(code: string, ordType: 'limit' | 'market', price?: number): Promise<Orderable | null>;
  /** 종목 기본정보(시총·PER·PBR 등). 국내만. 실패 시 null → 화면은 "-". */
  getStockInfo(code: string): Promise<StockInfo | null>;
  /** 종목별 투자 스코어(규칙 기반). 국내만. 근거 없으면 null → 화면은 "-". */
  getStockOpinion(code: string): Promise<StockOpinion | null>;
  getWatchlist(): Promise<WatchItem[]>;
  getNews(): Promise<NewsItem[]>;
  getAiOpinion(): Promise<AiOpinion>;
  // 종목 상세. M3에서 asks/bids/trades는 KIS 웹소켓 실시간으로 대체.
  getStockDetail(code: string): Promise<StockDetail>;
  getPortfolio(): Promise<Portfolio>;
  getResearch(): Promise<Report[]>;
  getSeoulRent(): Promise<SeoulRent>;
  /** 단지 마스터. 배치 사이 불변 — 필터를 바꿔도 재요청하지 않는다. */
  getAptComplexes(): Promise<ComplexesResult | NeedsCollect>;
  /** 시그널 순위만. 리스트는 상위 50개, 지도는 전체를 쓴다. */
  screenApartments(q: ScreenQuery): Promise<ScreenResult | NeedsCollect>;
  getAptComplex(aptSeq: string): Promise<AptComplexDetail | null>;
  /** 단지별 거래 내역. 날짜 내림차순. */
  getComplexDeals(aptSeq: string): Promise<ComplexDealsResult>;
  /** 국내주식 실시간 순위. kind: 'up'|'down'|'volume'|'amount', 10개 상한. */
  getRanking(kind: 'up' | 'down' | 'volume' | 'amount', market?: 'all' | 'kospi' | 'kosdaq'): Promise<RankingItem[]>;
  /** 포트폴리오 수익률 이력. days: 조회 일수(22/66/250/전체). */
  getPortfolioHistory(days: number): Promise<PortfolioHistoryResult>;
}

/* ── 버핏지수 ──────────────────────────────────────────────────────────────── */

/**
 * 버핏지수 = 주식시장 시가총액 ÷ 명목 GDP.
 * 절대 임계값 대신 같은 시계열의 최근 10년 분포(min·median·max·백분위)와 함께 읽는다.
 */
export interface BuffettMarket {
  /** '코스피' | '미국' — 나스닥 단독 버핏지수는 성립하지 않는다(server/buffett.mjs 주석 참고). */
  label: string;
  /** 산식 설명 한 줄. */
  note: string;
  currency: 'KRW' | 'USD';
  /** 퍼센트. 예: 165.6 */
  ratio: number;
  /** 시가총액 — 조원 또는 조달러. */
  cap: number;
  /** 명목 GDP — 조원 또는 조달러. */
  gdp: number;
  /** 시총 기준일. KR은 'YYYYMMDD', US는 'YYYY-MM-DD'. */
  asOf: string;
  /** GDP 기준 분기. */
  gdpAsOf: string;
  min: number | null;
  max: number | null;
  median: number | null;
  /** 10년 분포에서의 위치(0~100). */
  percentile: number | null;
  history: { t: string; ratio: number }[];
}

export interface BuffettData {
  kr: BuffettMarket | null;
  us: BuffettMarket | null;
}

/* ── 가격 알림 (S4/C1) ─────────────────────────────────────────────────────── */

export interface PriceAlert {
  id: string;
  code: string;
  name: string;
  market: 'KR' | 'US';
  kind: 'target-above' | 'target-below' | 'move-pct' | 'high52';
  value: number;
  baseline?: number;  // 52주 신고가일 때만 설정 (생성 시점 기준)
  createdAt: number;
}

export interface AppNotification {
  id: string;
  kind: 'price' | 'apt' | 'sys';
  title: string;
  desc: string;
  code?: string;  // price 알림일 때만 (종목 코드)
  at: number;
  read: boolean;
}
