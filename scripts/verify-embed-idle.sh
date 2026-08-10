#!/usr/bin/env bash
# ============================================================================
# verify-embed-idle.sh
#
# sidecar(포트 13324)의 KURE 임베딩 인코더 유휴 언로드(GPU -> CPU -> 완전 해제)가
# 배포 후 실제로 동작하는지 실측 검증한다.
#
# 전제조건(스크립트 실행 전에 사람이 해둬야 함):
#   - settings.yaml의 stt.idle_unload_sec: 30, stt.idle_full_unload_sec: 60 으로
#     설정하고 sidecar(ddobak-stt)를 재시작해 반영한 상태
#   - 백그라운드 점검 루프 주기는 app/main.py의 _IDLE_OFFLOAD_INTERVAL_SEC=60(초)로
#     코드에 하드코딩돼 있다. 따라서 TTL이 30/60초여도 실제 1단계(gpu->cpu) 발동은
#     다음 점검 틱에서야 일어나고, 점검 틱과 마지막 사용 시각의 위상차 때문에
#     최악의 경우 1단계가 최대 약 90초, 2단계(cpu->unloaded)가 최대 약 150초까지
#     걸릴 수 있다. 이 스크립트의 대기 타임아웃은 그 여유를 감안해 넉넉히 잡는다.
#
# 사용법:
#   ./scripts/verify-embed-idle.sh
#
# 종료 코드: 0=모든 검증 통과, 1=하나 이상 검증 실패(또는 사전 조건 미충족)
# ============================================================================
set -u
set -o pipefail

# ── 설정값 ──────────────────────────────────────────────────────────────
BASE_URL="http://localhost:13324"
HEALTH_URL="${BASE_URL}/health"
EMBED_URL="${BASE_URL}/embed"

POLL_INTERVAL_SEC=5      # 상태 폴링 간격
STAGE1_MAX_WAIT_SEC=150  # 1단계(gpu->cpu) 최대 대기 (점검주기 60s * 2 + 여유)
STAGE2_MAX_WAIT_SEC=150  # 2단계(cpu->unloaded) 최대 대기 (1단계 확인 시점부터)

SERVICE_NAME="ddobak-stt"                                              # systemd 유닛명
PWSH="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"   # WSL에서 Windows 성능카운터 조회용
PWSH_TIMEOUT_SEC=15

# ── 전역 상태 ────────────────────────────────────────────────────────────
OVERALL_FAIL=0
CHECKS=()          # 검증 결과 로그 (표시용)
SNAP_LABELS=()      # 스냅샷 기록 순서
declare -A SNAP_TS
declare -A SNAP_STATE
declare -A SNAP_GPU_TOTAL_MIB   # nvidia-smi 전체 GPU 사용량(MiB)
declare -A SNAP_GPU_VMWP_MB     # WSL vmwp 프로세스의 GPU 전용 메모리(MB, Windows 카운터 기준)
declare -A SNAP_RSS_KB          # 사이드카 프로세스 RSS(KiB)
declare -A SNAP_DESC            # 라벨 -> 한국어 설명

VMWP_PID=""

# ── 유틸 ────────────────────────────────────────────────────────────────
log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail_exit() {
    log "[치명적 오류] $*"
    exit 1
}

is_number() {
    [[ "$1" =~ ^-?[0-9]+([.][0-9]+)?$ ]]
}

kb_to_mb() {
    local kb="$1"
    if ! is_number "$kb"; then
        echo "N/A"
        return
    fi
    awk -v k="$kb" 'BEGIN{printf "%.1f", k/1024}'
}

delta_str() {
    # $1 - $2 (둘 다 숫자일 때만 계산, 아니면 N/A)
    local a="$1" b="$2"
    if is_number "$a" && is_number "$b"; then
        awk -v a="$a" -v b="$b" 'BEGIN{printf "%+.1f", a-b}'
    else
        echo "N/A"
    fi
}

# ── 사전 점검: 필수 도구 ──────────────────────────────────────────────────
check_dependencies() {
    local missing=()
    for cmd in curl jq awk date ps systemctl timeout; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing+=("$cmd")
        fi
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        fail_exit "필수 명령어 누락: ${missing[*]} — 설치 후 다시 실행하세요."
    fi
    if ! command -v nvidia-smi >/dev/null 2>&1; then
        log "[경고] nvidia-smi 없음 — GPU 전체 사용량 관측은 N/A로 표기됩니다."
    fi
    if [ ! -x "$PWSH" ]; then
        log "[경고] Windows PowerShell($PWSH) 접근 불가 — WSL vmwp GPU 관측은 N/A로 표기됩니다."
    fi
}

