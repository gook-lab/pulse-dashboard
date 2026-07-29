# PULSE 기능 확장 로드맵 · Claude Code 프롬프트

> 시안: 프로젝트 루트 `FeatureExpansion.dc.html` — 우선순위 5건(S1·D1·P1·B1·C1)이 탭으로 동작합니다.
> 브라우저에서 열어 인터랙션(호가 클릭 채움, 랭킹 필터, 스크럽, 평형 전환, 알림 드로어)을 직접 확인한 뒤 구현하세요.

현재 구현(대시보드·종목상세·뉴스·포트폴리오·리서치·부동산) 기준, Toss/KB의 검증된 패턴을 참고한 확장 기능 카탈로그.
각 프롬프트는 Claude Code에 그대로 붙여넣는 용도 — 기존 아키텍처(zustand `useStore` · `httpApi` · `common/` 컴포넌트 · `colorMode`/`signColor` · KIS 웹소켓 훅)를 전제로 쓴다.

> 공통 규칙 (모든 프롬프트 앞에 한 번 선언)
> ```
> 기존 컨벤션을 따른다: CSS 변수 토큰(global.css) + Tailwind 매핑, 등락색은 반드시 signColor(±1, colorMode),
> 로딩은 CardSkeleton/SkeletonRows, 에러는 ErrorState+재시도, 배지는 Badge, 토글은 Segmented,
> 차트는 PriceChart/VerticalBars/HorizontalBars 재사용. 새 색상 하드코딩 금지. 접근성: 리스트는 listbox/option, :focus-visible 유지.
> Toss/KB는 기능 패턴 참고만 — 고유 브랜드 비주얼·카피는 복제하지 않는다.
> ```

---

## 1. 대시보드

### D1. 실시간 급등락 랭킹 (Toss 실시간 차트)
```
대시보드에 RankingBoard 카드를 추가한다. src/components/dashboard/RankingBoard.tsx.
- Segmented로 급상승/급하락/거래량/인기 4개 탭, 시장 토글(전체/KR/US)
- 행: 순위(1~10) · MarketChip · 종목명 · 현재가 · 등락률(signColor) · 미니 Sparkline
- 순위 변동 시 행이 framer-motion layout으로 부드럽게 재정렬, 신규 진입은 배경 플래시 1회
- 데이터: /api/ranking?kind=&market= 폴링 15s, stale-while-revalidate (aptScreen 패턴 재사용)
- 행 클릭 → selectStock(code) → 종목상세 탭 이동
```

### D2. 시장 캘린더 (실적·배당·공모)
```
대시보드 우측 컬럼에 MarketCalendar 카드를 추가한다.
- 이번 주 7일 스트립: 오늘 강조, 이벤트 있는 날에 점 표시(실적=brand, 배당=amber, 공모/매크로=blue)
- 날짜 선택 시 하단에 이벤트 리스트: D-day 배지 · 종목/지표명 · 예상치vs컨센서스(있으면)
- 관심종목(watchlist)에 있는 종목 이벤트는 ★와 함께 상단 고정
- FOMC·CPI 같은 매크로 이벤트는 국기 대신 MarketChip 스타일의 'MACRO' 칩
- 데이터: /api/calendar?from=&to= — 백엔드 미구현 시 mockApi에 2주치 시드
```

### D3. 내 투자 헤드라인 (Toss 홈 요약)
```
대시보드 최상단에 PortfolioPulse 스트립을 추가한다 (AppBar 아래, 지수 카드 위, 높이 64px).
- 좌: '오늘 내 계좌' 일간손익 ±금액·%(signColor, 숫자는 mono) — portfolio 스토어 재사용
- 중: 보유종목 중 오늘 최고/최저 기여 종목 2개 (이름+등락률, 클릭→종목상세)
- 우: '포트폴리오 보기 →' 링크
- portfolio 미로드 시 이 스트립 자체를 렌더하지 않는다 (스켈레톤도 없음 — 선택적 요약이므로)
```

### D4. 지수 카드 → 미니 차트 확장
```
IndexCards의 각 카드를 클릭하면 인라인으로 펼쳐지는 미니 차트를 추가한다.
- 펼침: 카드 아래 행 전체 폭으로 PriceChart(높이 180, 기간탭 1일/1주/1개월만) 삽입, 나머지 카드는 유지
- 한 번에 하나만 펼침, 재클릭·ESC로 접기, 펼친 카드는 border brand 강조
- 데이터: /api/index-series?code=&period= , 로딩 중 Skeleton(height 180)
```

## 2. 종목 상세

### S1. 모의 주문 티켓 (Toss 간편주문)
```
StockDetail 우측 컬럼 상단에 OrderTicket을 추가한다 (모의 주문 — 실제 체결 없음).
- Segmented 매수/매도(색은 signColor ±1), 수량 스테퍼 + 10%/25%/50%/최대 칩, 지정가/시장가 토글
- 지정가 입력은 호가단위로 스냅, 예상 체결금액·수수료·매수 후 잔고 실시간 계산(mono)
- 주문 버튼 → Modal 확인(종목·수량·가격 요약) → useToast success '모의 주문 접수'
- 주문 내역은 localStorage 'pulse.paper-orders'에 저장, 포트폴리오 탭에서 조회 가능하게 스토어에 paperOrders 추가
- 호가창 가격 클릭 시 지정가 입력에 자동 채움 (기존 Orderbook에 onPickPrice prop 추가)
```

