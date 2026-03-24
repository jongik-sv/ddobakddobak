#!/usr/bin/env bash
# TSK-00-05: Procfile 및 개발 환경 설정 - 인프라 검증 테스트
# TDD Red-Green 방식: acceptance criteria 기반 파일 존재/내용 검증

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

pass() { ((PASS++)); echo "  PASS: $1"; }
fail() { ((FAIL++)); echo "  FAIL: $1"; }

echo "=== TSK-00-05 Infrastructure Tests ==="
echo ""

# ─── 1. Procfile 존재 및 내용 검증 ───
echo "[Procfile]"

if [[ -f "$PROJECT_ROOT/Procfile" ]]; then
  pass "Procfile exists"
else
  fail "Procfile does not exist"
fi

# rails 프로세스 (포트 3000)
if grep -qE '^rails:.*3000' "$PROJECT_ROOT/Procfile" 2>/dev/null; then
  pass "Procfile defines rails on port 3000"
else
  fail "Procfile missing rails process on port 3000"
fi

# sidecar 프로세스 (포트 8000)
if grep -qE '^sidecar:.*8000' "$PROJECT_ROOT/Procfile" 2>/dev/null; then
  pass "Procfile defines sidecar on port 8000"
else
  fail "Procfile missing sidecar process on port 8000"
fi

# frontend 프로세스 (포트 5173)
if grep -qE '^frontend:.*5173' "$PROJECT_ROOT/Procfile" 2>/dev/null; then
  pass "Procfile defines frontend on port 5173"
else
  fail "Procfile missing frontend process on port 5173"
fi

# 프로세스가 정확히 3개
if [[ -f "$PROJECT_ROOT/Procfile" ]]; then
  PROC_COUNT=$(grep -cE '^[a-z]+:' "$PROJECT_ROOT/Procfile" 2>/dev/null || echo 0)
  if [[ "$PROC_COUNT" -eq 3 ]]; then
    pass "Procfile has exactly 3 processes"
  else
    fail "Procfile has $PROC_COUNT processes (expected 3)"
  fi
else
  fail "Procfile has 0 processes (expected 3)"
fi

echo ""

# ─── 2. .env.example 환경 변수 검증 ───
echo "[.env.example]"

if [[ -f "$PROJECT_ROOT/.env.example" ]]; then
  pass ".env.example exists"
else
  fail ".env.example does not exist"
fi

REQUIRED_VARS=(
  STT_ENGINE
  ANTHROPIC_AUTH_TOKEN
  ANTHROPIC_BASE_URL
  RAILS_ENV
  SECRET_KEY_BASE
  SIDECAR_HOST
  SIDECAR_PORT
  HF_TOKEN
)

for var in "${REQUIRED_VARS[@]}"; do
  if grep -qE "^${var}=" "$PROJECT_ROOT/.env.example" 2>/dev/null; then
    pass ".env.example contains $var"
  else
    fail ".env.example missing $var"
  fi
done

echo ""

# ─── 3. .gitignore 검증 ───
echo "[.gitignore]"

if [[ -f "$PROJECT_ROOT/.gitignore" ]]; then
  pass ".gitignore exists"
else
  fail ".gitignore does not exist"
fi

# 필수 제외 패턴 검증
REQUIRED_PATTERNS=(
  ".env"
  ".DS_Store"
  "__pycache__"
  "node_modules"
  "*.pyc"
  "*.bin"
  "*.gguf"
  "*.safetensors"
)

for pattern in "${REQUIRED_PATTERNS[@]}"; do
  if grep -qF "$pattern" "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
    pass ".gitignore contains $pattern"
  else
    fail ".gitignore missing $pattern"
  fi
done

echo ""

# ─── 결과 요약 ───
echo "=== Results: $PASS passed, $FAIL failed ==="

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
else
  exit 0
fi