# ── 관측 함수들 ────────────────────────────────────────────────────────────
get_health_json() {
    # 성공 시 stdout에 JSON, 실패 시 빈 문자열 + 종료코드 1
    curl -s --max-time 5 "$HEALTH_URL" 2>/dev/null
}

get_embed_state_from_json() {
    local json="$1"
    if [ -z "$json" ]; then
        echo "unknown(연결실패)"
        return
    fi
    echo "$json" | jq -r '.embed_state // "unknown"' 2>/dev/null || echo "unknown(파싱실패)"
}

get_gpu_total_mib() {
    if ! command -v nvidia-smi >/dev/null 2>&1; then
        echo "N/A"
        return
    fi
    local v
    v=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d '[:space:]')
    if [ -z "$v" ]; then
        echo "N/A"
    else
        echo "$v"
    fi
}

get_vmwp_pid() {
    if [ ! -x "$PWSH" ]; then
        echo ""
        return
    fi
    timeout "$PWSH_TIMEOUT_SEC" "$PWSH" -NoProfile -Command "(Get-Process vmwp -ErrorAction SilentlyContinue).Id" 2>/dev/null \
        | tr -d '\r' | grep -E '^[0-9]+$' | head -n1
}

get_vmwp_gpu_mb() {
    # WSL 전체를 대표하는 vmwp 프로세스의 GPU 전용 메모리(Dedicated Usage, bytes -> MB)
    if [ ! -x "$PWSH" ] || [ -z "$VMWP_PID" ]; then
        echo "N/A"
        return
    fi
    local bytes
    bytes=$(timeout "$PWSH_TIMEOUT_SEC" "$PWSH" -NoProfile -Command \
        "(Get-Counter '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction SilentlyContinue).CounterSamples | Where-Object {\$_.InstanceName -like '*${VMWP_PID}*'} | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum" \
        2>/dev/null | tr -d '\r' | tail -n1)
    if ! is_number "$bytes"; then
        echo "N/A"
        return
    fi
    awk -v b="$bytes" 'BEGIN{printf "%.1f", b/1024/1024}'
}

get_sidecar_rss_kb() {
    local pid
    pid=$(systemctl show "$SERVICE_NAME" -p ExecMainPID --value 2>/dev/null | tr -d '[:space:]')
    if [ -z "$pid" ] || [ "$pid" = "0" ]; then
        echo "N/A"
        return
    fi
    local rss
    rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d '[:space:]')
    if [ -z "$rss" ]; then
        echo "N/A"
    else
        echo "$rss"
    fi
}

# ── 스냅샷 기록 ────────────────────────────────────────────────────────────
record_snapshot() {
    local label="$1" desc="$2"
    local ts json state gpu_total gpu_vmwp rss_kb

    ts="$(date '+%H:%M:%S')"
    json="$(get_health_json)"
    state="$(get_embed_state_from_json "$json")"
    gpu_total="$(get_gpu_total_mib)"
    gpu_vmwp="$(get_vmwp_gpu_mb)"
    rss_kb="$(get_sidecar_rss_kb)"

    SNAP_LABELS+=("$label")
    SNAP_DESC["$label"]="$desc"
    SNAP_TS["$label"]="$ts"
    SNAP_STATE["$label"]="$state"
    SNAP_GPU_TOTAL_MIB["$label"]="$gpu_total"
    SNAP_GPU_VMWP_MB["$label"]="$gpu_vmwp"
    SNAP_RSS_KB["$label"]="$rss_kb"

    log "[스냅샷:${desc}] embed_state=${state} GPU전체=${gpu_total}MiB WSL-GPU=${gpu_vmwp}MB RSS=$(kb_to_mb "$rss_kb")MB"
}

# ── 검증 헬퍼 ────────────────────────────────────────────────────────────
check_state() {
    local label="$1" expected="$2" desc="$3"
    local actual="${SNAP_STATE[$label]:-unknown}"
    if [ "$actual" = "$expected" ]; then
        log "[검증 OK] ${desc} — embed_state=${actual} (기대값 ${expected})"
        CHECKS+=("OK   | ${desc} | 실제=${actual} 기대=${expected}")
    else
        log "[검증 실패] ${desc} — embed_state=${actual} (기대값 ${expected})"
        CHECKS+=("FAIL | ${desc} | 실제=${actual} 기대=${expected}")
        OVERALL_FAIL=1
    fi
}