### S2. 투자자 동향 (KB/키움 수급)
```
StockDetail에 InvestorFlow 카드를 추가한다 (KR 종목만, US는 숨김).
- 최근 20일 외국인/기관/개인 순매수를 스택 VerticalBars로, 누적선 오버레이
- 상단 요약: '외국인 5일 연속 순매수 +1,240억' 같은 자동 문장 1줄 (연속일수 계산)
- Segmented 일간/주간, 값 포맷은 억원 단위 fmt 유틸 확장
- 데이터: /api/investor-flow?code= — mockApi 시드 포함
```

### S3. 컨센서스 밴드
```
AI 투자의견 카드 아래 AnalystConsensus를 추가한다.
- 증권사 목표가 분포를 가로 밴드로: min–max 트랙 위에 평균 마커, 현재가 마커(두 마커 색 구분)
- 매수/중립/매도 의견 수를 Badge 3개로, 최근 상향/하향 이력 2건 리스트
- 데이터: research 스토어의 fund 확장 또는 /api/consensus?code=
```

### S4. 가격 알림 (Toss 알림)
```
StockDetail 헤더에 종 아이콘 → PriceAlertModal을 추가한다.
- 조건: 목표가 도달(이상/이하), 등락률 ±N% (Slider 1~30%), 52주 신고가 갱신 토글
- 저장: localStorage 'pulse.alerts', 스토어 alerts[]
- 웹소켓 tick에서 조건 충족 시 useToast info + 알림센터(공통 C1)로 전달, 충족된 알림은 1회성 소멸
- 활성 알림 있는 종목은 관심종목 리스트에 작은 종 아이콘 표시
```

## 3. 뉴스

### N1. 아침/마감 브리핑 (Toss 뉴스 브리핑)
```
뉴스 탭 상단에 DailyBriefing 카드를 추가한다.
- 오전 8시 기준 '아침 브리핑' / 오후 4시 '마감 브리핑' 자동 전환 (그 외 시간은 최신 것 유지)
- 구성: 3줄 요약(불릿) · 오늘 주목 종목 3개 칩(클릭→종목상세) · 주요 일정 2건(캘린더 연동)
- 접기/펼치기, 읽음 상태 localStorage — 읽으면 다음 브리핑까지 접힌 채 유지
- 데이터: /api/briefing — LLM 생성 파이프라인은 백엔드 몫, 프론트는 형태만
```

### N2. 키워드 트렌드
```
뉴스 좌측 필터 패널에 TrendingKeywords 섹션을 추가한다.
- 최근 24h 헤드라인에서 추출된 키워드 상위 8개를 빈도순 칩으로, 급상승은 ▲ 표시
- 칩 클릭 → 해당 키워드로 뉴스 리스트 필터 (기존 감성 필터와 AND 조합)
- 활성 키워드는 헤더에 제거 가능한 칩으로 표시 (부동산 areaFilter 칩과 동일 패턴)
```

### N3. 종목별 감성 타임라인
```
뉴스 탭에서 특정 종목 필터 시 상단에 SentimentTimeline을 추가한다.
- 최근 30일 일별 호재/악재 건수를 위아래로 뻗는 미러 바 차트로 (위=호재 signColor(1), 아래=악재)
- 바 클릭 → 그 날짜 뉴스로 리스트 스크롤·필터
- 가격 라인 오버레이 토글 (PriceChart 데이터 재사용, 뉴스-가격 상관 확인용)
```

## 4. 포트폴리오

### P1. 수익률 추이 vs 벤치마크 (Toss 내 수익률)
```
포트폴리오 상단에 ReturnChart 카드를 추가한다.
- PriceChart를 재사용해 내 수익률(%) 라인 + KOSPI/S&P500 벤치마크 라인 2개 오버레이
  (PriceChart에 compareSeries?: {name, data, color}[] prop을 추가하는 방식으로 확장)
- 기간 Segmented 1개월/3개월/1년/전체, 헤더에 기간 수익률 vs 벤치마크 초과수익 ±%p
- 스크럽 시 세 라인 값이 툴팁에 함께 표시
```

### P2. 배당 캘린더
```
포트폴리오에 DividendCalendar 카드를 추가한다.
- 보유종목의 배당락일·지급일을 월 캘린더에 점으로, 하단에 다가오는 배당 리스트(D-day·주당배당금·보유수량 기준 예상액)
- 연간 예상 배당 합계 + 배당수익률을 헤더에 (mono, 억/만 단위 fmt)
- 데이터: /api/dividends?codes= — mockApi 시드
```

