# 또박또박 (ddobakddobak)

AI 기반 회의 전사(STT) 및 요약 서비스. 실시간 음성 인식, 화자 분리, AI 요약, 블록 에디터 기반 회의록 편집 기능을 제공합니다.

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Zustand |
| Backend | Ruby on Rails 8.1 (API mode), SQLite3, ActionCable |
| Sidecar | Python 3.11, FastAPI, pywhispercpp / mlx-lm |
| 실시간 통신 | WebSocket (ActionCable) |
| 배경 작업 | Solid Queue |

## 사전 요구사항

- **Ruby** 4.0.2+ (`rbenv` 또는 `rvm` 권장)
- **Node.js** 20+ (npm 포함)
- **Python** 3.11+ (`uv` 패키지 매니저 필요)
- **Bundler** (`gem install bundler`)

### uv 설치 (Python 패키지 매니저)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## 설치 및 초기 설정

### 1. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 아래 값들을 설정합니다:

```env
# AI 요약 API 토큰 (필수)
ANTHROPIC_AUTH_TOKEN="your_token_here"

# Rails 시크릿 키 생성 (필수)
# SECRET_KEY_BASE 값은 아래 명령으로 생성:
#   cd backend && bin/rails secret
SECRET_KEY_BASE="<generated_secret>"

# Hugging Face 토큰 (화자 분리 기능 사용 시 필요)
HF_TOKEN="your_hf_token_here"
```

### 2. Backend (Rails) 설정

```bash
cd backend
bundle install
bin/rails db:create db:migrate
```

### 3. Frontend 설정

```bash
cd frontend
npm install
```

### 4. Sidecar (Python) 설정

```bash
cd sidecar
uv sync
```

## 실행

### 방법 A: 한 번에 실행 (foreman 사용)

```bash
# foreman 설치 (최초 1회)
gem install foreman

# 프로젝트 루트에서
foreman start
```

### 방법 B: 터미널 3개로 각각 실행

**터미널 1 — Rails API (port 3000)**
```bash
cd backend && bin/rails server -p 3000
```

**터미널 2 — Python Sidecar (port 8000)**
```bash
cd sidecar && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**터미널 3 — React Frontend (port 5173)**
```bash
cd frontend && npm run dev -- --port 5173
```

### 접속 URL

| 서비스 | URL |
|--------|-----|
| 프론트엔드 | http://localhost:5173 |
| Rails API | http://localhost:3000/api/v1 |
| Python Sidecar | http://localhost:8000 |
| 헬스 체크 | http://localhost:3000/api/v1/health |

## 테스트

### Backend (RSpec)

```bash
cd backend
bundle exec rspec
```

### Frontend (Vitest)

```bash
cd frontend
npm run test          # 단발 실행
npm run test:watch    # 감시 모드
```

### E2E (Playwright)

모든 서비스가 실행 중인 상태에서:

```bash
cd e2e
npx playwright test
npx playwright test --ui   # UI 모드
```

## STT 엔진 선택

`.env`의 `STT_ENGINE` 값으로 음성 인식 엔진을 교체할 수 있습니다:

| 값 | 설명 |
|----|------|
| `qwen3_asr` | 기본값. Apple Silicon 최적화 (mlx-lm) |
| `whisper_cpp` | OpenAI Whisper C++ 구현체 |
| `faster_whisper` | Whisper 고속 변형 |
| `sensevoice` | CJK 언어 특화 (Alibaba) |

## 디렉터리 구조

```
.
├── backend/        # Rails API 서버
├── frontend/       # React SPA
├── sidecar/        # Python FastAPI (STT / AI 요약)
├── e2e/            # Playwright E2E 테스트
├── docs/           # 기획/설계 문서 (PRD, TRD, WBS)
├── Procfile        # foreman 프로세스 정의
└── .env.example    # 환경 변수 템플릿
```
