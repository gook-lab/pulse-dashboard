// M0 백엔드 — 첫 조각: F&G 프록시 (키 불필요).
// 외부 API를 프론트가 직접 부르지 않도록 백엔드가 헤더 위장 + 캐시 + 매핑을 담당.
// 실행: node server/index.mjs  (기본 포트 8080, Vite가 /api 를 여기로 프록시)
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { pool } from './lib.mjs';
import { SEOUL_GU, ymOffset } from './realestate/lawd.mjs';
import { fetchDeals, jeonseAgg } from './realestate/collect.mjs';
import { routes as realestateRoutes } from './realestate/index.mjs';
import { createPortfolioHistory } from './portfolioHistory.mjs';
import { createAssetsStore } from './assets.mjs';
import { buildKr as buffettKr, buildUs as buffettUs } from './buffett.mjs';
import { buildOpinion } from './opinion.mjs';

// server/.env 로드 (없어도 무시 — 키 없는 라우트는 그대로 동작)
// ※ collect.mjs 도 자체적으로 로드한다(단독 `pnpm collect` 실행 대비). 중복 호출은 무해.
try { process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url))); } catch { /* no .env */ }

const PORT = process.env.PORT || 8080;
const { FRED_API_KEY, FINNHUB_API_KEY, ECOS_API_KEY, ALPHAVANTAGE_API_KEY } = process.env;
// DATA_GO_KR_KEY 와 UA 는 realestate/collect.mjs 로 이동(단일 소스).

// --- 포트폴리오 이력 관리 (일별 스냅샷) -----------------------------------------
const CACHE_DIR = fileURLToPath(new URL('./cache/', import.meta.url));
let portfolioHistory = null;

// --- 수동 자산 (홈 순자산의 KIS 밖 부분 — 설계 W2) ----------------------------
// 정의는 정적(CRUD), 값은 스냅샷 배치가 매일 합산해 시계열로 남긴다.
const DATA_DIR = fileURLToPath(new URL('./data/', import.meta.url));
const assetsStore = createAssetsStore({ file: `${DATA_DIR}manual-assets.json` });

// --- 작은 TTL 캐시 -----------------------------------------------------------
const cache = new Map(); // key -> { at, ttl, data }
const inflight = new Map(); // key -> Promise (동시 요청 중복 producer 방지: StrictMode 2회 호출 등)
/**
 * @param ttlMs 밀리초, 또는 `(data) => 밀리초`. 함수를 쓰면 결과에 따라 TTL을 줄일 수 있다 —
 *   항목별 폴백으로 일부가 null인 묶음을 정상 TTL만큼 붙잡아두면 순간 실패가 오래 굳는다.
 */
async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return { data: hit.data, stale: false };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const data = await producer();
      cache.set(key, { at: Date.now(), ttl: typeof ttlMs === 'function' ? ttlMs(data) : ttlMs, data });
      return { data, stale: false };
    } catch (err) {
      if (hit) return { data: hit.data, stale: true }; // 실패 시 마지막 값이라도
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// --- CNN Fear & Greed (미국 주식 심리) --------------------------------------
// ⚠️ 봇 차단(418) 회피: User-Agent만으론 부족, Referer/Origin/Accept까지 필요.
const CNN_URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.cnn.com/markets/fear-and-greed',
  'Origin': 'https://www.cnn.com',
};

const RATING_KR = {
  'extreme fear': '극도의 공포',
  'fear': '공포',
  'neutral': '중립',
  'greed': '탐욕',
  'extreme greed': '극도의 탐욕',
};

async function fetchFearGreed() {
  const res = await fetch(CNN_URL, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`CNN ${res.status}`);
  const j = await res.json();
  const fg = j.fear_and_greed;
  return {
    value: Math.round(fg.score),
    label: RATING_KR[fg.rating] ?? fg.rating,
    prevWeek: Math.round(fg.previous_1_week),
    prevMonth: Math.round(fg.previous_1_month),
    prevYear: Math.round(fg.previous_1_year),
    updatedAt: fg.timestamp,
  };
}

// --- alternative.me 크립토 F&G (공식 무료, 키 불필요) ------------------------
async function fetchCryptoFearGreed() {
  const res = await fetch('https://api.alternative.me/fng/?limit=1');
  if (!res.ok) throw new Error(`alt.me ${res.status}`);
  const j = await res.json();
  const d = j.data?.[0];
  return {
    value: Number(d.value),
    label: RATING_KR[String(d.value_classification).toLowerCase()] ?? d.value_classification,
    updatedAt: new Date(Number(d.timestamp) * 1000).toISOString(),
  };
}

// --- 업비트 BTC 시세 (공개, 키 불필요) --------------------------------------
async function fetchBtc() {
  const res = await fetch('https://api.upbit.com/v1/ticker?markets=KRW-BTC');
  if (!res.ok) throw new Error(`upbit ${res.status}`);
  const d = (await res.json())[0];
  return { price: d.trade_price, changePct: +(d.signed_change_rate * 100).toFixed(2) };
}

// --- FRED (미 국채·유가) : 최신 2개 유효값으로 값+등락% -----------------------
async function fredLatest(series) {
  const u = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=10`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`FRED ${res.status}`);
  const obs = (await res.json()).observations.filter((o) => o.value !== '.' && o.value !== '').map((o) => +o.value);
  const value = obs[0], prev = obs[1] ?? obs[0];
  return { value, changePct: +(((value - prev) / prev) * 100).toFixed(2) };
}

// --- Finnhub 시세 (ETF/주식) ------------------------------------------------
async function finnhubQuote(sym) {
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_API_KEY}`);
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  const j = await res.json();
  return { price: j.c, change: j.d, changePct: +(+j.dp).toFixed(2) };
}

// --- ECOS (한국은행) : 기간 조회 → 마지막값 + 직전값 등락 --------------------
async function ecosLatest(stat, cycle, item, spanMs) {
  const now = new Date(), start = new Date(Date.now() - spanMs);
  const fmt = cycle === 'D'
    ? (d) => d.toISOString().slice(0, 10).replace(/-/g, '')
    : (d) => d.toISOString().slice(0, 7).replace('-', '');
  const u = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_API_KEY}/json/kr/1/100/${stat}/${cycle}/${fmt(start)}/${fmt(now)}/${item}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`ECOS ${res.status}`);
  const rows = (await res.json()).StatisticSearch?.row || [];
  if (!rows.length) throw new Error('ECOS empty');
  const vals = rows.map((r) => +r.DATA_VALUE);           // TIME 오름차순 → 마지막이 최신
  const value = vals[vals.length - 1], prev = vals[vals.length - 2] ?? value;
  return { value, time: rows[rows.length - 1].TIME, changePct: +(((value - prev) / prev) * 100).toFixed(2) };
}

const DAY = 86_400_000;

// --- ECOS KeyStatisticList (100대 경제지표 — 한 번에 환율·금리 등) ------------
async function econKey() {
  const res = await fetch(`https://ecos.bok.or.kr/api/KeyStatisticList/${ECOS_API_KEY}/json/kr/1/100`);
  if (!res.ok) throw new Error(`ECOS key ${res.status}`);
  const rows = (await res.json()).KeyStatisticList?.row || [];
  const find = (re) => { const r = rows.find((x) => re.test(x.KEYSTAT_NAME || '')); return r ? +String(r.DATA_VALUE).replace(/,/g, '') : null; };
  return {
    baseRate: find(/한국은행 기준금리/),
    gb3y: find(/국고채수익률\(3년\)/),
    gb5y: find(/국고채수익률\(5년\)/),
    corp3y: find(/회사채수익률/),
    kospi: find(/코스피지수/),
    usdkrw: find(/원\/달러 환율/),
    jpykrw: find(/원\/엔/),
    eurkrw: find(/원\/유로/),
    cnykrw: find(/원\/위안/),
  };
}

