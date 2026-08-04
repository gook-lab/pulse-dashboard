import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * 일별 포트폴리오·벤치마크 이력 관리.
 *
 * @param {Object} deps 의존성 주입
 * @param {Function} deps.fetchBalance KIS 잔고 조회 → { summary: { totalValue, principal } }
 * @param {Function} deps.fetchKospi KOSPI 지수 → { price }
 * @param {Function} deps.fetchSpx S&P500(SPY) → { price }
 * @param {Function} [deps.fetchManualTotal] 수동 자산 합계(원) → number. 미주입이면 구형 스키마 그대로.
 * @param {string} deps.file 캐시 파일 경로 (JSON)
 * @param {Function} deps.now 현재 시각 함수 (테스트용 Date 주입)
 * @returns {Object} { record, start, stop, read }
 */
export function createPortfolioHistory({ fetchBalance, fetchKospi, fetchSpx, fetchManualTotal, file, now = () => new Date() }) {
  let timerId = null;

  /** KST 기준 YYYY-MM-DD 문자열. */
  function getKstDate(date = now()) {
    // UTC 시각에 9시간을 더한 후 로컬 시간으로 해석 (KST = UTC+9)
    const utc = new Date(date);
    const kstTime = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
    // toISOString()은 UTC 기준이므로, 수동으로 포맷
    const year = kstTime.getUTCFullYear();
    const month = String(kstTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kstTime.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /** 파일 읽기 (없으면 빈 구조 반환). */
  async function readData() {
    if (!existsSync(file)) return { entries: [] };
    try {
      const content = await readFile(file, 'utf8');
      return JSON.parse(content);
    } catch {
      return { entries: [] };
    }
  }

  /** Atomic write: tmp → rename. */
  async function writeData(data) {
    const dir = dirname(file);
    const tmp = `${file}.tmp`;

    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, file);
  }

  /** 하나의 record 수행. */
  async function record() {
    const date = getKstDate();
    const data = await readData();

    // 각각 독립적으로 fetch (첫 번째 실패가 다른 것을 막지 않도록)
    let totalValue, principal, kospi, spx;
    try {
      const bal = await fetchBalance();
      totalValue = bal.summary.totalValue;
      principal = bal.summary.principal;
    } catch {
      totalValue = null;
      principal = null;
    }
    try { kospi = (await fetchKospi()).price; } catch { kospi = null; }
    try { spx = (await fetchSpx()).price; } catch { spx = null; }

    const newEntry = { date, totalValue, principal, kospi, spx };

    // 수동 자산(additive 필드) — fetchManualTotal 주입 시에만 붙는다(구형 스키마·기존 테스트 불변).
    // 구·신 엔트리가 한 파일에 혼재해도 소비자는 필드 부재를 "수동자산 미포함 구간"으로 읽는다.
    if (fetchManualTotal) {
      let manualTotal = null;
      try {
        const t = await fetchManualTotal();
        manualTotal = Number.isFinite(t) ? t : null;
      } catch { manualTotal = null; }
      newEntry.manualTotal = manualTotal;
      // 순자산 정책(설계 W2): netWorth = KIS 총자산 + 수동 자산. KIS 가 없으면 순자산도 null —
      // 수동 자산만으로 "순자산"을 만들면 시계열이 KIS 복구 시점에 계단으로 뛴다.
      newEntry.netWorth = totalValue == null ? null : totalValue + (manualTotal ?? 0);
    }

    // 같은 날짜 기존 엔트리 찾아 덮어쓰기
    const idx = data.entries.findIndex((e) => e.date === date);
    if (idx >= 0) {
      data.entries[idx] = newEntry;
    } else {
      data.entries.push(newEntry);
    }

    await writeData(data);
  }

  /** intervalMs 간격으로 record 실행. */
  async function start(intervalMs) {
    // 초기 record 즉시 호출
    await record();

    // 타이머 시작
    timerId = setInterval(() => {
      record().catch((e) => console.error('[portfolioHistory] record error:', e));
    }, intervalMs);
  }

  /** 타이머 정리. */
  function stop() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  /** 최근 N일 데이터 조회. */
  async function read(days = 400) {
    const data = await readData();
    const entries = data.entries || [];
    return entries.slice(-days);
  }

  return { record, start, stop, read };
}
