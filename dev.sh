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
CADDY_PORT="${CADDY_PORT:-443}"

# 1024 미만 포트(443 등)는 바인딩에 root 권한 필요 → caddy만 sudo로 기동한다.
if [ "$CADDY_PORT" -lt 1024 ]; then CADDY_PRIV=1; else CADDY_PRIV=0; fi
# URL 표시용 포트 접미사: 443이면 생략(프로덕션처럼 포트 없는 주소).
if [ "$CADDY_PORT" = "443" ]; then PORT_SFX=""; else PORT_SFX=":${CADDY_PORT}"; fi

# 활성 기본 인터페이스의 LAN IP 자동 감지 (다른 PC/폰에서 웹 UI 접근 안내 + 인증서 일치 확인용).
DEFAULT_IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
LAN_IP="$(ipconfig getifaddr "${DEFAULT_IFACE:-en0}" 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true)"

LAN_CERT="$PROJECT_ROOT/certs/lan.pem"
LAN_KEY="$PROJECT_ROOT/certs/lan-key.pem"
CADDY_LOCAL="$PROJECT_ROOT/Caddyfile.local"

RAILS_CMD="SERVER_MODE=true bin/rails server -p ${RAILS_PORT} -b 0.0.0.0"
[ -n "$LAN_IP" ] && RAILS_CMD="LAN_WEB_URL=https://${LAN_IP}${PORT_SFX} ${RAILS_CMD}"
SIDECAR_CMD="uv run uvicorn app.main:app --host 0.0.0.0 --port ${SIDECAR_PORT}"
# Caddy: LAN HTTPS 단일 origin(:${CADDY_PORT}). /api·/auth·/cable→rails, 그 외→vite.
# 다른 PC/폰 브라우저는 https://<LAN_IP>:${CADDY_PORT} 한 곳만 접속(같은 origin이라 CORS·IP입력 불필요).
# 웹 프론트는 설계상 window.location.origin 기준 same-origin 호출이므로 반드시 Caddy 경유해야 동작.
CADDY_CMD="caddy run --config '$CADDY_LOCAL' --adapter caddyfile"

require_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "[error] tmux가 설치되어 있지 않습니다. 'brew install tmux' 후 다시 시도하세요." >&2
    exit 1
  fi
}

session_exists() {
  tmux has-session -t "$SESSION" 2>/dev/null
}

ensure_db() {
  local db="$PROJECT_ROOT/backend/storage/development.sqlite3"
  if [ ! -f "$db" ]; then
    echo "[info] DB 없음 → 생성 (bin/rails db:prepare)"
    ( cd "$PROJECT_ROOT/backend" && bin/rails db:prepare )
    return
  fi
  # DB 존재 → 밀린 마이그레이션 확인. 있으면 백업 후 migrate (이 레포는 마이그가 데이터 전멸시킨 전적 있어 백업 필수).
  if ( cd "$PROJECT_ROOT/backend" && bin/rails db:abort_if_pending_migrations ) >/dev/null 2>&1; then
    echo "[info] DB 최신 → migrate 건너뜀"
  else
    local bak="${db}.bak.$(date +%Y%m%d_%H%M%S)"
    echo "[warn] 밀린 마이그레이션 감지 → 백업($bak) 후 migrate"
    cp "$db" "$bak"
    local before_m="?" before_t="?" before_s="?"
    if command -v sqlite3 >/dev/null 2>&1; then
      before_m=$(sqlite3 "$db" "SELECT COUNT(*) FROM meetings" 2>/dev/null || echo "?")
      before_t=$(sqlite3 "$db" "SELECT COUNT(*) FROM transcripts" 2>/dev/null || echo "?")
      before_s=$(sqlite3 "$db" "SELECT COUNT(*) FROM summaries" 2>/dev/null || echo "?")
    fi
    ( cd "$PROJECT_ROOT/backend" && bin/rails db:migrate )
    if command -v sqlite3 >/dev/null 2>&1; then
      local after_m after_t after_s
      after_m=$(sqlite3 "$db" "SELECT COUNT(*) FROM meetings" 2>/dev/null || echo "?")
      after_t=$(sqlite3 "$db" "SELECT COUNT(*) FROM transcripts" 2>/dev/null || echo "?")
      after_s=$(sqlite3 "$db" "SELECT COUNT(*) FROM summaries" 2>/dev/null || echo "?")
      echo "[info] migrate 전/후 — meetings ${before_m}→${after_m}, transcripts ${before_t}→${after_t}, summaries ${before_s}→${after_s}"
      local dropped=0
      if [ "$before_m" != "?" ] && [ "$after_m" != "?" ] && [ "$after_m" -lt "$before_m" ]; then dropped=1; fi
      if [ "$before_t" != "?" ] && [ "$after_t" != "?" ] && [ "$after_t" -lt "$before_t" ]; then dropped=1; fi
      if [ "$before_s" != "?" ] && [ "$after_s" != "?" ] && [ "$after_s" -lt "$before_s" ]; then dropped=1; fi
      if [ "$dropped" -eq 1 ]; then
        echo "[DANGER] ⚠️ 마이그레이션 후 데이터 감소 감지! 즉시 확인 요망."
        echo "[DANGER]   복구: cp \"$bak\" \"$db\""
        echo "[DANGER]   그 후 해당 마이그레이션 검토 후 재실행할 것."
      fi
    fi
  fi
}

