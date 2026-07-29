// 서울 25구 법정동 시군구코드(LAWD_CD) — 단일 소스.
// ⚠️ GeoJSON(public/maps/seoul-simple.json)의 code 와 다르다. 공식 LAWD_CD 를 쓸 것.
// index.mjs 의 seoulJeonse 와 realestate 배치가 모두 여기서 가져간다.

export const SEOUL_GU = {
  종로구: '11110', 중구: '11140', 용산구: '11170', 성동구: '11200', 광진구: '11215',
  동대문구: '11230', 중랑구: '11260', 성북구: '11290', 강북구: '11305', 도봉구: '11320',
  노원구: '11350', 은평구: '11380', 서대문구: '11410', 마포구: '11440', 양천구: '11470',
  강서구: '11500', 구로구: '11530', 금천구: '11545', 영등포구: '11560', 동작구: '11590',
  관악구: '11620', 서초구: '11650', 강남구: '11680', 송파구: '11710', 강동구: '11740',
};

/** '11680' → '강남구' */
export const GU_BY_CODE = Object.fromEntries(
  Object.entries(SEOUL_GU).map(([name, code]) => [code, name]),
);

/** n개월 전의 'YYYYMM'. from 을 넘기면 그 시점 기준(테스트용). */
export function ymOffset(n, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 수집 대상 월 목록을 최신순으로. startAgo 개월 전부터 count 개.
 *
 * 신고지연 보정(설계 D11): 국토부 실거래는 계약 후 30일 이내 신고 의무라
 * 최근 1~2개월은 구조적으로 과소집계된다. 시그널의 기준월(now)을 3개월 전으로
 * 밀기 위해 수집은 15개월치를 받아 12개월 확정 구간을 확보한다.
 *
 *   [ 미확정 2개월 ][ ← 확정 12개월 → ][ 여유 1 ]
 *    now-0  now-1     now-3 ...  now-14
 */
export function ymRange(startAgo, count, from = new Date()) {
  return Array.from({ length: count }, (_, i) => ymOffset(startAgo + i, from));
}

/** 시그널 계산의 기준월 오프셋. 신고지연 때문에 0이 아니다. */
export const NOW_OFFSET_MONTHS = 3;
/** 확정 구간 길이(개월). */
export const CONFIRMED_MONTHS = 12;
/** 실제 수집 개월 수 = 기준월 오프셋 + 확정 구간. */
export const COLLECT_MONTHS = NOW_OFFSET_MONTHS + CONFIRMED_MONTHS;
