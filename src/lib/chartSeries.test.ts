import { describe, it, expect } from 'vitest';
import { densify, synthIntraday, fromIntraday, fmtD, fmtM, fmtT } from './chartSeries';
import type { Candle } from '../data/types';

const day = (date: string, o: number, h: number, l: number, c: number, v: number): Candle => ({ date, o, h, l, c, v });

describe('chartSeries', () => {
  describe('densify 거래량', () => {
    // Regression: 거래량 막대가 전부 같은 높이로 보이던 버그 — 일봉 거래량을 서브포인트 k개로
    // 균등 분할(d.v / k)해서 모든 막대 값이 동일해졌다.
    // Found by 사용자 리포트 2026-07-29
    // Report: .gstack/qa-reports/qa-report-localhost5180-2026-07-29.md
    it('캔들당 실거래량 1건만 싣고 나머지 서브포인트는 null', () => {
      const { vols } = densify([day('20260729', 100, 110, 95, 105, 5000)], 4);
      expect(vols).toEqual([null, null, null, 5000]);
    });

    it('여러 캔들이면 캔들마다 마지막 지점에 각자의 거래량', () => {
      const { vols } = densify([
        day('20260728', 100, 110, 95, 105, 5000),
        day('20260729', 105, 120, 100, 118, 9000),
      ], 3);
      expect(vols).toEqual([null, null, 5000, null, null, 9000]);
    });

    it('막대가 균등 분할값으로 뭉개지지 않는다 — 서로 다른 거래량이 그대로 보존', () => {
      const { vols } = densify([
        day('20260727', 100, 101, 99, 100, 1000),
        day('20260728', 100, 101, 99, 100, 50000),
      ], 5);
      const real = vols.filter((v): v is number => v != null);
      expect(real).toEqual([1000, 50000]);
      expect(new Set(real).size).toBe(2); // 동일 높이 버그면 1
    });

    it('k=1이면 캔들 하나당 막대 하나', () => {
      const { vols, closes } = densify([day('20260729', 100, 110, 95, 105, 777)], 1);
      expect(vols).toEqual([777]);
      expect(closes).toEqual([105]);
    });

    it('o/h/l/c 실제값은 서브포인트 안에 보존된다', () => {
      const { closes } = densify([day('20260729', 100, 130, 70, 120, 10)], 6);
      expect(closes[0]).toBe(100);                 // 시가
      expect(closes[closes.length - 1]).toBe(120); // 종가
      expect(Math.max(...closes)).toBe(130);       // 고가
      expect(Math.min(...closes)).toBe(70);        // 저가
    });

    it('빈 입력은 빈 시리즈', () => {
      expect(densify([], 5)).toEqual({ closes: [], cds: [], vols: [], labels: [] });
    });
  });

  describe('synthIntraday', () => {
    it('분봉이 없을 때 거래량은 전부 null — 없는 분 거래량을 합성하지 않는다', () => {
      const { vols, closes } = synthIntraday(day('20260729', 100, 110, 95, 105, 5000), 10);
      expect(closes).toHaveLength(10);
      expect(vols.every((v) => v === null)).toBe(true);
    });

    it('라벨은 09:00~15:30 장중 시각', () => {
      const { labels } = synthIntraday(day('20260729', 100, 110, 95, 105, 5000), 3);
      expect(labels[0]).toBe('09:00');
      expect(labels[labels.length - 1]).toBe('15:30');
    });

    it('일봉이 없으면 빈 시리즈', () => {
      expect(synthIntraday(undefined, 78)).toEqual({ closes: [], cds: [], vols: [], labels: [] });
    });
  });

  describe('fromIntraday', () => {
    it('실 분봉의 거래량을 그대로 쓴다', () => {
      const rows = [
        day('20260729090100', 100, 101, 99, 100, 500),
        day('20260729090200', 100, 103, 100, 102, 1200),
      ];
      const { vols, closes } = fromIntraday(rows);
      expect(vols).toEqual([500, 1200]);
      expect(closes).toEqual([100, 102]);
    });

    // Regression: 모의 환경이 아직 오지 않은 분까지 v=0·직전가로 패딩해 보내 차트 끝이 평탄해졌다.
    it('v=0(체결 없는 분) 패딩은 버린다', () => {
      const rows = [
        day('20260729090100', 100, 101, 99, 100, 500),
        day('20260729145200', 100, 100, 100, 100, 0),
        day('20260729145300', 100, 100, 100, 100, 0),
        day('20260729153000', 100, 101, 99, 99, 300),
      ];
      const { vols, closes, labels } = fromIntraday(rows);
      expect(vols).toEqual([500, 300]);
      expect(closes).toEqual([100, 99]);
      expect(labels).toEqual(['09:01', '15:30']);
    });

    it('가격이 0이거나 NaN인 행도 버린다', () => {
      const rows = [
        day('20260729090100', 0, 0, 0, 0, 500),
        day('20260729090200', 100, 101, 99, NaN, 500),
        day('20260729090300', 100, 101, 99, 100, 700),
      ];
      expect(fromIntraday(rows).vols).toEqual([700]);
    });

    it('전부 걸러지면 빈 시리즈 — 막대가 아예 안 그려진다', () => {
      const rows = [day('20260729090100', 100, 100, 100, 100, 0)];
      expect(fromIntraday(rows)).toEqual({ closes: [], cds: [], vols: [], labels: [] });
    });
  });

  describe('라벨 포맷터', () => {
    it('fmtD: YYYYMMDD → MM/DD', () => expect(fmtD('20260729')).toBe('07/29'));
    it('fmtM: YYYYMMDD → YYYY.MM', () => expect(fmtM('20260729')).toBe('2026.07'));
    it('fmtD: 형식이 다르면 원본 유지', () => expect(fmtD('2026')).toBe('2026'));
    it('fmtT: 중간 지점은 12:15', () => expect(fmtT(1, 3)).toBe('12:15'));
  });
});
