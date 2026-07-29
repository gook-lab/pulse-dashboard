// 스크리너 요청 경로 + 배치 오케스트레이션.
//
// ★ 요청 경로에 원시 거래를 올리지 않는다
//   부팅 시 apt-signals.json 만 메모리에 상주(단지 × 시그널 13 + 12개월 시계열).
//   스크리닝은 배열 filter+sort 라 캐시 없이도 수 ms. 원시 7만행은 배치 전용.
//
// ★ 엔드포인트가 둘인 이유 (설계 D4)
//   리스트는 상위 50개만, 지도는 전체가 필요하다. 하나로는 limit 을 정할 수 없다.
//   /complexes = 안 변하는 단지 마스터(ETag 캐시)  ·  /screen = 변하는 순위만

import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, rename, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { collectSeoul, writeRaw, formatStats } from './collect.mjs';
import { buildMaster, geocodeAll, writeGeocodeReport, detectGeocodeDrop } from './complexes.mjs';
import { computeAll, getSignal } from './signals.mjs';

const CACHE_DIR = fileURLToPath(new URL('../cache/', import.meta.url));
const TMP_DIR = fileURLToPath(new URL('../cache/.tmp/', import.meta.url));
const SIGNALS_FILE = `${CACHE_DIR}apt-signals.json`;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export const SIGNAL_KEYS = ['momentum3', 'momentum6', 'momentum12', 'high52wPct', 'volumeRatio', 'jeonseRatio', 'rs'];

// ── 메모리 상주 ─────────────────────────────────────────────────────────────
let store = null;   // { generatedAt, dataMonth, months, complexes[], master[], etag }

/**
 * 배치는 별도 프로세스(`pnpm collect`)라 파일을 바꿔도 실행 중인 서버는 모른다.
 * mtime 을 보고 바뀌었으면 다시 읽는다. 안 그러면 배치를 돌리고도 옛 순위를 계속 본다.
 * (첫 배치 후 실제로 겪은 문제. 서버 재시작 없이 갱신되어야 "지금 갱신" 버튼도 성립한다.)
 */
export async function loadStore({ force = false } = {}) {
  const { mtimeMs } = await stat(SIGNALS_FILE);
  if (store && !force && store._mtime === mtimeMs) return store;
  const raw = JSON.parse(await readFile(SIGNALS_FILE, 'utf8'));
  raw.etag = createHash('sha1').update(raw.generatedAt).digest('hex').slice(0, 16);
  raw._mtime = mtimeMs;
  store = raw;
  return store;
}

/** 캐시가 없으면 프론트가 EmptyState 로 안내할 수 있게 구조화된 503. */
export class NeedsCollectError extends Error {
  constructor() { super('cache not built'); this.status = 503; this.needsCollect = true; }
}

async function requireStore() {
  try { return await loadStore(); } catch { throw new NeedsCollectError(); }
}

const isStale = (s) => Date.now() - new Date(s.generatedAt).getTime() > STALE_AFTER_MS;

// ── 스크리닝 ────────────────────────────────────────────────────────────────
/**
 * 조건에 맞는 단지를 시그널 값으로 정렬. 순수 함수라 테스트가 쉽다.
 *
 * null 은 0 이 아니다 — 그 시그널을 계산할 수 없는 단지는 모집단에서 빠지고
 * 빠진 개수가 nullCount 로 나간다. 화면이 "3,012개 중 1,847개 계산 가능" 을 보여줘야 한다.
 */
export function screen(complexes, q = {}) {
  const {
    signal = 'momentum6', dealType = 'trade', minDeals = 3,
    gu = [], areaTier = null, sortDir = 'desc', bbox = null,
  } = q;

  let pool = complexes;
  if (gu.length) pool = pool.filter((c) => gu.includes(c.gu));
  if (areaTier) pool = pool.filter((c) => c.areaTier === areaTier);
  if (bbox) {
    const [swLat, swLng, neLat, neLng] = bbox;
    pool = pool.filter((c) => c.lat != null && c.lat >= swLat && c.lat <= neLat && c.lng >= swLng && c.lng <= neLng);
  }

  const total = pool.length;
  const eligible = pool.filter((c) => {
    // 전세가율은 매매·전세 양쪽 표본으로 계산된다 — 현재 거래유형 하나의 건수로 거르면
    // 매매/전세 토글이 전세가율 순위를 바꾸는 비직관이 생긴다. 양쪽 최소값을 쓴다.
    const dc = signal === 'jeonseRatio'
      ? Math.min(c.signals.trade?.dealCount ?? 0, c.signals.rent?.dealCount ?? 0)
      : c.signals[dealType]?.dealCount ?? 0;
    return dc >= minDeals && getSignal(c, signal, dealType) != null;
  });

  const dir = sortDir === 'asc' ? 1 : -1;
  const ranked = eligible
    .map((c) => ({ id: c.aptSeq, value: getSignal(c, signal, dealType), deals: c.signals[dealType]?.dealCount ?? 0 }))
    .sort((a, b) => (a.value - b.value) * dir)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return { ranked, total, nullCount: total - eligible.length, signal, dealType, minDeals };
}