// --- 뉴스 취합: Alpha Vantage(감성 라벨) + Finnhub 일반 시장뉴스(대량) 병합 ----
function avParseTime(t) {
  return new Date(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(9, 11) || 0, +t.slice(11, 13) || 0).getTime();
}
// Finnhub는 감성 라벨이 없어 헤드라인 키워드로 경량 분류.
function sentFromText(t = '') {
  const s = t.toLowerCase();
  if (/\b(surge|surges|soar|soars|jump|jumps|rally|rallies|gain|gains|beat|beats|record|all-time high|upgrade|bullish|rise|rises|rebound|boost|top|climbs?|outperform|strong)\b/.test(s)) return 'good';
  if (/\b(fall|falls|drop|drops|plunge|plunges|slump|sink|sinks|miss|misses|cut|cuts|downgrade|bearish|fear|fears|loss|losses|decline|declines|weak|warn|warns|tumble|tumbles|crash|slide|slides|selloff|recession)\b/.test(s)) return 'bad';
  return 'neutral';
}
async function fetchAvNews() {
  // 경제·시장 토픽으로 확장(특정 종목 한정 아님) → 경제 뉴스 취합.
  const res = await fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=financial_markets,economy_macro,economy_monetary,finance&sort=LATEST&limit=50&apikey=${ALPHAVANTAGE_API_KEY}`);
  const j = await res.json();
  if (!j.feed) throw new Error(j.Note || j.Information || 'AV no feed');
  const sent = (l = '') => (/bullish/i.test(l) ? 'good' : /bearish/i.test(l) ? 'bad' : 'neutral');
  return j.feed.map((f, i) => ({
    id: 'av' + i, headline: f.title, summary: (f.summary || '').slice(0, 130), url: f.url,
    source: f.source, ms: avParseTime(f.time_published),
    tickers: (f.ticker_sentiment || []).slice(0, 3).map((t) => t.ticker),
    sentiment: sent(f.overall_sentiment_label),
  }));
}
async function fetchFinnhubNews() {
  const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API_KEY}`);
  if (!res.ok) throw new Error(`Finnhub news ${res.status}`);
  const arr = await res.json();
  return (arr || []).filter((f) => f.headline && f.datetime).map((f) => ({
    id: 'fh' + f.id, headline: f.headline, summary: (f.summary || '').slice(0, 130), url: f.url,
    source: f.source, ms: f.datetime * 1000,
    tickers: (f.related || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3),
    sentiment: sentFromText(f.headline),
  }));
}
// CNN — 클래식 RSS는 2018년에 중단됨(전 피드 stale 확인). Google News RSS로 CNN 경제기사만
// 필터해 수집(무료·키 불필요). 링크는 구글 리다이렉트지만 원문으로 정상 연결된다.
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unesc = (s = '') => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => XML_ENT[e]);
// 경제/시장 관련 헤드라인 판별 — 구글 relevance가 총기사건·연예 등을 섞어 보내므로 백엔드에서 거른다.
const ECON_RE = /\b(econom|market|stock|shares?|fed|earnings?|inflation|rates?|bank|oil|gas|price|ceo|ipo|tariff|trade|dollar|won|yen|euro|crypto|bitcoin|tech|profit|revenue|wall street|nasdaq|s&p|dow|invest|bond|treasur|recession|gdp|jobs?|layoffs?|hous(e|ing)|mortgage|retail|consumer|company|companies|business|merger|acquisition|deal|billion|million|fund|etf|chip|semiconductor|ai\b|startup|valuation|debt|deficit|export|import)\b/i;
async function fetchCnnNews() {
  const u = 'https://news.google.com/rss/search?q=business+when:1d+site:cnn.com&hl=en-US&gl=US&ceid=US:en';
  const res = await fetch(u, { headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] } });
  if (!res.ok) throw new Error(`GoogleNews(CNN) ${res.status}`);
  const xml = (await res.text()).replace(/\n/g, ' ');
  const items = [];
  const re = /<item>(.*?)<\/item>/g;
  let m, i = 0;
  while ((m = re.exec(xml)) && items.length < 20) {   // 소스별 캡: CNN이 피드를 도배하지 않도록
    const block = m[1];
    const pick = (tag) => (block.match(new RegExp(`<${tag}>(.*?)</${tag}>`)) || [])[1] || '';
    const rawTitle = unesc(pick('title').replace(/<!\[CDATA\[|\]\]>/g, ''));
    const headline = rawTitle.replace(/(\s*[-|]\s*CNN( Business| International)?)+\s*$/i, '').trim();
    const link = pick('link').trim();
    const ms = Date.parse(pick('pubDate')) || 0;
    if (!headline || !ms) continue;
    if (!ECON_RE.test(headline)) continue;           // 비경제(사건·연예·정치 단신) 제외
    if (/stock quote|price and forecast|% off\b|best .* we.ve tested|coupon|promo code|deal of the day/i.test(headline)) continue; // 시세페이지·쇼핑 제외
    items.push({
      id: 'cnn' + i++, headline, summary: '', url: link, source: 'CNN', ms,
      tickers: [], sentiment: sentFromText(headline),
    });
  }
  if (!items.length) throw new Error('GoogleNews(CNN) empty');
  return items;
}
async function fetchNews() {
  const [av, fh, cnn] = await Promise.all([
    fetchAvNews().catch(() => []), fetchFinnhubNews().catch(() => []), fetchCnnNews().catch(() => []),
  ]);
  const now = Date.now();
  // 최신순 → 중복 제거(url 우선, 없으면 헤드라인 — 구글 리다이렉트 링크는 헤드라인으로도 중복 제거)
  const seen = new Set(), uniq = [];
  for (const n of [...av, ...fh, ...cnn].sort((a, b) => b.ms - a.ms)) {
    const keys = [n.url, n.headline].filter(Boolean).map((k) => k.toLowerCase().trim());
    if (!keys.length || keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k)); uniq.push(n);
  }
  const grp = (ms) => { const days = (now - ms) / DAY; return days < 1 ? '오늘' : days < 2 ? '어제' : '이번주'; };
  const items = uniq.slice(0, 60).map((n) => ({
    id: n.id, headline: n.headline, summary: n.summary, url: n.url, source: n.source,
    minutesAgo: Math.max(0, Math.round((now - n.ms) / 60_000)),
    tickers: n.tickers, sentiment: n.sentiment, group: grp(n.ms),
  }));
  return { fetchedAt: new Date(now).toISOString(), items };
}

// --- KIS 한국투자증권 (검증 전까지 모의) -------------------------------------
const KIS = (() => {
  const mock = process.env.KIS_MODE !== 'real';
  return {
    mock,
    base: mock ? 'https://openapivts.koreainvestment.com:29443' : 'https://openapi.koreainvestment.com:9443',
    key: mock ? process.env.KIS_MOCK_APP_KEY : process.env.KIS_REAL_APP_KEY,
    secret: mock ? process.env.KIS_MOCK_APP_SECRET : process.env.KIS_REAL_APP_SECRET,
  };
})();

/** 지연 헬퍼 — KIS 게이트/페이지 간격에서 쓴다. */
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * KIS 전역 호출 게이트.
 *
 * 모의계좌는 초당 호출 상한이 낮아, 라우트가 각자 요청을 던지면 서로를 밀어낸다
 * (실측: 서로 다른 종목 6건 연속 조회에서 1건이 502). 그동안 라우트마다 재시도·짧은 TTL로
 * 땜질해 왔지만 원인은 하나였다 — 동시성 제어가 없다는 것.
 *
 * 모든 KIS HTTP 호출을 한 줄로 세우고 최소 간격을 강제한다. 개별 재시도는 그대로 두되
 * (게이트는 순서만 보장하고 실패를 되돌리지는 않는다) 애초에 밀리는 빈도를 없앤다.
 * ⚠️ 실시간 ws 게이트웨이(kisGateway)는 별도 채널이라 여기 해당 없음.
 */
const kisFetch = (() => {
  const MIN = 200, MAX = 1600;
  let gap = 250;              // 적응형 — 고정값은 늘 틀린다(TR별로 상한이 다르다)
  let chain = Promise.resolve();
  let lastAt = 0;
  return (url, init) => {
    const run = async () => {
      const wait = lastAt + gap - Date.now();
      if (wait > 0) await nap(wait);
      lastAt = Date.now();
      const res = await fetch(url, init);
      // 스로틀은 5xx/429로 온다 → 간격을 벌리고, 성공이 이어지면 천천히 좁힌다.
      // ⚠️ 여기서 자동 재시도하지 않는다 — 주문(kisPost)까지 재시도하면 중복 주문이 된다.
      if (res.status >= 500 || res.status === 429) gap = Math.min(MAX, Math.round(gap * 1.6));
      else gap = Math.max(MIN, gap - 15);
      return res;
    };
    // 성공·실패 모두 다음 호출로 이어지게 한다(한 건 실패로 큐가 멈추면 안 된다).
    const p = chain.then(run, run);
    chain = p.then(() => {}, () => {});
    return p;
  };
})();

let _kisTok = null;         // {token, exp} — 24h 유효 + 발급 1회/분 제한 → 반드시 캐시
let _kisTokPromise = null;  // 동시 발급 방지(1분당 1회 제한 회피)
async function kisToken() {
  if (_kisTok && Date.now() < _kisTok.exp) return _kisTok.token;
  if (_kisTokPromise) return _kisTokPromise;
  _kisTokPromise = (async () => {
    const res = await kisFetch(`${KIS.base}/oauth2/tokenP`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: KIS.key, appsecret: KIS.secret }),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.access_token) throw new Error(`KIS token: ${j.msg1 || res.status}`);
    _kisTok = { token: j.access_token, exp: Date.now() + (j.expires_in - 3600) * 1000 };
    return _kisTok.token;
  })().finally(() => { _kisTokPromise = null; });
  return _kisTokPromise;
}

// WebSocket 실시간 접속키(approval_key) — 백엔드 발급, 만료 짧게 브라우저로 전달.
let _kisApproval = null;
async function kisApprovalKey() {
  if (_kisApproval && Date.now() < _kisApproval.exp) return _kisApproval.key;
  const res = await kisFetch(`${KIS.base}/oauth2/Approval`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: KIS.key, secretkey: KIS.secret }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.approval_key) throw new Error(`KIS approval: ${j.msg1 || res.status}`);
  _kisApproval = { key: j.approval_key, exp: Date.now() + 12 * 60 * 60_000 }; // 12h
  return _kisApproval.key;
}

async function kisGet(path, trId, params) {
  const token = await kisToken();
  const qs = new URLSearchParams(params).toString();
  const res = await kisFetch(`${KIS.base}${path}?${qs}`, {
    headers: { authorization: `Bearer ${token}`, appkey: KIS.key, appsecret: KIS.secret, tr_id: trId, 'content-type': 'application/json' },
  });
  if (!res.ok) throw new Error(`KIS ${path} ${res.status}`);
  return res.json();
}

async function kisQuote(code) {
  const j = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100',
    { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code });
  const o = j.output || {};
  return { code, price: +o.stck_prpr, change: +o.prdy_vrss, changePct: +o.prdy_ctrt };
}

/**
 * 종목 기본정보(시총·PER·PBR·EPS·거래량·52주). inquire-price가 시세와 함께 다 준다.
 * ⚠️ 배당수익률은 이 TR에 없다 — 목값으로 채우지 말고 null로 두고 화면에서 "-".
 */
async function kisInfo(code) {
  const j = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100',
    { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code });
  const o = j.output || {};
  const num = (v) => (Number.isFinite(+v) && v !== '' ? +v : null);
  return {
    code,
    marketCapEok: num(o.hts_avls),   // 억원
    per: num(o.per),
    pbr: num(o.pbr),
    eps: num(o.eps),
    bps: num(o.bps),
    volume: num(o.acml_vol),
    w52High: num(o.w52_hgpr),
    w52Low: num(o.w52_lwpr),
    div: null,                        // KIS 미제공
  };
}

async function kisChart(code, period) {
  const div = period === 'W' ? 'W' : period === 'M' ? 'M' : 'D';
  const back = period === 'M' ? 1800 : period === 'W' ? 500 : 130;
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const j = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice', 'FHKST03010100', {
    FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code,
    FID_INPUT_DATE_1: ymd(new Date(Date.now() - back * 86_400_000)), FID_INPUT_DATE_2: ymd(new Date()),
    FID_PERIOD_DIV_CODE: div, FID_ORG_ADJ_PRC: '0',
  });
  const rows = (j.output2 || []).filter((r) => r && r.stck_clpr)
    .map((r) => ({ date: r.stck_bsop_date, o: +r.stck_oprc, h: +r.stck_hgpr, l: +r.stck_lwpr, c: +r.stck_clpr, v: +r.acml_vol }));
  return rows.reverse(); // 과거 → 최신
}

