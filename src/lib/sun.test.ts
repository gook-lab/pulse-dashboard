import { describe, it, expect } from 'vitest';
import { solarPosition, shadowVector, convexHull, kstDate } from './sun';

// 서울시청
const LAT = 37.5665;
const LNG = 126.978;

describe('solarPosition — 서울 실측값 대조', () => {
  it('하지 정오 태양 고도는 약 76도 (천문 관측값)', () => {
    const p = solarPosition(kstDate(2026, 5, 21, 12, 30), LAT, LNG);
    expect(p.altitude).toBeGreaterThan(73);
    expect(p.altitude).toBeLessThan(78);
    expect(p.azimuth).toBeGreaterThan(170);   // 남중 근처
    expect(p.azimuth).toBeLessThan(195);
  });

  it('동지 정오 태양 고도는 약 29도 — 하지의 절반도 안 된다', () => {
    const p = solarPosition(kstDate(2026, 11, 21, 12, 30), LAT, LNG);
    expect(p.altitude).toBeGreaterThan(26);
    expect(p.altitude).toBeLessThan(32);
  });

  it('춘분 정오는 약 52도 (90 - 위도)', () => {
    const p = solarPosition(kstDate(2026, 2, 21, 12, 30), LAT, LNG);
    expect(p.altitude).toBeGreaterThan(49);
    expect(p.altitude).toBeLessThan(55);
  });

  it('오전은 동쪽, 오후는 서쪽 — 방위가 시간과 함께 증가한다', () => {
    const am = solarPosition(kstDate(2026, 5, 21, 8), LAT, LNG);
    const pm = solarPosition(kstDate(2026, 5, 21, 16), LAT, LNG);
    expect(am.azimuth).toBeLessThan(120);   // 동~동남
    expect(pm.azimuth).toBeGreaterThan(240); // 서~서남
  });

  it('한밤중은 고도가 음수 — 그림자를 그리지 않아야 한다', () => {
    expect(solarPosition(kstDate(2026, 5, 21, 1), LAT, LNG).altitude).toBeLessThan(0);
  });

  it('브라우저 타임존과 무관하게 같은 값 (kstDate 가 UTC 로 고정)', () => {
    const a = solarPosition(kstDate(2026, 5, 21, 12), LAT, LNG);
    const b = solarPosition(new Date('2026-06-21T03:00:00Z'), LAT, LNG);
    expect(a.altitude).toBeCloseTo(b.altitude, 6);
  });
});

describe('shadowVector — 그림자 방향과 길이', () => {
  it('태양이 남에 있으면 그림자는 북으로 간다', () => {
    const v = shadowVector({ altitude: 45, azimuth: 180 }, 30)!;
    expect(v.dy).toBeGreaterThan(0);          // 북(y+)
    expect(Math.abs(v.dx)).toBeLessThan(0.01);
    expect(v.len).toBeCloseTo(30, 1);          // 45도면 높이와 같은 길이
  });

  it('고도가 낮으면 그림자가 길어진다 — 동지에 저층까지 가리는 이유', () => {
    const high = shadowVector({ altitude: 76, azimuth: 180 }, 30)!;
    const low = shadowVector({ altitude: 29, azimuth: 180 }, 30)!;
    expect(low.len).toBeGreaterThan(high.len * 3);
  });

  it('길이 상한을 둔다 — 발산하는 폴리곤은 화면에서 의미가 없다', () => {
    expect(shadowVector({ altitude: 2, azimuth: 180 }, 100, 400)!.len).toBe(400);
  });

  it('해가 지평선 근처면 null', () => {
    expect(shadowVector({ altitude: 0.5, azimuth: 90 }, 30)).toBeNull();
    expect(shadowVector({ altitude: -10, azimuth: 90 }, 30)).toBeNull();
  });

  it('태양이 동에 있으면 그림자는 서로 간다', () => {
    const v = shadowVector({ altitude: 30, azimuth: 90 }, 20)!;
    expect(v.dx).toBeLessThan(0);   // 서(x-)
  });
});

describe('convexHull', () => {
  it('사각형 안쪽 점은 버린다', () => {
    const h = convexHull([[0, 0], [4, 0], [4, 4], [0, 4], [2, 2]]);
    expect(h).toHaveLength(4);
    expect(h).not.toContainEqual([2, 2]);
  });

  it('건물 밑면 + 밀린 밑면을 하나의 그림자로 묶는다', () => {
    const base: [number, number][] = [[0, 0], [10, 0], [10, 5], [0, 5]];
    const moved = base.map(([x, y]) => [x, y + 20] as [number, number]);
    const h = convexHull([...base, ...moved]);
    expect(h.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...h.map((p) => p[1]))).toBe(25);   // 그림자 끝까지 포함
  });

  it('점 2개 이하는 그대로', () => {
    expect(convexHull([[0, 0], [1, 1]])).toHaveLength(2);
  });
});
