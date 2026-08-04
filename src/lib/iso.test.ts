import { describe, it, expect } from 'vitest';
import {
  spin, project, unproject, metersToLatLng, latLngToMeters, depthAt, northDegrees,
  wallTone, ringIsCCW, ribbon, path, clampPitch, wrapYaw, PITCH_DEFAULT, PITCH_MIN, PITCH_MAX,
} from './iso';

const YAWS = [0, 37, 90, 123.5, 180, 270, 359];

describe('spin — 연속 방위 회전', () => {
  it('0° 는 그대로, 360° 는 제자리', () => {
    expect(spin(3, 7, 0)[0]).toBeCloseTo(3);
    expect(spin(3, 7, 360)[0]).toBeCloseTo(3);
    expect(spin(3, 7, 360)[1]).toBeCloseTo(7);
  });

  it('길이를 보존한다 — 회전이지 확대가 아니다', () => {
    for (const deg of YAWS) {
      const [x, y] = spin(30, -12, deg);
      expect(Math.hypot(x, y)).toBeCloseTo(Math.hypot(30, -12), 6);
    }
  });

  it('90° 씩 네 번이면 제자리', () => {
    let p: [number, number] = [5, 2];
    for (let i = 0; i < 4; i++) p = spin(p[0], p[1], 90);
    expect(p[0]).toBeCloseTo(5);
    expect(p[1]).toBeCloseTo(2);
  });

  it('음수 각도는 반대로 돈다', () => {
    const a = spin(10, 0, 45);
    const b = spin(10, 0, -45);
    expect(a[1]).toBeCloseTo(-b[1], 6);
  });
});

describe('project — 축측 투영', () => {
  it('원점은 화면 원점', () => {
    const p = project(0, 0);
    expect(p.sx).toBeCloseTo(0);
    expect(p.sy).toBeCloseTo(0);
  });

  it('북(y+)은 화면 위로 간다 — SVG 는 y 가 아래로 증가하므로 sy 가 음수', () => {
    expect(project(0, 10).sy).toBeLessThan(0);
  });

  it('동(x+)은 화면 오른쪽', () => {
    expect(project(10, 0).sx).toBeGreaterThan(0);
  });

  it('높이는 화면에서 위로만 올라간다 — 가로 위치는 변하지 않는다', () => {
    const flat = project(4, 4, 0);
    const tall = project(4, 4, 30);
    expect(tall.sx).toBeCloseTo(flat.sx);
    expect(tall.sy).toBeLessThan(flat.sy);
  });

  it('고도가 높을수록 지면이 펼쳐지고 건물은 낮아진다 — 평면도에 가까워진다', () => {
    const groundLow = Math.abs(project(0, 100, 0, 0, 15).sy);
    const groundHigh = Math.abs(project(0, 100, 0, 0, 75).sy);
    expect(groundHigh).toBeGreaterThan(groundLow);

    const hLow = project(0, 0, 50, 0, 15).sy;
    const hHigh = project(0, 0, 50, 0, 75).sy;
    expect(Math.abs(hHigh)).toBeLessThan(Math.abs(hLow));
  });

  it('고도를 바꿔도 가로 위치는 그대로 — 방위만 좌우를 정한다', () => {
    for (const pitch of [10, 30, 60, 85]) {
      expect(project(25, -8, 0, 40, pitch).sx).toBeCloseTo(project(25, -8, 0, 40, PITCH_DEFAULT).sx, 6);
    }
  });
});

describe('depthAt — 가림 순서', () => {
  it('방위 0 에서는 북동쪽이 뒤쪽(깊이 큼)', () => {
    expect(depthAt(10, 10, 0)).toBeGreaterThan(depthAt(-10, -10, 0));
  });

  it('180° 돌면 깊이 순서가 뒤집힌다 — painter 정렬의 핵심', () => {
    expect(depthAt(10, 10, 180)).toBeLessThan(depthAt(-10, -10, 180));
  });

  it('임의 각도에서도 깊이와 화면 y 가 일관된다 — 어긋나면 뒷건물이 앞을 덮는다', () => {
    const pts: [number, number][] = [[20, 5], [-8, -14], [40, -30], [0, 60], [-25, 25]];
    for (const yaw of YAWS) {
      for (const pitch of [12, 30, 70]) {
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const a = { d: depthAt(...pts[i], yaw), sy: project(pts[i][0], pts[i][1], 0, yaw, pitch).sy };
            const b = { d: depthAt(...pts[j], yaw), sy: project(pts[j][0], pts[j][1], 0, yaw, pitch).sy };
            if (Math.abs(a.d - b.d) < 1e-9) continue;
            const deeper = a.d > b.d ? a : b;
            const shallower = a.d > b.d ? b : a;
            expect(deeper.sy).toBeLessThan(shallower.sy + 1e-9);
          }
        }
      }
    }
  });
});

describe('unproject — 화면 → 로컬 미터', () => {
  it('project 를 되돌린다 — 임의 방위·고도에서', () => {
    for (const yaw of YAWS) {
      for (const pitch of [10, 30, 55, 85]) {
        for (const [x, y] of [[0, 0], [37, -12], [-140, 260], [5.5, 5.5]]) {
          const p = project(x, y, 0, yaw, pitch);
          const back = unproject(p.sx, p.sy, yaw, pitch);
          expect(back.x).toBeCloseTo(x, 5);
          expect(back.y).toBeCloseTo(y, 5);
        }
      }
    }
  });

  it('화면 위로 올라가면 깊이가 커진다 — 팬 방향과 좌표가 맞아야 지역을 옳게 받는다', () => {
    const a = unproject(0, 0, 0);
    const b = unproject(0, -100, 0);
    expect(b.x + b.y).toBeGreaterThan(a.x + a.y);
  });
});

