#!/usr/bin/env node
// RADIO 규약 린트 훅 (PostToolUse: Edit|Write) — 경고만 하고 절대 막지 않는다(항상 exit 0).
// 규약 근거: docs/ARCHITECTURE-FE.md · CLAUDE.md "RADIO 규약".
import { readFileSync } from 'node:fs';

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

let filePath = process.argv[2] || '';
try {
  // Claude Code 훅은 stdin으로 JSON을 준다: { tool_input: { file_path } }
  const stdin = readFileSync(0, 'utf8');
  if (stdin.trim()) {
    const j = JSON.parse(stdin);
    filePath = j?.tool_input?.file_path || filePath;
  }
} catch { /* stdin 없거나 파싱 실패 — argv 폴백 */ }

if (!filePath || !/\/src\/.*\.(ts|tsx)$/.test(filePath) || /\.test\.|\/realestate\//.test(filePath)) process.exit(0);
const src = read(filePath);
if (!src) process.exit(0);

const warns = [];
const short = filePath.replace(/^.*\/src\//, 'src/');

// 1) 등락색 하드코딩 금지 — colors.ts만 팔레트 정의 가능. 나머지는 signColor/HOLD/STATUS_* 주입.
if (!/\/lib\/colors\.ts$/.test(filePath)) {
  const hex = src.match(/#(16C784|EA3943|F6465D|4C82FB)/gi);
  if (hex) warns.push(`등락색 하드코딩 ${hex.length}건(${[...new Set(hex)].join(',')}) — signColor(pct,mode)·HOLD·STATUS_* 주입 규약 위반 가능`);
}

// 2) 폴링은 visibility 게이트 필수 — 백그라운드 탭 리소스 낭비 방지.
if (/setInterval\(/.test(src) && !/document\.hidden/.test(src)) {
  warns.push('setInterval 있음 + document.hidden 게이트 없음 — 폴링이면 `if (!document.hidden)` 게이트 필요');
}

// 3) 화면 코드는 mockApi를 직접 알면 안 된다 — httpApi(strangler)만 소비.
if (/\/components\//.test(filePath) && /from ['"].*mockApi['"]/.test(src)) {
  warns.push('components에서 mockApi 직접 import — 화면은 MarketApi 계약(httpApi)만 소비');
}

// 4) 실패 시 목 폴백 금지(전면 '-' 규약) — httpApi에서 catch로 mockApi 반환 감지.
if (/httpApi\.ts$/.test(filePath) && /catch[^{]*\{[^}]*mockApi\./.test(src)) {
  warns.push("httpApi 실패 경로에서 mockApi 폴백 감지 — 실데이터 없으면 unavailable/'-' 규약");
}

if (warns.length) {
  for (const w of warns) console.error(`[RadioLint] ${short}: ${w}`);
  console.error('[RadioLint] 규약: docs/ARCHITECTURE-FE.md · CLAUDE.md "RADIO 규약" 참조');
}
process.exit(0); // 항상 통과 — 어기면 시끄럽게, 막지는 않게
