# 지도 · 차트 핸드오프

PULSE 대시보드의 **부동산 지도 탐색**과 **가격 차트** 시안 + 구현 자료.

## 담긴 것

| 파일 | 내용 |
|---|---|
| `SeoulRealEstate.html` | 부동산 지도 탐색 시안 (그대로 브라우저에서 열림) |
| `maps/seoul-simple.json` | 서울 25개 자치구 경계 GeoJSON (행정안전부 행정구역) |
| `PriceChart.tsx` | 토스식 가격 차트 React 컴포넌트 |
| `BarChart.tsx` | 세로(실적)·가로(비교) 바 차트 |
| `PROMPTS.md` | 두 영역의 구현 프롬프트 |

## 시안 열기
`SeoulRealEstate.html`을 브라우저에서 직접 열면 됩니다.
(같은 폴더의 `maps/seoul-simple.json`을 fetch하므로 폴더째 유지하세요. 로컬 파일 프로토콜에서 fetch가 막히면
`npx serve .` 같은 정적 서버로 띄우면 됩니다.)

## 라이브러리
- 지도: **d3-geo**(행정구역 choropleth) + **Leaflet + OSM**(실거리·시세)
- 차트: 외부 차트 라이브러리 없음. 순수 SVG + framer-motion

## 주의
- 시안의 수치는 **샘플**입니다. 실거래가는 국토교통부 API로 대체하세요.
- 동/단지 마커 위치는 **구 경계 안쪽의 근사 좌표**입니다. 정확히 하려면 행정동 경계 GeoJSON과
  단지 좌표 지오코딩이 필요합니다 (PROMPTS.md 참고).
- OSM 타일 사용 시 `© OpenStreetMap contributors` 저작자 표시는 필수입니다.
