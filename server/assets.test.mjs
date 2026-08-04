import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAssetsStore } from './assets.mjs';
import { readFile, unlink, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDir = join(dirname(fileURLToPath(import.meta.url)), '.test-tmp');

describe('assetsStore', () => {
  let file, store;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    file = join(testDir, `manual-assets-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    store = createAssetsStore({ file });
  });

  afterEach(async () => {
    try { await unlink(file); } catch { /* noop */ }
    try { await unlink(`${file}.tmp`); } catch { /* noop */ }
  });

  it('빈 저장소는 빈 목록·합계 0', async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.total()).toBe(0);
  });

  it('생성 → 목록 → 수정 → 삭제 왕복', async () => {
    const a = await store.upsert({ name: '비상금 통장', kind: 'cash', amount: 3_000_000 });
    expect(a.id).toBeTruthy();
    expect(a.amount).toBe(3_000_000);

    const b = await store.upsert({ name: '전세 보증금', kind: 'deposit', amount: 200_000_000, note: '만기 2027-03' });
    expect((await store.list()).map((x) => x.name)).toEqual(['비상금 통장', '전세 보증금']);
    expect(await store.total()).toBe(203_000_000);

    const a2 = await store.upsert({ id: a.id, name: '비상금', kind: 'cash', amount: 5_000_000 });
    expect(a2.id).toBe(a.id);
    expect(await store.total()).toBe(205_000_000);
    expect((await store.list()).length).toBe(2);

    expect(await store.remove(b.id)).toBe(true);
    expect(await store.remove(b.id)).toBe(false); // 이미 없음
    expect(await store.total()).toBe(5_000_000);
  });

  it('검증: 빈 이름·잘못된 유형·음수 금액은 거부', async () => {
    await expect(store.upsert({ name: '', kind: 'cash', amount: 1 })).rejects.toThrow(/이름/);
    await expect(store.upsert({ name: 'x', kind: 'stock', amount: 1 })).rejects.toThrow(/유형/);
    await expect(store.upsert({ name: 'x', kind: 'cash', amount: -1 })).rejects.toThrow(/금액/);
    await expect(store.upsert({ name: 'x', kind: 'cash', amount: NaN })).rejects.toThrow(/금액/);
  });

  it('없는 id 수정은 거부(새 항목으로 둔갑 금지)', async () => {
    await expect(store.upsert({ id: 'ghost', name: 'x', kind: 'cash', amount: 1 })).rejects.toThrow(/찾을 수 없습니다/);
  });

  it('손상된 파일은 빈 저장소로 복구(throw 금지)', async () => {
    await writeFile(file, '{corrupt', 'utf8');
    expect(await store.list()).toEqual([]);
    await store.upsert({ name: '복구 후 첫 자산', kind: 'other', amount: 10 });
    const j = JSON.parse(await readFile(file, 'utf8'));
    expect(j.items).toHaveLength(1);
  });
});
