// 목 시드 — 백엔드 없이 프론트를 만들기 위한 실존 단지 30개.
//
// ⚠️ 여기서 나오는 시그널 값은 전부 가짜다. 화면은 source:'mock' 을 받으면
//    반드시 "목 데이터" 배지를 강제 노출해야 한다. 시그널 도구에서 가짜 숫자를
//    진짜로 오해하는 것은 버그보다 나쁘다.
//
// 좌표는 실좌표(대략)라 지도 레이아웃·클러스터링을 눈으로 검증할 수 있다.
// aptSeq 형식은 실제와 동일한 {시군구코드}-{일련번호}.

import type { AptComplex, AptComplexDetail, AptDeal, KindSignals, SignalKey, DealType, AreaTier } from './types';

interface Seed extends AptComplex { areaTier: AreaTier; roadnm: string }

export const APT_SEED: Seed[] = [
  { aptSeq: '11740-101', aptNm: '고덕그라시움', gu: '강동구', umdNm: '상일동', lat: 37.5556, lng: 127.1583, buildYear: 2019, areaTier: '60~85', roadnm: '고덕로 333' },
  { aptSeq: '11710-201', aptNm: '헬리오시티', gu: '송파구', umdNm: '가락동', lat: 37.5015, lng: 127.1120, buildYear: 2018, areaTier: '60~85', roadnm: '송파대로 345' },
  { aptSeq: '11680-4800', aptNm: '래미안블레스티지', gu: '강남구', umdNm: '개포동', lat: 37.4806, lng: 127.0552, buildYear: 2019, areaTier: '85~135', roadnm: '선릉로 8' },
  { aptSeq: '11440-301', aptNm: '마포래미안푸르지오', gu: '마포구', umdNm: '아현동', lat: 37.5546, lng: 126.9553, buildYear: 2014, areaTier: '60~85', roadnm: '마포대로 195' },
  { aptSeq: '11710-202', aptNm: '파크리오', gu: '송파구', umdNm: '신천동', lat: 37.5136, lng: 127.1043, buildYear: 2008, areaTier: '60~85', roadnm: '올림픽로 135' },
  { aptSeq: '11650-401', aptNm: '아크로리버파크', gu: '서초구', umdNm: '반포동', lat: 37.5100, lng: 126.9955, buildYear: 2016, areaTier: '85~135', roadnm: '신반포로 275' },
  { aptSeq: '11200-501', aptNm: 'e편한세상옥수파크힐스', gu: '성동구', umdNm: '옥수동', lat: 37.5407, lng: 127.0106, buildYear: 2016, areaTier: '60~85', roadnm: '독서당로 106' },
  { aptSeq: '11380-601', aptNm: 'DMC파크뷰자이', gu: '은평구', umdNm: '수색동', lat: 37.5809, lng: 126.8961, buildYear: 2015, areaTier: '60~85', roadnm: '수색로 200' },
  { aptSeq: '11650-402', aptNm: '래미안퍼스티지', gu: '서초구', umdNm: '반포동', lat: 37.5045, lng: 127.0033, buildYear: 2009, areaTier: '85~135', roadnm: '사평대로 205' },
  { aptSeq: '11110-701', aptNm: '경희궁자이', gu: '종로구', umdNm: '홍파동', lat: 37.5709, lng: 126.9662, buildYear: 2017, areaTier: '60~85', roadnm: '송월길 155' },
  { aptSeq: '11650-403', aptNm: '반포자이', gu: '서초구', umdNm: '반포동', lat: 37.5048, lng: 126.9964, buildYear: 2008, areaTier: '85~135', roadnm: '신반포로 270' },
  { aptSeq: '11710-203', aptNm: '잠실엘스', gu: '송파구', umdNm: '잠실동', lat: 37.5142, lng: 127.0836, buildYear: 2008, areaTier: '60~85', roadnm: '올림픽로 99' },
  { aptSeq: '11470-801', aptNm: '목동신시가지7단지', gu: '양천구', umdNm: '목동', lat: 37.5330, lng: 126.8748, buildYear: 1986, areaTier: '60~85', roadnm: '목동로 201' },
  { aptSeq: '11350-901', aptNm: '상계주공7단지', gu: '노원구', umdNm: '상계동', lat: 37.6608, lng: 127.0616, buildYear: 1988, areaTier: '~60', roadnm: '노해로 480' },
  { aptSeq: '11680-4801', aptNm: '개포주공5단지', gu: '강남구', umdNm: '개포동', lat: 37.4874, lng: 127.0663, buildYear: 1983, areaTier: '~60', roadnm: '삼성로 14' },
  { aptSeq: '11740-102', aptNm: '둔촌현대1차', gu: '강동구', umdNm: '둔촌동', lat: 37.5296, lng: 127.1381, buildYear: 1984, areaTier: '60~85', roadnm: '동남로 811' },
  { aptSeq: '11560-1001', aptNm: '여의도자이', gu: '영등포구', umdNm: '여의도동', lat: 37.5219, lng: 126.9245, buildYear: 2008, areaTier: '85~135', roadnm: '국제금융로 10' },
  { aptSeq: '11560-1002', aptNm: '시범아파트', gu: '영등포구', umdNm: '여의도동', lat: 37.5254, lng: 126.9294, buildYear: 1971, areaTier: '85~135', roadnm: '여의대방로 43' },
  { aptSeq: '11170-1101', aptNm: '한남더힐', gu: '용산구', umdNm: '한남동', lat: 37.5372, lng: 127.0021, buildYear: 2011, areaTier: '135~', roadnm: '독서당로 111' },
  { aptSeq: '11170-1102', aptNm: '이촌코오롱', gu: '용산구', umdNm: '이촌동', lat: 37.5216, lng: 126.9740, buildYear: 1999, areaTier: '60~85', roadnm: '이촌로 200' },
  { aptSeq: '11215-1201', aptNm: '광장현대', gu: '광진구', umdNm: '광장동', lat: 37.5462, lng: 127.1046, buildYear: 1990, areaTier: '85~135', roadnm: '아차산로 500' },
  { aptSeq: '11290-1301', aptNm: '래미안길음센터피스', gu: '성북구', umdNm: '길음동', lat: 37.6088, lng: 127.0250, buildYear: 2019, areaTier: '60~85', roadnm: '길음로 100' },
  { aptSeq: '11230-1401', aptNm: '래미안답십리', gu: '동대문구', umdNm: '답십리동', lat: 37.5715, lng: 127.0553, buildYear: 2014, areaTier: '60~85', roadnm: '천호대로 300' },
  { aptSeq: '11500-1501', aptNm: '마곡엠밸리7단지', gu: '강서구', umdNm: '마곡동', lat: 37.5606, lng: 126.8256, buildYear: 2014, areaTier: '60~85', roadnm: '마곡중앙로 100' },
  { aptSeq: '11620-1601', aptNm: '관악드림타운', gu: '관악구', umdNm: '봉천동', lat: 37.4869, lng: 126.9528, buildYear: 2002, areaTier: '60~85', roadnm: '관악로 200' },
  { aptSeq: '11590-1701', aptNm: '흑석한강센트레빌', gu: '동작구', umdNm: '흑석동', lat: 37.5081, lng: 126.9633, buildYear: 2011, areaTier: '85~135', roadnm: '현충로 100' },
  { aptSeq: '11530-1801', aptNm: '구로두산위브', gu: '구로구', umdNm: '구로동', lat: 37.4954, lng: 126.8874, buildYear: 2006, areaTier: '60~85', roadnm: '구로중앙로 150' },
  { aptSeq: '11320-1901', aptNm: '도봉한신', gu: '도봉구', umdNm: '창동', lat: 37.6531, lng: 127.0475, buildYear: 1992, areaTier: '~60', roadnm: '노해로 300' },
  { aptSeq: '11260-2001', aptNm: '중랑e편한세상', gu: '중랑구', umdNm: '상봉동', lat: 37.5964, lng: 127.0851, buildYear: 2013, areaTier: '60~85', roadnm: '망우로 300' },
  { aptSeq: '11140-2101', aptNm: '남산타운', gu: '중구', umdNm: '신당동', lat: 37.5539, lng: 127.0116, buildYear: 2002, areaTier: '60~85', roadnm: '다산로 200' },
];

