# 또박또박 (ddobakddobak)

> 회의 음성을 실시간으로 텍스트화하고, AI가 핵심 요약 · 결정사항 · Action Item을 자동으로 정리해주는 로컬 기반 회의 보조 앱

## 주요 기능

- **실시간 음성→텍스트 변환** — 브라우저 마이크로 녹음하면 즉시 기록 표시
- **화자 분리** — pyannote.audio로 발언자를 자동 구분 (선택적 활성화)
- **AI 회의록** — 설정 간격마다 중간 요약, 종료 시 최종 요약 자동 생성
- **블록 에디터** — Notion 스타일 편집, AI 요약을 직접 수정 가능
- **AI 피드백** — 회의록에 피드백을 입력하면 AI가 내용을 수정
- **오디오 파일 전사** — 녹음 파일(mp3, wav, m4a)을 업로드해서 회의록 생성
- **오디오 재생 + 기록 동기화** — 기록 클릭 시 해당 시점으로 이동
- **Mermaid 다이어그램** — AI 요약에 포함된 Mermaid 코드 자동 렌더링
- **Markdown 내보내기** — 회의록을 Markdown 파일로 저장
- **다국어 지원** — 한국어, English, 日本語, 中文 등 9개 언어

## 아키텍처

```
┌──────────────────────────────────────────┐
│            React SPA (Vite)              │
│   블록 에디터 │ 라이브 기록 │ AI 요약 패널  │
└──────────────────┬───────────────────────┘
                   │ WebSocket + REST
┌──────────────────┴───────────────────────┐
│          Ruby on Rails API               │
│   회의 관리 │ 인증 │ 내보내기 │ Solid Queue │
└─────────┬──────────────────┬─────────────┘
          │                  │
┌─────────┴────┐  ┌──────────┴─────────────┐
│   SQLite     │  │    Python Sidecar       │
│  (로컬 저장)  │  │  STT (Qwen3/Whisper)   │
│              │  │  화자 분리 (pyannote)    │
│              │  │  AI 요약 (LLM)          │
└──────────────┘  └────────────────────────┘
```

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, BlockNote |
| Backend | Ruby on Rails 8.1 (API mode), SQLite3, ActionCable, Solid Queue |
| Sidecar | Python 3.11+, FastAPI, mlx-audio, pywhispercpp, pyannote.audio |
| AI 요약 | Anthropic API 호환 (Claude, Z.ai GLM 등) |
| 실시간 통신 | WebSocket (ActionCable) |

## 사전 요구사항

- **Ruby** 3.4+ (`rbenv` 또는 `rvm` 권장)
- **Node.js** 20+ (npm 포함)
- **Python** 3.11+ (`uv` 패키지 매니저 필요)
- **Bundler** (`gem install bundler`)

### uv 설치 (Python 패키지 매니저)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## 설치 및 설정

### 1. 환경 변수

```bash
cp .env.example .env
```

`.env` 파일을 편집합니다:

```env
# STT 엔진 선택
STT_ENGINE="qwen3_asr_8bit"

# AI 요약 API (Anthropic API 호환 엔드포인트)
ANTHROPIC_AUTH_TOKEN="your_token_here"
ANTHROPIC_BASE_URL="https://api.anthropic.com"   # 또는 호환 API URL
LLM_MODEL="claude-sonnet-4-6"

# Rails 시크릿 키 (아래 명령으로 생성)
#   cd backend && bin/rails secret
SECRET_KEY_BASE="<generated_secret>"

# 화자 분리 사용 시 (선택)
HF_TOKEN="your_hf_token_here"
```

> **HF 토큰 없이도 STT는 정상 동작합니다.** 화자 분리(pyannote)만 HF 계정이 필요합니다. 설정에서 화자 분리를 끄면 HF 토큰 없이 사용 가능합니다.

### 2. Backend (Rails)

```bash
cd backend
bundle install
bin/rails db:create db:migrate
```

### 3. Frontend

```bash
cd frontend
npm install
```

### 4. Sidecar (Python)

```bash
cd sidecar
uv sync
```

## 실행

### 방법 A: 한 번에 실행 (foreman)

```bash
gem install foreman   # 최초 1회
foreman start
```

### 방법 B: 터미널 3개로 각각 실행

```bash
# 터미널 1 — Rails API (port 3000)
cd backend && bin/rails server -p 3000

# 터미널 2 — Python Sidecar (port 8000)
cd sidecar && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# 터미널 3 — React Frontend (port 5173)
cd frontend && npm run dev -- --port 5173
```

### 접속

| 서비스 | URL |
|--------|-----|
| 프론트엔드 | http://localhost:5173 |
| Rails API | http://localhost:3000/api/v1 |
| Sidecar API | http://localhost:8000 |
| 헬스 체크 | http://localhost:3000/api/v1/health |

## STT 엔진 선택

`.env`의 `STT_ENGINE` 값으로 음성 인식 엔진을 교체할 수 있습니다. Adapter 패턴으로 설계되어 환경 변수 변경만으로 전환됩니다.

| 값 | 모델 | HF 계정 | 특징 |
|----|------|---------|------|
| `qwen3_asr_8bit` | Qwen3-ASR 1.7B (8bit) | 불필요 | 기본값. Apple Silicon 최적화 (mlx-audio) |
| `qwen3_asr_6bit` | Qwen3-ASR 1.7B (6bit) | 불필요 | 메모리/정확도 균형 |
| `qwen3_asr_4bit` | Qwen3-ASR 1.7B (4bit) | 불필요 | 최소 메모리 |
| `whisper_cpp` | Whisper Large v3 Turbo | 불필요 | whisper.cpp, Metal/ANE 가속 |
| `mock` | 테스트용 더미 | 불필요 | 개발/테스트 시 사용 |

## 테스트

```bash
# Backend (RSpec)
cd backend && bundle exec rspec

# Frontend (Vitest)
cd frontend && npm run test

# E2E (Playwright) — 모든 서비스 실행 중 상태에서
cd e2e && npx playwright test
```

## 디렉터리 구조

```
.
├── backend/        # Rails API 서버
│   ├── app/
│   │   ├── channels/       # ActionCable (WebSocket)
│   │   ├── controllers/    # REST API 컨트롤러
│   │   ├── jobs/           # Solid Queue 비동기 작업
│   │   ├── models/         # ActiveRecord 모델
│   │   └── services/       # 비즈니스 로직
│   └── db/                 # SQLite 스키마 & 마이그레이션
├── frontend/       # React SPA
│   └── src/
│       ├── components/     # UI 컴포넌트
│       ├── hooks/          # 커스텀 React 훅
│       ├── pages/          # 페이지 컴포넌트
│       ├── stores/         # Zustand 상태 관리
│       └── api/            # API 클라이언트
├── sidecar/        # Python FastAPI
│   └── app/
│       ├── stt/            # STT 어댑터 (Qwen3, Whisper 등)
│       ├── diarization/    # 화자 분리
│       └── llm/            # AI 요약
├── e2e/            # Playwright E2E 테스트
├── docs/           # 기획/설계 문서 (PRD, TRD, WBS)
├── config.yaml     # 앱 설정 (엔진 목록, 오디오 파라미터 등)
├── Procfile        # foreman 프로세스 정의
└── .env.example    # 환경 변수 템플릿
```

## 라이선스

이 프로젝트는 개인/학습 목적으로 제작되었습니다.
