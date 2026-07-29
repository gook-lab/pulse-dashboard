// 단지별 거래 이력 저장 및 조회.
//
// ★ 저장 구조: server/cache/apt-deals/{sggCd}.json
//   { [aptSeq]: { ym, day, kind:'trade'|'rent', area, floor, price, monthlyRent }[] }
//   tmp→rename 원자 쓰기. 구별 샤드는 배치가 수집한 전체 데이터를 보존한다.
//
// ★ 읽기: aptSeq → sggCd 매핑 후 lazy 로드 + LRU 캐시(5개 구 max)
//   응답: { deals: [...] }    날짜 내림차순
//        { deals: [], stale: true }   구버전 캐시(shard 파일 부재)

import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEALS_DIR = 'apt-deals';
const MAX_LRU_SIZE = 5;

/**
 * 원시 거래 rows → 구별 샤드 JSON 파일로 저장.
 * aptSeq 를 키로, 같은 단지의 거래를 배열에 누적한다.
 * tmp→rename 원자 쓰기.
 *
 * baseDir: 프로덕션은 server/cache, 테스트는 temp 디렉토리.
 * 구조: baseDir에 직접 {sggCd}.json 파일을 쓴다.
 */
export async function writeDealShards(rows, baseDir = null) {
  const targetDir = baseDir || join(process.cwd(), 'server', 'cache', DEALS_DIR);
  const tmpDir = baseDir
    ? join(baseDir, '.tmp')
    : join(process.cwd(), 'server', 'cache', '.tmp');

  // sggCd 별로 rows를 그룹화
  const byDistrict = new Map();
  for (const row of rows) {
    if (!row.sggCd || !row.aptSeq) continue;
    const sggCd = String(row.sggCd);
    if (!byDistrict.has(sggCd)) byDistrict.set(sggCd, new Map());
    const districtMap = byDistrict.get(sggCd);
    if (!districtMap.has(row.aptSeq)) districtMap.set(row.aptSeq, []);
    districtMap.get(row.aptSeq).push({
      ym: row.ym,
      day: row.day,
      kind: row.kind,
      area: row.area,
      floor: row.floor,
      price: row.price,
      monthlyRent: row.monthlyRent,
    });
  }

  // 구별로 파일 쓰기
  await mkdir(targetDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  for (const [sggCd, complexMap] of byDistrict.entries()) {
    const payload = Object.fromEntries(complexMap);
    const tmpFile = join(tmpDir, `${sggCd}.json`);
    const finalFile = join(targetDir, `${sggCd}.json`);
    await writeFile(tmpFile, JSON.stringify(payload));
    await rename(tmpFile, finalFile);
  }
}

/**
 * 단지의 거래 이력을 조회한다.
 * aptSeq → 샤드 파일 로드(캐시) → 필터링 & 정렬
 * 응답: { deals: [...] } | { deals: [], stale: true }
 *
 * baseDir: 프로덕션은 server/cache, 테스트는 temp 디렉토리.
 * baseDir이 주어지면 직접 {sggCd}.json 읽음 (테스트용).
 * 없으면 server/cache/apt-deals/{sggCd}.json 읽음.
 */
export async function readComplexDeals(aptSeq, sggCd, baseDir = null, lruCache = null) {
  const targetDir = baseDir
    ? baseDir
    : join(process.cwd(), 'server', 'cache', DEALS_DIR);

  // 캐시가 없으면 생성(테스트용 주입 가능)
  const cache = lruCache || createDealsLRU();

  // sggCd별 캐시 확인
  let shardData = cache.get(sggCd);
  if (!shardData) {
    // 파일에서 로드
    try {
      const filePath = join(targetDir, `${sggCd}.json`);
      const content = await readFile(filePath, 'utf8');
      shardData = JSON.parse(content);
      cache.set(sggCd, shardData);
    } catch (e) {
      // 파일이 없으면 stale(구버전 캐시)
      return { deals: [], stale: true };
    }
  }

  // aptSeq의 거래 목록
  const deals = shardData[aptSeq] ?? [];

  // 날짜 내림차순 정렬 (ym 기준, 같으면 day)
  const sorted = [...deals].sort((a, b) => {
    if (a.ym !== b.ym) return b.ym.localeCompare(a.ym);  // ym 내림차순
    return b.day - a.day;  // day 내림차순
  });

  return { deals: sorted };
}

/**
 * LRU 캐시 생성. Map 기반, 최대 5개 항목.
 */
export function createDealsLRU(maxSize = MAX_LRU_SIZE) {
  const map = new Map();

  const cache = {
    get(key) {
      if (!map.has(key)) return undefined;
      // LRU: 접근 시 최신 항목으로 이동
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },

    set(key, value) {
      if (map.has(key)) {
        map.delete(key);
      } else if (map.size >= maxSize) {
        // 가장 오래된 항목(첫 번째) 제거
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
      }
      map.set(key, value);
    },

    has(key) {
      return map.has(key);
    },

    get size() {
      return map.size;
    },

    clear() {
      map.clear();
    },
  };

  return cache;
}
