# 구현 프롬프트

AI 코딩 에이전트에 그대로 붙여넣어 쓰는 용도. React + Vite + TS + Tailwind + framer-motion 기준.

---

## 1. 부동산 지도 탐색 화면 (기본)

```
서울 부동산 지도 탐색 화면을 만든다. 3분할: 좌(목록 352px) / 중(지도 flex) / 우(통계 336px).

지도: d3-geo로 public/maps/seoul-simple.json(25개 자치구 GeoJSON)을 렌더한다.
- geoMercator().fitExtent로 컨테이너에 맞추고 geoPath로 path 생성
- choropleth 색상은 지도 지표 토글(평균가/전월대비/거래량)에 따라 전환
- 구 클릭 → 해당 구 bbox로 SVG transform zoom(0.62s cubic-bezier), 나머지 구는 fill-opacity 0.22로 dim
- 호버 시 툴팁(평균가·거래건수·전월대비), 목록 행 호버와 양방향 하이라이트 동기화

목록: 브레드크럼(서울시 › 구 › 동) + 정렬 세그먼트(가격/변동/거래).
레벨에 따라 자치구 25 → 행정동 → 단지(준공년도·세대수)로 행 구성이 바뀐다.

통계: 선택 범위에 맞춰 세분화. KPI 4개(평균/중위/거래량/전월대비), 최근 12개월 추이 라인,
가격 분포 히스토그램, 면적대별 평균, 가격 상위 5.
⚠️ KPI 평균·거래량은 반드시 "화면에 보이는 하위 항목"에서 거래량 가중으로 계산할 것
(부모 집계를 쓰면 평균과 중위값이 서로 다른 모집단을 설명하게 됨).
⚠️ 12개월 추이는 현재값에서 역방향으로 걸어서 생성할 것 (끝점을 덮어쓰면 마지막 구간이 절벽이 됨).

필터: 거래유형(전세/매매/월세) · 지도 지표 · 면적대. 셋 다 지도 채색·목록·통계에 동시 반영.
```

---

## 2. 실거리 지도 · 시세 말풍선

```
지도 패널에 [행정구역 / 실거리·시세] 토글을 추가한다.
실거리 모드는 Leaflet + OSM 타일로 실제 도로 지도를 띄우고, 네이버 부동산식 시세 말풍선 마커를 얹는다.

- L.map + L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' })
  → attribution은 라이선스 요구사항이므로 절대 제거 금지
- 다크 UI에 맞추려면 .leaflet-tile-pane에 filter: brightness(.52) saturate(.7) contrast(1.14)
  ⚠️ invert() 계열 필터는 흰색 도로가 검게 뒤집혀 도로망이 사라지므로 쓰지 말 것
- 마커는 L.divIcon으로 HTML 말풍선(이름 + 가격 + 꼬리 + 점) 렌더, 선택 항목은 브랜드 컬러로 반전
- 줌 레벨: 시 11 / 구 13 / 동·단지 16
- 좌표는 d3 projection.invert([x,y])로 화면좌표 → [lng,lat] 역변환해 재사용
```

### 2-1. 네이버 지도로 교체 (실서비스)

```
실거리 지도를 네이버 지도(NCP Maps)로 교체한다.
- index.html에 https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=... 로드 (키는 .env → Vite define)
- naver.maps.Map 생성, 마커는 naver.maps.Marker + icon.content에 기존 말풍선 마크업 그대로 사용
- 좌표는 국토부 실거래 API의 법정동코드 + 도로명주소를 naver.maps.Service.geocode로 지오코딩 후 DB 캐싱
- 마커 클릭 → 우측 통계 패널이 해당 단지 스코프로 전환

지도 선택지 비교:
- 네이버 지도: 부동산 UX 익숙, 한국 주소·건물 정확. 클라이언트 ID + 도메인 등록 필요
- 카카오맵: 무료 한도 넉넉, 로드뷰 제공
- VWorld(국토부): 무료, 지적도·용도지역 레이어 제공 → 부동산에 유리
- 구글 지도: 한국은 지도 반출 규제로 건물·도보 상세가 약함 → 국내 부동산엔 비추천
```

### 2-2. 행정동 경계 추가 (정확도)

```
행정동 경계 GeoJSON을 추가한다. public/maps/seoul-dong.json에 서울 행정동 경계를 넣고,
구 선택 시 해당 구에 속한 동만 필터링해 실제 폴리곤으로 렌더한다.
근사 좌표 동 버블을 동 choropleth + 중심 라벨로 교체하고, 단지 레벨은 실거래 좌표를 핀으로 찍는다.
```

---

## 3. 가격 차트 (토스 스타일)

```
handoff/common/PriceChart.tsx를 src/components/common/에 넣고 종목 상세에 연결한다.

props: name, code, cur, dec, series(기간별 종가 배열), volumes, candles(선택), labels, mode, height

핵심 인터랙션:
- 기간 탭 1일/1주/1개월/3개월/1년/5년. 탭 전환 시 스크럽·줌 초기화
- 좌우 드래그 스크럽 → 상단 대표 가격·등락률이 그 시점 값으로 바뀌고 손 떼면 현재가 복귀 (토스의 핵심)
- 크로스헤어 점선 + 이중 원(광원 링 + 본체) + 툴팁(좌우 끝 clamp, pointer-events:none)
- 기준선: 구간 첫 값에 점선, 그 위/아래로 라인 색 결정
- 줌/팬 입력 분리 → 마우스: 휠=줌, 드래그=팬, 호버=스크럽 / 터치: 드래그=스크럽, 두 손가락=핀치
- 구간 미니맵: 전체 기간 축소 + 현재 구간 박스, 클릭·드래그로 점프
- 거래량 바: 전일 대비 색상, 스크럽 중 선택 봉만 100%·나머지 16%
- 캔들 토글: candles prop이 있을 때만 노출

주의:
- 휠 리스너는 addEventListener('wheel', fn, { passive:false })로 직접 등록 (React onWheel은 preventDefault 불가)
- 컨테이너에 touch-action: pan-y → 세로 스크롤은 살리고 가로 제스처만 가로챈다
- 폭은 ResizeObserver로 측정해 실제 px로 그린다 (viewBox 스케일링 쓰면 점·원이 찌그러짐)
```

### 3-1. 실시간 연결

```
PriceChart를 KIS 실시간에 연결한다.
- 1일 기간일 때만 useKisTrade로 체결가를 받아 series['1일'] 마지막 값을 갱신
- 스크럽 중(idx != null)에는 헤더 숫자를 갱신하지 않는다 (사용자가 과거 시점을 보는 중)
- 갱신은 requestAnimationFrame으로 묶어 초당 최대 4회로 throttle
```

---

## 4. 바 차트

```
handoff/common/BarChart.tsx를 사용한다.
- VerticalBars: 분기 실적. data=[{label:'25 Q4', value:24.7, compare:19.1}] → 당기+전년동기 2줄 바 + YoY 자동 계산
- HorizontalBars: 경쟁사 비교. highlight prop으로 자사만 강조
리서치 화면의 밸류에이션 섹션과 종목 상세 하단에 배치한다.
```