/** aptSeq 로부터 결정적 난수(0..1). 새로고침해도 값이 안 흔들린다. */
function seeded(key: string, salt: string): number {
  let h = 2166136261;
  for (const ch of key + salt) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

const span = (t: number, min: number, max: number, dec = 1) =>
  +(min + (max - min) * t).toFixed(dec);

function kindSignals(aptSeq: string, kind: DealType): KindSignals {
  const s = (salt: string) => seeded(aptSeq, kind + salt);
  const m6 = span(s('m6'), -12, 20);
  const deals = Math.round(span(s('deals'), 0, 60, 0));
  return {
    momentum3: span(s('m3'), -8, 12),
    momentum6: m6,
    momentum12: span(s('m12'), -18, 32),
    high52wPct: span(s('hi'), -22, 0),
    volumeRatio: span(s('vol'), 0.3, 3.2, 2),
    rs: span(s('rs'), -9, 9),
    dealCount: deals,
  };
}

/** 목 단지 전체 — 시그널 포함. 순위 계산은 실제와 같은 코드 경로를 쓴다. */
export function mockComplexes(): (AptComplexDetail & { areaTier: AreaTier })[] {
  const months = Array.from({ length: 17 }, (_, i) => {
    const d = new Date(2025, 2 + i, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  return APT_SEED.map((c) => {
    const t = kindSignals(c.aptSeq, 'trade');
    const r = kindSignals(c.aptSeq, 'rent');
    const base = 2000 + seeded(c.aptSeq, 'base') * 6000;
    const series = (kind: string): [number | null, number][] =>
      months.map((_, i) => {
        const drift = 1 + (i / months.length) * (seeded(c.aptSeq, kind + 'd') - 0.4) * 0.5;
        const has = seeded(c.aptSeq, kind + i) > 0.25;
        return has ? [+(base * drift).toFixed(0), Math.round(seeded(c.aptSeq, kind + 'c' + i) * 5) + 1] : [null, 0];
      });
    const jr = seeded(c.aptSeq, 'jr') > 0.25 ? span(seeded(c.aptSeq, 'jrv'), 0.42, 0.86, 3) : null;

    // 평형대별 요약 — 대표 평형대 + 인접 1개에만 값을 채워 실데이터의 희소함을 흉내낸다.
    const tiers: AptComplexDetail['tiers'] = {};
    const tierIdx = AREA_TIERS.indexOf(c.areaTier);
    for (const ti of [tierIdx, tierIdx + (seeded(c.aptSeq, 'tn') > 0.5 ? 1 : -1)]) {
      const tier = AREA_TIERS[ti];
      if (!tier) continue;
      const f = ti === tierIdx ? 1 : 0.82;
      tiers[tier] = {
        t: [Math.round(base * 1.6 * f), Math.round(seeded(c.aptSeq, 'tc' + ti) * 20)],
        r: [Math.round(base * f), Math.round(seeded(c.aptSeq, 'rc' + ti) * 40) + 3],
      };
    }

    // 최근 거래 10건 — 최신 달부터 역순으로 채운다.
    const recent: AptDeal[] = Array.from({ length: 10 }, (_, i) => {
      const mi = months.length - 1 - Math.floor(i / 2);
      const isRent = seeded(c.aptSeq, 'rk' + i) > 0.35;
      const area = c.areaTier === '~60' ? 59.9 : c.areaTier === '60~85' ? 84.9 : c.areaTier === '85~135' ? 114.7 : 138.3;
      const py = area / 3.3058;
      return {
        ym: months[mi],
        day: Math.round(seeded(c.aptSeq, 'rd' + i) * 27) + 1,
        kind: (isRent ? 'rent' : 'trade') as DealType,
        area,
        floor: Math.round(seeded(c.aptSeq, 'rf' + i) * 24) + 1,
        price: Math.round(base * (isRent ? 1 : 1.6) * py * (0.92 + seeded(c.aptSeq, 'rp' + i) * 0.16)),
        monthlyRent: isRent && seeded(c.aptSeq, 'rm' + i) > 0.75 ? Math.round(seeded(c.aptSeq, 'rmv' + i) * 200) : isRent ? 0 : null,
      };
    });

    return {
      ...c,
      sggCd: c.aptSeq.split('-')[0],
      jibun: '1',
      series: { t: series('t'), r: series('r') },
      signals: { trade: t, rent: r, jeonseRatio: jr, jeonseRatioTier: jr ? c.areaTier : null },
      months,
      tiers,
      recent,
    };
  });
}

const AREA_TIERS: AreaTier[] = ['~60', '60~85', '85~135', '135~'];

export const MOCK_GENERATED_AT = '2026-07-01T00:00:00.000Z';
export const MOCK_DATA_MONTH = '202604';

export const MOCK_SIGNAL_KEYS: SignalKey[] =
  ['momentum3', 'momentum6', 'momentum12', 'high52wPct', 'volumeRatio', 'jeonseRatio', 'rs'];