describe('northDegrees — 나침반', () => {
  it('바늘은 실제 투영된 북쪽과 일치한다 — 나침반이 거짓말하면 일조 판단이 틀린다', () => {
    for (const yaw of YAWS) {
      for (const pitch of [15, 30, 70]) {
        const p = project(0, 100, 0, yaw, pitch);
        const deg = northDegrees(yaw, pitch) * (Math.PI / 180);
        const len = Math.hypot(p.sx, p.sy);
        expect(Math.sin(deg)).toBeCloseTo(p.sx / len, 6);
        expect(-Math.cos(deg)).toBeCloseTo(p.sy / len, 6);
      }
    }
  });

  it('방위를 돌리면 바늘도 돈다', () => {
    expect(northDegrees(0)).not.toBeCloseTo(northDegrees(45), 1);
  });
});

describe('wallTone — 화면 고정 조명', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it('단계는 항상 범위 안이다', () => {
    for (const yaw of YAWS) {
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = square[i], [x2, y2] = square[(i + 1) % 4];
        const t = wallTone(x1, y1, x2, y2, yaw);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(2);
      }
    }
  });

  it('마주 보는 두 벽은 밝기가 다르다 — 같으면 입체로 안 읽힌다', () => {
    const a = wallTone(0, 0, 10, 0, 0);
    const c = wallTone(10, 10, 0, 10, 0);
    expect(a).not.toBe(c);
  });

  it('회전하면 같은 벽의 밝기가 바뀐다 — 빛은 화면에 고정이다', () => {
    const tones = YAWS.map((yaw) => wallTone(0, 0, 10, 0, yaw));
    expect(new Set(tones).size).toBeGreaterThan(1);
  });
});

describe('ringIsCCW — OSM 링 방향은 보장되지 않는다', () => {
  const ccwSquare: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const cwSquare: [number, number][] = [...ccwSquare].reverse() as [number, number][];

  it('반시계는 true, 시계는 false', () => {
    expect(ringIsCCW(ccwSquare)).toBe(true);
    expect(ringIsCCW(cwSquare)).toBe(false);
  });

  it('링 방향을 반영하면 같은 벽이 같은 밝기를 받는다 — 안 그러면 32%가 반대로 칠해진다', () => {
    // 같은 물리적 벽(0,0)-(10,0). CCW 링에서는 i=0 변, CW 링에서는 역방향으로 등장한다.
    for (const yaw of [0, 47, 180, 300]) {
      const a = wallTone(0, 0, 10, 0, yaw, true);
      const b = wallTone(10, 0, 0, 0, yaw, false);
      expect(a).toBe(b);
    }
  });
});

describe('clampPitch / wrapYaw — 조작 한계', () => {
  it('고도는 범위를 벗어나지 않는다', () => {
    expect(clampPitch(-40)).toBe(PITCH_MIN);
    expect(clampPitch(400)).toBe(PITCH_MAX);
    expect(clampPitch(45)).toBe(45);
  });

  it('방위는 몇 바퀴를 돌려도 0~360 이다', () => {
    expect(wrapYaw(370)).toBeCloseTo(10);
    expect(wrapYaw(-10)).toBeCloseTo(350);
    expect(wrapYaw(720)).toBeCloseTo(0);
  });
});

describe('ribbon — 도로 띠', () => {
  it('직선 도로는 폭만큼 벌어진 사각형이 된다', () => {
    const r = ribbon([[0, 0], [10, 0]], 6);
    expect(r).toHaveLength(4);
    const ys = r.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6);
  });

  it('점 개수의 두 배가 나온다 — 좌우 양쪽', () => {
    expect(ribbon([[0, 0], [5, 5], [10, 0]], 4)).toHaveLength(6);
  });

  it('겹친 점이 있어도 NaN 을 만들지 않는다', () => {
    const r = ribbon([[0, 0], [0, 0]], 4);
    expect(r.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
});

describe('metersToLatLng / latLngToMeters', () => {
  const LAT = 37.5312, LNG = 126.895;

  it('왕복하면 제자리', () => {
    const p = metersToLatLng(340, -120, LAT, LNG);
    const back = latLngToMeters(p.lat, p.lng, LAT, LNG);
    expect(back.x).toBeCloseTo(340, 6);
    expect(back.y).toBeCloseTo(-120, 6);
  });

  it('북쪽 1,113m 는 위도 +0.01도', () => {
    expect(metersToLatLng(0, 1113.2, LAT, LNG).lat).toBeCloseTo(LAT + 0.01, 5);
  });

  it('서울 위도에서 경도 1도는 위도 1도보다 짧다', () => {
    const east = metersToLatLng(1000, 0, LAT, LNG);
    const north = metersToLatLng(0, 1000, LAT, LNG);
    expect(east.lng - LNG).toBeGreaterThan(north.lat - LAT);
  });
});

describe('path', () => {
  it('닫힌 path 를 만든다', () => {
    expect(path([{ sx: 0, sy: 0 }, { sx: 1, sy: 2 }])).toBe('M 0.0 0.0 L 1.0 2.0 Z');
  });
});