# 목표 상태에 도달할 때까지 폴링. 도달 시 0, 타임아웃 시 1 반환 (스크립트를 죽이지 않음)
wait_for_state() {
    local target="$1" max_wait="$2" desc="$3"
    local start_ts now elapsed json state

    start_ts=$(date +%s)
    log "[대기 시작] ${desc} — embed_state=='${target}' 대기 (최대 ${max_wait}초, ${POLL_INTERVAL_SEC}초 간격 폴링)"

    while true; do
        now=$(date +%s)
        elapsed=$((now - start_ts))
        if [ "$elapsed" -ge "$max_wait" ]; then
            log "[대기 타임아웃] ${desc} — ${max_wait}초 경과했지만 embed_state='${target}' 미도달"
            return 1
        fi

        json="$(get_health_json)"
        if [ -n "$json" ]; then
            state="$(get_embed_state_from_json "$json")"
            log "  ... ${elapsed}s 경과, 현재 embed_state=${state}"
            if [ "$state" = "$target" ]; then
                log "[대기 완료] ${desc} — ${elapsed}초만에 embed_state='${target}' 도달"
                return 0
            fi
        else
            log "  ... ${elapsed}s 경과, /health 응답 없음 (재시도)"
        fi
        sleep "$POLL_INTERVAL_SEC"
    done
}

# /embed 호출. 성공 시 LAST_EMBED_HTTP_CODE/LAST_EMBED_BODY 전역에 결과 저장.
LAST_EMBED_HTTP_CODE=""
LAST_EMBED_BODY=""
call_embed() {
    local tmp
    tmp="$(mktemp)"
    LAST_EMBED_HTTP_CODE=$(curl -s -o "$tmp" -w '%{http_code}' --max-time 30 \
        -X POST "$EMBED_URL" \
        -H 'Content-Type: application/json' \
        -d '{"texts":["또박또박 유휴 언로드 검증용 테스트 문장"]}' 2>/dev/null || echo "000")
    LAST_EMBED_BODY="$(cat "$tmp" 2>/dev/null)"
    rm -f "$tmp"
}

# ============================================================================
# 메인 흐름
# ============================================================================
main() {
    log "===== KURE 임베딩 유휴 언로드 실측 검증 시작 ====="
    check_dependencies

    VMWP_PID="$(get_vmwp_pid)"
    if [ -n "$VMWP_PID" ]; then
        log "[정보] WSL vmwp PID=${VMWP_PID} (Windows GPU 카운터 조회에 사용)"
    else
        log "[정보] vmwp PID를 찾지 못함 — WSL 전체 GPU 관측 없이 진행"
    fi

    # 1) /health 응답 확인 -----------------------------------------------
    log "[1/7] /health 응답 확인"
    local initial_health
    initial_health="$(get_health_json)"
    if [ -z "$initial_health" ]; then
        fail_exit "${HEALTH_URL} 에 연결할 수 없습니다. sidecar(ddobak-stt)가 떠 있는지, 포트 13324가 맞는지 확인하세요."
    fi
    log "  /health 응답 OK: $(echo "$initial_health" | jq -c '.')"

    # 2) 기준선 기록 --------------------------------------------------------
    log "[2/7] 기준선(baseline) 기록"
    record_snapshot "baseline" "기준선"

    # 3) /embed 실호출로 벡터 반환 확인 --------------------------------------
    log "[3/7] POST /embed 호출 — 임베딩 벡터 반환 확인"
    call_embed
    if [ "$LAST_EMBED_HTTP_CODE" != "200" ]; then
        fail_exit "POST /embed 실패 — HTTP ${LAST_EMBED_HTTP_CODE}, body: ${LAST_EMBED_BODY}"
    fi
    if ! echo "$LAST_EMBED_BODY" | jq -e . >/dev/null 2>&1; then
        fail_exit "POST /embed 응답이 유효한 JSON이 아닙니다: ${LAST_EMBED_BODY}"
    fi
    local emb_len emb_dim
    emb_len=$(echo "$LAST_EMBED_BODY" | jq -r '(.embeddings // []) | length')
    emb_dim=$(echo "$LAST_EMBED_BODY" | jq -r '.dim // 0')
    if ! is_number "$emb_len" || [ "$(echo "$emb_len" | cut -d. -f1)" -le 0 ] 2>/dev/null; then
        fail_exit "POST /embed 응답의 embeddings 배열이 비어 있습니다 (len=${emb_len}). body: ${LAST_EMBED_BODY}"
    fi
    if ! is_number "$emb_dim" || [ "$(echo "$emb_dim" | cut -d. -f1)" -le 0 ] 2>/dev/null; then
        fail_exit "POST /embed 응답의 dim이 0 이하입니다 (dim=${emb_dim}). body: ${LAST_EMBED_BODY}"
    fi
    log "  /embed 호출 성공 — embeddings 길이=${emb_len}, dim=${emb_dim}"

    # 4) 호출 직후 상태 기록 — gpu 여야 함 -----------------------------------
    log "[4/7] 호출 직후 상태 기록 (embed_state=='gpu' 기대)"
    record_snapshot "after_call" "임베딩 호출 직후"
    check_state "after_call" "gpu" "임베딩 호출 직후 GPU 상주 확인"

    # 5) 1단계 대기 — cpu 여야 함 --------------------------------------------
    log "[5/7] 1단계(gpu->cpu) 대기"
    wait_for_state "cpu" "$STAGE1_MAX_WAIT_SEC" "1단계(gpu->cpu) 오프로드" || true
    record_snapshot "stage1" "1단계 대기 후"
    check_state "stage1" "cpu" "1단계 오프로드(GPU->CPU) 확인"

    # 6) 2단계 대기 — unloaded 여야 함 ---------------------------------------
    log "[6/7] 2단계(cpu->unloaded) 대기"
    wait_for_state "unloaded" "$STAGE2_MAX_WAIT_SEC" "2단계(cpu->unloaded) 완전 해제" || true
    record_snapshot "stage2" "2단계 대기 후"
    check_state "stage2" "unloaded" "2단계 완전 해제(CPU->UNLOADED) 확인"

    # 7) 재로드 확인 --------------------------------------------------------
    log "[7/7] 재로드 확인 — POST /embed 재호출"
    call_embed
    if [ "$LAST_EMBED_HTTP_CODE" != "200" ]; then
        log "[검증 실패] 재로드 후 /embed 재호출 실패 — HTTP ${LAST_EMBED_HTTP_CODE}, body: ${LAST_EMBED_BODY}"
        CHECKS+=("FAIL | 재로드 후 /embed 재호출 | HTTP=${LAST_EMBED_HTTP_CODE}")
        OVERALL_FAIL=1
    else
        local reload_len
        reload_len=$(echo "$LAST_EMBED_BODY" | jq -r '(.embeddings // []) | length' 2>/dev/null || echo 0)
        if is_number "$reload_len" && [ "$(echo "$reload_len" | cut -d. -f1)" -gt 0 ] 2>/dev/null; then
            log "[검증 OK] 재로드 후 /embed 재호출 — 벡터 정상 반환 (len=${reload_len})"
            CHECKS+=("OK   | 재로드 후 /embed 재호출 | len=${reload_len}")
        else
            log "[검증 실패] 재로드 후 /embed 재호출 — 벡터가 비어 있음: ${LAST_EMBED_BODY}"
            CHECKS+=("FAIL | 재로드 후 /embed 재호출 | 벡터 비어있음")
            OVERALL_FAIL=1
        fi
    fi
    record_snapshot "reload" "재로드 확인 후"
    check_state "reload" "gpu" "재로드 후 GPU 상주 확인"

    # ── 요약 출력 ────────────────────────────────────────────────────────
    print_summary
}