async function kisIndex(iscd) {
  const j = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-index-price', 'FHPUP02100000',
    { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: iscd });
  const o = j.output || {};
  // KIS 모의는 지수 레벨만 주고 등락·시가·거래량을 전부 0으로 비워 보낸다. 그 0을 그대로
  // 넘기면 화면에 "0.00% 보합"으로 찍혀 실제 보합과 구별되지 않는다 → 없음을 명시한다.
  const noChange = +o.acml_vol === 0 && +o.bstp_nmix_oprc === 0 && +o.bstp_nmix_prdy_vrss === 0;
  return {
    price: +o.bstp_nmix_prpr,
    change: +o.bstp_nmix_prdy_vrss,
    changePct: +o.bstp_nmix_prdy_ctrt,
    ...(noChange && { changeUnavailable: true }),
  };
}

// 시장 코드: all/코스피/코스닥
const MKT_ISCD = { all: '0000', kospi: '0001', kosdaq: '1001' };
const rankHeaders = (token, trId) => ({ authorization: `Bearer ${token}`, appkey: KIS.key, appsecret: KIS.secret, tr_id: trId, custtype: 'P', 'content-type': 'application/json' });

// KIS 거래량/거래대금 순위 (volume-rank). by: volume | amount.
async function kisRank({ market = 'all', by = 'volume', limit = 100 } = {}) {
  const token = await kisToken();
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J', FID_COND_SCR_DIV_CODE: '20171', FID_INPUT_ISCD: MKT_ISCD[market] || '0000',
    FID_DIV_CLS_CODE: '0', FID_BLNG_CLS_CODE: by === 'amount' ? '3' : '0', FID_TRGT_CLS_CODE: '111111111',
    FID_TRGT_EXLS_CLS_CODE: '0000000000', FID_INPUT_PRICE_1: '', FID_INPUT_PRICE_2: '', FID_VOL_CNT: '', FID_INPUT_DATE_1: '',
  });
  const res = await kisFetch(`${KIS.base}/uapi/domestic-stock/v1/quotations/volume-rank?${params}`, { headers: rankHeaders(token, 'FHPST01710000') });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.rt_cd && j.rt_cd !== '0')) throw new Error(`KIS rank: ${j.msg1 || res.status}`);
  return (j.output || []).slice(0, limit).map((r, i) => ({
    rank: +r.data_rank || i + 1, code: r.mksc_shrn_iscd, name: r.hts_kor_isnm,
    price: +r.stck_prpr, changePct: +r.prdy_ctrt, volume: +r.acml_vol, amount: +r.acml_tr_pbmn,
  }));
}

// KIS 등락률 순위 (ranking/fluctuation). dir: up(급등) | down(급락).
async function kisFluctuation({ market = 'all', dir = 'up', limit = 100 } = {}) {
  const token = await kisToken();
  const params = new URLSearchParams({
    fid_cond_mrkt_div_code: 'J', fid_cond_scr_div_code: '20170', fid_input_iscd: MKT_ISCD[market] || '0000',
    fid_rank_sort_cls_code: dir === 'up' ? '0' : '1', fid_input_cnt_1: '0', fid_prc_cls_code: '0',
    fid_input_price_1: '', fid_input_price_2: '', fid_vol_cnt: '', fid_trgt_cls_code: '0',
    fid_trgt_exls_cls_code: '0', fid_div_cls_code: '0', fid_rsfl_rate1: '', fid_rsfl_rate2: '',
  });
  const res = await kisFetch(`${KIS.base}/uapi/domestic-stock/v1/ranking/fluctuation?${params}`, { headers: rankHeaders(token, 'FHPST01700000') });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.rt_cd && j.rt_cd !== '0')) throw new Error(`KIS fluctuation: ${j.msg1 || res.status}`);
  return (j.output || []).slice(0, limit).map((r, i) => ({
    rank: +r.data_rank || i + 1, code: r.stck_shrn_iscd, name: r.hts_kor_isnm,
    price: +r.stck_prpr, changePct: +r.prdy_ctrt, volume: +r.acml_vol, amount: +r.acml_tr_pbmn,
  }));
}

// 코스피/코스닥 TOP 100 — KIS 랭킹은 30건 캡이라 다음(Daum) 금융 API 사용(실시장 데이터, 무료·키 불필요).
// ⚠️ changeRate 는 부호 없는 값 — change(FALL/RISE)가 방향이다.
async function daumTop100(market = 'KOSPI', by = 'cap') {
  const field = by === 'amount' ? 'accTradePrice' : 'marketCap';
  const u = `https://finance.daum.net/api/trend/market_capitalization?page=1&perPage=100&fieldName=${field}&order=desc&market=${market}`;
  const res = await fetch(u, {
    headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'], Referer: 'https://finance.daum.net/domestic/market_capitalization' },
  });
  if (!res.ok) throw new Error(`Daum top100 ${res.status}`);
  const j = await res.json();
  const rows = j.data || [];
  if (!rows.length) throw new Error('Daum top100 empty');
  return rows.map((x, i) => {
    const rate = Math.abs(+x.changeRate || 0) * 100;
    const sign = x.change === 'FALL' ? -1 : x.change === 'RISE' ? 1 : 0;
    return {
      rank: x.rank || i + 1,
      code: String(x.symbolCode || x.code || '').replace(/^A/, ''),
      name: x.name, price: +x.tradePrice,
      changePct: +(sign * rate).toFixed(2),
      marketCap: +x.marketCap || 0,
    };
  });
}

// 당일 분봉(장중 촘촘한 차트용). 30개/호출 → 뒤로 페이지네이션해 하루치(~수백) 수집.

async function kisMinutes(code, pages = 13) {
  const out = [];
  let hour = '153000';
  // 모의 환경은 초당 호출 상한이 낮다 — 13페이지를 간격 없이 던지면 중간에 끊겨
  // 최근 몇십 분만 남는다(1일 차트가 뭉텅이로 비어 보임). 간격 + 1회 재시도로 손실을 줄인다.
  const page = (h) => kisGet('/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice', 'FHKST03010200', {
    FID_ETC_CLS_CODE: '', FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code,
    FID_INPUT_HOUR_1: h, FID_PW_DATA_INCU_YN: 'N',
  }).catch(() => null);
  for (let p = 0; p < pages; p++) {
    if (p > 0) await nap(120);
    let j = await page(hour);
    // 스로틀은 두 번까지 넘긴다. 한 페이지가 죽으면 다음 시각을 알 수 없어 순회가 끝나므로
    // (= 하루가 최근 몇십 분으로 잘린다) 여기서 포기하는 비용이 크다.
    for (let r = 0; !j && r < 2; r++) { await nap(400 + r * 600); j = await page(hour); }
    const rows = (j?.output2 || []).filter((r) => r && r.stck_prpr);
    if (!rows.length) break;
    for (const r of rows) out.push({ date: r.stck_bsop_date, time: r.stck_cntg_hour, o: +r.stck_oprc, h: +r.stck_hgpr, l: +r.stck_lwpr, c: +r.stck_prpr, v: +r.cntg_vol });
    const last = rows[rows.length - 1]?.stck_cntg_hour; // 가장 이른 시각
    if (!last || last <= '090000') break;
    // 다음 페이지: 마지막 시각 1분 이전
    const t = String(Math.max(0, (+last) - 100)).padStart(6, '0');
    if (t === hour) break;
    hour = t;
  }
  // 시간 오름차순(과거→최신)
  return out.sort((a, b) => (a.time < b.time ? -1 : 1)).map((r) => ({ date: r.date + r.time, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
}

// 계좌번호: KIS_ACCOUNT_NO = "CANO-01"(예: 50123456-01). 미설정이면 throw → 프론트 목 폴백.
function kisAccount() {
  const m = (process.env.KIS_ACCOUNT_NO || '').match(/(\d{6,})\D*(\d{2})/);
  if (!m) throw new Error('KIS_ACCOUNT_NO 미설정(모의투자 계좌번호 필요)');
  return { cano: m[1], acnt: m[2] };
}

// --- KIS 주문 (국내주식 현금) --------------------------------------------------
// 주문은 KIS 모의계좌가 단일 진실 소스다. 로컬에 예수금을 따로 계산해 두면 화면과
// 계좌가 갈라진다(이전 구조의 버그) — 주문 후에는 반드시 잔고를 다시 읽는다.
/** 상태코드를 실은 에러 — 라우터가 err.status를 그대로 응답한다. */
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** POST 본문 JSON 파싱. 본문 상한 64KB(주문 페이로드는 수백 바이트). */
async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 65_536) throw httpError(413, '본문이 너무 큽니다');
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw httpError(400, 'JSON 본문 파싱 실패'); }
}

const ORDER_TR = {
  mock: { buy: 'VTTC0802U', sell: 'VTTC0801U' },
  real: { buy: 'TTTC0802U', sell: 'TTTC0801U' },
};

/**
 * 거래(trading) GET 공통. 시세용 `kisGet`과 달리 `custtype`이 필수이고 rt_cd도 봐야 한다
 * (HTTP 200 + rt_cd!=0 으로 거부가 오므로 !res.ok 검사만으로는 실패를 놓친다).
 */
async function kisGetTrading(path, trId, params) {
  const token = await kisToken();
  const res = await kisFetch(`${KIS.base}${path}?${new URLSearchParams(params)}`, {
    headers: {
      authorization: `Bearer ${token}`, appkey: KIS.key, appsecret: KIS.secret,
      tr_id: trId, custtype: 'P', 'content-type': 'application/json',
    },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.rt_cd && j.rt_cd !== '0')) throw new Error(`KIS ${path}: ${j.msg1 || res.status}`);
  return j;
}

