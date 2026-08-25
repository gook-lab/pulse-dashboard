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
- 화면별 팔레트도 전부 토큰이다. hex·rgba 리터럴을 컴포넌트에 쓰지 말 것:
  `--map-*`(배치도 지면·라벨) · `--bld-*`(건물 압출, near/far × 톤3 + base/rim) · `--poi-*`(인프라 아이콘) · `--chart-*`(차트 눈금·축·미니맵·툴팁).
  ⚠️ **등락색만은 토큰이 아니라 `colors(mode)`** — colorMode 토글로 바뀌어야 하므로 CSS 변수로 굳히면 안 된다.

## 데이터 연동 패턴
- 새 실데이터: `server/index.mjs`에 라우트 추가(캐시 필수) → `httpApi`에서 소비. **실패 시 목 폴백 금지 — `unavailable`/"-"** (아래 RADIO 규약 #2).
- 외부 API 교훈: **CNN·data.go.kr는 User-Agent 없으면 차단**, **data.go.kr 50콜 동시 시 throttle**(동시성 5+재시도), **KIS 토큰 1분 1회**(in-flight 중복 제거·캐시).
- **모든 KIS HTTP 호출은 `kisFetch` 게이트를 통과한다** — 모의계좌 초당 상한이 낮아 라우트가 각자 던지면 서로를 밀어낸다(실측: 서로 다른 종목 연속 조회에서 6/10 실패). 전역 직렬 큐 + **적응형 간격**(5xx/429면 ×1.6, 성공하면 −15ms, 200~1600ms)으로 0/12까지 떨어뜨렸다. 고정 간격은 TR마다 상한이 달라 늘 틀린다. ⚠️ **게이트에서 자동 재시도하지 말 것** — 주문(`kisPost`)까지 재시도되면 중복 주문이다. 재시도는 호출자 책임.
- **종목 기본정보는 `/api/kr/info`(KIS `inquire-price`)** — 시총(`hts_avls` 억원)·PER·PBR·EPS·BPS·거래량·52주를 다 준다. 목 `DETAIL_META`는 실제와 3배 이상 벌어진다(삼성전자 시총 468조 vs 1,552조 · PER 12.8 vs 40.5). **배당수익률은 이 TR에 없다** → 항상 "-". 미국은 무료 펀더멘털 소스가 없어 리서치 밸류에이션도 `fundamentalsReal:false` → "-".
- KIS는 검증 전까지 **모의(mock)** 계좌만 사용. ⚠️ **장 시작 전에는 지수 등락이 안 온다** — `inquire-index-price`가 레벨(`bstp_nmix_prpr`)만 주고 `prdy_vrss`·`prdy_ctrt`·`oprc`·`acml_vol`을 전부 `0`으로 비워 보낸다(장중에는 정상). 그 0을 그대로 쓰면 "0.00% 보합"으로 찍혀 실제 보합과 구별되지 않으므로, 세 값이 모두 0이면 `changeUnavailable`로 표시해 등락만 "-" 처리한다.
- **주문은 모의계좌에 실제로 들어간다**(`/api/kr/order` → `order-cash`, 모의 TR `VTTC0802U` 매수 / `VTTC0801U` 매도). 잔고·주문가능금액이 단일 진실 소스이므로 **로컬에서 예수금을 따로 계산하지 말 것**(과거 `effectiveBalance` 오버레이가 주문 티켓과 포트폴리오를 갈라놓았다). 모의계좌 API 가용성: 주문·잔고(`inquire-balance`)·주문가능금액(`inquire-psbl-order` `VTTC8908R`)은 **되고**, 당일 체결내역(`inquire-daily-ccld`)은 **빈 배열**, 미체결(`inquire-psbl-rvsecncl`)은 **"모의투자에서는 해당업무가 제공되지 않습니다"**. 그래서 주문 이력만 로컬에 남기고 KIS 주문번호(ODNO)를 함께 저장한다.
- **장 시작 전엔 잔고의 일간 등락도 0으로 온다** — `inquire-balance`의 `fltt_rt`·`bfdy_cprs_icdc`가 둘 다 0(실측 08:41). 그대로 합치면 "일간손익 ₩0 / 0%"가 실제 보합처럼 찍히므로 `dayPnlUnavailable`로 "-" 처리한다. 평가손익(`evlu_pfls_rt`)은 장 전에도 정상이다.
- **예수금은 `prvs_rcdl_excc_amt`(가수도정산금액)** — `dnca_tot_amt`는 D+2 결제 전이라 매수해도 안 줄어들어 "주문했는데 그대로"로 보인다. 매도 검증은 `ord_psbl_qty`(매도가능수량)로 — `hldg_qty`로 하면 미체결 매도가 걸린 주식을 또 팔 수 있다.
- **1일 등락은 전일 종가 대비로 고정** — `PriceChart`의 기본 기준가는 "보이는 구간의 첫 점"이라 확대하면 기준이 따라 움직이고 한 점까지 좁히면 `base==현재가`가 되어 **+0.00%**가 된다. `baseValue={{ '1일': prevClose }}`로 못박고, `prevClose`는 실일봉에서 뽑는다(마지막 봉이 오늘이면 그 앞, 장 시작 전이면 마지막). 목 `detail.changePct`·`unavailable`인 관심종목 행의 `changePct`는 기준으로 쓰지 말 것 — 실제 +21%가 −2.20%로 찍힌다.
- **분봉은 잘린 응답을 길게 캐시하지 말 것** — `kisMinutes`는 13페이지를 거슬러 올라가는데 한 페이지가 스로틀로 죽으면 다음 시각을 못 구해 순회가 끝난다(실측: 005930이 30행·유효 1행). `rows[0].date`가 09시대까지 내려갔는지로 완주를 판정해 잘렸으면 5초만 캐시(완주 60초). 프론트도 유효 캔들이 10개 미만이면 합성 라인으로 넘긴다.
- **`PriceChart`는 주식·부동산 공용** — 도메인 문구를 컴포넌트에 하드코딩하면 새어나온다(주식 차트에 "거래가 한 달에만 있어…"가 떴다). 한 점 안내는 `singlePointNote`로 호출자가 준다.
- **주문 단가에 목 가격을 쓰지 말 것** — `getStockDetail`이 아직 목이라 `detail.price`가 실가와 3배까지 벌어진다(005930: 목 78,400 vs 실 251,000). `referencePrice(orderbook, lastTradePrice)`로 실호가에서만 만들고, 실가가 없으면 0을 돌려 주문을 막는다.
- **FRED는 `limit`으로 자르지 말 것** — `sort_order=asc`는 1947년부터 세므로 최근 분기가 잘려 나간다. 범위는 `observation_start`로 좁힌다.
- **ECOS 환율은 정의가 두 가지** — `KeyStatisticList`의 "원/달러 환율(종가)"과 `731Y001/0000001` "원/미국달러(매매기준율)"은 같은 날에도 10원대로 벌어진다. 화면 여러 곳에 환율을 쓸 땐 **한 소스로 통일**(현재 전부 매매기준율). 섞으면 같은 화면에 두 값이 찍혀 버그로 읽힌다.
- **항목별 폴백 묶음은 부분 실패를 긴 TTL로 캐시하지 말 것** — `cached(key, ttlMs, ...)`의 `ttlMs`에 `(data) => ms` 함수를 넘겨 일부가 `null`이면 짧게 잡는다(`/api/macro` 참고). 안 그러면 순간 실패가 한 시간짜리 "-"로 굳는다.
- **TOP100은 Daum 금융 API**(`/api/kr/top100`, 무료·실시장 — KIS 랭킹류는 30건 하드캡). ⚠️ Daum `changeRate`는 부호 없음 — `change: FALL|RISE`가 방향. **목표주가는 기술적 산출**(`/api/kr/targets`, 볼린저 상단+60일 고가 클램프) — US는 무료 소스 없어 `targetReal:false` → "-".
- 버핏지수(`/api/buffett`, 계산은 `server/buffett.mjs`): 코스피 = ECOS 시총(`802Y001/0183000` 일별·억원) ÷ GDP(`200Y105/1400` 분기·십억원, **최근 4분기 합**) · 미국 = FRED `NCBEILQ027S`(백만$) ÷ `GDP`(십억$·연율, **같은 분기끼리**). ⚠️ **나스닥 단독 버핏지수는 만들지 않는다** — 외국기업 포함·NYSE 제외로 분자·분모 모집단이 어긋나고 나스닥 시총 무료 소스도 없다. 미국은 표준 정의(전체 시장)로 계산하고 라벨도 "미국". 절대 임계값(<75% 저평가 …) 대신 **같은 시계열 10년 분포 위치**(백분위·중앙값)를 함께 보여준다.
- **OSM/Overpass**(`server/realestate/osm.mjs`, 배치도 재료): 공용 무료 서버라 우리가 먼저 자제한다 — 분당 30콜 예산·미러 2개·재시도, 결과는 `server/cache/osm/`에 파일 캐시(`CACHE_VERSION` 올리면 전체 재수집).
  질의는 **`out body geom(bbox)`** 여야 한다: `out geom tags`는 relation 멤버를 빼고(한강이 통째로 사라진다), bbox 가 없으면 way 를 안 잘라 준다(실측 한 way 8,188m).
- **히트맵 블록 크기는 실 시가총액** — 미국 `/api/heatmap/weights`(Finnhub `profile2.marketCapitalization`, 무료·백만$) · 코스피는 `/api/kr/top100`의 `marketCap`. ⚠️ **한 종목이라도 빠지면 전부 목 가중으로 되돌린다** — 실값과 목값은 스케일이 달라(4,537,071 vs 3,170) 섞이면 트리맵이 통째로 뒤틀린다. 카드에 "크기 = 실 시가총액 / 목 가중" 배지로 출처를 밝힌다.
- **종목 스코어는 규칙 기반**(`/api/kr/opinion`, 계산은 `server/opinion.mjs`) — 20일 모멘텀 0.35 · 52주 위치 0.30 · 뉴스 감성 0.20 · PER 0.15의 가중 혼합. **AI 모델이 아니므로 화면에도 "규칙 기반"이라고 쓴다.** 없는 항목은 빼고 남은 것만 평균하며 전부 없으면 `null` → "-". 근거 문장은 반드시 잰 숫자를 인용한다(`20일 수익률 -22.1%로 하락 흐름`). PER 비중이 낮은 이유: 업종별 정상 범위가 달라 저PER=저평가로 단정할 수 없다.
- **홈(W2) 순자산 정책** — 순자산 = KIS 총자산 + 수동 자산(`server/assets.mjs` · `/api/assets` CRUD · `server/data/`는 gitignore). **관심단지 추정가는 합산 금지**(워치 전용, `/api/realestate/estimates` = rep.t 대표평형×중앙값·전세 표본으론 추정 안 함). `/api/home`은 항목별 `cached` 분리 — 실패 항목만 null로 조합해 항상 200, 프론트는 항목 단위 "-". dayChange `pct`는 순자산 대비로 재계산(KIS `dayPnlPct`는 유가증권 대비라 -9.6%처럼 찍혀 오독). 일일 스냅샷은 `manualTotal`·`netWorth` additive 필드 — 구·신 엔트리 혼재를 소비자가 견딘다(`manualIncluded`). 홈 피드는 주문·알림이 로컬(localStorage)이라 서버 병합 불가 → `buildHomeFeed`(`src/lib/homeFeed.ts`, 순수 함수) 클라 조립, 시간 역순 단일 규칙.
- 부동산(realestate): `server/realestate/`에서 배치 수집 → `apt-signals.json` 캐싱. 단지 키는 **`aptSeq`**(이름 매칭 금지 — 동명 단지 존재). 시그널은 **3개월 이동 중앙값** + 이상치 제외(`[0.4, 2.5]×단지중앙값`), 기준월 = 3개월 전(신고지연 보정). 지오코딩은 `KAKAO_REST_KEY` 필요. 상세는 `server/realestate/PROBE.md`.

## 단지투어 3D 배치도

`ComplexSiteMap.tsx` + 뷰 정책 `siteMapView.ts` + 좌표 `src/lib/iso.ts`. OSM 건물 외곽선을 SVG로 압출한다(three.js 없음).

**조작 계약** — 드래그 회전 · `Shift`+드래그 이동 · 우클릭/`Alt`/`Ctrl`·`Cmd`+드래그 확대 · 휠 확대(클릭해 포커스 후 또는 `Ctrl`+휠) · 방향키 이동 · `[` `]` 방위 · `,` `.` 고도 · `0` 제자리. 확대는 **커서 기준**(팬 역산). 터치는 세로 스크롤을 지키려 `touch-action: pan-y` — 핀치 확대는 없고 HUD `±` 버튼으로 대신한다.

**좌표계**(`iso.ts`) — 방위 yaw 0~360° 연속, 고도 pitch 8~85°(기본 30°). 지면 깊이는 `sinφ`, 높이는 `cosφ`로 눌린다. 회전은 좌표를 돌리는 것이라 렌더러가 필요 없다.
- **깊이 정렬 축은 yaw와 함께 돌아야 한다** — 월드 `x+y`로 정렬하면 180°에서 순서가 뒤집혀 뒷건물이 앞을 덮는다.
- **OSM 링 방향은 보장되지 않는다**(실측 CCW 451 / CW 209) — 벽 법선을 링 방향으로만 구하면 32%가 명암 반전. `ringIsCCW`로 먼저 잰다.

**LOD** — 축소하면 덜 그린다(`levelOfDetail`). 그림자 0.75× · 보행로 0.7× · 층 구분선 1.1×(주변 건물 1.8×) · 외곽선 1.5× · 층수 라벨 0.9× · 인프라 아이콘 0.45×. 최소 건물 면적은 0/150/400m².

**주변 스트리밍** — `/api/realestate/area`(일반 fetch, SSE 아님). 200m 격자 칸 단위로 화면을 채우고, 칸 캐시는 원점과 무관하게 구워 `shiftCell`로 옮기므로 **단지끼리 공유**된다. 동시 3개·칸당 18초 상한·줌에 따라 예산 확대. 단지를 바꾸면 진행 중 요청을 끊고 응답의 `seq`를 대조한다(늦게 온 응답이 새 좌표계에 섞이면 건물이 엉뚱한 곳에 선다).

**주변 인프라** — 역·학교·병원·마트·공원만(편의점·버스정류장은 아이콘이 지도를 덮는다). 지하철역은 대부분 터널이라 **`isHidden`(지오메트리 규칙)을 표시에 적용하면 역세권이 통째로 사라진다**. 도로명은 `residential`까지 포함해야 한다 — 간선도로만 걸면 주택가에서 0개다.

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
- `pnpm validate` (커밋 전 통합 검증 — tsc + 테스트 + 색 하드코딩 + 미정의 CSS 토큰. 훅은 경고만 하고 이건 막는다)
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

## 문서 규약

사람이 읽는 문서(`README*.md`, `docs/**/*.md`)는 guk-lab 공통 규약을 따른다.
정본은 `~/sonix/toy/guk-lab-docs` — 복사하지 않고 가리킨다.

- 톤: `guk-lab-docs/STYLE.md` — 본문 습니다체, 헤드 요약·표 셀은 명사형,
  헤딩은 기술 명사구, 수치에는 측정 시점 병기.
- 다이어그램: `guk-lab-docs/harness/skills/doc-diagrams/SKILL.md` —
  `docs/diagrams/<name>.mmd` 가 정본, 색은 의미(core/view/store/external/tool),
  점선은 런타임 밖 경로에만.
- 브랜치·PR: `guk-lab-docs/playbooks/branching.md` — main 직접 커밋 금지,
  develop 에 쌓고 PR 로 합친다.
- `README.md` 를 고치면 `README.en.md` 도 같은 커밋에서 고친다.