print_summary() {
    echo
    log "===== 검증 결과 요약 ====="
    echo
    printf '%-6s | %-40s\n' "결과" "항목"
    printf -- '-------+------------------------------------------\n'
    local c
    for c in "${CHECKS[@]}"; do
        echo "$c"
    done
    echo

    log "===== 단계별 스냅샷 표 (기준선 대비 증감 포함) ====="
    echo
    printf '%-8s | %-22s | %-10s | %-12s | %-14s | %-10s | %-10s\n' \
        "시각" "단계" "embed_state" "GPU전체(MiB)" "WSL-GPU(MB)" "RSS(MB)" "RSS증감(MB)"
    printf -- '---------+------------------------+------------+--------------+----------------+------------+------------\n'

    local baseline_rss_kb="${SNAP_RSS_KB[baseline]:-N/A}"
    local baseline_rss_mb
    baseline_rss_mb="$(kb_to_mb "$baseline_rss_kb")"

    local label
    for label in "${SNAP_LABELS[@]}"; do
        local desc="${SNAP_DESC[$label]:-$label}"
        local state="${SNAP_STATE[$label]:-N/A}"
        local gpu_total="${SNAP_GPU_TOTAL_MIB[$label]:-N/A}"
        local gpu_vmwp="${SNAP_GPU_VMWP_MB[$label]:-N/A}"
        local rss_kb="${SNAP_RSS_KB[$label]:-N/A}"
        local rss_mb
        rss_mb="$(kb_to_mb "$rss_kb")"
        local rss_delta
        rss_delta="$(delta_str "$rss_mb" "$baseline_rss_mb")"

        printf '%-8s | %-22s | %-10s | %-12s | %-14s | %-10s | %-10s\n' \
            "${SNAP_TS[$label]:-?}" "$desc" "$state" "$gpu_total" "$gpu_vmwp" "$rss_mb" "$rss_delta"
    done
    echo

    if [ "$OVERALL_FAIL" -ne 0 ]; then
        log "===== 최종 결과: 실패(FAIL) — 위 표에서 FAIL 항목을 확인하세요 ====="
        exit 1
    else
        log "===== 최종 결과: 통과(PASS) — 유휴 언로드 2단계가 예상대로 동작함 ====="
        exit 0
    fi
}

main "$@"
