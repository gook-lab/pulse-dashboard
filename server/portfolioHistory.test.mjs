import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPortfolioHistory } from './portfolioHistory.mjs';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDir = join(dirname(fileURLToPath(import.meta.url)), '.test-tmp');

describe('portfolioHistory', () => {
  let testFile;
  let mockNow;
  let mockFetchers;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    testFile = join(testDir, 'portfolio-history-test.json');
    mockNow = new Date('2025-06-15T15:30:00+09:00'); // KST 일요일

    // Mock fetchers that return success
    mockFetchers = {
      fetchBalance: vi.fn(async () => ({
        summary: { totalValue: 10000000, principal: 5000000 }
      })),
      fetchKospi: vi.fn(async () => ({ price: 2800.5 })),
      fetchSpx: vi.fn(async () => ({ price: 455.25 })),
    };
  });

  afterEach(async () => {
    try { await unlink(testFile); } catch { /* noop */ }
    try { await unlink(`${testFile}.tmp`); } catch { /* noop */ }
  });

  describe('record()', () => {
    it('첫 기록 후 파일에 엔트리 저장', async () => {
      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      await hist.record();

      const content = JSON.parse(await readFile(testFile, 'utf8'));
      expect(content).toEqual({
        entries: [
          {
            date: '2025-06-15',
            totalValue: 10000000,
            principal: 5000000,
            kospi: 2800.5,
            spx: 455.25,
          }
        ]
      });
    });

    it('같은 날 2번 record하면 마지막 값으로 덮어쓰기', async () => {
      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      await hist.record();

      // 같은 날 다시 기록 (값 변경)
      mockFetchers.fetchBalance.mockResolvedValueOnce({
        summary: { totalValue: 11000000, principal: 5500000 }
      });
      mockFetchers.fetchKospi.mockResolvedValueOnce({ price: 2850.0 });
      mockFetchers.fetchSpx.mockResolvedValueOnce({ price: 460.0 });

      await hist.record();

      const content = JSON.parse(await readFile(testFile, 'utf8'));
      expect(content.entries).toHaveLength(1);
      expect(content.entries[0]).toEqual({
        date: '2025-06-15',
        totalValue: 11000000,
        principal: 5500000,
        kospi: 2850.0,
        spx: 460.0,
      });
    });

    it('날짜 변경 시 새 엔트리 추가', async () => {
      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      await hist.record();

      // 다음 날
      const nextDay = new Date('2025-06-16T10:00:00+09:00');
      const hist2 = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => nextDay,
      });

      await hist2.record();

      const content = JSON.parse(await readFile(testFile, 'utf8'));
      expect(content.entries).toHaveLength(2);
      expect(content.entries[0].date).toBe('2025-06-15');
      expect(content.entries[1].date).toBe('2025-06-16');
    });

    it('fetchBalance 실패 시 totalValue/principal = null, record 계속', async () => {
      mockFetchers.fetchBalance.mockRejectedValueOnce(new Error('KIS down'));

      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      await hist.record();

      const content = JSON.parse(await readFile(testFile, 'utf8'));
      expect(content.entries[0]).toEqual({
        date: '2025-06-15',
        totalValue: null,
        principal: null,
        kospi: 2800.5,
        spx: 455.25,
      });
    });

    it('fetchKospi 실패 시 kospi = null, 나머지 기록', async () => {
      mockFetchers.fetchKospi.mockRejectedValueOnce(new Error('KIS throttle'));

      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      await hist.record();

      const content = JSON.parse(await readFile(testFile, 'utf8'));
      expect(content.entries[0]).toEqual({
        date: '2025-06-15',
        totalValue: 10000000,
        principal: 5000000,
        kospi: null,
        spx: 455.25,
      });
    });

    it('fetchSpx 실패 시 spx = null, 나머지 기록', async () => {
      mockFetchers.fetchSpx.mockRejectedValueOnce(new Error('Finnhub down'));

      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      await hist.record();

      const content = JSON.parse(await readFile(testFile, 'utf8'));
      expect(content.entries[0]).toEqual({
        date: '2025-06-15',
        totalValue: 10000000,
        principal: 5000000,
        kospi: 2800.5,
        spx: null,
      });
    });

    it('파일이 없으면 새로 생성', async () => {
      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      await hist.record();

      const content = JSON.parse(await readFile(testFile, 'utf8'));
      expect(content.entries).toHaveLength(1);
      expect(content.entries[0].date).toBe('2025-06-15');
    });
  });

  describe('read(days)', () => {
    it('최근 N일 데이터만 반환', async () => {
      // 여러 날 데이터를 파일에 미리 넣기
      const initialData = {
        entries: [
          { date: '2025-06-10', totalValue: 9000000, principal: 4500000, kospi: 2700, spx: 450 },
          { date: '2025-06-11', totalValue: 9200000, principal: 4600000, kospi: 2750, spx: 452 },
          { date: '2025-06-12', totalValue: 9500000, principal: 4700000, kospi: 2800, spx: 455 },
          { date: '2025-06-13', totalValue: 9800000, principal: 4800000, kospi: 2850, spx: 458 },
          { date: '2025-06-14', totalValue: 10000000, principal: 5000000, kospi: 2900, spx: 460 },
        ]
      };
      await writeFile(testFile, JSON.stringify(initialData));

      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      const result = await hist.read(3);

      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2025-06-12');
      expect(result[1].date).toBe('2025-06-13');
      expect(result[2].date).toBe('2025-06-14');
    });

    it('요청한 날 수보다 데이터가 적으면 있는 만큼 반환', async () => {
      const initialData = {
        entries: [
          { date: '2025-06-14', totalValue: 10000000, principal: 5000000, kospi: 2900, spx: 460 },
        ]
      };
      await writeFile(testFile, JSON.stringify(initialData));

      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      const result = await hist.read(7);

      expect(result).toHaveLength(1);
    });

    it('파일이 없으면 빈 배열 반환', async () => {
      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      const result = await hist.read(7);

      expect(result).toEqual([]);
    });

    it('days=400(기본값) 테스트 — 최근 400일', async () => {
      const initialData = {
        entries: Array.from({ length: 450 }, (_, i) => {
          const d = new Date(2024, 0, 1 + i);
          return {
            date: d.toISOString().slice(0, 10),
            totalValue: 10000000 + i * 1000,
            principal: 5000000,
            kospi: 2800 + i,
            spx: 455 + i * 0.1,
          };
        })
      };
      await writeFile(testFile, JSON.stringify(initialData));

      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      const result = await hist.read(400);

      expect(result).toHaveLength(400);
      // 가장 최근 400개 (마지막 400개)
      expect(result[0].date).toBe(initialData.entries[50].date);
      expect(result[399].date).toBe(initialData.entries[449].date);
    });
  });

  describe('start(intervalMs) & stop()', () => {
    it('start() 후 초기 record 즉시 호출', async () => {
      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      const startPromise = hist.start(100_000); // 큰 interval
      await new Promise(r => setTimeout(r, 10)); // 초기 record가 완료될 때까지 대기

      expect(mockFetchers.fetchBalance).toHaveBeenCalledTimes(1);
      hist.stop();
    });

    it('stop() 호출 시 타이머 해제 후 추가 호출 없음', async () => {
      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => mockNow,
      });

      await hist.start(100);

      // 약간 기다린 후 stop
      await new Promise(r => setTimeout(r, 50));
      hist.stop();
      const callCount = mockFetchers.fetchBalance.mock.calls.length;

      // 더 기다려도 호출 증가 없음
      await new Promise(r => setTimeout(r, 200));
      expect(mockFetchers.fetchBalance.mock.calls.length).toBe(callCount);
    });
  });

  describe('KST 날짜 기준', () => {
    it('UTC 자정 ~ KST 자정을 같은 날로 처리', async () => {
      // UTC 2025-06-14 23:00 = KST 2025-06-15 08:00
      const utcNearMidnight = new Date('2025-06-14T23:00:00Z');

      const hist = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => utcNearMidnight,
      });

      await hist.record();

      const content = JSON.parse(await readFile(testFile, 'utf8'));
      // KST 기준이므로 2025-06-15
      expect(content.entries[0].date).toBe('2025-06-15');
    });

    it('KST 자정 직후와 직전이 다른 날', async () => {
      // KST 2025-06-15 00:00 = UTC 2025-06-14 15:00
      const kstMidnight = new Date('2025-06-14T15:00:00Z');

      const hist1 = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => kstMidnight,
      });

      await hist1.record();

      // KST 2025-06-14 23:59 = UTC 2025-06-14 14:59
      const kstBeforeMidnight = new Date('2025-06-14T14:59:00Z');

      const hist2 = createPortfolioHistory({
        ...mockFetchers,
        file: testFile,
        now: () => kstBeforeMidnight,
      });

      await hist2.record();

      const content = JSON.parse(await readFile(testFile, 'utf8'));
      expect(content.entries).toHaveLength(2);
      // hist1 (UTC 15:00) = KST 2025-06-15, hist2 (UTC 14:59) = KST 2025-06-14
      expect(content.entries[0].date).toBe('2025-06-15');
      expect(content.entries[1].date).toBe('2025-06-14');
    });
  });

  describe('수동 자산 스키마 확장 (W2)', () => {
    it('fetchManualTotal 주입 시 manualTotal·netWorth 가 붙는다', async () => {
      const hist = createPortfolioHistory({
        ...mockFetchers,
        fetchManualTotal: async () => 3_000_000,
        file: testFile,
        now: () => mockNow,
      });
      await hist.record();
      const e = JSON.parse(await readFile(testFile, 'utf8')).entries[0];
      expect(e.manualTotal).toBe(3_000_000);
      expect(e.netWorth).toBe(13_000_000); // KIS 10M + 수동 3M
    });

    it('미주입이면 구형 스키마 그대로(필드 없음)', async () => {
      const hist = createPortfolioHistory({ ...mockFetchers, file: testFile, now: () => mockNow });
      await hist.record();
      const e = JSON.parse(await readFile(testFile, 'utf8')).entries[0];
      expect('manualTotal' in e).toBe(false);
      expect('netWorth' in e).toBe(false);
    });

    it('KIS 실패 시 netWorth 는 null — 수동 자산만으로 순자산을 만들지 않는다', async () => {
      const hist = createPortfolioHistory({
        ...mockFetchers,
        fetchBalance: async () => { throw new Error('KIS down'); },
        fetchManualTotal: async () => 3_000_000,
        file: testFile,
        now: () => mockNow,
      });
      await hist.record();
      const e = JSON.parse(await readFile(testFile, 'utf8')).entries[0];
      expect(e.totalValue).toBeNull();
      expect(e.manualTotal).toBe(3_000_000);
      expect(e.netWorth).toBeNull();
    });

    it('fetchManualTotal 실패는 null — KIS 총자산만으로 netWorth 계산', async () => {
      const hist = createPortfolioHistory({
        ...mockFetchers,
        fetchManualTotal: async () => { throw new Error('file gone'); },
        file: testFile,
        now: () => mockNow,
      });
      await hist.record();
      const e = JSON.parse(await readFile(testFile, 'utf8')).entries[0];
      expect(e.manualTotal).toBeNull();
      expect(e.netWorth).toBe(10_000_000);
    });

    it('구·신 엔트리 혼재 파일에서 read() 정상(역호환)', async () => {
      // 구형 엔트리를 미리 심는다
      await writeFile(testFile, JSON.stringify({
        entries: [{ date: '2025-06-14', totalValue: 9_000_000, principal: 5_000_000, kospi: 2790, spx: 450 }],
      }), 'utf8');
      const hist = createPortfolioHistory({
        ...mockFetchers,
        fetchManualTotal: async () => 1_000_000,
        file: testFile,
        now: () => mockNow,
      });
      await hist.record();
      const entries = await hist.read(400);
      expect(entries).toHaveLength(2);
      expect('netWorth' in entries[0]).toBe(false);      // 구형 그대로
      expect(entries[1].netWorth).toBe(11_000_000);      // 신형
    });
  });
});