### P3. 리밸런싱 도우미
```
자산배분 도넛 옆에 RebalanceHint를 추가한다.
- 종목별 목표 비중을 사용자가 설정(Slider, 합계 100% 검증) → localStorage 저장
- 현재 비중과 목표의 이탈을 HorizontalBars로: 이탈 ±3%p 이상만 강조, '삼성전자 +5.2%p 초과' 문장
- '조정 시뮬레이션' 버튼 → Modal에 필요한 매수/매도 수량 표 (모의 주문 티켓 S1로 딥링크)
```

## 5. 리서치

### R1. 종목 비교 (KB 종목 비교)
```
리서치에 CompareView를 추가한다 (리포트 리더와 Segmented로 전환).
- 종목 2~3개 선택(관심종목에서 검색·추가) → 열 단위 나란히 비교
- 행: 현재가/시총/PER/PBR/배당률/AI스코어/목표가 상승여력 — 각 행에서 우위 값에 subtle 하이라이트
- 가격 추이는 정규화(시작=100) 라인 3개를 한 차트에 (P1의 compareSeries 재사용)
- URL 상태 ?compare=005930,AAPL 로 공유 가능하게
```

### R2. 시그널 백테스트
```
리서치에 BacktestPanel을 추가한다.
- 입력: 시그널(AI스코어 상위 N / 모멘텀), 리밸런스 주기(월/분기), 기간(1~5년 Slider), 초기금액
- 결과: 누적수익 라인(vs KOSPI), MDD·샤프·승률 KPI 4개, 연도별 수익 VerticalBars
- 실행 중 Progress + 취소, 결과는 스토어에 캐시(같은 파라미터 재실행 방지)
- 데이터: /api/backtest POST — 백엔드 미구현 시 시드 결과 반환
```

### R3. 의견 변경 타임라인
```
리포트 리더에 OpinionHistory 섹션을 추가한다.
- AI 의견/목표가 변경 이력을 세로 타임라인으로: 날짜 · 매수→중립 화살표(색 전환) · 목표가 변경 ±%
- 상향=signColor(1) 하향=signColor(-1), 최근 6건, 더보기 접기
```

## 6. 부동산

### B1. 단지 상세 시트 (KB 시세 상세)
```
부동산에서 단지 선택 시 우측에 ComplexSheet 패널을 추가한다 (지도 위 오버레이가 아니라 3열째 컬럼, 1440px 미만은 Modal).
- 헤더: 단지명·준공·세대수·용적률, 관심 ★
- 실거래 이력: 최근 24개월 거래를 산점(면적대 색상) + 3개월 중앙값 라인 — PriceChart 확장 말고 전용 경량 SVG
- KB시세 vs 실거래 중앙값 비교 바 (괴리율 ±% 강조)
- 면적대(평형) Segmented → 이력·시세 모두 반영
- 데이터: /api/complex/:aptSeq/deals
```

### B2. 관심단지 알림 + 변동 요약
```
부동산 워치리스트(aptWatchlist)에 변동 요약 뷰를 추가한다.
- '관심 단지' Segmented 탭: 지난 배치 대비(aptSnapshot cur/prev) Δ를 정렬해 카드 리스트로
- 신규 거래 발생 단지는 'NEW n건' Badge, 시그널 급변(±2σ)은 강조
- 알림: 배치 갱신 시(generatedAt 변경) 관심단지 중 변동 상위 1건을 useToast info로
```

### B3. 대출 계산기 (KB 대출 한도)
```
단지 상세 시트에 LoanCalc 접이식 섹션을 추가한다.
- 입력: 매매가(시세 자동 채움), LTV Slider(40~70%), 금리(연 %, Number), 기간(10~40년)
- 출력: 최대 대출액·월 상환액(원리금균등)·총 이자 — 입력 변경 시 즉시 재계산(mono)
- 규제 반영은 하지 않는다 — '단순 계산, 실제 한도는 심사에 따름' 캡션 필수
```

## 공통

### C1. 알림 센터
```
AppBar에 벨 아이콘 + NotificationCenter 드로어를 추가한다.
- S4 가격알림·B2 부동산 변동·시스템 공지를 시간순으로, 미읽음 카운트 배지
- 항목 클릭 → 해당 탭/종목으로 딥링크, 모두 읽음 버튼
- 저장: localStorage 'pulse.notifications' 최근 50건
```

### C2. 전역 검색 확장 (⌘K)
```
기존 ⌘K 검색을 커맨드 팔레트로 확장한다.
- 섹션: 종목(기존) / 뉴스 키워드 / 부동산 단지 / 액션('색상 컨벤션 전환', '포트폴리오로 이동')
- ↑↓ 이동·Enter 실행 유지, 섹션 헤더는 sticky, 최근 검색 3건 기억
```

---

## 우선순위 제안

체감 임팩트 기준: **S1 주문 티켓 → D1 랭킹 → P1 수익률 추이 → B1 단지 시트 → C1 알림 센터** 순.
S4(알림)와 C1(알림 센터)은 한 묶음으로 같이 구현하는 게 낫다.
