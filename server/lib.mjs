// 백엔드 공용 유틸. index.mjs 와 realestate/* 가 함께 쓴다.
// 여기 있는 것은 도메인 지식이 없는 순수 헬퍼만.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 동시성 제한 풀. items 를 limit 개씩만 동시에 worker 에 흘린다.
 * data.go.kr 은 버스트에 약하고(50콜 동시 시 throttle), KIS 도 마찬가지라
 * 외부 API 를 다수 호출하는 모든 경로가 이걸 거친다.
 *
 *   items ─┬─ worker ─┐
 *          ├─ worker ─┼─▶ out[]  (입력 순서 보존)
 *          └─ worker ─┘
 *            최대 limit 개 동시 실행
 */
export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

/** 지수 백오프 재시도. attempts 회까지, base * 2^n ms 대기. */
export async function retry(fn, { attempts = 3, base = 500, onRetry } = {}) {
  let last;
  for (let n = 0; n < attempts; n++) {
    try {
      return await fn(n);
    } catch (e) {
      last = e;
      if (n === attempts - 1) break;
      onRetry?.(e, n);
      await sleep(base * 2 ** n);
    }
  }
  throw last;
}
