#!/usr/bin/env bash
#
# 커밋 전 통합 검증 — 이번 세션에 30회 넘게 손으로 반복한 네 가지를 한 번에.
#
# radio-lint(PostToolUse 훅)와 겹치는 항목이 있지만 역할이 다르다:
# 훅은 편집 순간 **경고**만 하고 지나가고, 이건 실패하면 **막는다**.
set -uo pipefail

cd "$(dirname "$0")/.."
FAIL=0

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
bad()  { printf '\033[31m✗ %s\033[0m\n' "$1"; FAIL=1; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }

step "타입 검사"
if pnpm exec tsc -p tsconfig.json --noEmit; then ok "tsc"; else bad "타입 오류"; fi

step "테스트"
if pnpm exec vitest run --silent 2>&1 | tail -5; then ok "vitest"; else bad "테스트 실패"; fi

# 등락색·팔레트는 src/lib/colors.ts 와 global.css 가 단일 소스다.
# 컴포넌트에 hex 를 박으면 colorMode 토글·테마가 조용히 어긋난다.
step "색 하드코딩"
HEX=$(grep -rn "#[0-9a-fA-F]\{6\}" \
  src/components/realestate/ \
  src/components/home/ \
  src/components/AppBar.module.css \
  src/components/detail/StockDetail.module.css \
  src/components/common/PriceChart.tsx \
  src/components/common/Button.tsx \
  src/lib/iso.ts 2>/dev/null || true)
if [ -n "$HEX" ]; then
  bad "hex 리터럴 발견 — global.css 토큰이나 colors(mode) 를 쓸 것"
  echo "$HEX" | head -10
else
  ok "hex 없음"
fi

# 정의되지 않은 CSS 변수는 에러 없이 무시된다 — 검정/투명으로 조용히 렌더된다.
# (실제로 --color-* 오타 때문에 차트가 통째로 검은 상자였던 적이 있다.)
step "미정의 CSS 토큰"
USED=$(grep -rhno -- "var(--[a-z0-9-]*)" src --include='*.css' --include='*.tsx' 2>/dev/null \
  | sed 's/.*var(//;s/)//' | sort -u)
DEFINED=$(grep -o -- "^[[:space:]]*--[a-z0-9-]*" src/styles/global.css | tr -d ' ' | sort -u)
MISSING=$(comm -23 <(echo "$USED") <(echo "$DEFINED"))
# 인라인 style 에서 폴백과 함께 쓰는 런타임 변수는 global.css 에 없어도 정상이다.
MISSING=$(echo "$MISSING" | grep -v '^--label-bg$' | grep -v '^$' || true)
if [ -n "$MISSING" ]; then
  bad "global.css 에 없는 토큰:"
  echo "$MISSING"
else
  ok "토큰 전부 정의됨"
fi

printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m전부 통과\033[0m\n'
else
  printf '\033[31m검증 실패 — 위 항목을 고칠 것\033[0m\n'
fi
exit "$FAIL"
