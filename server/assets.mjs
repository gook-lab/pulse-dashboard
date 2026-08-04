import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/**
 * 수동 자산 저장소 — 홈 순자산의 "KIS 밖" 부분.
 *
 * 정의는 정적(사용자가 직접 입력·수정), 값은 일일 스냅샷(portfolioHistory)이 합산해
 * 시계열로 남긴다. localStorage 가 아니라 서버 파일인 이유: 스냅샷 배치가 서버에서 돈다.
 *
 * 자산 1건: { id, name, kind: 'cash'|'deposit'|'realestate'|'other', amount(원), note?, updatedAt }
 */
export function createAssetsStore({ file }) {
  const KINDS = new Set(['cash', 'deposit', 'realestate', 'other']);

  async function readData() {
    if (!existsSync(file)) return { items: [] };
    try {
      const j = JSON.parse(await readFile(file, 'utf8'));
      return Array.isArray(j.items) ? j : { items: [] };
    } catch {
      return { items: [] };
    }
  }

  /** Atomic write: tmp → rename (portfolioHistory 와 같은 규칙). */
  async function writeData(data) {
    const tmp = `${file}.tmp`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, file);
  }

  async function list() {
    return (await readData()).items;
  }

  /** 생성(id 없음) 또는 수정(id 있음). 검증 실패는 message 를 실은 Error 로 던진다. */
  async function upsert({ id, name, kind, amount, note }) {
    const nm = String(name ?? '').trim();
    if (!nm || nm.length > 40) throw new Error('자산 이름은 1~40자여야 합니다');
    if (!KINDS.has(kind)) throw new Error(`자산 유형은 ${[...KINDS].join('|')} 중 하나여야 합니다`);
    const amt = Math.round(+amount);
    if (!Number.isFinite(amt) || amt < 0) throw new Error('금액은 0 이상의 숫자여야 합니다');

    const data = await readData();
    const item = {
      id: id || randomUUID(),
      name: nm, kind, amount: amt,
      ...(note ? { note: String(note).slice(0, 120) } : {}),
      updatedAt: new Date().toISOString(),
    };
    const idx = data.items.findIndex((x) => x.id === item.id);
    if (id && idx < 0) throw new Error('수정할 자산을 찾을 수 없습니다');
    if (idx >= 0) data.items[idx] = item; else data.items.push(item);
    await writeData(data);
    return item;
  }

  async function remove(id) {
    const data = await readData();
    const before = data.items.length;
    data.items = data.items.filter((x) => x.id !== id);
    if (data.items.length === before) return false;
    await writeData(data);
    return true;
  }

  /** 합계(원). 스냅샷 배치·/api/home 이 쓴다. */
  async function total() {
    return (await readData()).items.reduce((a, x) => a + (x.amount || 0), 0);
  }

  return { list, upsert, remove, total };
}
