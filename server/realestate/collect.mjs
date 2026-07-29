// 국토부 실거래 수집 — 원시 거래 행을 그대로 축적한다.
//
// 설계 근거(Step 0 실사, server/realestate/PROBE.md):
//  · 응답에 aptSeq 단지 고유 ID가 있다 → 아파트명 문자열 매칭 불필요
//  · numOfRows=1000 을 넘는 (구,월)이 흔하다 (강남 202601 = 2,061건) → pageNo 루프 필수
//  · 1콜 평균 5.1초 → 동시성 5 로도 배치가 20분대
//  · UA 없으면 WAF 가 400 Request Blocked
//
//   fetchDealsPage ──▶ fetchDeals(페이지 루프) ──┬──▶ collectSeoul (25구 × 15개월)
//                                                └──▶ aptRentJeonse (index.mjs 의 구 단위 집계 래퍼)

import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { pool, retry } from '../lib.mjs';
import { SEOUL_GU, GU_BY_CODE, ymRange, COLLECT_MONTHS, NOW_OFFSET_MONTHS } from './lawd.mjs';

try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* index.mjs 가 이미 로드했을 수 있음 */ }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const NUM_OF_ROWS = 1000;
const MAX_PAGES = 10;           // 안전장치. 실측 최대는 3페이지(2,061건)
export const CONCURRENCY = 5;   // data.go.kr 은 50콜 동시 시 throttle

export const ENDPOINT = {
  // ⚠️ trade 는 2026-07-27 실사에서 403 Forbidden. data.go.kr 에서 해당 서비스
  //    활용신청이 승인돼야 열린다(PROBE.md ②). rent 는 같은 키로 정상 200.
  trade: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  rent: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
};

/** "50,000" | 50000 | " " → 50000 | 0 */
const num = (v) => Number(String(v ?? '').replace(/[, ]/g, '')) || 0;
const str = (v) => String(v ?? '').trim();

/**
 * 원시 응답 1건 → 통일 스키마.
 * trade/rent 가 금액 필드만 다르고 나머지는 같다.
 * trade 필드명은 403 때문에 미검증 — dealAmount 우선, 없으면 대체 후보를 훑는다.
 */
export function normalizeRow(kind, r, ymd) {
  const price = kind === 'trade'
    ? num(r.dealAmount ?? r.dealAmt ?? r.거래금액)
    : num(r.deposit);
  return {
    aptSeq: str(r.aptSeq),                 // 단지 고유 ID. 이게 키다.
    aptNm: str(r.aptNm),                   // 표시 전용 — 키로 쓰지 말 것(이름 충돌 존재)
    sggCd: str(r.sggCd),
    umdNm: str(r.umdNm),
    jibun: str(r.jibun),
    roadnm: str(r.roadnm ?? r.roadNm),     // 지오코딩 입력. 전월세는 roadnm, 매매(상세)는 roadNm — 실측으로 확인
    buildYear: Number(r.buildYear) || null,
    ym: ymd,
    day: Number(r.dealDay) || null,
    area: Number(r.excluUseAr) || null,    // 전용면적 ㎡
    floor: Number(r.floor) || null,
    kind,                                  // 'trade' | 'rent'
    price,                                 // 만원. trade=매매가, rent=보증금
    monthlyRent: kind === 'rent' ? num(r.monthlyRent) : null, // 0 이면 전세
  };
}

