# PULSE — Tailwind + framer-motion 셋업 & 공통 컴포넌트

기존 코드베이스(React 18 + Vite + TS, CSS Modules)에 Tailwind와 framer-motion을 얹고,
`src/components/common/`에 공통 컴포넌트를 추가하는 가이드.

## 1. 의존성 설치
```bash
pnpm add framer-motion
pnpm add -D tailwindcss@^3 postcss autoprefixer
```

## 2. 설정 파일 배치
- `tailwind.config.ts` → 프로젝트 루트
- `postcss.config.js` → 프로젝트 루트

`tailwind.config.ts`는 `global.css`의 CSS 변수(`--bg`, `--panel` …)를 Tailwind 색상으로 매핑합니다.
→ 토큰은 그대로 단일 소스로 두고, 클래스로 `bg-panel` `border-line` `text-sub` `text-mut` `bg-panel2` `text-brand` `rounded-card` `font-mono` 사용.

## 3. global.css 상단에 디렉티브 추가
기존 `:root { --bg … }`는 그대로 두고, 파일 맨 위에만 추가:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```
> preflight(base)가 부담되면 `@tailwind base;`를 빼고 components/utilities만 써도 됩니다.

## 4. 공통 컴포넌트
`src/components/common/`에 복사. 배럴(`index.ts`)로 한 번에 import:
```tsx
import { Button, Spinner, Loading, Skeleton, SkeletonText, SkeletonRows, Badge, Segmented, EmptyState } from '@/components/common';
```

| 컴포넌트 | 용도 | 모션 |
|---|---|---|
| `Spinner` / `Loading` | 인라인 스피너 / 패널 중앙 로딩 | 회전 |
| `Button` | primary·subtle·ghost·danger × sm·md·lg, `loading`·`block`·`icon` | whileTap 스케일 |
| `Skeleton` / `SkeletonText` / `SkeletonRows` | 블록·텍스트·테이블행 로딩 | shimmer |
| `Badge` | 호재/악재/중립, 매수/중립/매도 태그(색 주입) | — |
| `Segmented` | 기간·필터·지표 토글 그룹 | layoutId 슬라이드 |
| `EmptyState` | 데이터 없음/미선택 안내 | 페이드인 |

### 마이그레이션 완료
대시보드·상세·뉴스·리서치의 로딩(카드별 `CardSkeleton`/`SkeletonRows`)·기간·필터 토글(`Segmented`)·
빈상태(`EmptyState`)·감성/의견 태그(`Badge` + `signColor(mode)`)·호재악재(`ReasonList`)로 모두 전환됨.
새 UI는 처음부터 공통 컴포넌트를 사용한다(하드코딩 등락색 금지 — `signColor(±1, mode)`).

## 등락색과 Badge
등락색은 `colorMode`(global/korea)에 따라 달라지므로 색을 컴포넌트가 정하지 않고 주입합니다.
`lib/colors.ts`의 `signColor(pct, mode)` / `colors(mode)`를 그대로 사용하세요.

## Tailwind v4를 쓰는 경우
v4는 설정 방식이 다릅니다(`@tailwindcss/postcss`, CSS-first). 위 가이드는 안정적인 **v3 기준**입니다.
v4로 가려면 `postcss.config.js`의 플러그인을 `@tailwindcss/postcss`로 바꾸고 `@import "tailwindcss";` 방식으로 전환하세요.