/** KIS POST 공통. 주문류는 hashkey 없이도 통과하지만 tr_id·custtype은 필수. */
async function kisPost(path, trId, body) {
  const token = await kisToken();
  const res = await kisFetch(`${KIS.base}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`, appkey: KIS.key, appsecret: KIS.secret,
      tr_id: trId, custtype: 'P', 'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok && j.rt_cd === '0', status: res.status, json: j };
}

/**
 * 현금 주문. ordType 'limit'이면 지정가(ORD_DVSN '00')로 price 필수, 'market'이면 시장가('01').
 * KIS가 거부하면 거부 사유(msg1)를 그대로 올려보낸다 — "장 시간이 아닙니다" 같은 메시지가
 * 사용자에게 그대로 보여야 한다(임의 문구로 덮으면 원인을 못 찾는다).
 */
async function kisOrder({ code, side, qty, price, ordType }) {
  const { cano, acnt } = kisAccount();
  const trId = ORDER_TR[KIS.mock ? 'mock' : 'real'][side];
  if (!trId) throw new Error(`side는 buy|sell만 허용: ${side}`);
  const limit = ordType === 'limit';
  const { ok, status, json } = await kisPost('/uapi/domestic-stock/v1/trading/order-cash', trId, {
    CANO: cano, ACNT_PRDT_CD: acnt, PDNO: code,
    ORD_DVSN: limit ? '00' : '01',
    ORD_QTY: String(qty),
    ORD_UNPR: limit ? String(Math.round(price)) : '0',
  });
  const o = json.output || {};
  return {
    ok,
    orderNo: o.ODNO || null,
    orderTime: o.ORD_TMD || null,
    // rt_cd!=0 이면 msg1이 거부 사유. 성공도 msg1에 "정상처리" 류가 온다.
    message: json.msg1 || (ok ? '주문 접수' : `KIS 응답 ${status}`),
    code: json.msg_cd || null,
  };
}

/** 주문가능금액. 미체결 주문분이 이미 빠진 값이라 로컬 차감이 필요 없다. */
async function kisOrderable({ code, price, ordType }) {
  const { cano, acnt } = kisAccount();
  const j = await kisGetTrading('/uapi/domestic-stock/v1/trading/inquire-psbl-order',
    KIS.mock ? 'VTTC8908R' : 'TTTC8908R', {
      CANO: cano, ACNT_PRDT_CD: acnt, PDNO: code,
      ORD_UNPR: ordType === 'limit' ? String(Math.round(price || 0)) : '0',
      ORD_DVSN: ordType === 'limit' ? '00' : '01',
      CMA_EVLU_AMT_ICLD_YN: 'N', OVRS_ICLD_YN: 'N',
    });
  const o = j.output || {};
  return {
    cash: +o.ord_psbl_cash || 0,            // 주문가능현금
    maxQty: +o.nrcvb_buy_qty || 0,          // 미수없는 매수가능수량
    maxAmount: +o.nrcvb_buy_amt || 0,
  };
}

/**
 * 미체결(정정·취소 가능) 주문.
 * ⚠️ 모의계좌에서는 KIS가 "모의투자에서는 해당업무가 제공되지 않습니다"로 거부한다(실측).
 *    실전 전환 시에만 값이 온다. 프론트는 실패를 빈 목록으로 흘려보내고 로컬 이력을 쓴다.
 */
async function kisOpenOrders() {
  const { cano, acnt } = kisAccount();
  const j = await kisGetTrading('/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl',
    KIS.mock ? 'VTTC8036R' : 'TTTC8036R', {
      CANO: cano, ACNT_PRDT_CD: acnt, CTX_AREA_FK100: '', CTX_AREA_NK100: '',
      INQR_DVSN_1: '0', INQR_DVSN_2: '0',
    });
  return (j.output || []).map((r) => ({
    orderNo: r.odno,
    code: r.pdno,
    name: r.prdt_name,
    side: r.sll_buy_dvsn_cd === '02' ? 'buy' : 'sell',
    qty: +r.ord_qty || 0,
    remainQty: +r.psbl_qty || 0,      // 정정·취소 가능수량 = 미체결 잔량
    price: +r.ord_unpr || 0,
    time: r.ord_tmd || '',
    state: 'open',
  }));
}

/** 당일 주문·체결 내역. 체결/미체결을 한 번에 본다. */
async function kisTodayOrders() {
  const { cano, acnt } = kisAccount();
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const j = await kisGetTrading('/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
    KIS.mock ? 'VTTC8001R' : 'TTTC8001R', {
      CANO: cano, ACNT_PRDT_CD: acnt, INQR_STRT_DT: d, INQR_END_DT: d,
      SLL_BUY_DVSN_CD: '00', INQR_DVSN: '00', PDNO: '', CCLD_DVSN: '00',
      ORD_GNO_BRNO: '', ODNO: '', INQR_DVSN_3: '00', INQR_DVSN_1: '',
      CTX_AREA_FK100: '', CTX_AREA_NK100: '',
    });
  return (j.output1 || []).map((r) => {
    const qty = +r.ord_qty || 0, filled = +r.tot_ccld_qty || 0;
    return {
      orderNo: r.odno,
      code: r.pdno,
      name: r.prdt_name,
      side: r.sll_buy_dvsn_cd === '02' ? 'buy' : 'sell',   // 01=매도, 02=매수
      qty,
      filledQty: filled,
      price: +r.ord_unpr || 0,
      filledPrice: +r.avg_prvs || 0,
      amount: +r.tot_ccld_amt || 0,
      time: r.ord_tmd || '',
      /** filled=0 미체결 · filled<qty 부분체결 · 그 외 체결 */
      state: filled === 0 ? 'open' : filled < qty ? 'partial' : 'filled',
    };
  });
}

// KIS 잔고조회(포트폴리오). 모의=VTTC8434R / 실전=TTTC8434R. 국내주식 기준.
async function kisBalance() {
  const { cano, acnt } = kisAccount();
  const token = await kisToken();
  const trId = KIS.mock ? 'VTTC8434R' : 'TTTC8434R';
  const params = new URLSearchParams({
    CANO: cano, ACNT_PRDT_CD: acnt, AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '02',
    UNPR_DVSN: '01', FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '01', CTX_AREA_FK100: '', CTX_AREA_NK100: '',
  });
  const res = await kisFetch(`${KIS.base}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`, {
    headers: { authorization: `Bearer ${token}`, appkey: KIS.key, appsecret: KIS.secret, tr_id: trId, custtype: 'P', 'content-type': 'application/json' },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.rt_cd && j.rt_cd !== '0')) throw new Error(`KIS balance: ${j.msg1 || res.status}`);
  const sum = (j.output2 || [])[0] || {};
  const holdings = (j.output1 || []).filter((r) => +r.hldg_qty > 0).map((r) => {
    const evlu = +r.evlu_amt, dayPct = +r.fltt_rt || 0;
    // KIS는 장 시작 전 일간 등락을 안 준다(fltt_rt·bfdy_cprs_icdc 모두 0). 그 0을 그대로 더하면
    // "일간손익 ₩0 / 0%"가 실제 보합처럼 찍힌다 — 없음과 보합은 구별돼야 한다.
    const dayMissing = +r.fltt_rt === 0 && +r.bfdy_cprs_icdc === 0;
    return {
      code: r.pdno, name: r.prdt_name, market: 'KR', qty: +r.hldg_qty,
      // 매도가능수량 — 미체결 매도가 걸려 있으면 보유수량보다 작다.
      sellableQty: +r.ord_psbl_qty || 0,
      avg: Math.round(+r.pchs_avg_pric), price: +r.prpr, cur: '₩', dec: 0,
      dayPnl: dayMissing ? 0 : evlu * (dayPct / (100 + dayPct || 1)),
      dayMissing,
    };
  });
  const fx = await ecosLatest('731Y001', 'D', '0000001', 20 * DAY).then((r) => r.value).catch(() => 1400);
  // 예수금은 `prvs_rcdl_excc_amt`(가수도정산금액 = D+2 정산 반영)를 쓴다.
  // `dnca_tot_amt`(예수금총금액)는 D+2 결제 전이라 매수해도 그대로여서, 주문했는데 예수금이
  // 안 줄어드는 것처럼 보인다. 실측: 1,000만 계좌에서 24.9만 매수 후
  // dnca=10,000,000 / prvs_rcdl=9,750,970(= 매수금 249,000 + 제비용 30 차감).
  const cash = Math.round(+sum.prvs_rcdl_excc_amt || +sum.dnca_tot_amt || 0);
  const securities = Math.round(+sum.evlu_amt_smtl_amt || holdings.reduce((a, h) => a + h.price * h.qty, 0)); // 유가증권 평가액
  const totalValue = Math.round(+sum.tot_evlu_amt || (cash + securities)); // 총자산(현금+유가)
  const principal = Math.round(+sum.pchs_amt_smtl_amt || 0);
  const pnl = Math.round(+sum.evlu_pfls_smtl_amt || (securities - principal));
  const dayPnl = Math.round(holdings.reduce((a, h) => a + h.dayPnl, 0));
  // 보유가 있는데 전부 일간 등락 미제공이면 합계도 의미가 없다 → 화면에서 "-".
  const dayPnlUnavailable = holdings.length > 0 && holdings.every((h) => h.dayMissing);
  return {
    fxUsdKrw: fx, source: KIS.mock ? 'kis-mock' : 'kis-real', cash,
    summary: {
      totalValue, securities, pnl,
      pnlPct: principal ? +((pnl / principal) * 100).toFixed(2) : 0,
      dayPnl, dayPnlPct: securities ? +((dayPnl / securities) * 100).toFixed(2) : 0,
      ...(dayPnlUnavailable && { dayPnlUnavailable: true }),
      principal,
    },
    holdings: holdings.map(({ dayPnl: _d, dayMissing: _m, ...h }) => h),
  };
}

// --- 서울 전세 실거래 (data.go.kr 아파트 전월세) -----------------------------
// ⚠️ WAF 회피: User-Agent 필수(curl 기본 UA는 400 Request Blocked).
// 법정동코드 표·수집 계층은 realestate/ 로 추출됨(단일 소스). 여기는 구 단위 집계만 남는다.

// 한 구·한 달의 전세 평균 보증금(만원) + 건수.
// fetchDeals 가 UA 위장·지수백오프·페이지네이션을, jeonseAgg 가 집계를 담당한다.
async function aptRentJeonse(lawd, ymd) {
  const { rows } = await fetchDeals('rent', lawd, ymd);
  return jeonseAgg(rows);
}

async function seoulJeonse() {
  const cur = ymOffset(1), prev = ymOffset(2);
  // 구 단위 5개씩 병렬, 구 내부 두 달은 순차 → 실효 동시성 ~5 (throttle 회피)
  const districts = await pool(Object.entries(SEOUL_GU), 5, async ([name, code]) => {
    const c = await aptRentJeonse(code, cur).catch(() => ({ sum: 0, count: 0 }));
    const p = await aptRentJeonse(code, prev).catch(() => ({ sum: 0, count: 0 }));
    const avg = c.count ? Math.round(c.sum / c.count) : 0;
    const avgPrev = p.count ? p.sum / p.count : 0;
    const changePct = avgPrev ? +(((avg - avgPrev) / avgPrev) * 100).toFixed(1) : 0;
    return { name, code, avgManwon: avg, avgEok: +(avg / 10000).toFixed(2), count: c.count, changePct };
  });
  const valid = districts.filter((d) => d.count > 0);
  const avgAll = valid.length ? Math.round(valid.reduce((s, d) => s + d.avgManwon, 0) / valid.length) : 0;
  return { month: cur, avgManwon: avgAll, avgEok: +(avgAll / 10000).toFixed(2), districts };
}

// --- 지수/매크로 프로듀서(라우트+AI 공유) + AI 종합 의견(규칙 기반) ----------
async function usIndices() {
  const [SPY, QQQ, DIA] = await Promise.all([finnhubQuote('SPY'), finnhubQuote('QQQ'), finnhubQuote('DIA')]);
  return { SPY, QQQ, DIA };
}
async function krIndices() {
  // 지수별 개별 폴백 — KIS 일시 스로틀 시 502 대신 null 반환(프론트가 목으로 폴백, 콘솔 에러 0 유지).
  const [KOSPI, KOSDAQ] = await Promise.all([
    kisIndex('0001').catch(() => null),
    kisIndex('1001').catch(() => null),
  ]);
  return { KOSPI, KOSDAQ };
}
async function macroBundle() {
  const [us10y, oil, vix, gold] = await Promise.all([
    fredLatest('DGS10').catch(() => null),
    fredLatest('DCOILWTICO').catch(() => null),
    fredLatest('VIXCLS').catch(() => null),
    finnhubQuote('GLD').catch(() => null),
  ]);
  return { us10y, oil, vix, gold };
}

// --- 버핏지수 : ECOS 시총·GDP + FRED 법인주식·GDP (계산은 buffett.mjs) --------
/** ECOS 시계열 전체를 오름차순 [{time, value}]로. 비수치 행은 버린다. */
async function ecosRows(stat, cycle, item, start, end) {
  const u = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_API_KEY}/json/kr/1/1000/${stat}/${cycle}/${start}/${end}/${item}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`ECOS ${stat} ${res.status}`);
  const rows = (await res.json()).StatisticSearch?.row || [];
  return rows
    .map((r) => ({ time: r.TIME, value: +r.DATA_VALUE }))
    .filter((r) => Number.isFinite(r.value));
}

