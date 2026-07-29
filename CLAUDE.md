# PULSE — 시황 통합 대시보드 (프로젝트 가이드)

React 18 + Vite + TypeScript. 다크 트레이딩 터미널 스타일. 상세 요구사항은 `기능명세.md`.

## 스택
- **UI**: React 18 + Vite + TS, **Tailwind v3** + **framer-motion**, CSS Modules(기존 컴포넌트)
- **상태**: zustand (`src/store/`)
- **데이터**: `src/data/httpApi.ts`(strangler) — 백엔드 준비된 것만 HTTP, 나머지 목(`mockApi.ts`). 계약은 `MarketApi`(`types.ts`)
- **백엔드**: `server/index.mjs`(Node, 포트 8080). 외부 API 프록시 + 캐시 + 헤더위장. 키는 `server/.env`(절대 프론트/커밋 금지)
- **경로 별칭**: `@` → `src` (vite + tsconfig)

## 디자인 시스템 — 항상 공통 컴포넌트 사용
새 UI는 `src/components/common/`을 우선 사용한다. 애드혹 버튼/로딩/토글/빈상태를 직접 만들지 말 것.

```tsx
import { Button, Spinner, Loading, Skeleton, SkeletonText, SkeletonRows,
         Badge, Segmented, EmptyState, Modal, ConfirmDialog } from '@/components/common';
import toast from '@/lib/toast';
```

| 상황 | 사용 | 금지(구식) |
|---|---|---|
| 버튼 | `<Button variant loading block icon>` | `<button className={s.xBtn}>` |
| 인라인 스피너 / 패널 로딩 | `<Spinner/>` / `<Loading label/>` | `"불러오는 중…"` 텍스트 |
| 스켈레톤 | `<Skeleton/> <SkeletonText/> <SkeletonRows/>` | — |
| 태그(감성·의견·등락) | `<Badge color={signColor(pct,mode)}>` | `.sig` 스팬 |
| 토글(기간·필터·지표) | `<Segmented options value onChange>` | `.pBtn/.fBtn/.tBtn` |
| 빈/미선택 | `<EmptyState title desc/>` | 애드혹 div |
| 토스트 | `toast.success({message})` (react-hot-toast) | `alert()` |
| 모달/확인 | `<Modal>` / `<ConfirmDialog>` (Radix, viviane 패턴) | 직접 오버레이 |

- 모달 Content는 `useModalOpenSignal()`로 전역 열림 카운트를 유지한다(`src/store/useModalStore.ts`).
- 토스트/모달 공통 로직은 **viviane 프로젝트**(`sonix-viviane`) 패턴을 참고해 세팅했다.

## 색상 컨벤션 (중요)
- 등락색은 **절대 하드코딩 금지**. `src/lib/colors.ts`의 `signColor(pct, mode)` / `colors(mode)` 사용.
- `colorMode`(global 초록↑/빨강↓ · korea 빨강↑/파랑↓)는 zustand 전역. 색은 컴포넌트가 정하지 않고 주입.
- 토큰은 `src/styles/global.css`의 CSS 변수 단일 소스 → Tailwind는 `bg-panel` `text-sub` `border-line` `text-brand` `rounded-card` `font-mono` 등으로 매핑(`tailwind.config.ts`).

## 데이터 연동 패턴
- 새 실데이터: `server/index.mjs`에 라우트 추가(캐시 필수) → `httpApi`에서 소비. **실패 시 목 폴백 금지 — `unavailable`/"-"** (아래 RADIO 규약 #2).
- 외부 API 교훈: **CNN·data.go.kr는 User-Agent 없으면 차단**, **data.go.kr 50콜 동시 시 throttle**(동시성 5+재시도), **KIS 토큰 1분 1회**(in-flight 중복 제거·캐시).
- KIS는 검증 전까지 **모의(mock)** 계좌만 사용.
- **TOP100은 Daum 금융 API**(`/api/kr/top100`, 무료·실시장 — KIS 랭킹류는 30건 하드캡). ⚠️ Daum `changeRate`는 부호 없음 — `change: FALL|RISE`가 방향. **목표주가는 기술적 산출**(`/api/kr/targets`, 볼린저 상단+60일 고가 클램프) — US는 무료 소스 없어 `targetReal:false` → "-".
- 부동산(realestate): `server/realestate/`에서 배치 수집 → `apt-signals.json` 캐싱. 단지 키는 **`aptSeq`**(이름 매칭 금지 — 동명 단지 존재). 시그널은 **3개월 이동 중앙값** + 이상치 제외(`[0.4, 2.5]×단지중앙값`), 기준월 = 3개월 전(신고지연 보정). 지오코딩은 `KAKAO_REST_KEY` 필요. 상세는 `server/realestate/PROBE.md`.

## RADIO 규약 (FE 아키텍처 — `docs/ARCHITECTURE-FE.md`가 단일 소스)
새 기능·수정은 R→A→D→I→O 순서로 판단한다. **불변식 5개는 절대 규칙**:
1. **브라우저는 KIS에 직결하지 않는다** — 실시간은 `kisGateway`(서버 ws 1개) → SSE 팬아웃(`/api/stream`)만. 키·재접속·41키 한도(코드당 2키, 상한 20코드)는 서버 책임.
2. **실데이터가 없으면 목이 아니라 "-"다** — `unavailable`/`targetReal` 플래그로 표현. httpApi 실패 경로에서 `mockApi` 반환 금지.
3. **등락색은 주입된다** — `signColor(pct,mode)`·`HOLD`·`STATUS_*`(colors.ts)만. hex 하드코딩 금지.
4. **파서 계약은 골든 테스트로 잠근다** — SSE trade/orderbook 필드 인덱스 변경 시 픽스처부터.
5. **캐시는 빈 성공을 저장하지 않는다** — 스로틀 순간의 `{}`가 TTL 동안 박제되면 안 됨(throw로 저장 차단 + 라우트에서 200 폴백).

운영 규칙:
- **상태 주소**: server state→zustand/훅, local→useState, derived→useMemo/서버. URL state 도입 시 `?tab&code` 계약 준수.
- **폴링은 `document.hidden` 게이트 필수** + 신선도 SLI(지수30s·US 15s·히트맵60s·포트폴리오30s·뉴스1h)를 지키거나 문서를 갱신.
- **전송은 O(1) 표현** — 목록 원본 대신 라벨/집계/정렬완료본(뉴스 sentiment, portfolio summary, rank).
- **이탈 정리**: SSE 클라이언트는 `pagehide`→`sendBeacon('/api/stream/bye?id=')`로 즉시 구독 반납.
- 훅 강제: `.claude/settings.json` PostToolUse → `scripts/radio-lint.mjs`(경고 전용, 등락색 하드코딩·폴링 게이트·mockApi 직수입·목 폴백 감지).

## 명령
- `pnpm dev` (5180) · `pnpm server` (8080, 백엔드) · `pnpm build` · `pnpm test`
- `pnpm collect` (부동산 실거래 배치, 약 6분 · `--with-trade` 매매 포함 — 활용신청 필수 · `--rebuild` 재수집 없이 시그널만)
- `pnpm server:restart` (8080 LISTEN만 종료 후 재기동+헬스체크 — `lsof -ti`로 직접 kill 금지: Vite 프록시 커넥션까지 잡음)
- QA/브라우징은 gstack `$B`(browse) 사용.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
