// 단지 마스터 — 원시 거래를 aptSeq 로 묶고 좌표를 붙인다.
//
// ★ match.mjs 가 없는 이유 (Step 0 실사, PROBE.md ②)
//   실거래 응답에 aptSeq 단지 고유 ID가 들어 있다. 강남구 5,343건 검증에서
//   aptSeq 누락 0건 · 한 aptSeq가 여러 이름 0건 · 반대로 한 이름이 여러 aptSeq 10건.
//   ("삼성" 이 강남구에만 3개 단지, "동부센트레빌" 도 3개)
//   아파트명으로 묶었다면 강남구 한 곳에서만 10건이 오염됐다. 그래서 이름은 표시 전용이다.
//
// 좌표: 실거래 응답의 roadnm(도로명) → 카카오 로컬 주소검색.
//   국토부 지오코더(15101106)는 실사에서 HTTP 500 이라 1순위에서 제외했다.

import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { pool, retry } from '../lib.mjs';
import { GU_BY_CODE } from './lawd.mjs';

const CACHE_DIR = fileURLToPath(new URL('../cache/', import.meta.url));
const TMP_DIR = fileURLToPath(new URL('../cache/.tmp/', import.meta.url));
const GEO_CONCURRENCY = 5;   // data.go.kr 과 동일 정책. 카카오도 버스트에 약하다.

/**
 * 원시 거래 → 단지 마스터. 키는 aptSeq.
 * 표시 메타는 가장 최근 거래 기준(단지명이 바뀌면 최신 이름을 따른다).
 */
export function buildMaster(rows) {
  const byApt = new Map();
  for (const r of rows) {
    if (!r.aptSeq) continue;
    const cur = byApt.get(r.aptSeq);
    if (!cur || r.ym > cur.ym) {
      byApt.set(r.aptSeq, {
        aptSeq: r.aptSeq,
        aptNm: r.aptNm,
        sggCd: r.sggCd,
        gu: GU_BY_CODE[r.sggCd] ?? null,
        umdNm: r.umdNm,
        jibun: r.jibun,
        roadnm: r.roadnm,
        buildYear: r.buildYear,
        ym: r.ym,
      });
    }
  }
  return [...byApt.values()].map(({ ym, ...c }) => ({ ...c, lat: null, lng: null }));
}

/** 지오코딩 질의문자열. 도로명이 있으면 그걸, 없으면 법정동+지번. */
export function addressOf(c) {
  const base = `서울 ${c.gu ?? ''}`.trim();
  if (c.roadnm) return `${base} ${c.roadnm}`.trim();
  if (c.umdNm && c.jibun) return `${base} ${c.umdNm} ${c.jibun}`.trim();
  return c.umdNm ? `${base} ${c.umdNm}`.trim() : null;
}

/** 카카오 로컬 주소검색 1건. { lat, lng } | null */
export async function geocodeOne(address, { fetchImpl = fetch, key = process.env.KAKAO_REST_KEY } = {}) {
  if (!key || !address) return null;
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}&size=1`;
  const res = await fetchImpl(url, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!res.ok) {
    const err = new Error(`kakao ${res.status}`);
    err.fatal = res.status === 401 || res.status === 403;
    throw err;
  }
  const doc = (await res.json())?.documents?.[0];
  if (!doc) return null;
  return { lat: Number(doc.y), lng: Number(doc.x) };
}

/**
 * 마스터 전체에 좌표를 채운다. 키가 없으면 전부 null 로 두고 그 사실을 보고한다.
 * 조용히 좌표 없는 지도를 내보내는 것이 최악이다.
 */
export async function geocodeAll(master, { log = console.log, ...opts } = {}) {
  const key = opts.key ?? process.env.KAKAO_REST_KEY;
  const report = { total: master.length, resolved: 0, failed: [], skipped: !key };

  if (!key) {
    log('  ⚠ KAKAO_REST_KEY 없음 — 좌표 없이 진행. 지도 마커는 비고 리스트만 동작한다.');
    return report;
  }

  await pool(master, GEO_CONCURRENCY, async (c) => {
    const addr = addressOf(c);
    try {
      const hit = await retry(() => geocodeOne(addr, opts), { attempts: 3, base: 400 });
      if (hit) { c.lat = hit.lat; c.lng = hit.lng; report.resolved++; }
      else report.failed.push({ aptSeq: c.aptSeq, aptNm: c.aptNm, address: addr, reason: 'no-result' });
    } catch (e) {
      report.failed.push({ aptSeq: c.aptSeq, aptNm: c.aptNm, address: addr, reason: String(e.message) });
    }
  });

  report.rate = report.total ? +((report.resolved / report.total) * 100).toFixed(1) : 0;
  return report;
}

/** 직전 실행 대비 확보율이 떨어졌는지 — 조용한 실패를 막는 유일한 장치(T16). */
export async function detectGeocodeDrop(report) {
  try {
    const prev = JSON.parse(await readFile(`${CACHE_DIR}geocode-report.json`, 'utf8'));
    if (typeof prev.rate === 'number' && report.rate < prev.rate - 5) {
      return { drop: true, from: prev.rate, to: report.rate };
    }
  } catch { /* 첫 실행 */ }
  return { drop: false };
}

export async function writeGeocodeReport(report) {
  await mkdir(TMP_DIR, { recursive: true });
  const tmp = `${TMP_DIR}geocode-report.json`;
  await writeFile(tmp, JSON.stringify(report, null, 1));
  await rename(tmp, `${CACHE_DIR}geocode-report.json`);
}
