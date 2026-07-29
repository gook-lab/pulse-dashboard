import { describe, it, expect, vi } from 'vitest';
import { normalizeRow, fetchDealsPage, fetchDeals, jeonseAgg } from './collect.mjs';

// Step 0 실사(2026-07-27)에서 받은 실제 응답 형태. 값만 축약.
const RAW_RENT = [
  { aptNm: '까치마을', aptSeq: '11680-314', buildYear: 1993, dealDay: 28, dealMonth: 1, dealYear: 2026,
    deposit: '50,000', excluUseAr: 49.5, floor: 15, jibun: 746, monthlyRent: 0,
    roadnm: '광평로19길 10', sggCd: 11680, umdNm: '수서동' },
  { aptNm: '래미안블레스티지', aptSeq: '11680-4800', buildYear: 2019, dealDay: 8, dealMonth: 4, dealYear: 2026,
    deposit: '5,000', excluUseAr: 84.943, floor: 14, jibun: 1280, monthlyRent: 560,   // 월세 → 전세 집계 제외
    roadnm: '선릉로 8', sggCd: 11680, umdNm: '수서동' },
  { aptNm: '삼성', aptSeq: '11680-330', buildYear: 1998, dealDay: 3, dealMonth: 4, dealYear: 2026,
    deposit: '120,000', excluUseAr: 114.2, floor: 7, jibun: 22, monthlyRent: 0,
    roadnm: '봉은사로 100', sggCd: 11680, umdNm: '삼성동' },
  { aptNm: '보증금0', aptSeq: '11680-999', buildYear: 2000, dealDay: 1, dealMonth: 4, dealYear: 2026,
    deposit: ' ', excluUseAr: 59.9, floor: 3, jibun: 1, monthlyRent: 0,                // 보증금 파싱 실패 → 제외
    roadnm: '테스트로 1', sggCd: 11680, umdNm: '수서동' },
];

const okRes = (items, totalCount) => ({
  ok: true, status: 200,
  json: async () => ({ response: { header: { resultCode: '000' }, body: { items: { item: items }, totalCount } } }),
});

describe('normalizeRow', () => {
  it('전월세 원시행을 통일 스키마로 — 쉼표 금액 파싱', () => {
    expect(normalizeRow('rent', RAW_RENT[0], '202601')).toEqual({
      aptSeq: '11680-314', aptNm: '까치마을', sggCd: '11680', umdNm: '수서동', jibun: '746',
      roadnm: '광평로19길 10', buildYear: 1993, ym: '202601', day: 28,
      area: 49.5, floor: 15, kind: 'rent', price: 50000, monthlyRent: 0,
    });
  });

  it('aptSeq 를 키로 쓴다 — 같은 이름 다른 단지가 섞이지 않는다', () => {
    // 실사에서 확인된 실제 충돌: "삼성" 이 강남구에만 3개 단지
    const a = normalizeRow('rent', { ...RAW_RENT[2], aptSeq: '11680-330' }, '202604');
    const b = normalizeRow('rent', { ...RAW_RENT[2], aptSeq: '11680-316' }, '202604');
    expect(a.aptNm).toBe(b.aptNm);      // 이름은 같지만
    expect(a.aptSeq).not.toBe(b.aptSeq); // 키는 다르다
  });

  it('매매는 dealAmount 를 price 로, monthlyRent 는 null', () => {
    const r = normalizeRow('trade', { aptSeq: '11680-1', aptNm: 'X', dealAmount: '150,000', excluUseAr: 84, dealDay: 5 }, '202604');
    expect(r.price).toBe(150000);
    expect(r.monthlyRent).toBeNull();
    expect(r.kind).toBe('trade');
  });

  it('빈 값·공백 필드에 NaN 이 새지 않는다', () => {
    const r = normalizeRow('rent', { aptSeq: ' ', deposit: ' ', monthlyRent: ' ', excluUseAr: '', floor: '' }, '202604');
    expect(r.price).toBe(0);
    expect(r.monthlyRent).toBe(0);
    expect(r.area).toBeNull();
    expect(r.floor).toBeNull();
  });
});

