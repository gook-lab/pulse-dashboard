#!/bin/bash
# 백엔드(8080) 안전 재시작.
#
# ⚠️ `lsof -ti tcp:8080` 만 쓰면 LISTEN 이 아닌 프록시 커넥션(Vite dev 서버가
#    /api 를 8080 으로 물고 있는 소켓)까지 잡아서 dev 서버를 오살한다.
#    실제로 3일 떠 있던 Vite 를 죽인 사고가 있었다. 반드시 -sTCP:LISTEN 으로 좁힌다.
set -euo pipefail
cd "$(dirname "$0")/.."

PIDS=$(lsof -ti tcp:8080 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "[restart] 기존 서버 종료: $PIDS"
  echo "$PIDS" | xargs kill 2>/dev/null || true
  sleep 1
  # 아직 살아 있으면 강제 종료
  PIDS=$(lsof -ti tcp:8080 -sTCP:LISTEN 2>/dev/null || true)
  [ -n "$PIDS" ] && echo "$PIDS" | xargs kill -9 2>/dev/null || true
fi

echo "[restart] 서버 시작..."
nohup node server/index.mjs > /tmp/pulse-server.log 2>&1 &

for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 0.5
  if curl -sf --max-time 2 http://localhost:8080/api/health >/dev/null 2>&1; then
    echo "[restart] ✓ 정상 (http://localhost:8080) · 로그: /tmp/pulse-server.log"
    exit 0
  fi
done

echo "[restart] ✗ 헬스체크 실패 — 로그 확인:"
tail -5 /tmp/pulse-server.log
exit 1
