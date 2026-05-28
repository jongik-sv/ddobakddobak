#!/usr/bin/env bash
# 또박또박 "앱(production) 서버 환경" 재현 스크립트
#   - Tauri 앱(lib.rs start_services)과 동일하게 app_data의 복사된 소스를
#     production 모드로 tmux 세션(ddobak-app)에 띄운다.
#   - dev.sh(개발 모드)와 별개. 프론트엔드는 띄우지 않는다(서버 전용).
#
# 사용법:
#   ./app-server.sh            # 서버 기동 (= up)
#   ./app-server.sh up         # 서버 기동
#   ./app-server.sh up --sync  # 프로젝트 소스를 app_data로 복사·의존성 재설치 후 기동
#   ./app-server.sh attach     # tmux 세션에 attach
#   ./app-server.sh status     # 포트/헬스 확인
#   ./app-server.sh down       # tmux 세션 종료

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION="ddobak-app"

# 앱(lib.rs start_services)과 동일한 경로/포트. 필요 시 env로 override.
APP_DATA_DIR="${APP_DATA_DIR:-$HOME/Library/Application Support/com.ddobakddobak.app}"
RAILS_PORT="${RAILS_PORT:-13323}"
SIDECAR_PORT="${SIDECAR_PORT:-13324}"
RAILS_BIND="${RAILS_BIND:-0.0.0.0}"
SIDECAR_BIND="${SIDECAR_BIND:-127.0.0.1}"

BACKEND_DIR="$APP_DATA_DIR/backend"
SIDECAR_DIR="$APP_DATA_DIR/sidecar"
DB_PATH="$APP_DATA_DIR/db/production.sqlite3"
AUDIO_DIR="$APP_DATA_DIR/audio"
MODELS_DIR="$APP_DATA_DIR/models"
SPEAKER_DBS_DIR="$APP_DATA_DIR/speaker_dbs"

require_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "[error] tmux가 설치되어 있지 않습니다. 'brew install tmux' 후 다시 시도하세요." >&2
    exit 1
  fi
}

session_exists() {
  tmux has-session -t "$SESSION" 2>/dev/null
}

require_setup() {
  if [[ ! -f "$DB_PATH" || ! -f "$BACKEND_DIR/Gemfile" ]]; then
    echo "[error] 앱 데이터가 준비되지 않았습니다: $APP_DATA_DIR" >&2
    echo "[error] 또박또박 앱을 한 번 실행해 초기 셋업(SetupGate)을 완료한 뒤 다시 시도하세요." >&2
    exit 1
  fi
}

# 프로젝트 소스를 app_data로 복사하고 의존성을 재설치한다(--sync).
sync_sources() {
  echo "[info] --sync: 프로젝트 소스를 app_data로 복사합니다."
  echo "[info]   src: $PROJECT_ROOT"
  echo "[info]   dst: $APP_DATA_DIR"
  mkdir -p "$BACKEND_DIR" "$SIDECAR_DIR"

  local excludes=(
    --exclude 'tmp/' --exclude 'log/' --exclude 'storage/'
    --exclude '.venv/' --exclude 'node_modules/' --exclude '.git/'
    --exclude '*.sqlite3' --exclude '*.sqlite3-*'
  )
  # 삭제 없이 덮어쓰기(앱이 설치한 .bundle / .venv 등은 유지)
  rsync -a "${excludes[@]}" "$PROJECT_ROOT/backend/" "$BACKEND_DIR/"
  rsync -a "${excludes[@]}" "$PROJECT_ROOT/sidecar/" "$SIDECAR_DIR/"
  if [[ -f "$PROJECT_ROOT/config.yaml" ]]; then
    cp "$PROJECT_ROOT/config.yaml" "$APP_DATA_DIR/config.yaml"
  fi

  echo "[info] bundle install (production)"
  ( cd "$BACKEND_DIR" && bundle install )
  echo "[info] uv sync --extra=macos"
  ( cd "$SIDECAR_DIR" && uv run true >/dev/null 2>&1 || true; uv sync --extra=macos )
}