/**
 * 헤드라인 — 화면 최상단 한 줄 (설계 D10).
 * "어디가" + "얼마나" 를 한 문장에. 단순 카운트는 필터 캡션이 이미 말하고 있다.
 */
export function headline(ranked, complexes, { signal, dealType }) {
  if (!ranked.length) return null;
  const byId = new Map(complexes.map((c) => [c.aptSeq, c]));
  const top = ranked.slice(0, 50);

  const guCount = new Map();
  for (const r of top) {
    const g = byId.get(r.id)?.gu;
    if (g) guCount.set(g, (guCount.get(g) ?? 0) + 1);
  }
  const lead = [...guCount].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g.replace(/구$/, ''));

  const label = { momentum3: '3개월 모멘텀', momentum6: '6개월 모멘텀', momentum12: '12개월 모멘텀',
    high52wPct: '신고가 근접', volumeRatio: '거래량 돌파', jeonseRatio: '전세가율', rs: '상대강도' }[signal] ?? signal;

  let detail;
  if (signal === 'high52wPct') detail = `신고가 ${ranked.filter((r) => r.value === 0).length}개 단지`;
  else if (signal === 'volumeRatio') detail = `평균 3배 이상 ${ranked.filter((r) => r.value >= 3).length}개`;
  else if (signal === 'jeonseRatio') detail = `80% 이상 ${ranked.filter((r) => r.value >= 0.8).length}개`;
  else {
    const up = ranked.filter((r) => r.value > 0).length;
    detail = `상승 ${up} / 하락 ${ranked.length - up}`;
  }

  return {
    text: lead.length ? `${label} — ${lead.join('·')}가 주도` : label,
    detail,
    dealType: dealType === 'rent' ? '전세' : '매매',
  };
}

// ── 라우트 ──────────────────────────────────────────────────────────────────
const parseBbox = (s) => {
  const n = String(s ?? '').split(',').map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? n : null;
};

