#!/usr/bin/env bash
# 또박또박 개발 환경 실행 스크립트
#   - tmux 세션(ddobak)에 rails / sidecar 윈도우를 띄운다
#   - 현재 터미널에서는 Tauri 데스크톱 앱(frontend)을 실행한다
#
# 사용법:
#   ./dev.sh           # 백엔드 기동 + Tauri 실행
#   ./dev.sh up        # 백엔드만 기동 (Tauri 실행하지 않음)
#   ./dev.sh attach    # 실행 중인 tmux 세션에 attach
#   ./dev.sh down      # tmux 세션 종료

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION="ddobak"

RAILS_PORT="${RAILS_PORT:-13323}"
SIDECAR_PORT="${SIDECAR_PORT:-13324}"
FRONTEND_PORT="${FRONTEND_PORT:-13325}"
CADDY_PORT="${CADDY_PORT:-13443}"

# 활성 기본 인터페이스의 LAN IP 자동 감지 (다른 PC/폰에서 웹 UI 접근 안내 + 인증서 일치 확인용).
DEFAULT_IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
LAN_IP="$(ipconfig getifaddr "${DEFAULT_IFACE:-en0}" 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true)"

RAILS_CMD="SERVER_MODE=true bin/rails server -p ${RAILS_PORT} -b 0.0.0.0"
[ -n "$LAN_IP" ] && RAILS_CMD="LAN_WEB_URL=https://${LAN_IP}:${CADDY_PORT} ${RAILS_CMD}"
SIDECAR_CMD="uv run uvicorn app.main:app --host 0.0.0.0 --port ${SIDECAR_PORT}"
# Caddy: LAN HTTPS 단일 origin(:${CADDY_PORT}). /api·/auth·/cable→rails, 그 외→vite.
# 다른 PC/폰 브라우저는 https://<LAN_IP>:${CADDY_PORT} 한 곳만 접속(같은 origin이라 CORS·IP입력 불필요).
# 웹 프론트는 설계상 window.location.origin 기준 same-origin 호출이므로 반드시 Caddy 경유해야 동작.
CADDY_CMD="caddy run --config '$PROJECT_ROOT/Caddyfile' --adapter caddyfile"

require_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "[error] tmux가 설치되어 있지 않습니다. 'brew install tmux' 후 다시 시도하세요." >&2
    exit 1
  fi
}

session_exists() {
  tmux has-session -t "$SESSION" 2>/dev/null
}

start_backend() {
  require_tmux
  if session_exists; then
    echo "[info] tmux 세션 '$SESSION'이 이미 실행 중입니다. (재사용)"
    return
  fi

  echo "[info] tmux 세션 '$SESSION' 생성"
  tmux new-session -d -s "$SESSION" -n rails -c "$PROJECT_ROOT/backend"
  tmux send-keys -t "$SESSION:rails" "$RAILS_CMD" Enter

  tmux new-window -t "$SESSION" -n sidecar -c "$PROJECT_ROOT/sidecar"
  tmux send-keys -t "$SESSION:sidecar" "$SIDECAR_CMD" Enter

  tmux new-window -t "$SESSION" -n caddy -c "$PROJECT_ROOT"
  tmux send-keys -t "$SESSION:caddy" "$CADDY_CMD" Enter

  echo "[info]   - rails   : http://localhost:${RAILS_PORT}"
  echo "[info]   - sidecar : http://localhost:${SIDECAR_PORT}"
  echo "[info]   - caddy   : https://localhost:${CADDY_PORT}  (LAN 웹 단일 진입점)"
  if [ -n "$LAN_IP" ]; then
    echo "[info]   - LAN 웹  : https://${LAN_IP}:${CADDY_PORT}  (다른 PC/폰 브라우저, 같은 origin → 서버주소 입력·CORS 불필요)"
    if ! grep -q "$LAN_IP" "$PROJECT_ROOT/Caddyfile" 2>/dev/null; then
      echo "[warn] 현재 LAN IP($LAN_IP)가 Caddyfile에 없음 → HTTPS 인증서 불일치로 웹 접속 깨짐."
      echo "[warn]   해결: mkcert로 새 IP 인증서 발급 후 Caddyfile의 site주소/tls 경로 갱신."
    fi
  fi
  echo "[info] 로그 확인: tmux attach -t $SESSION  (Ctrl+b n / p 로 윈도우 이동)"
}

start_frontend() {
  echo "[info] Tauri frontend 실행 (종료: Ctrl+C). 백엔드는 종료되지 않습니다."
  echo "[info] 백엔드 종료가 필요하면 './dev.sh down' 실행하세요."
  cd "$PROJECT_ROOT/frontend"
  exec npm run tauri:dev
}

case "${1:-all}" in
  all)
    start_backend
    start_frontend
    ;;
  up)
    start_backend
    ;;
  attach)
    require_tmux
    if ! session_exists; then
      echo "[error] tmux 세션 '$SESSION'이 실행 중이 아닙니다. 먼저 './dev.sh up' 실행하세요." >&2
      exit 1
    fi
    tmux attach -t "$SESSION"
    ;;
  down)
    require_tmux
    if session_exists; then
      tmux kill-session -t "$SESSION"
      echo "[info] tmux 세션 '$SESSION' 종료 완료."
    else
      echo "[info] 실행 중인 tmux 세션 '$SESSION'이 없습니다."
    fi
    ;;
  -h|--help|help)
    sed -n '2,10p' "$0"
    ;;
  *)
    echo "[error] 알 수 없는 명령: $1" >&2
    echo "사용법: $0 [all|up|attach|down|help]" >&2
    exit 1
    ;;
esac