/**
 * FRED 관측치를 오름차순 [{date, value}]로. 결측('.')은 버린다.
 * ⚠️ limit으로 자르면 안 된다 — asc는 1947년부터 세므로 최근 분기가 잘려 나간다.
 *    반드시 observation_start로 범위를 좁힌다.
 */
async function fredRows(series, start) {
  const u = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${FRED_API_KEY}&file_type=json&sort_order=asc&observation_start=${start}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`FRED ${series} ${res.status}`);
  return (await res.json()).observations
    .map((o) => ({ date: o.date, value: +o.value }))
    .filter((o) => Number.isFinite(o.value));
}

async function buffettBundle() {
  const now = new Date();
  const yEnd = now.getFullYear() + 1;
  const yStart = now.getFullYear() - 10;          // 분포 비교용 10년치
  const dStart = new Date(Date.now() - 40 * DAY).toISOString().slice(0, 10).replace(/-/g, '');
  const dEnd = now.toISOString().slice(0, 10).replace(/-/g, '');

  const kr = (async () => {
    const [gdpQ, capM, capD] = await Promise.all([
      ecosRows('200Y105', 'Q', '1400', `${yStart - 1}Q1`, `${yEnd}Q4`),   // 국내총생산(명목, 십억원)
      ecosRows('901Y014', 'M', '1040000', `${yStart}01`, `${yEnd}12`),    // KOSPI 시가총액(천원)
      ecosRows('802Y001', 'D', '0183000', dStart, dEnd),                  // 시가총액 유가증권시장(억원)
    ]);
    return buffettKr({ gdpQ, capM, capD });
  })();

  const us = (async () => {
    const cut = `${yStart}-01-01`;
    const [gdpQ, capQ] = await Promise.all([
      fredRows('GDP', cut),            // 명목 GDP, 십억$ 연율
      fredRows('NCBEILQ027S', cut),    // 비금융법인 주식 발행잔액, 백만$
    ]);
    return buffettUs({ gdpQ, capQ });
  })();

  // 한쪽이 죽어도 나머지는 보여준다. 목값은 만들지 않는다 — 실패는 null.
  const [krR, usR] = await Promise.all([kr.catch(() => null), us.catch(() => null)]);
  if (!krR && !usR) throw new Error('버핏지수 소스 전부 실패 — 캐시 저장 회피');
  return { kr: krR, us: usR };
}

async function aiOpinion() {
  const safe = (p) => p.then((data) => ({ data })).catch(() => ({ data: null }));
  const [fgR, usR, krR, newsR, macroR] = await Promise.all([
    safe(cached('fg', 30 * 60_000, fetchFearGreed).then((r) => r.data)),
    safe(cached('usidx', 30_000, usIndices).then((r) => r.data)),
    safe(cached('kridx', 20_000, krIndices).then((r) => r.data)),
    safe(cached('news', 60 * 60_000, fetchNews).then((r) => r.data)),
    safe(cached('macro', 60 * 60_000, macroBundle).then((r) => r.data)),
  ]);
  const fg = fgR.data, us = usR.data, kr = krR.data, news = newsR.data, macro = macroR.data;
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const usChg = us ? avg([us.SPY?.changePct, us.QQQ?.changePct, us.DIA?.changePct].filter((x) => x != null)) : 0;
  const krChg = kr ? avg([kr.KOSPI?.changePct, kr.KOSDAQ?.changePct].filter((x) => x != null)) : 0;
  const commChg = macro ? avg([macro.oil?.changePct, macro.gold?.changePct].filter((x) => x != null)) : 0;
  // 뉴스 감성 취합(AV+Finnhub 병합 최대 40건) → 뉴스 심리 지표.
  const items = news?.items ?? [];
  const good = items.filter((n) => n.sentiment === 'good').length;
  const bad = items.filter((n) => n.sentiment === 'bad').length;
  const newsN = good + bad;
  const newsStrength = clamp(50 + (newsN ? ((good - bad) / newsN) * 32 : 0));

  const usStrength = clamp(50 + usChg * 10 + (fg ? (fg.value - 50) * 0.4 : 0));
  const krStrength = clamp(50 + krChg * 10);
  const commStrength = clamp(50 + commChg * 10);
  // 종합점수 = 미 0.30 + 국내 0.25 + F&G 0.22 + 뉴스심리 0.23 (뉴스 취합 강화 반영)
  const score = clamp(usStrength * 0.30 + krStrength * 0.25 + (fg ? fg.value : 50) * 0.22 + newsStrength * 0.23);
  const stance = score >= 60 ? '위험선호 우위' : score >= 45 ? '중립·관망' : '위험회피 우위';
  const bull = [], bear = [];
  if (fg && fg.value >= 55) bull.push(`Fear&Greed ${fg.value} — 위험선호 심리`);
  if (fg && fg.value < 45) bear.push(`Fear&Greed ${fg.value} — 공포 심리`);
  if (usChg >= 0) bull.push(`미 지수 강세 평균 +${usChg.toFixed(1)}%`); else bear.push(`미 지수 약세 평균 ${usChg.toFixed(1)}%`);
  if (krChg >= 0) bull.push(`국내 지수 반등 +${krChg.toFixed(1)}%`); else bear.push(`국내 지수 약세 ${krChg.toFixed(1)}%`);
  if (good > bad) bull.push(`경제뉴스 호재 우위 ${good}:${bad} (${items.length}건 분석)`);
  else if (bad > good) bear.push(`경제뉴스 악재 우위 ${bad}:${good} (${items.length}건 분석)`);
  return {
    score,
    stance: `${stance} — 탐욕 ${fg ? fg.value : '—'} · 뉴스심리 ${newsStrength} · 미 ${usChg >= 0 ? '+' : ''}${usChg.toFixed(1)}% / 국내 ${krChg >= 0 ? '+' : ''}${krChg.toFixed(1)}%`,
    markets: [
      { name: '미국', strength: usStrength },
      { name: '한국', strength: krStrength },
      { name: '뉴스 심리', strength: newsStrength },
      { name: '원자재', strength: commStrength },
    ],
    bull: bull.length ? bull.slice(0, 3) : ['특이 호재 없음'],
    bear: bear.length ? bear.slice(0, 3) : ['특이 악재 없음'],
  };
}

/** 포트폴리오 producer — /api/portfolio 와 /api/home 이 같은 캐시 키('portfolio')로 공유. */
async function portfolioProducer() {
  try { return await kisBalance(); }
  catch (e) {
    const msg = String(e?.message || e);
    // 계좌 미설정은 사용자가 고쳐야 하는 상태 → 그대로 알린다.
    if (/미설정/.test(msg)) return { configured: false, reason: msg, holdings: [] };
    // 스로틀 등 일시 실패는 throw — cached()가 마지막 정상값을 stale로 내준다.
    // 여기서 configured:false 를 돌려주면 성공으로 간주돼 15초간 "주문 불가"로 박제된다
    // (주문 직후 잔고 재조회가 초당 제한에 걸리면 바로 재현된다).
    throw e;
  }
}