describe('fetchDealsPage', () => {
  it('items 가 배열이 아니라 단일 객체로 와도 처리한다 (data.go.kr 1건 응답)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okRes(RAW_RENT[0], 1));
    const { rows, total } = await fetchDealsPage('rent', '11680', '202601', 1, { fetchImpl, key: 'k' });
    expect(rows).toHaveLength(1);
    expect(total).toBe(1);
  });

  it('items 가 없으면 빈 배열', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: { body: { totalCount: 0 } } }) });
    const { rows } = await fetchDealsPage('rent', '11680', '202601', 1, { fetchImpl, key: 'k' });
    expect(rows).toEqual([]);
  });

  it('403 은 fatal 로 표시된다 — 재시도해도 소용없는 미승인 상태', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(fetchDealsPage('trade', '11680', '202601', 1, { fetchImpl, key: 'k' }))
      .rejects.toMatchObject({ status: 403, fatal: true });
  });

  it('500 은 fatal 이 아니다 — 재시도 대상', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchDealsPage('rent', '11680', '202601', 1, { fetchImpl, key: 'k' }))
      .rejects.toMatchObject({ status: 500, fatal: false });
  });
});

describe('fetchDeals — 페이지네이션', () => {
  it('totalCount 가 numOfRows 를 넘으면 다음 페이지를 받는다', async () => {
    // 실사 기준: 강남 202601 = 2,061건 → 3페이지
    const page = (n) => Array.from({ length: n }, (_, i) => ({ ...RAW_RENT[0], aptSeq: `11680-${i}` }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(okRes(page(1000), 2061))
      .mockResolvedValueOnce(okRes(page(1000), 2061))
      .mockResolvedValueOnce(okRes(page(61), 2061));
    const { rows, total, calls } = await fetchDeals('rent', '11680', '202601', { fetchImpl, key: 'k' });
    expect(total).toBe(2061);
    expect(rows).toHaveLength(2061);
    expect(calls).toBe(3);
  });

  it('한 페이지로 끝나면 한 번만 부른다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okRes(RAW_RENT, 4));
    const { calls } = await fetchDeals('rent', '11140', '202604', { fetchImpl, key: 'k' });
    expect(calls).toBe(1);
  });

  it('일시 실패는 지수 백오프로 재시도하고 성공하면 이어간다', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(okRes(RAW_RENT, 4));
    const { rows, retries } = await fetchDeals('rent', '11140', '202604', { fetchImpl, key: 'k' });
    expect(rows).toHaveLength(4);
    expect(retries).toBe(1);
  });
});

// ★ REGRESSION ★ — aptRentJeonse 리팩터 전후 동일 출력 보장.
// 기존 구현(index.mjs:391, 삭제됨)은 원시 items 를 직접 훑어 monthlyRent!==0 을 걸러내고
// deposit>0 인 것만 합산했다. 리팩터 후에는 fetchDeals(정규화) + jeonseAgg(집계)로 나뉜다.
describe('★REGRESSION★ jeonseAgg — 기존 aptRentJeonse 와 동일 결과', () => {
  /** 리팩터 이전 구현을 그대로 옮겨온 참조 함수. 절대 수정하지 말 것. */
  function legacyAgg(items) {
    let sum = 0, count = 0;
    for (const it of items) {
      const mr = Number(String(it.monthlyRent).replace(/[, ]/g, '')) || 0;
      if (mr !== 0) continue;
      const dep = Number(String(it.deposit).replace(/[, ]/g, '')) || 0;
      if (dep <= 0) continue;
      sum += dep; count++;
    }
    return { sum, count };
  }

  it('동일 입력에 동일 {sum, count}', () => {
    const legacy = legacyAgg(RAW_RENT);
    const next = jeonseAgg(RAW_RENT.map((r) => normalizeRow('rent', r, '202604')));
    expect(next).toEqual(legacy);
    expect(next).toEqual({ sum: 170000, count: 2 });   // 까치마을 5만 + 삼성 12만
  });

  it('월세 건은 양쪽 모두 제외', () => {
    const onlyMonthly = [RAW_RENT[1]];
    expect(jeonseAgg(onlyMonthly.map((r) => normalizeRow('rent', r, '202604')))).toEqual(legacyAgg(onlyMonthly));
    expect(jeonseAgg(onlyMonthly.map((r) => normalizeRow('rent', r, '202604')))).toEqual({ sum: 0, count: 0 });
  });

  it('빈 입력', () => {
    expect(jeonseAgg([])).toEqual(legacyAgg([]));
  });
});
