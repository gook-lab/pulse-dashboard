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

// server/.env 로드 (없어도 무시 — 키 없는 라우트는 그대로 동작)
// ※ collect.mjs 도 자체적으로 로드한다(단독 `pnpm collect` 실행 대비). 중복 호출은 무해.
try { process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url))); } catch { /* no .env */ }

const PORT = process.env.PORT || 8080;
const { FRED_API_KEY, FINNHUB_API_KEY, ECOS_API_KEY, ALPHAVANTAGE_API_KEY } = process.env;
// DATA_GO_KR_KEY 와 UA 는 realestate/collect.mjs 로 이동(단일 소스).

// --- 포트폴리오 이력 관리 (일별 스냅샷) -----------------------------------------
const CACHE_DIR = fileURLToPath(new URL('./cache/', import.meta.url));
let portfolioHistory = null;

// --- 작은 TTL 캐시 -----------------------------------------------------------
const cache = new Map(); // key -> { at, ttl, data }
const inflight = new Map(); // key -> Promise (동시 요청 중복 producer 방지: StrictMode 2회 호출 등)
async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return { data: hit.data, stale: false };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const data = await producer();
      cache.set(key, { at: Date.now(), ttl: ttlMs, data });
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

let _kisTok = null;         // {token, exp} — 24h 유효 + 발급 1회/분 제한 → 반드시 캐시
let _kisTokPromise = null;  // 동시 발급 방지(1분당 1회 제한 회피)
async function kisToken() {
  if (_kisTok && Date.now() < _kisTok.exp) return _kisTok.token;
  if (_kisTokPromise) return _kisTokPromise;
  _kisTokPromise = (async () => {
    const res = await fetch(`${KIS.base}/oauth2/tokenP`, {
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
  const res = await fetch(`${KIS.base}/oauth2/Approval`, {
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
  const res = await fetch(`${KIS.base}${path}?${qs}`, {
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
  return { price: +o.bstp_nmix_prpr, change: +o.bstp_nmix_prdy_vrss, changePct: +o.bstp_nmix_prdy_ctrt };
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
  const res = await fetch(`${KIS.base}/uapi/domestic-stock/v1/quotations/volume-rank?${params}`, { headers: rankHeaders(token, 'FHPST01710000') });
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
  const res = await fetch(`${KIS.base}/uapi/domestic-stock/v1/ranking/fluctuation?${params}`, { headers: rankHeaders(token, 'FHPST01700000') });
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
  for (let p = 0; p < pages; p++) {
    const j = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice', 'FHKST03010200', {
      FID_ETC_CLS_CODE: '', FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code,
      FID_INPUT_HOUR_1: hour, FID_PW_DATA_INCU_YN: 'N',
    }).catch(() => null);
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
  const res = await fetch(`${KIS.base}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`, {
    headers: { authorization: `Bearer ${token}`, appkey: KIS.key, appsecret: KIS.secret, tr_id: trId, custtype: 'P', 'content-type': 'application/json' },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.rt_cd && j.rt_cd !== '0')) throw new Error(`KIS balance: ${j.msg1 || res.status}`);
  const sum = (j.output2 || [])[0] || {};
  const holdings = (j.output1 || []).filter((r) => +r.hldg_qty > 0).map((r) => {
    const evlu = +r.evlu_amt, dayPct = +r.fltt_rt || 0;
    return {
      code: r.pdno, name: r.prdt_name, market: 'KR', qty: +r.hldg_qty,
      avg: Math.round(+r.pchs_avg_pric), price: +r.prpr, cur: '₩', dec: 0,
      dayPnl: evlu * (dayPct / (100 + dayPct || 1)),
    };
  });
  const fx = await ecosLatest('731Y001', 'D', '0000001', 20 * DAY).then((r) => r.value).catch(() => 1400);
  const cash = Math.round(+sum.dnca_tot_amt || 0);                       // 예수금(현금)
  const securities = Math.round(+sum.evlu_amt_smtl_amt || holdings.reduce((a, h) => a + h.price * h.qty, 0)); // 유가증권 평가액
  const totalValue = Math.round(+sum.tot_evlu_amt || (cash + securities)); // 총자산(현금+유가)
  const principal = Math.round(+sum.pchs_amt_smtl_amt || 0);
  const pnl = Math.round(+sum.evlu_pfls_smtl_amt || (securities - principal));
  const dayPnl = Math.round(holdings.reduce((a, h) => a + h.dayPnl, 0));
  return {
    fxUsdKrw: fx, source: KIS.mock ? 'kis-mock' : 'kis-real', cash,
    summary: {
      totalValue, securities, pnl,
      pnlPct: principal ? +((pnl / principal) * 100).toFixed(2) : 0,
      dayPnl, dayPnlPct: securities ? +((dayPnl / securities) * 100).toFixed(2) : 0,
      principal,
    },
    holdings: holdings.map(({ dayPnl: _d, ...h }) => h),
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
  '/api/macro': () => cached('macro', 60 * 60_000, macroBundle),
  // 서울 25구 전세 실거래 집계 (12시간 캐시 — 50콜)
  '/api/realestate/seoul': () => cached('seoul', 12 * 60 * 60_000, seoulJeonse),
  // KIS 국내 지수 (KOSPI 0001 / KOSDAQ 1001)
  '/api/kr/indices': () => cached('kridx', 20_000, krIndices),
  // AI 종합 투자의견 (규칙 기반: F&G + 지수 모멘텀 + 뉴스 감성). LLM 키 있으면 교체 가능.
  '/api/ai/opinion': () => cached('ai', 5 * 60_000, aiOpinion),
  // KIS WebSocket 접속키 + ws url (프론트가 직접 KIS ws에 연결)
  '/api/kis/approval': async () => ({
    approvalKey: await kisApprovalKey(),
    wsUrl: KIS.mock ? 'ws://ops.koreainvestment.com:31000' : 'ws://ops.koreainvestment.com:21000',
    mock: KIS.mock,
  }),
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
      const [daily, weekly, monthly] = await Promise.all([
        kisChart(code, 'D').catch(() => []), kisChart(code, 'W').catch(() => []), kisChart(code, 'M').catch(() => []),
      ]);
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
  // KIS 당일 분봉(장중 촘촘 차트). code=005930
  '/api/kr/intraday': (q) => {
    const code = (q?.get('code') || '').trim();
    return cached(`intra:${code}`, 60_000, () => kisMinutes(code));
  },
  // KIS 국내 종목 시세 (codes=005930,000660)
  '/api/kr/quotes': (q) => {
    const codes = (q?.get('codes') || '').split(',').map((c) => c.trim()).filter(Boolean);
    return cached('krq:' + codes.join(','), 15_000, async () => {
      const out = {};
      for (const c of codes) out[c] = await kisQuote(c).catch(() => null);
      return out;
    });
  },
  // KIS 모의투자 잔고 → 포트폴리오 (15초 캐시). 계좌 미설정/실패 시 200 + holdings:[] → 프론트가 목으로 폴백(콘솔 에러 0 유지).
  '/api/portfolio': () => cached('portfolio', 15_000, async () => {
    try { return await kisBalance(); }
    catch (e) { return { configured: false, reason: String(e?.message || e), holdings: [] }; }
  }),
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
    return cached('hmq:' + syms.join(','), 10 * 60_000, async () => {
      const out = {};
      await pool(syms, 8, async (sym) => {
        const d = await finnhubQuote(sym).catch(() => null);
        if (d && d.price) out[sym] = { price: d.price, changePct: d.changePct };
      });
      return out;
    });
  },
  // 미국 종목 시세 (Finnhub, symbols=AAPL,NVDA,TSLA)
  '/api/us/quotes': (q) => {
    const syms = (q?.get('symbols') || '').split(',').map((c) => c.trim()).filter(Boolean);
    return cached('usq:' + syms.join(','), 15_000, async () => {
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
      fetchKospi: () => kisIndex('0001'),
      fetchSpx: () => finnhubQuote('SPY'),
      file: `${CACHE_DIR}portfolio-history.json`,
    });
    await portfolioHistory.start(60 * 60_000); // 1시간
    console.log('[portfolio-history] started (1h interval)');
  } catch (e) {
    console.error('[portfolio-history] failed to start:', e.message);
  }
});