start_backend() {
  require_tmux
  require_setup

  if session_exists; then
    echo "[info] tmux 세션 '$SESSION'이 이미 실행 중입니다. (재사용)"
    return
  fi

  # 다른 프로세스(앱/ dev.sh)가 이미 포트를 점유 중이면 충돌하므로 중단
  if nc -z 127.0.0.1 "$RAILS_PORT" 2>/dev/null || nc -z 127.0.0.1 "$SIDECAR_PORT" 2>/dev/null; then
    echo "[error] 포트 $RAILS_PORT/$SIDECAR_PORT 중 일부가 이미 사용 중입니다 (앱 또는 dev.sh 실행 중?)." >&2
    echo "[error] 기존 서버를 종료한 뒤 다시 시도하세요. (앱 종료 또는 './dev.sh down')" >&2
    exit 1
  fi

  local rails_cmd sidecar_cmd
  rails_cmd="SERVER_MODE=true RAILS_ENV=production DB_PATH=\"$DB_PATH\" AUDIO_DIR=\"$AUDIO_DIR\" RAILS_LOG_TO_STDOUT=1 SOLID_QUEUE_IN_PUMA=1 bin/rails server -p $RAILS_PORT -b $RAILS_BIND"
  sidecar_cmd="MODELS_DIR=\"$MODELS_DIR\" SPEAKER_DBS_DIR=\"$SPEAKER_DBS_DIR\" uv run uvicorn app.main:app --host $SIDECAR_BIND --port $SIDECAR_PORT"

  echo "[info] tmux 세션 '$SESSION' 생성 (production / app_data)"
  tmux new-session -d -s "$SESSION" -n rails -c "$BACKEND_DIR"
  tmux send-keys -t "$SESSION:rails" "$rails_cmd" Enter

  tmux new-window -t "$SESSION" -n sidecar -c "$SIDECAR_DIR"
  tmux send-keys -t "$SESSION:sidecar" "$sidecar_cmd" Enter

  echo "[info]   - rails   : http://$RAILS_BIND:$RAILS_PORT (RAILS_ENV=production, DB=$DB_PATH)"
  echo "[info]   - sidecar : http://$SIDECAR_BIND:$SIDECAR_PORT"
  echo "[info] 로그 확인: ./app-server.sh attach  (Ctrl+b n / p 로 윈도우 이동)"
}

check_port() {
  local port="$1" name="$2" health="$3"
  if curl -fsS -m 2 "http://127.0.0.1:$port$health" >/dev/null 2>&1; then
    echo "[ok]   $name (:$port) — health 200"
  elif nc -z 127.0.0.1 "$port" 2>/dev/null; then
    echo "[warn] $name (:$port) — 포트 열림(health 미응답)"
  else
    echo "[down] $name (:$port) — 응답 없음"
  fi
}

# 인자 파싱: 첫 비플래그 = 서브커맨드, --sync 플래그 별도 수집
CMD="up"
DO_SYNC=0
for arg in "$@"; do
  case "$arg" in
    --sync) DO_SYNC=1 ;;
    -h|--help|help) CMD="help" ;;
    up|attach|down|status) CMD="$arg" ;;
    *) echo "[error] 알 수 없는 인자: $arg" >&2
       echo "사용법: $0 [up|attach|down|status|help] [--sync]" >&2
       exit 1 ;;
  esac
done

case "$CMD" in
  up)
    if [[ "$DO_SYNC" == "1" ]]; then
      sync_sources
    fi
    start_backend
    ;;
  attach)
    require_tmux
    if ! session_exists; then
      echo "[error] tmux 세션 '$SESSION'이 실행 중이 아닙니다. 먼저 './app-server.sh up' 실행하세요." >&2
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
  status)
    check_port "$RAILS_PORT" "rails  " "/api/v1/health"
    check_port "$SIDECAR_PORT" "sidecar" "/health"
    ;;
  help)
    sed -n '2,13p' "$0"
    ;;
esac