/** 한 페이지. { rows, total } */
export async function fetchDealsPage(kind, lawd, ymd, pageNo = 1, { fetchImpl = fetch, key = process.env.DATA_GO_KR_KEY } = {}) {
  const url = `${ENDPOINT[kind]}?serviceKey=${key}&LAWD_CD=${lawd}&DEAL_YMD=${ymd}`
    + `&_type=json&numOfRows=${NUM_OF_ROWS}&pageNo=${pageNo}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    const err = new Error(`data.go.kr ${kind} ${res.status}`);
    err.status = res.status;
    // 403 = 해당 오픈API 활용신청 미승인. 재시도해도 소용없다.
    err.fatal = res.status === 403 || res.status === 401;
    throw err;
  }
  const j = await res.json();
  const body = j?.response?.body;
  let items = body?.items?.item;
  if (!items) return { rows: [], total: Number(body?.totalCount) || 0 };
  if (!Array.isArray(items)) items = [items];       // 1건이면 배열이 아니라 객체로 온다
  return { rows: items.map((r) => normalizeRow(kind, r, ymd)), total: Number(body?.totalCount) || items.length };
}

/**
 * 한 (구, 월)의 전량. totalCount 를 읽어 필요한 만큼 pageNo 를 돈다.
 * 반환: { rows, total, calls, retries }
 */
export async function fetchDeals(kind, lawd, ymd, opts = {}) {
  const rows = [];
  let total = Infinity, calls = 0, retries = 0;
  for (let p = 1; p <= MAX_PAGES; p++) {
    const r = await retry(
      () => { calls++; return fetchDealsPage(kind, lawd, ymd, p, opts); },
      {
        attempts: 3,
        base: 500,
        onRetry: (e) => { if (e.fatal) throw e; retries++; },
      },
    );
    if (p === 1) total = r.total;
    rows.push(...r.rows);
    if (r.rows.length === 0 || rows.length >= total) break;
  }
  return { rows, total, calls, retries };
}

/**
 * 원시 거래 행 → 전세(월세=0) 보증금 합/건수.
 * index.mjs 의 seoulJeonse(대시보드 구 단위 요약)가 쓴다.
 * 순수 함수 — 리팩터 전 구현과 동일 출력이어야 한다(collect.test.mjs 회귀 테스트).
 */
export function jeonseAgg(rows) {
  let sum = 0, count = 0;
  for (const r of rows) {
    if (r.monthlyRent !== 0) continue;   // 전세만
    if (r.price <= 0) continue;
    sum += r.price; count++;
  }
  return { sum, count };
}

// ── 배치 ───────────────────────────────────────────────────────────────────
const CACHE_DIR = fileURLToPath(new URL('../cache/', import.meta.url));
const TMP_DIR = fileURLToPath(new URL('../cache/.tmp/', import.meta.url));

/**
 * 서울 25구 × COLLECT_MONTHS 개월 × kinds 를 전부 수집.
 * 실패한 (구,월)이 하나라도 있으면 caller 가 캐시를 교체하지 않는다 —
 * 구멍 난 시계열이 조용히 배포되면 시그널이 전부 거짓말이 된다.
 */
export async function collectSeoul({ kinds = ['rent'], months, log = console.log, ...opts } = {}) {
  const ymList = months ?? ymRange(NOW_OFFSET_MONTHS - 2, COLLECT_MONTHS + 2); // 미확정 구간도 차트용으로 받는다
  const jobs = [];
  for (const kind of kinds) {
    for (const [gu, lawd] of Object.entries(SEOUL_GU)) {
      for (const ym of ymList) jobs.push({ kind, gu, lawd, ym });
    }
  }

  const t0 = Date.now();
  const stats = { rows: 0, calls: 0, retries: 0, failed: [], byKind: {} };
  let done = 0;

  const results = await pool(jobs, CONCURRENCY, async (job) => {
    try {
      const r = await fetchDeals(job.kind, job.lawd, job.ym, opts);
      stats.calls += r.calls; stats.retries += r.retries;
      stats.byKind[job.kind] = (stats.byKind[job.kind] ?? 0) + r.rows.length;
      return r.rows;
    } catch (e) {
      stats.failed.push({ ...job, error: String(e.message), fatal: !!e.fatal });
      return [];
    } finally {
      if (++done % 25 === 0) log(`  ... ${done}/${jobs.length} (구,월) 완료`);
    }
  });

  const rows = results.flat();
  stats.rows = rows.length;
  stats.elapsedMs = Date.now() - t0;
  stats.months = ymList;
  stats.generatedAt = new Date().toISOString();
  return { rows, stats };
}

/** .tmp 에 쓰고 전부 성공했을 때만 rename. 실패 시 이전 캐시가 살아남는다. */
export async function writeRaw(rows, stats) {
  await mkdir(TMP_DIR, { recursive: true });
  const tmp = `${TMP_DIR}apt-raw.json.gz`;
  await writeFile(tmp, gzipSync(JSON.stringify({ stats, rows })));
  await rename(tmp, `${CACHE_DIR}apt-raw.json.gz`);
}

export function formatStats(s) {
  return `수집 ${s.rows.toLocaleString()}건 / 구 25 / 월 ${s.months.length} / 콜 ${s.calls}`
    + ` / 소요 ${Math.round(s.elapsedMs / 1000)}s / 재시도 ${s.retries} / 실패(구,월) ${s.failed.length}`;
}