# 현재 LAN IP에 맞춰 LAN HTTPS 인증서 + Caddy 설정(Caddyfile.local)을 매 기동 시 자동 동기화.
# 네트워크를 옮겨도 수동 편집 없이 폰/다른 PC에서 https://<현재 IP>:13443 접속이 유지된다.
ensure_lan_tls() {
  if [ -z "$LAN_IP" ]; then
    echo "[warn] LAN IP 미감지 → localhost 전용(외부/폰 접속 불가)"
    cp "$PROJECT_ROOT/Caddyfile" "$CADDY_LOCAL"
    return
  fi

  local localhost_name
  localhost_name="$(scutil --get LocalHostName 2>/dev/null || true)"
  if [ -n "$localhost_name" ]; then localhost_name="${localhost_name}.local"; fi

  local have_ip=""
  if [ -f "$LAN_CERT" ]; then
    have_ip="$(openssl x509 -in "$LAN_CERT" -noout -text 2>/dev/null | grep -oE 'IP Address:[0-9.]+' | grep -Fx "IP Address:${LAN_IP}" || true)"
  fi

  if [ -z "$have_ip" ]; then
    if command -v mkcert >/dev/null 2>&1; then
      echo "[info] LAN 인증서 재발급(mkcert) → ${LAN_IP}${localhost_name:+, ${localhost_name}}"
      if mkcert -cert-file "$LAN_CERT" -key-file "$LAN_KEY" localhost 127.0.0.1 "$LAN_IP" ${localhost_name:+"$localhost_name"} >/dev/null 2>&1; then
        :
      else
        echo "[warn] mkcert 발급 실패 → 기존 인증서로 진행(웹 HTTPS 깨질 수 있음)"
      fi
    else
      echo "[warn] mkcert 미설치 → 인증서 자동발급 불가. 'brew install mkcert && mkcert -install' 후 재실행 권장."
    fi
  fi

  local cert_use="$LAN_CERT" key_use="$LAN_KEY"
  if [ ! -f "$LAN_CERT" ]; then cert_use="$PROJECT_ROOT/certs/localhost+3.pem"; key_use="$PROJECT_ROOT/certs/localhost+3-key.pem"; fi

  awk -v port="$CADDY_PORT" -v ip="$LAN_IP" -v host="$localhost_name" -v cert="$cert_use" -v key="$key_use" '
    /^https:\/\// && /\{[[:space:]]*$/ && !site {
      line = "https://localhost:" port ", https://127.0.0.1:" port ", https://[::1]:" port ", https://" ip ":" port
      if (host != "") line = line ", https://" host ":" port
      print line " {"; site=1; inblk=1; next
    }
    inblk && $1=="tls" && !tls { print "\ttls " cert " " key; tls=1; next }
    { print }
  ' "$PROJECT_ROOT/Caddyfile" > "$CADDY_LOCAL"
}

start_backend() {
  require_tmux
  ensure_db
  ensure_lan_tls
  if session_exists; then
    echo "[info] tmux 세션 '$SESSION'이 이미 실행 중입니다. (재사용)"
    return
  fi

  echo "[info] tmux 세션 '$SESSION' 생성"
  tmux new-session -d -s "$SESSION" -n rails -c "$PROJECT_ROOT/backend"
  tmux send-keys -t "$SESSION:rails" "$RAILS_CMD" Enter

  tmux new-window -t "$SESSION" -n sidecar -c "$PROJECT_ROOT/sidecar"
  tmux send-keys -t "$SESSION:sidecar" "$SIDECAR_CMD" Enter

  if [ "$CADDY_PRIV" = "1" ]; then
    # 443 등 1024 미만 포트는 root 필요 → caddy만 sudo 백그라운드로 기동(로그: .caddy.log).
    # sudo -v를 현재 터미널에서 먼저 받아 캐시 → 이어지는 sudo가 재프롬프트 없이 실행된다.
    caddy stop >/dev/null 2>&1 || true   # 잔여 caddy 정리(포트 중복 바인딩 방지)
    echo "[info] caddy가 :${CADDY_PORT} 바인딩에 관리자 권한 필요 — sudo 인증"
    if ! sudo -v; then
      echo "[error] sudo 인증 실패 → caddy 미기동. rails/sidecar는 실행 중." >&2
    else
      sudo nohup caddy run --config "$CADDY_LOCAL" --adapter caddyfile \
        > "$PROJECT_ROOT/.caddy.log" 2>&1 &
      echo "[info] caddy(sudo) 백그라운드 기동 → 로그: tail -f $PROJECT_ROOT/.caddy.log"
    fi
  else
    tmux new-window -t "$SESSION" -n caddy -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION:caddy" "$CADDY_CMD" Enter
  fi

  echo "[info]   - rails   : http://localhost:${RAILS_PORT}"
  echo "[info]   - sidecar : http://localhost:${SIDECAR_PORT}"
  echo "[info]   - caddy   : https://localhost${PORT_SFX}  (LAN 웹 단일 진입점)"
  if [ -n "$LAN_IP" ]; then
    echo "[info]   - LAN 웹  : https://${LAN_IP}${PORT_SFX}  (다른 PC/폰 브라우저, 같은 origin → 서버주소 입력·CORS 불필요)"
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
    # 백그라운드 caddy(sudo/443)도 종료 (admin API, sudo 불필요)
    if caddy stop >/dev/null 2>&1; then echo "[info] caddy 종료 완료."; fi
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
