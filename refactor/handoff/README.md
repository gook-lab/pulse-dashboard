# PULSE — 개발 핸드오프

React + Vite + TypeScript 구현용 뼈대 코드.

## 파일
- `useKisSocket.ts` — 한국투자증권 실시간 WebSocket 훅
  - 국내/해외 체결·호가 구독, 자동 재접속(지수 백오프), PINGPONG 하트비트, 재접속 시 자동 재구독
  - 훅: `useKisTrade` / `useKisTrades` / `useKisOrderbook`
- `StockDetail.tsx` — 종목 상세(헤더 + 호가창 + 체결 내역) 예시 컴포넌트

## 사용 예
```tsx
const approvalKey = await fetch('/api/kis/approval').then(r => r.json()); // 백엔드에서 발급
<StockDetail code="005930" market="KR" name="삼성전자" cur="₩" dec={0}
             approvalKey={approvalKey} up="#16C784" down="#EA3943" />
```

## ⚠️ 반드시 지킬 것
1. **appkey/appsecret은 프런트엔드에 두지 말 것.** `approval_key` 발급(`POST /oauth2/Approval`)은
   백엔드에서만 하고, 만료 짧은 approval_key만 브라우저로 전달.
2. **필드 인덱스는 KIS 실시간 명세서 기준의 대표값**입니다. 실계좌 연동 전
   국내(H0STCNT0/H0STASP0)·해외(HDFSCNT0/HDFSASP0) 응답 필드 순서를 최신 문서로 검증하세요.
3. 해외 종목키(tr_key)는 거래소 프리픽스 필요 (예: 나스닥 `DNAS`+심볼). `toUsKey()` 참고해 확장.
4. 실전/모의 엔드포인트 포트가 다릅니다 (21000 / 31000).

## 색상 컨벤션
상승/하락 색을 `up`/`down` prop으로 주입 → 전역 토글(global 초록↑·빨강↓ / korea 빨강↑·파랑↓)과 연동.
