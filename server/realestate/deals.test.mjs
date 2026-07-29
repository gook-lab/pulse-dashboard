import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeDealShards, readComplexDeals, createDealsLRU } from './deals.mjs';

describe('deals — 단지별 거래 이력', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(process.cwd(), '.test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('writeDealShards — 구별 샤드 쓰기', () => {
    it('두 구의 rows를 각각 파일로 분리 저장', async () => {
      const rows = [
        { aptSeq: '11680-1', sggCd: '11680', ym: '202604', day: 1, kind: 'rent', area: 84, floor: 5, price: 5000, monthlyRent: 0 },
        { aptSeq: '11680-2', sggCd: '11680', ym: '202603', day: 15, kind: 'rent', area: 60, floor: 10, price: 4000, monthlyRent: 0 },
        { aptSeq: '11140-1', sggCd: '11140', ym: '202602', day: 20, kind: 'trade', area: 114, floor: 3, price: 80000, monthlyRent: null },
        { aptSeq: '11680-1', sggCd: '11680', ym: '202602', day: 10, kind: 'rent', area: 84, floor: 5, price: 4800, monthlyRent: 0 },
      ];

      await writeDealShards(rows, tmpDir);

      // 11680 파일 존재 및 정상 포맷
      const sgg11680 = JSON.parse(readFileSync(join(tmpDir, '11680.json'), 'utf8'));
      expect(sgg11680).toHaveProperty('11680-1');
      expect(sgg11680).toHaveProperty('11680-2');
      expect(sgg11680['11680-1']).toHaveLength(2);  // 202604 + 202602
      expect(sgg11680['11680-2']).toHaveLength(1);

      // 11140 파일 존재
      const sgg11140 = JSON.parse(readFileSync(join(tmpDir, '11140.json'), 'utf8'));
      expect(sgg11140['11140-1']).toHaveLength(1);
      expect(sgg11140['11140-1'][0].kind).toBe('trade');
    });

    it('같은 단지 여러 달 거래를 배열에 누적', async () => {
      const rows = [
        { aptSeq: '11680-1', sggCd: '11680', ym: '202604', day: 5, kind: 'rent', area: 84, floor: 5, price: 5000, monthlyRent: 0 },
        { aptSeq: '11680-1', sggCd: '11680', ym: '202604', day: 10, kind: 'rent', area: 84, floor: 10, price: 5100, monthlyRent: 0 },
        { aptSeq: '11680-1', sggCd: '11680', ym: '202603', day: 15, kind: 'rent', area: 84, floor: 15, price: 4900, monthlyRent: 0 },
      ];

      await writeDealShards(rows, tmpDir);

      const sgg = JSON.parse(readFileSync(join(tmpDir, '11680.json'), 'utf8'));
      const deals = sgg['11680-1'];
      expect(deals).toHaveLength(3);
      // 삽입 순서대로 (정렬하지 않음 — 읽을 때 정렬)
      expect(deals[0].day).toBe(5);
      expect(deals[1].day).toBe(10);
      expect(deals[2].day).toBe(15);
    });

    it('다양한 kind (trade, rent, monthlyRent=0/값) 포함', async () => {
      const rows = [
        { aptSeq: '11680-1', sggCd: '11680', ym: '202604', day: 1, kind: 'trade', area: 84, floor: 5, price: 80000, monthlyRent: null },
        { aptSeq: '11680-2', sggCd: '11680', ym: '202604', day: 2, kind: 'rent', area: 60, floor: 3, price: 3000, monthlyRent: 0 },
        { aptSeq: '11680-3', sggCd: '11680', ym: '202604', day: 3, kind: 'rent', area: 72, floor: 8, price: 4000, monthlyRent: 150 },
      ];

      await writeDealShards(rows, tmpDir);

      const sgg = JSON.parse(readFileSync(join(tmpDir, '11680.json'), 'utf8'));
      expect(sgg['11680-1'][0].kind).toBe('trade');
      expect(sgg['11680-2'][0].monthlyRent).toBe(0);
      expect(sgg['11680-3'][0].monthlyRent).toBe(150);
    });

    it('sggCd가 문자열인 경우도 처리', async () => {
      const rows = [
        { aptSeq: '11680-1', sggCd: '11680', ym: '202604', day: 1, kind: 'rent', area: 84, floor: 5, price: 5000, monthlyRent: 0 },
      ];

      await writeDealShards(rows, tmpDir);

      const files = require('node:fs').readdirSync(tmpDir);
      expect(files).toContain('11680.json');
    });
  });

  describe('readComplexDeals — 단지 거래 조회', () => {
    beforeEach(async () => {
      const rows = [
        { aptSeq: '11680-1', sggCd: '11680', ym: '202604', day: 1, kind: 'rent', area: 84, floor: 5, price: 5000, monthlyRent: 0 },
        { aptSeq: '11680-1', sggCd: '11680', ym: '202603', day: 15, kind: 'rent', area: 84, floor: 10, price: 4800, monthlyRent: 0 },
        { aptSeq: '11680-1', sggCd: '11680', ym: '202602', day: 10, kind: 'rent', area: 84, floor: 3, price: 4600, monthlyRent: 0 },
        { aptSeq: '11680-2', sggCd: '11680', ym: '202604', day: 20, kind: 'trade', area: 114, floor: 8, price: 80000, monthlyRent: null },
        { aptSeq: '11140-1', sggCd: '11140', ym: '202604', day: 5, kind: 'rent', area: 60, floor: 2, price: 3500, monthlyRent: 0 },
      ];
      await writeDealShards(rows, tmpDir);
    });

    it('존재하는 단지의 거래 목록을 조회한다', async () => {
      const cache = createDealsLRU();
      const result = await readComplexDeals('11680-1', '11680', tmpDir, cache);

      expect(result.deals).toHaveLength(3);
      expect(result.stale).toBeUndefined();  // 정상 파일이면 stale 필드 없음
    });

    it('날짜 내림차순으로 정렬한다 (최근순)', async () => {
      const cache = createDealsLRU();
      const result = await readComplexDeals('11680-1', '11680', tmpDir, cache);

      const deals = result.deals;
      expect(deals[0].ym).toBe('202604');
      expect(deals[1].ym).toBe('202603');
      expect(deals[2].ym).toBe('202602');
    });

    it('같은 달 안에서 day 도 내림차순', async () => {
      const rows = [
        { aptSeq: '11680-1', sggCd: '11680', ym: '202604', day: 5, kind: 'rent', area: 84, floor: 1, price: 5000, monthlyRent: 0 },
        { aptSeq: '11680-1', sggCd: '11680', ym: '202604', day: 15, kind: 'rent', area: 84, floor: 2, price: 5100, monthlyRent: 0 },
        { aptSeq: '11680-1', sggCd: '11680', ym: '202604', day: 10, kind: 'rent', area: 84, floor: 3, price: 5050, monthlyRent: 0 },
      ];
      await writeDealShards(rows, tmpDir);
      const cache = createDealsLRU();
      const result = await readComplexDeals('11680-1', '11680', tmpDir, cache);
      expect(result.deals[0].day).toBe(15);
      expect(result.deals[1].day).toBe(10);
      expect(result.deals[2].day).toBe(5);
    });

    it('존재하는 단지인데 거래 없으면 빈 배열 (정상)', async () => {
      const cache = createDealsLRU();
      const result = await readComplexDeals('11680-999', '11680', tmpDir, cache);

      expect(result.deals).toEqual([]);
      expect(result.stale).toBeUndefined();  // 파일은 있으므로 정상
    });

    it('샤드 파일이 없으면 stale=true (구버전 캐시)', async () => {
      // 11740 구는 생성된 파일이 없음
      const cache = createDealsLRU();
      const result = await readComplexDeals('11740-1', '11740', tmpDir, cache);

      expect(result.deals).toEqual([]);
      expect(result.stale).toBe(true);
    });

    it('LRU 캐시가 제대로 작동한다 (5개 구 이상)', async () => {
      // 6개 구의 파일 생성
      const regions = ['11680', '11140', '11170', '11200', '11215', '11230'];
      for (let i = 0; i < regions.length; i++) {
        const rows = [
          { aptSeq: `${regions[i]}-1`, sggCd: regions[i], ym: '202604', day: 1, kind: 'rent', area: 84, floor: 5, price: 5000, monthlyRent: 0 },
        ];
        await writeDealShards(rows, tmpDir);
      }

      const cache = createDealsLRU();

      // 처음 5개는 모두 캐시된다
      for (let i = 0; i < 5; i++) {
        const sggCd = regions[i];
        await readComplexDeals(`${sggCd}-1`, sggCd, tmpDir, cache);
        expect(cache.has(sggCd)).toBe(true);
      }

      // 6번째 조회 시 가장 오래된 항목(11680)이 제거된다
      await readComplexDeals(`${regions[5]}-1`, regions[5], tmpDir, cache);
      expect(cache.has(regions[0])).toBe(false);  // 11680 제거됨
      expect(cache.has(regions[5])).toBe(true);   // 11230 추가됨
      expect(cache.size).toBe(5);
    });

    it('캐시 히트: 같은 구를 다시 조회하면 파일을 다시 읽지 않는다', async () => {
      const cache = createDealsLRU();
      const r1 = await readComplexDeals('11680-1', '11680', tmpDir, cache);
      const r2 = await readComplexDeals('11680-2', '11680', tmpDir, cache);

      // 두 단지 모두 같은 캐시 데이터를 써야 한다 (같은 sggCd)
      expect(r1.deals).toBeDefined();
      expect(r2.deals).toBeDefined();
      expect(cache.get('11680')).toBeDefined();
    });
  });

  describe('LRU 캐시 기본', () => {
    it('최대 5개 항목만 유지한다', async () => {
      const cache = createDealsLRU();
      const data = { '11680': [{ aptSeq: '11680-1', ym: '202604', day: 1, kind: 'rent', area: 84, floor: 5, price: 5000, monthlyRent: 0 }] };

      for (let i = 0; i < 5; i++) {
        const key = `sgg${i}`;
        cache.set(key, data);
      }
      expect(cache.size).toBe(5);

      cache.set('sgg5', data);
      expect(cache.size).toBe(5);
      expect(cache.has('sgg0')).toBe(false);  // 가장 오래된 항목 제거됨
      expect(cache.has('sgg5')).toBe(true);   // 새 항목 추가됨
    });
  });
});