export const routes = {
  /**
   * 단지 마스터. 배치 사이에 안 변한다 — HTTP ETag + no-cache(재검증 필수)로
   * 브라우저가 If-None-Match 를 자동으로 붙이고, 안 바뀌었으면 304 로 3.4MB 를 아낀다.
   * 프론트 fetch 코드는 그대로다(브라우저 HTTP 캐시가 처리).
   */
  '/api/realestate/complexes': async (q, req) => {
    const s = await requireStore();
    const tag = `"${s.etag}"`;
    const headers = { ETag: tag, 'Cache-Control': 'no-cache' };
    if (req?.headers?.['if-none-match'] === tag) return { __notModified: true, __headers: headers };
    return { __headers: headers, generatedAt: s.generatedAt, dataMonth: s.dataMonth, etag: s.etag, items: s.master };
  },

  '/api/realestate/screen': async (q) => {
    const s = await requireStore();
    const signal = SIGNAL_KEYS.includes(q?.get('signal')) ? q.get('signal') : 'momentum6';
    const dealType = q?.get('dealType') === 'rent' ? 'rent' : 'trade';
    const minDeals = Math.max(0, Number(q?.get('minDeals')) || 3);
    const query = {
      signal, dealType, minDeals,
      gu: (q?.get('gu') || '').split(',').filter(Boolean),
      areaTier: q?.get('areaTier') || null,
      sortDir: q?.get('sortDir') === 'asc' ? 'asc' : 'desc',
      bbox: parseBbox(q?.get('bbox')),
    };
    const out = screen(s.complexes, query);
    return {
      ...out,
      headline: headline(out.ranked, s.complexes, query),
      generatedAt: s.generatedAt,
      dataMonth: s.dataMonth,
      stale: isStale(s),
      // 좌표 확보율 5%p 이상 하락(T16) — 조용한 지오코딩 실패를 화면 경고로 끌어올린다.
      geocodeDrop: s.stats?.geocodeDrop ?? null,
      source: 'live',
    };
  },

  /** 단지 상세 — 시계열은 메모리에 있으므로 파일 I/O 없음. */
  '/api/realestate/complex': async (q) => {
    const s = await requireStore();
    const id = q?.get('id');
    const c = s.complexes.find((x) => x.aptSeq === id);
    if (!c) { const e = new Error('not found'); e.status = 404; throw e; }
    return { ...c, months: s.months, generatedAt: s.generatedAt };
  },

  /**
   * 프론트 설정. JS 키는 도메인 제한이 걸린 공개 키지만
   * 소스에 커밋하지 않는 원칙을 지키기 위해 server/.env 에서 내려준다.
   */
  '/api/realestate/config': async () => ({ kakaoJsKey: process.env.KAKAO_JS_KEY ?? null }),

  /**
   * 카카오 SDK 사전 점검 — 미등록 도메인이면 카카오가 Referer 를 보고 401 을 준다.
   * 브라우저에서 직접 fetch 하면 CORS 로 원인이 안 보이므로 서버가 대신 물어봐 준다.
   * 지도 실패 배지에 "도메인 등록 필요" 같은 고칠 수 있는 이유를 띄우기 위한 것.
   */
  '/api/realestate/kakao-probe': async (q) => {
    const key = process.env.KAKAO_JS_KEY;
    if (!key) return { ok: false, reason: 'no-key' };
    const origin = q?.get('origin') || 'http://localhost:5180';
    try {
      const r = await fetch(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`,
        { headers: { Referer: `${origin}/` } });
      const body = r.ok ? '' : await r.text();
      return { ok: r.ok, status: r.status, domainMismatch: body.includes('domain mismatched') };
    } catch (e) {
      return { ok: false, status: 0, error: String(e?.message || e) };
    }
  },

  /**
   * "지금 갱신" (설계 D12). 배치를 백그라운드로 돌리고 즉시 응답한다.
   * 서버 디스패치가 메서드를 보지 않으므로 GET/POST 모두 동작 — 프론트는 POST 를 쓴다.
   * 진행 중 재요청은 새로 시작하지 않고 현재 상태만 돌려준다(중복 실행 방지).
   */
  '/api/realestate/collect': async () => {
    if (collectJob?.running) return { started: false, ...collectStatus() };
    collectJob = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: null, message: '수집 시작…', error: null };
    void runBatch({ kinds: ['rent'], log: (line) => { collectJob.message = String(line); console.log(line); } })
      .then((r) => { collectJob.running = false; collectJob.ok = r.ok; collectJob.finishedAt = new Date().toISOString(); })
      .catch((e) => { collectJob.running = false; collectJob.ok = false; collectJob.error = String(e?.message || e); collectJob.finishedAt = new Date().toISOString(); });
    return { started: true, ...collectStatus() };
  },

  '/api/realestate/collect/status': async () => collectStatus(),
};

// ── "지금 갱신" 잡 상태 ─────────────────────────────────────────────────────
let collectJob = null;
const collectStatus = () => collectJob
  ? { running: collectJob.running, startedAt: collectJob.startedAt, finishedAt: collectJob.finishedAt, ok: collectJob.ok, message: collectJob.message, error: collectJob.error }
  : { running: false, startedAt: null, finishedAt: null, ok: null, message: null, error: null };

// ── 배치 ────────────────────────────────────────────────────────────────────
/**
 * 수집 → 마스터 → 좌표 → 시그널 → 원자적 교체.
 * 실패한 (구,월)이 하나라도 있으면 캐시를 바꾸지 않는다.
 * 구멍 난 시계열이 조용히 배포되면 시그널이 전부 거짓말이 된다.
 */
export async function runBatch({ kinds = ['rent'], log = console.log } = {}) {
  log(`[collect] 시작 — 종류 ${kinds.join(', ')}`);
  const { rows, stats } = await collectSeoul({ kinds, log });
  log(`[collect] ${formatStats(stats)}`);

  if (stats.failed.length) {
    const fatal = stats.failed.filter((f) => f.fatal);
    log(`[collect] ✗ 실패 ${stats.failed.length}건 — 캐시를 교체하지 않는다.`);
    for (const f of stats.failed.slice(0, 5)) log(`    ${f.kind} ${f.gu} ${f.ym}: ${f.error}`);
    if (fatal.length) log(`    ⚠ ${fatal.length}건은 권한 문제(403/401). data.go.kr 활용신청을 확인할 것.`);
    return { ok: false, stats };
  }

  await writeRaw(rows, stats);

  const master = buildMaster(rows);
  log(`[complexes] 단지 ${master.length.toLocaleString()}개 (aptSeq 기준)`);
  const geo = await geocodeAll(master, { log });
  if (!geo.skipped) log(`[complexes] 좌표 확보 ${geo.resolved}/${geo.total} (${geo.rate}%)`);
  const drop = await detectGeocodeDrop(geo);
  if (drop.drop) log(`[complexes] ⚠ 좌표 확보율 하락 ${drop.from}% → ${drop.to}%`);
  await writeGeocodeReport(geo);

  const months = [...stats.months].reverse();          // ymRange 는 최신순 → 시계열은 과거→현재
  const complexes = computeAll(rows, months);
  log(`[signals] ${complexes.length.toLocaleString()}개 단지 시그널 계산`);

  const coord = new Map(master.map((m) => [m.aptSeq, m]));
  for (const c of complexes) {
    const m = coord.get(c.aptSeq);
    c.lat = m?.lat ?? null; c.lng = m?.lng ?? null;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    dataMonth: months[months.length - 1],
    months,
    complexes,
    master: master.map(({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear }) =>
      ({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear })),
    stats: { ...stats, geocode: geo, geocodeDrop: drop.drop ? { from: drop.from, to: drop.to } : null },
  };
  await mkdir(TMP_DIR, { recursive: true });
  const tmp = `${TMP_DIR}apt-signals.json`;
  await writeFile(tmp, JSON.stringify(payload));
  await rename(tmp, SIGNALS_FILE);

  store = null;   // 다음 요청에서 다시 읽는다
  log(`[done] apt-signals.json 교체 완료 · 기준월 ${payload.dataMonth}`);
  return { ok: true, stats, geo, complexes: complexes.length };
}

/**
 * 재수집 없이 시그널만 다시 계산한다. apt-raw.json.gz 가 이미 있을 때 쓴다.
 * 시그널 로직을 고칠 때마다 575콜을 다시 쏠 이유가 없다.
 */
export async function rebuildFromRaw({ log = console.log } = {}) {
  const { gunzipSync } = await import('node:zlib');
  const buf = await readFile(`${CACHE_DIR}apt-raw.json.gz`);
  const { rows, stats } = JSON.parse(gunzipSync(buf));
  log(`[rebuild] 원시 ${rows.length.toLocaleString()}건 로드 (수집 ${stats.generatedAt})`);

  const master = buildMaster(rows);
  const months = [...stats.months].reverse();
  const complexes = computeAll(rows, months);
  const outliers = complexes.reduce((s, c) => s + (c.outliers ?? 0), 0);
  log(`[rebuild] 단지 ${complexes.length.toLocaleString()}개 · 이상치 제외 ${outliers.toLocaleString()}건`);

  let geo = { skipped: true };
  try { geo = JSON.parse(await readFile(`${CACHE_DIR}geocode-report.json`, 'utf8')); } catch { /* 없으면 무시 */ }
  const coord = new Map(master.map((m) => [m.aptSeq, m]));
  for (const c of complexes) {
    const m = coord.get(c.aptSeq);
    c.lat = m?.lat ?? null; c.lng = m?.lng ?? null;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    dataMonth: months[months.length - 1],
    months, complexes,
    master: master.map(({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear }) =>
      ({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear })),
    stats: { ...stats, geocode: geo, outliers },
  };
  await mkdir(TMP_DIR, { recursive: true });
  const tmp = `${TMP_DIR}apt-signals.json`;
  await writeFile(tmp, JSON.stringify(payload));
  await rename(tmp, SIGNALS_FILE);
  store = null;
  log(`[rebuild] apt-signals.json 교체 완료 · 기준월 ${payload.dataMonth}`);
  return { ok: true, complexes: complexes.length, outliers };
}

/**
 * 재수집 없이 지오코딩만 다시 돈다. KAKAO_REST_KEY 를 나중에 넣었을 때
 * 575콜 6분짜리 수집을 반복하지 않고 좌표만 채우기 위한 경로다.
 * (rebuildFromRaw 는 이전 report 를 읽기만 할 뿐 지오코딩을 하지 않는다.)
 */
export async function geocodeFromRaw({ log = console.log } = {}) {
  if (!process.env.KAKAO_REST_KEY) {
    log('[geocode] ✗ KAKAO_REST_KEY 가 server/.env 에 없다. 카카오 콘솔에서 REST 키를 발급해 넣을 것.');
    return { ok: false };
  }
  const { gunzipSync } = await import('node:zlib');
  const buf = await readFile(`${CACHE_DIR}apt-raw.json.gz`);
  const { rows, stats } = JSON.parse(gunzipSync(buf));
  log(`[geocode] 원시 ${rows.length.toLocaleString()}건 로드 → 단지 마스터 재구성`);

  const master = buildMaster(rows);
  const geo = await geocodeAll(master, { log });
  log(`[geocode] 좌표 확보 ${geo.resolved}/${geo.total} (${geo.rate}%)`);
  const drop = await detectGeocodeDrop(geo);
  if (drop.drop) log(`[geocode] ⚠ 좌표 확보율 하락 ${drop.from}% → ${drop.to}%`);
  await writeGeocodeReport(geo);

  const months = [...stats.months].reverse();
  const complexes = computeAll(rows, months);
  const coord = new Map(master.map((m) => [m.aptSeq, m]));
  for (const c of complexes) {
    const m = coord.get(c.aptSeq);
    c.lat = m?.lat ?? null; c.lng = m?.lng ?? null;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    dataMonth: months[months.length - 1],
    months, complexes,
    master: master.map(({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear }) =>
      ({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear })),
    stats: { ...stats, geocode: geo, geocodeDrop: drop.drop ? { from: drop.from, to: drop.to } : null },
  };
  await mkdir(TMP_DIR, { recursive: true });
  const tmp = `${TMP_DIR}apt-signals.json`;
  await writeFile(tmp, JSON.stringify(payload));
  await rename(tmp, SIGNALS_FILE);
  store = null;
  log(`[geocode] apt-signals.json 교체 완료 · 좌표 확보율 ${geo.rate}%`);
  return { ok: true, geo };
}

/**
 * 배치·재계산 직후 눈검증용 — momentum6 상위 10개를 표로 찍는다.
 * 시그널 로직을 고칠 때마다 curl + node -e 를 손으로 조합하던 것을 대체.
 * 이상치(+977%)·mix shift(+228%) 류의 회귀는 이 표에서 바로 눈에 띈다.
 */
async function printTopSignals(dealType = 'rent', signal = 'momentum6') {
  const s = await loadStore({ force: true });
  const top = s.complexes
    .filter((c) => getSignal(c, signal, dealType) != null && (c.signals[dealType]?.dealCount ?? 0) >= 3)
    .sort((a, b) => getSignal(b, signal, dealType) - getSignal(a, signal, dealType))
    .slice(0, 10)
    .map((c, i) => ({
      순위: i + 1, 단지: c.aptNm, 구: c.gu,
      [signal]: getSignal(c, signal, dealType),
      거래: c.signals[dealType].dealCount, 이상치제외: c.outliers ?? 0,
    }));
  console.log(`\n[검증] ${dealType} ${signal} 상위 10 (minDeals=3):`);
  console.table(top);
}

// `pnpm collect` 로 직접 실행될 때만 배치를 돈다.
//   --rebuild     재수집 없이 시그널만 다시 계산
//   --geocode     재수집 없이 지오코딩만 다시 (KAKAO_REST_KEY 를 나중에 넣었을 때)
//   --with-trade  매매까지 수집 (data.go.kr 활용신청 승인 후)
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.includes('--rebuild')) {
    const r = await rebuildFromRaw();
    if (r.ok) await printTopSignals();
    process.exit(r.ok ? 0 : 1);
  }
  if (process.argv.includes('--geocode')) {
    const r = await geocodeFromRaw();
    process.exit(r.ok ? 0 : 1);
  }
  const kinds = process.argv.includes('--with-trade') ? ['rent', 'trade'] : ['rent'];
  const r = await runBatch({ kinds });
  if (r.ok) await printTopSignals(kinds.includes('trade') ? 'trade' : 'rent');
  process.exit(r.ok ? 0 : 1);
}