// --- 라우팅 ------------------------------------------------------------------
const routes = {
  // 부동산 스크리너 (/complexes · /screen · /complex) — realestate/index.mjs
  ...realestateRoutes,
  '/api/health': async () => ({ ok: true }),
  '/api/fear-greed': () => cached('fg', 30 * 60_000, fetchFearGreed),        // 30분 캐시
  '/api/fear-greed/crypto': () => cached('fgc', 30 * 60_000, fetchCryptoFearGreed),
  '/api/crypto/btc': () => cached('btc', 30_000, fetchBtc),                    // 30초 캐시
  // 미국 지수 = ETF 프록시(무료 티어는 지수레벨 미제공) SPY/QQQ/DIA
  '/api/indices/us': () => cached('usidx', 30_000, usIndices),
  // 원/달러 환율 (ECOS 731Y001 원/미국달러 매매기준율)
  '/api/fx/usdkrw': () => cached('fx', 60 * 60_000, () => ecosLatest('731Y001', 'D', '0000001', 20 * DAY)),
  // ECOS 100대 경제지표 (환율·금리 스냅샷, 한 콜)
  '/api/econ/key': () => cached('econkey', 60 * 60_000, econKey),
  // 매크로: 한국 기준금리(ECOS) + 미 국채10Y(FRED) + WTI 유가(FRED)
  // 한 항목이라도 빠졌으면 1분만 붙잡는다 — FRED 일시 실패가 1시간짜리 '-'로 굳지 않게.
  '/api/macro': () => cached('macro', (d) => (Object.values(d).some((v) => v == null) ? 60_000 : 60 * 60_000), macroBundle),

  // 시총은 일별·GDP는 분기별 갱신 → 6시간 캐시로 충분
  '/api/buffett': () => cached('buffett', 6 * 60 * 60_000, buffettBundle),
  // 서울 25구 전세 실거래 집계 (12시간 캐시 — 50콜)
  '/api/realestate/seoul': () => cached('seoul', 12 * 60 * 60_000, seoulJeonse),
  // KIS 국내 지수 (KOSPI 0001 / KOSDAQ 1001)
  '/api/kr/indices': () => cached('kridx', 20_000, krIndices),
  // AI 종합 투자의견 (규칙 기반: F&G + 지수 모멘텀 + 뉴스 감성). LLM 키 있으면 교체 가능.
  '/api/ai/opinion': () => cached('ai', 5 * 60_000, aiOpinion),
  // KIS WebSocket 접속키 + ws url (프론트가 직접 KIS ws에 연결)
  // '/api/kis/approval' 제거됨 — 브라우저가 KIS에 직결하지 않는다(RADIO 불변식 #1).
  // 실시간은 서버 게이트웨이(ws 1개) → SSE 팬아웃뿐이라 프론트에 소비자가 없었고,
  // 남겨두면 접속키를 아무에게나 내주는 창구가 된다. approval_key는 게이트웨이 내부에서만 쓴다.
  // KIS 국내 일/주/월봉 (code=005930&period=D|W|M)
  '/api/kr/chart': (q) => {
    const code = (q?.get('code') || '').trim();
    const period = (q?.get('period') || 'D').trim();
    return cached(`chart:${code}:${period}`, 5 * 60_000, () => kisChart(code, period));
  },
  // 일/주/월봉 한 번에(1일~5년 탭용). {daily, weekly, monthly}
  '/api/kr/chart-all': (q) => {
    const code = (q?.get('code') || '').trim();
    return cached(`chartall:${code}`, 5 * 60_000, async () => {
      // 3개를 동시에 던지면 순간 호출률이 3배가 되어 모의 환경에서 일부가 스로틀로 빈 배열이 된다.
      // 순차 + 간격으로 받는다. daily 는 1일~3개월 탭·52주 범위의 근거라 실패 시 재시도한다.
      let daily = await kisChart(code, 'D').catch(() => []);
      if (!daily.length) { await nap(500); daily = await kisChart(code, 'D').catch(() => []); }
      await nap(120);
      const weekly = await kisChart(code, 'W').catch(() => []);
      await nap(120);
      const monthly = await kisChart(code, 'M').catch(() => []);
      // 빈 일봉을 5분간 캐시하면 그동안 차트가 목 스케일로 떨어진다(삼성전자에 ₩85,636 같은 값).
      // throw 로 저장을 회피하면 cached() 가 직전 성공값을 stale 로 돌려준다.
      if (!daily.length) throw new Error('일봉 응답 없음(KIS 스로틀 가능) — 캐시 저장 회피');
      return { daily, weekly, monthly };
    });
  },
  // 기술적 목표가(볼린저 상단: 20D 평균 + 2σ, KIS 일봉 실데이터) — 목 고정 목표가 대체.
  // ⚠️ 프론트 StockDetail의 로컬 계산과 동일 공식 유지(src/components/detail/StockDetail.tsx bollTarget).
  '/api/kr/targets': async (q) => {
    const codes = (q?.get('codes') || '').split(',').map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c)).slice(0, 10);
    try {
      return await cached('tgt:' + codes.join(','), 5 * 60_000, async () => {
      const out = {};
      for (const c of codes) {
        const daily = await cached(`chart:${c}:D`, 5 * 60_000, () => kisChart(c, 'D')).then((r) => r.data).catch(() => null);
        const closes = (daily || []).slice(-20).map((x) => x.c).filter(Number.isFinite);
        if (closes.length < 5) continue;
        const m = closes.reduce((a, b) => a + b, 0) / closes.length;
        const sd = Math.sqrt(closes.reduce((a, b) => a + (b - m) ** 2, 0) / closes.length);
        // 상단은 최근 60일 실제 고가로 클램프 — 관측된 가격 범위를 벗어난 목표가 금지.
        const hi60 = Math.max(...(daily || []).slice(-60).map((x) => x.h).filter(Number.isFinite));
        const raw = Math.min(m + 2 * sd, Number.isFinite(hi60) ? hi60 : Infinity);
        const tick = raw >= 100000 ? 500 : raw >= 10000 ? 100 : raw >= 1000 ? 10 : 1; // 호가단위 근사
        out[c] = { target: Math.round(raw / tick) * tick, close: closes[closes.length - 1] };
      }
      // 스로틀로 전부 실패한 빈 결과를 5분 캐시에 박제하지 않는다 — throw 하면 cached()가 저장 없이 전파.
      if (codes.length && !Object.keys(out).length) throw new Error('targets empty (KIS throttle?)');
      return out;
      });
    } catch {
      // 스로틀 순간: 캐시엔 안 남기고(위 throw) 응답은 200 {} — 콘솔 502 없이 다음 요청이 재시도.
      return {};
    }
  },
  // KIS 국내 순위 (토스식). by=volume|amount|up|down, market=all|kospi|kosdaq (30초 캐시)
  // 코스피/코스닥 TOP 100 (다음 금융, 60초 캐시). market=kospi|kosdaq, by=cap|amount
  '/api/kr/top100': (q) => {
    const market = (q?.get('market') || 'kospi').trim().toUpperCase() === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';
    const by = (q?.get('by') || 'cap').trim();
    return cached(`top100:${market}:${by}`, 60_000, () => daumTop100(market, by));
  },
  '/api/kr/rank': (q) => {
    const by = (q?.get('by') || 'amount').trim();
    const market = (q?.get('market') || 'all').trim();
    const limit = Math.min(100, Math.max(1, +(q?.get('limit') || 50)));
    return cached(`rank:${market}:${by}`, 30_000, () =>
      (by === 'up' || by === 'down') ? kisFluctuation({ market, dir: by, limit }) : kisRank({ market, by, limit }));
  },
  // KIS 당일 분봉(장중 촘촘 차트 + 실거래량). code=005930
  // 빈 결과를 캐시하면 스로틀 한 번에 60초 내내 차트가 폴백된다 → throw 로 저장을 회피한다.
  // cached() 는 실패 시 직전 성공값을 stale 로 돌려주므로, 한 번이라도 받았으면 화면이 유지된다.
  '/api/kr/intraday': (q) => {
    const code = (q?.get('code') || '').trim();
    // 잘린 응답을 60초 캐시하면 1일 차트가 점 하나로 남는다(실측: 005930이 30행·유효 1행으로
    // 굳어 "15:30 · +0.00%"만 그려졌다). 페이지 순회가 09시대까지 내려갔는지로 완주를 판정하고
    // 잘렸으면 짧게만 잡아 다음 폴링에서 스스로 회복시킨다. rows는 시간 오름차순.
    const complete = (rows) => (rows[0]?.date?.slice(8, 12) ?? '9999') <= '0901';
    return cached(`intra:${code}`, (rows) => (complete(rows) ? 60_000 : 5_000), async () => {
      const rows = await kisMinutes(code);
      if (!rows.length) throw new Error('분봉 응답 없음(KIS 스로틀 가능) — 캐시 저장 회피');
      return rows;
    });
  },
  // 종목 기본정보(시총·PER·PBR·EPS·거래량·52주). 목 DETAIL_META를 대체한다.
  '/api/kr/info': (q) => {
    const code = (q?.get('code') || '').trim();
    if (!isKrCode(code)) throw httpError(400, '국내 6자리 종목코드 필요');
    return cached(`info:${code}`, 60_000, () => kisInfo(code));
  },
  // 종목별 투자 스코어 — 실측(일봉 20일 모멘텀 · 52주 위치 · PER · 뉴스 감성)의 규칙 기반 혼합.
  // 목 detail.ai(고정 점수·문구)를 대체한다. 근거가 하나도 없으면 null → 화면은 "-".
  '/api/kr/opinion': (q) => {
    const code = (q?.get('code') || '').trim();
    if (!isKrCode(code)) throw httpError(400, '국내 6자리 종목코드 필요');
    // 근거를 못 모은 경우(null)는 짧게만 캐시해 다음 조회에서 회복시킨다.
    return cached(`op:${code}`, (r) => (r ? 5 * 60_000 : 30_000), async () => {
      const [info, daily, newsRes] = await Promise.all([
        kisInfo(code).catch(() => null),
        kisChart(code, 'D').catch(() => []),
        cached('news', 60 * 60_000, fetchNews).catch(() => null),
      ]);
      const closes = (daily || []).map((c) => c.c).filter((v) => Number.isFinite(v) && v > 0);
      const items = newsRes?.data?.items || [];
      const mine = items.filter((n) => (n.tickers || []).includes(code));
      return buildOpinion({
        closes,
        price: closes[closes.length - 1],          // 최근 종가 = 52주 범위 내 위치 기준
        low52: info?.w52Low,
        high52: info?.w52High,
        per: info?.per,
        newsGood: mine.filter((n) => n.sentiment === 'good').length,
        newsBad: mine.filter((n) => n.sentiment === 'bad').length,
      });
    });
  },
  // KIS 국내 종목 시세 (codes=005930,000660)
  '/api/kr/quotes': (q) => {
    const codes = (q?.get('codes') || '').split(',').map((c) => c.trim()).filter(Boolean);
    // 일부 종목이 null이면 짧게만 잡는다 — 스로틀 한 번이 15초짜리 "-"(또는 목값 잔류)로 굳는다.
    const allOk = (out) => codes.length > 0 && codes.every((c) => out[c]);
    return cached('krq:' + codes.join(','), (out) => (allOk(out) ? 15_000 : 3_000), async () => {
      const out = {};
      for (const c of codes) out[c] = await kisQuote(c).catch(() => null);
      return out;
    });
  },
  // KIS 모의투자 잔고 → 포트폴리오 (15초 캐시). 계좌 미설정/실패 시 200 + holdings:[] → 프론트가 목으로 폴백(콘솔 에러 0 유지).
  // 주문 전송. POST 본문 {code, side:'buy'|'sell', qty, price, ordType:'limit'|'market'}.
  // 캐시하지 않는다(부수효과가 있는 요청). 성공 시 잔고 캐시를 비워 다음 조회가 KIS를 다시 읽게 한다.
  '/api/kr/order': async (_q, req) => {
    if (req.method !== 'POST') throw httpError(405, 'POST만 허용');
    const body = await readJsonBody(req);
    const code = String(body.code || '').trim();
    const side = body.side === 'sell' ? 'sell' : body.side === 'buy' ? 'buy' : null;
    const qty = Math.floor(+body.qty);
    const ordType = body.ordType === 'market' ? 'market' : 'limit';
    const price = +body.price;
    if (!isKrCode(code)) throw httpError(400, '국내 6자리 종목코드만 지원합니다');
    if (!side) throw httpError(400, 'side는 buy 또는 sell');
    if (!(qty > 0)) throw httpError(400, '수량은 1 이상');
    if (ordType === 'limit' && !(price > 0)) throw httpError(400, '지정가는 가격이 필요합니다');
    const r = await kisOrder({ code, side, qty, price, ordType });
    // KIS 거부(장 시간 외·잔고 부족 등)는 422 + 원문 메시지. 프론트가 그대로 보여준다.
    if (!r.ok) throw httpError(422, r.message);
    cache.delete('portfolio');   // 다음 /api/portfolio 가 KIS 잔고를 새로 읽도록
    cache.delete('orders');
    return r;
  },
  // 주문가능금액 — 미체결분이 이미 빠진 KIS 기준값. 로컬 차감 금지(이중 진실 방지).
  '/api/kr/orderable': (q) => {
    const code = String(q?.get('code') || '').trim();
    if (!isKrCode(code)) throw new Error('국내 6자리 종목코드 필요');
    const ordType = q?.get('ordType') === 'market' ? 'market' : 'limit';
    const price = +(q?.get('price') || 0);
    return cached(`orderable:${code}:${ordType}:${price}`, 5_000, () => kisOrderable({ code, price, ordType }));
  },
  // 당일 주문·체결 내역(체결/부분체결/미체결).
  // ⚠️ 모의계좌는 당일분을 빈 배열로 돌려준다(실측). 실전에서만 의미가 있어 화면 이력은
  //    로컬 기록(주문번호 포함)을 쓰고, 대기 주문은 아래 open 라우트로 본다.
  '/api/kr/orders': () => cached('orders', 5_000, kisTodayOrders),
  // 미체결(정정·취소 가능) 주문 — 모의에서도 동작한다.
  '/api/kr/orders/open': () => cached('openorders', 5_000, kisOpenOrders),

  '/api/portfolio': () => cached('portfolio', 15_000, portfolioProducer),
  // ── 수동 자산 CRUD (설계 W2) — 캐시 없음: 파일 직독이라 편집이 즉시 반영된다.
  '/api/assets': async (_q, req) => {
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      try { return await assetsStore.upsert(body); }
      catch (e) { throw httpError(400, String(e?.message || e)); }
    }
    return { items: await assetsStore.list() };
  },
  '/api/assets/delete': async (_q, req) => {
    if (req.method !== 'POST') throw httpError(405, 'POST만 허용');
    const { id } = await readJsonBody(req);
    if (!id) throw httpError(400, 'id 필요');
    return { ok: await assetsStore.remove(String(id)) };
  },
  // ── 홈 통합 응답 (설계 W2) — 항목별 조합: 실패 항목만 null, 응답은 항상 200.
  // 실패는 각 producer 의 throw 로 캐시에 안 남고(RADIO #5) 다음 요청에서 자연 재시도된다.
  // 프론트는 항목 단위 null → "-" 로 그린다(RADIO #2 — 목 폴백 금지).
  '/api/home': async () => {
    const [pf, manualTotal, series] = await Promise.all([
      cached('portfolio', 15_000, portfolioProducer).then((r) => r.data).catch(() => null),
      assetsStore.total().catch(() => 0),   // 파일 부재 = 자산 0 과 동치
      cached('home:series', 5 * 60_000, async () => {
        if (!portfolioHistory) return [];
        const entries = await portfolioHistory.read(120);
        return entries.map((e) => {
          // 구형 엔트리(netWorth 필드 없음)는 KIS 총자산을 그대로 순자산으로 — "수동자산 미포함 구간".
          const modern = 'netWorth' in e;
          const nw = modern ? e.netWorth : e.totalValue;
          return nw == null ? null : { date: e.date, netWorth: nw, manualIncluded: modern && e.manualTotal != null };
        }).filter(Boolean);
      }).then((r) => r.data).catch(() => []),
    ]);
    const ok = pf && pf.source && pf.configured !== false;
    const s = ok ? pf.summary : null;
    return {
      // 순자산 정책(설계 W2): KIS(주식+예수금) + 수동 자산. 관심단지 추정가는 합산하지 않는다.
      netWorth: ok ? s.totalValue + manualTotal : null,
      // pct 는 순자산 대비로 재계산 — KIS dayPnlPct 는 유가증권 평가액 대비라(-9.6% 실측)
      // 순자산 옆에 붙이면 "순자산이 9.6% 빠졌다"로 오독된다.
      dayChange: ok && !s.dayPnlUnavailable
        ? (() => {
          const nw = s.totalValue + manualTotal;
          const base = nw - s.dayPnl;
          return { value: s.dayPnl, pct: base > 0 ? +((s.dayPnl / base) * 100).toFixed(2) : 0 };
        })()
        : null,
      allocation: ok ? { stocks: s.securities ?? 0, cash: pf.cash ?? 0, manual: manualTotal } : null,
      manualTotal,
      snapshotSeries: series,
    };
  },
  // 포트폴리오 일별 이력 (최근 N일, 기본 400일). 60초 캐시.
  '/api/portfolio/history': (q) => {
    const days = Math.min(400, Math.max(1, +(q?.get('days') || 400)));
    return cached(`portfolio-history:${days}`, 60_000, async () => {
      if (!portfolioHistory) return { entries: [] };
      const entries = await portfolioHistory.read(days);
      return { entries };
    });
  },
  // 뉴스 배치 (1h 캐시) + 수동 갱신(캐시 버스트)
  '/api/news': () => cached('news', 60 * 60_000, fetchNews),
  '/api/news/refresh': () => { cache.delete('news'); return cached('news', 60 * 60_000, fetchNews); },
  // 히트맵 개별종목 실시세 (미국 Finnhub 배치, 동시성 8, 10분 캐시)
  '/api/heatmap/quotes': (q) => {
    const syms = (q?.get('symbols') || '').split(',').map((c) => c.trim()).filter(Boolean).slice(0, 70);
    // 실패한 심볼은 아예 빠지므로 부분 히트맵이 10분간 굳는다 → 다 못 채웠으면 30초만.
    const full = (out) => syms.length > 0 && Object.keys(out).length === syms.length;
    return cached('hmq:' + syms.join(','), (out) => (full(out) ? 10 * 60_000 : 30_000), async () => {
      const out = {};
      await pool(syms, 8, async (sym) => {
        const d = await finnhubQuote(sym).catch(() => null);
        if (d && d.price) out[sym] = { price: d.price, changePct: d.changePct };
      });
      return out;
    });
  },
  // 히트맵 블록 크기용 실 시가총액 (Finnhub profile2, 무료 티어 제공 · 백만$).
  // 시총은 하루 단위로 움직이므로 길게 캐시하되, 부분 실패는 짧게만 잡는다.
  '/api/heatmap/weights': (q) => {
    const syms = (q?.get('symbols') || '').split(',').map((c) => c.trim()).filter(Boolean).slice(0, 70);
    const full = (out) => syms.length > 0 && Object.keys(out).length === syms.length;
    return cached('hmw:' + syms.join(','), (out) => (full(out) ? 6 * 60 * 60_000 : 60_000), async () => {
      const out = {};
      await pool(syms, 6, async (sym) => {
        const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${FINNHUB_API_KEY}`).catch(() => null);
        const j = res && res.ok ? await res.json().catch(() => null) : null;
        const cap = +j?.marketCapitalization;
        if (Number.isFinite(cap) && cap > 0) out[sym] = cap;   // 백만$
      });
      return out;
    });
  },
  // 미국 종목 시세 (Finnhub, symbols=AAPL,NVDA,TSLA)
  '/api/us/quotes': (q) => {
    const syms = (q?.get('symbols') || '').split(',').map((c) => c.trim()).filter(Boolean);
    const allOk = (out) => syms.length > 0 && syms.every((x) => out[x]);
    return cached('usq:' + syms.join(','), (out) => (allOk(out) ? 15_000 : 3_000), async () => {
      const out = {};
      await Promise.all(syms.map(async (sym) => { out[sym] = await finnhubQuote(sym).catch(() => null); }));
      return out;
    });
  },
};

// ---- KIS 실시간 소켓 게이트웨이 (Toss/Upbit식: 업스트림 1개 + SSE 팬아웃) --------
// 브라우저는 우리 백엔드 SSE에만 붙고, 백엔드가 KIS와 소켓 1개만 유지(PINGPONG·재접속·재구독).
// approval_key도 서버에만 머문다. 탭마다 KIS 직결 → 재접속 폭주 문제 해결.
const KIS_TR = { trade: 'H0STCNT0', orderbook: 'H0STASP0' };
const kisWsUrl = () => (KIS.mock ? 'ws://ops.koreainvestment.com:31000' : 'ws://ops.koreainvestment.com:21000');
const isKrCode = (c) => /^\d{6}$/.test(c);
const num = (s) => Number(s || 0);
const fmtHms = (h) => (h && h.length >= 6 ? `${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}` : h || '');
function parseTradeFrame(f) {
  return { code: f[0], time: fmtHms(f[1]), price: num(f[2]), changePct: num(f[5]), volume: num(f[12]), side: f[21] === '5' ? '매도' : '매수' };
}
function parseOrderbookFrame(f) {
  const asks = [], bids = [];
  for (let i = 0; i < 5; i++) { asks.push({ price: num(f[3 + i]), qty: num(f[23 + i]) }); bids.push({ price: num(f[13 + i]), qty: num(f[33 + i]) }); }
  return { code: f[0], asks, bids };
}

const kisGateway = (() => {
  let ws = null, connecting = false, backoff = 1000, state = 'disconnected', approval = '';
  let stableTimer = null, stable = false;   // 3초 이상 유지돼야 '연결됨'으로 승격(플랩 필터)
  const STABLE_MS = 3000;
  // 무수신 워치독: KIS는 유휴 시에도 PINGPONG을 보내므로, 45초간 아무 프레임도 없으면
  // half-open(TCP는 살았는데 데이터가 죽은 상태)으로 보고 강제 재접속한다.
  const IDLE_MS = 45_000;
  let lastMsgAt = 0, idleTimer = null;
  const codes = new Map();     // code -> refcount
  const clients = new Set();   // SSE res 객체
  const byId = new Map();      // clientId -> res (sendBeacon 'bye' 즉시 해제용)
  let nextId = 1;

  const send = (obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  const reg = (trId, code, type) => ({ header: { approval_key: approval, custtype: 'P', tr_type: type, 'content-type': 'utf-8' }, body: { input: { tr_id: trId, tr_key: code } } });
  const subUpstream = (code, type) => { send(reg(KIS_TR.trade, code, type)); send(reg(KIS_TR.orderbook, code, type)); };
  // KIS 세션당 등록 키 한도(~41). 코드당 trade+orderbook 2키 → 20코드 상한(감사 S9).
  // 초과분은 업스트림 구독을 생략(해당 코드만 실시간 없음)하고 크게 로그 — 조용한 드랍 금지.
  const MAX_UPSTREAM_CODES = 20;
  const canSub = (code) => {
    const idx = [...codes.keys()].indexOf(code);
    if (idx >= MAX_UPSTREAM_CODES) { console.warn('[kisGateway] 41키 한도 — %s 업스트림 구독 생략(%d번째 코드)', code, idx + 1); return false; }
    return true;
  };
  function broadcast(event, data) {
    const p = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) { try { res.write(p); } catch { /* dropped */ } }
  }
  function setState(s) { if (s === state) return; state = s; broadcast('state', { state: s }); }

  async function connect() {
    if (connecting || (ws && ws.readyState <= 1)) return;
    connecting = true; if (state !== 'connected') setState('connecting');
    try { approval = await kisApprovalKey(); }
    catch { connecting = false; reconnect(); return; }
    let sock;
    try { sock = new WebSocket(kisWsUrl()); } catch { connecting = false; reconnect(); return; }
    ws = sock;
    sock.onopen = () => {
      connecting = false;
      for (const c of codes.keys()) { if (canSub(c)) subUpstream(c, '1'); } // 구독은 즉시(41키 한도 내)
      // 3초 이상 유지돼야 안정으로 판단 → 그때 backoff 리셋 + '연결됨' 승격.
      stable = false;
      stableTimer = setTimeout(() => { stable = true; backoff = 1000; setState('connected'); }, STABLE_MS);
    };
    sock.onmessage = (e) => {
      lastMsgAt = Date.now();
      if (!stable) { stable = true; setState('connected'); }
      onUpstream(typeof e.data === 'string' ? e.data : String(e.data));
    };
    sock.onclose = () => {
      connecting = false; ws = null;
      if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
      if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
      // 짧게 열렸다 닫힌 플랩이면 backoff를 키워 하머링 중단(KIS 부하/차단 방지).
      if (!stable) backoff = Math.min(backoff * 2, 30000);
      reconnect();
    };
    sock.onerror = () => { try { sock.close(); } catch { /* noop */ } };
    // 무수신 워치독 시작
    lastMsgAt = Date.now();
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      if (ws === sock && Date.now() - lastMsgAt > IDLE_MS) {
        console.warn('[kisGateway] 무수신 %ds — half-open 의심, 재접속', IDLE_MS / 1000);
        try { sock.close(); } catch { /* onclose가 재접속 처리 */ }
      }
    }, 10_000);
  }
  function reconnect() {
    if (!clients.size) { setState('disconnected'); return; }
    if (state !== 'connected') setState('connecting');
    setTimeout(connect, backoff);
  }
  function onUpstream(raw) {
    if (raw[0] === '{') { try { const m = JSON.parse(raw); if (m.header?.tr_id === 'PINGPONG' && ws?.readyState === 1) ws.send(raw); } catch { /* noop */ } return; }
    const parts = raw.split('|');
    const trId = parts[1], body = parts[3];
    if (!body) return;
    const f = body.split('^');
    try {
      if (trId === KIS_TR.trade) broadcast('trade', parseTradeFrame(f));
      else if (trId === KIS_TR.orderbook) broadcast('orderbook', parseOrderbookFrame(f));
    } catch { /* 손상 프레임 1건은 버린다 — onmessage 전체가 죽으면 재접속 폭주(감사 S12) */ }
  }

  function addClient(res, wantCodes) {
    clients.add(res);
    res._kisCodes = wantCodes;
    res._kisId = String(nextId++);
    byId.set(res._kisId, res);
    for (const c of wantCodes) {
      const n = (codes.get(c) || 0) + 1; codes.set(c, n);
      if (n === 1 && ws?.readyState === 1 && canSub(c)) subUpstream(c, '1');
    }
    // 클라이언트 id 전달 — pagehide 시 sendBeacon('/api/stream/bye?id=')로 즉시 구독 해제(KIS 41키 예산 보호)
    res.write(`event: hello\ndata: ${JSON.stringify({ id: res._kisId })}\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify({ state })}\n\n`);
    if (!ws && !connecting) connect();
  }
  function removeClient(res) {
    if (!clients.delete(res)) return;
    if (res._kisId) byId.delete(res._kisId);
    for (const c of (res._kisCodes || [])) {
      const n = (codes.get(c) || 1) - 1;
      if (n <= 0) { codes.delete(c); if (ws?.readyState === 1) subUpstream(c, '2'); } else codes.set(c, n);
    }
    if (!clients.size && ws) { try { ws.close(); } catch { /* noop */ } ws = null; setState('disconnected'); }
  }
  /** sendBeacon 'bye' — TCP close 감지를 기다리지 않고 즉시 해제. */
  function byeClient(id) {
    const res = byId.get(id);
    if (!res) return false;
    removeClient(res);
    try { res.end(); } catch { /* noop */ }
    return true;
  }
  return { addClient, removeClient, byeClient };
})();

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url || '/', 'http://localhost');

  // SSE: KIS 실시간 체결/호가 스트림. ?codes=005930,000660 (국내 6자리만)
  if (url.pathname === '/api/stream') {
    const codes = (url.searchParams.get('codes') || '').split(',').map((c) => c.trim()).filter(isKrCode);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 3000\n\n');
    const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { /* noop */ } }, 15000);
    kisGateway.addClient(res, codes);
    req.on('close', () => { clearInterval(ka); kisGateway.removeClient(res); });
    return;
  }
  // 페이지 이탈 비컨(navigator.sendBeacon) — POST여도 쿼리만 읽으므로 라우터를 타지 않고 즉시 처리.
  if (url.pathname === '/api/stream/bye') {
    const ok = kisGateway.byeClient((url.searchParams.get('id') || '').trim());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok }));
    return;
  }

  const handler = routes[url.pathname];
  if (!handler) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}'); return; }
  try {
    // req 를 두 번째 인자로 — 조건부 요청(If-None-Match)을 읽는 라우트용. 기존 핸들러는 무시한다.
    const out = await handler(url.searchParams, req);
    // 304: 본문 없이 검증 헤더만. /complexes 마스터 3.4MB 재전송을 막는 경로.
    if (out && out.__notModified) { res.writeHead(304, out.__headers ?? {}); res.end(); return; }
    const extra = (out && out.__headers) || {};
    if (out && out.__headers) delete out.__headers;
    const body = out && 'data' in out ? out.data : out;
    res.writeHead(200, { 'Content-Type': 'application/json', ...extra });
    res.end(JSON.stringify(body));
  } catch (err) {
    // 핸들러가 상태코드를 지정했으면 존중한다.
    // 특히 503 + needsCollect 는 프론트가 EmptyState 로 "pnpm collect 먼저" 를 안내하는 신호라
    // 502 로 뭉개면 그냥 서버 장애처럼 보인다.
    const status = Number(err?.status) || 502;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: String(err?.message || err),
      ...(err?.needsCollect ? { needsCollect: true, hint: 'pnpm collect' } : {}),
    }));
  }
});

server.listen(PORT, async () => {
  console.log(`[pulse-server] listening on http://localhost:${PORT}`);

  // 포트폴리오 이력 기록 시작 (서버 기동 1회 + 1시간 간격)
  try {
    portfolioHistory = createPortfolioHistory({
      fetchBalance: kisBalance,
      // KIS는 초당 제한에 자주 걸린다 — 실패하면 ECOS 코스피지수로 폴백한다.
      // (폴백이 없으면 히스토리에 kospi:null이 박히고 수익률 비교선이 끊긴다)
      fetchKospi: async () => {
        try {
          const r = await kisIndex('0001');
          if (r?.price > 0) return r;
        } catch { /* ECOS로 */ }
        const k = (await cached('econkey', 60 * 60_000, econKey)).data;
        if (!(k?.kospi > 0)) throw new Error('KOSPI 지수 소스 실패');
        return { price: k.kospi };
      },
      fetchSpx: () => finnhubQuote('SPY'),
      // 수동 자산 합산(설계 W2) — 스냅샷에 manualTotal·netWorth additive 필드가 붙는다.
      fetchManualTotal: () => assetsStore.total(),
      file: `${CACHE_DIR}portfolio-history.json`,
    });
    await portfolioHistory.start(60 * 60_000); // 1시간
    console.log('[portfolio-history] started (1h interval)');
  } catch (e) {
    console.error('[portfolio-history] failed to start:', e.message);
  }
});
