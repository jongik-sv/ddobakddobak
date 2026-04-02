# 또박또박 (ddobakddobak)

> 회의 음성을 실시간으로 텍스트화하고, AI가 핵심 요약 · 결정사항 · Action Item을 자동으로 정리해주는 로컬 기반 AI 회의록 서비스

회의에 집중하세요. 기록은 또박또박이 합니다.

---

## 목차

- [주요 기능](#주요-기능)
- [데모 스크린샷](#데모-스크린샷)
- [아키텍처](#아키텍처)
- [기술 스택](#기술-스택)
- [STT 엔진](#stt-엔진)
- [LLM 프로바이더](#llm-프로바이더)
- [사전 요구사항](#사전-요구사항)
- [설치 및 설정](#설치-및-설정)
- [실행](#실행)
- [데스크톱 앱 (Tauri)](#데스크톱-앱-tauri)
- [테스트](#테스트)
- [API 엔드포인트](#api-엔드포인트)
- [설정 가이드](#설정-가이드)
- [디렉터리 구조](#디렉터리-구조)
- [라이선스](#라이선스)

---

## 주요 기능

### 실시간 음성 인식 (STT)

- 브라우저 마이크로 녹음하면 즉시 텍스트로 변환
- Voice Activity Detection (VAD)으로 무음 구간 자동 건너뛰기
- AudioWorklet 기반 저지연 오디오 처리
- 설정 가능한 청크 크기 (2~20초, 오버랩 지원)

### AI 화자 분리

- pyannote.audio 기반 발화자 자동 구분
- 회의별 화자 데이터베이스로 동일 인물 자동 인식
- 화자 이름 변경 및 관리 기능
- 설정에서 on/off 전환 가능 (HF 토큰 필요)

### AI 회의록 자동 생성

- 실시간 중간 요약 (30초~5분 간격, 설정 가능)
- 회의 종료 시 최종 요약 자동 생성
- 구조화된 결과물: 핵심 요약, 논의 사항, 결정 사항, Action Item
- AI 피드백: 자연어로 수정 요청하면 AI가 회의록 수정
- 회의 유형별 맞춤 프롬프트 (일반회의, 팀회의, 스탠드업, 브레인스토밍, 리뷰, 인터뷰, 워크숍, 1:1, 강연)
- 커스텀 프롬프트 템플릿 관리

### 블록 에디터

- Notion 스타일 WYSIWYG 편집 (BlockNote 기반)
- AI 요약 결과를 직접 편집 가능
- Mermaid 다이어그램 자동 렌더링

### 실시간 회의 공유

- 공유 코드 생성으로 다른 사용자에게 실시간 회의 공유
- 뷰어 모드: 읽기 전용으로 전사 기록 · AI 요약 실시간 확인
- 참여자 목록 및 호스트 권한 이전
- ActionCable WebSocket 기반 실시간 동기화

### 오디오 파일 업로드

- 녹음 파일 (mp3, wav, m4a) 업로드로 회의록 생성
- 대용량 파일 분할 처리 (최대 30분 타임아웃)
- 업로드 파일도 화자 분리 · AI 요약 동일 적용

### 오디오 재생 + 기록 동기화

- WaveSurfer.js 기반 파형 시각화
- 기록 클릭 시 해당 시점으로 오디오 점프
- 재생 위치에 따른 현재 기록 하이라이트

### 내보내기 & 관리

- Markdown 파일로 회의록 내보내기
- 폴더별 회의 정리
- 태그 기반 분류
- 파일 첨부 기능
- 팀 관리 및 초대 기능

### 사용자별 LLM 설정

- 사용자마다 자신의 LLM 프로바이더/API 키 설정 가능
- 미설정 시 서버 기본값(settings.yaml) 사용
- 연결 테스트 기능

### 다국어 지원

9개 언어로 음성 인식 가능:

| 언어 | 코드 |
|------|------|
| 한국어 | `ko` |
| English | `en` |
| 日本語 | `ja` |
| 中文 | `zh` |
| Español | `es` |
| Français | `fr` |
| Deutsch | `de` |
| ภาษาไทย | `th` |
| Tiếng Việt | `vi` |

### 로컬/서버 모드

- **로컬 모드**: Tauri 데스크톱 앱에서 백엔드를 로컬로 실행
- **서버 모드**: 원격 서버에 연결하여 사용 (헬스체크 기능 내장)

---

## 데모 스크린샷

> `docs/screenshots/` 디렉터리에서 스크린샷을 확인할 수 있습니다.

---

## 아키텍처

```
┌─────────────────────────────────────────────────────┐
│              Tauri Desktop Shell (선택)               │
│  ┌───────────────────────────────────────────────┐  │
│  │            React SPA (Vite + TS)              │  │
│  │                                               │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │블록 에디터│ │라이브 기록│ │AI 요약 패널  │  │  │
│  │  │(BlockNote)│ │(실시간)  │ │(Mermaid 포함)│  │  │
│  │  └──────────┘ └──────────┘ └──────────────┘  │  │
│  │                                               │  │
│  │  AudioWorklet (VAD) │ Zustand │ WaveSurfer    │  │
│  └───────────────┬───────────────────────────────┘  │
└──────────────────┼──────────────────────────────────┘
                   │ WebSocket (ActionCable) + REST (ky)
                   │
┌──────────────────┴──────────────────────────────────┐
│              Ruby on Rails 8 API                     │
│                                                      │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────┐  │
│  │ Devise   │ │ ActionCable  │ │  Solid Queue     │  │
│  │ JWT 인증 │ │ WebSocket    │ │  비동기 작업     │  │
│  └──────────┘ └──────────────┘ └────────┬────────┘  │
│                                          │           │
│  ┌──────────────────────────────────────┐│           │
│  │ Services                             ││           │
│  │  SidecarClient │ MeetingFinalizer    ││           │
│  │  MeetingShareService │ MarkdownExport││           │
│  └──────────────────────────────────────┘│           │
└─────────┬────────────────────────────────┼───────────┘
          │                                │ HTTP
┌─────────┴────┐  ┌───────────────────────┴────────────┐
│   SQLite     │  │         Python Sidecar (FastAPI)    │
│   (WAL 모드) │  │                                     │
│              │  │  ┌─────────────────────────────────┐│
│  - Meeting   │  │  │ STT (Adapter Pattern)           ││
│  - Transcript│  │  │  Qwen3-ASR │ Whisper │ Faster   ││
│  - Summary   │  │  └─────────────────────────────────┘│
│  - Block     │  │  ┌─────────────────────────────────┐│
│  - User      │  │  │ 화자 분리 (pyannote.audio)      ││
│  - Team      │  │  │  화자 DB │ 임베딩 클러스터링     ││
│  - Folder    │  │  └─────────────────────────────────┘│
│  - Tag       │  │  ┌─────────────────────────────────┐│
│  - Attachment│  │  │ LLM (Anthropic/OpenAI/CLI)      ││
│  - Participant│  │  │  요약 │ Action Item │ 피드백     ││
│  - ActionItem│  │  └─────────────────────────────────┘│
│  - Prompt    │  │                                     │
└──────────────┘  └─────────────────────────────────────┘
```

### 실시간 처리 흐름

```
마이크 → AudioWorklet(VAD) → WebSocket → Rails → Solid Queue Job
                                                        │
                                                        ▼
                                            Sidecar STT + 화자분리
                                                        │
                                                        ▼
                                            ActionCable broadcast
                                                        │
                                                        ▼
                                               프론트엔드 실시간 표시
```

1. 브라우저의 AudioWorklet이 마이크 입력에서 음성 구간(VAD)을 감지
2. PCM 16kHz 오디오 청크를 ActionCable WebSocket으로 Rails에 전송
3. Rails가 Solid Queue 비동기 작업으로 처리 위임
4. 작업이 Python Sidecar HTTP API를 호출하여 STT + 화자 분리 수행
5. 결과를 ActionCable 채널로 브로드캐스트하여 프론트엔드에 실시간 표시
6. 설정된 간격마다 AI가 자동으로 중간 요약 생성

---

## 기술 스택

| 레이어 | 기술 | 역할 |
|--------|------|------|
| **Frontend** | React 19, TypeScript, Vite | SPA, 빌드 |
| | Tailwind CSS 4 | 스타일링 |
| | Zustand | 상태 관리 (auth, meeting, transcript, sharing, folder, appSettings) |
| | BlockNote | Notion 스타일 블록 에디터 |
| | WaveSurfer.js | 오디오 파형 시각화 |
| | ky | HTTP 클라이언트 (fetch 기반) |
| | Mermaid | 다이어그램 렌더링 |
| **Backend** | Ruby on Rails 8.1 (API mode) | REST API 서버 |
| | SQLite3 (WAL mode) | 로컬 데이터베이스 |
| | ActionCable | WebSocket 실시간 통신 |
| | Solid Queue | 비동기 작업 큐 |
| | Devise + JWT | 인증 (JTI 기반 토큰 폐기, Refresh Token) |
| **Sidecar** | Python 3.11+, FastAPI | 오디오 처리 서버 |
| | mlx-audio | Apple Silicon 최적화 STT |
| | pywhispercpp | Whisper Metal/ANE 가속 |
| | faster-whisper | CUDA GPU 가속 STT |
| | pyannote.audio | 화자 분리 |
| | Anthropic/OpenAI SDK | LLM 요약 (API 방식) |
| | Claude/Gemini/Codex CLI | LLM 요약 (CLI 방식) |
| **Desktop** | Tauri 2.10 | 크로스플랫폼 데스크톱 앱 |
| **Testing** | Vitest | 프론트엔드 단위 테스트 |
| | RSpec | 백엔드 단위 테스트 |
| | pytest | 사이드카 단위 테스트 |
| | Playwright | E2E 테스트 |

---

## STT 엔진

`settings.yaml`의 `stt.engine` 값으로 음성 인식 엔진을 교체할 수 있습니다. Adapter 패턴으로 설계되어 설정 변경만으로 전환됩니다.

| 엔진 | 모델 | 플랫폼 | 특징 |
|------|------|--------|------|
| `qwen3_asr_8bit` | Qwen3-ASR 1.7B (8bit) | macOS ARM64 | **macOS 기본값.** Apple Silicon MLX 가속. CJK 언어 최고 성능 |
| `qwen3_asr_6bit` | Qwen3-ASR 1.7B (6bit) | macOS ARM64 | 메모리/정확도 균형 |
| `qwen3_asr_4bit` | Qwen3-ASR 1.7B (4bit) | macOS ARM64 | 최소 메모리 사용 |
| `qwen3_asr_transformers` | Qwen3-ASR 1.7B | Windows / Linux (NVIDIA CUDA) | **Windows/Linux 기본값(CUDA).** HuggingFace transformers 기반. NVIDIA GPU 필수 |
| `whisper_cpp` | Whisper Large v3 Turbo | macOS / Linux / Windows | whisper.cpp, Metal/ANE 가속 |
| `faster_whisper` | Whisper Large v3 | NVIDIA GPU (CUDA) | Linux/Windows CUDA 가속 |
| `mock` | 테스트용 더미 | 모든 플랫폼 | 개발/테스트 시 사용 |

### 자동 감지

`stt.engine`을 지정하지 않으면 플랫폼에 따라 최적 엔진을 자동 선택합니다:

- **macOS ARM64** → `qwen3_asr_8bit` (MLX Metal GPU 가속)
- **NVIDIA CUDA 사용 가능** → `qwen3_asr_transformers` (transformers + CUDA 가속, CJK 최적)
- **그 외** → `whisper_cpp` (CPU 범용)

---

## LLM 프로바이더

`settings.yaml`의 `llm.presets`에서 여러 LLM 프로바이더를 설정하고, `llm.active_preset`으로 활성 프리셋을 전환합니다.

| 프로바이더 | 방식 | 특징 |
|-----------|------|------|
| `claude_cli` | CLI 파이프 | Claude CLI 도구 활용. API 키 불필요 |
| `gemini_cli` | CLI 파이프 | Google Gemini CLI 활용. API 키 불필요 |
| `codex_cli` | CLI 파이프 | Codex CLI 활용. API 키 불필요 |
| `anthropic` | Anthropic SDK | Claude API 또는 호환 API (Z.ai 등) |
| `openai` | OpenAI SDK | GPT 시리즈 또는 호환 API (Ollama 등) |

사용자별 LLM 설정도 지원합니다. 개별 사용자가 자신의 API 키를 설정하면 서버 기본값 대신 사용됩니다.

---

## 사전 요구사항

| 요구사항 | 버전 | 비고 |
|----------|------|------|
| **Ruby** | 3.4+ | `rbenv` 또는 `rvm` 권장 |
| **Node.js** | 20+ | npm 포함 |
| **Python** | 3.11+ | `uv` 패키지 매니저 필요 |
| **Bundler** | 최신 | `gem install bundler` |

### uv 설치 (Python 패키지 매니저)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 화자 분리 사용 시 (선택)

pyannote.audio 모델을 사용하려면 [Hugging Face](https://huggingface.co/) 계정과 토큰이 필요합니다. 다음 모델에 대한 접근 동의가 필요합니다:
- [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0)
- [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)

> HF 토큰 없이도 STT는 정상 동작합니다. 설정에서 화자 분리를 끄면 HF 토큰 없이 사용할 수 있습니다.

---

## 설치 및 설정

### 1. 저장소 클론

```bash
git clone https://github.com/your-username/ddobakddobak.git
cd ddobakddobak
```

### 2. 설정 파일

프로젝트 루트의 `settings.yaml`에서 STT 엔진, LLM, 화자 분리 등을 설정합니다:

```yaml
stt:
  engine: qwen3_asr_8bit       # STT 엔진 (위 표 참고)

hf:
  token: "your_hf_token"       # Hugging Face 토큰 (화자 분리용, 선택)

llm:
  active_preset: claude_cli    # 활성 LLM 프리셋
  presets:
    claude_cli:
      provider: claude_cli
      model: opus
    anthropic:
      provider: anthropic
      auth_token: "your_api_key"
      base_url: "https://api.anthropic.com"
      model: claude-sonnet-4-6

diarization:
  enabled: false               # 화자 분리 on/off

languages:
  selected: [ko, en]           # 음성 인식 대상 언어
```

`config.yaml`은 UI 라벨, 오디오 파라미터 등의 정적 설정을 관리합니다 (일반적으로 수정 불필요).

### 3. Backend (Rails)

```bash
cd backend
bundle install
bin/rails db:create db:migrate
```

### 4. Frontend

```bash
cd frontend
npm install
```

### 5. Sidecar (Python)

```bash
cd sidecar
uv sync
```

> macOS에서는 MLX 의존성이 자동으로 설치됩니다. CUDA GPU가 있는 환경에서는 `uv sync --extra cuda`로 CUDA 의존성을 추가할 수 있습니다.

---

## 실행

### 방법 A: 한 번에 실행 (foreman)

```bash
gem install foreman   # 최초 1회
foreman start
```

3개의 서비스가 동시에 시작됩니다:

| 프로세스 | 명령어 | 포트 |
|----------|--------|------|
| rails | `cd backend && bin/rails server -p 13323` | 13323 |
| sidecar | `cd sidecar && uv run uvicorn app.main:app --host 0.0.0.0 --port 13324` | 13324 |
| frontend | `cd frontend && npm run dev -- --port 13325` | 13325 |

### 방법 B: 터미널 3개로 각각 실행

```bash
# 터미널 1 — Rails API
cd backend && bin/rails server -p 13323

# 터미널 2 — Python Sidecar
cd sidecar && uv run uvicorn app.main:app --host 0.0.0.0 --port 13324

# 터미널 3 — React Frontend
cd frontend && npm run dev -- --port 13325
```

### 접속

| 서비스 | URL | 설명 |
|--------|-----|------|
| 프론트엔드 | http://localhost:13325 | 메인 UI |
| Rails API | http://localhost:13323/api/v1 | REST API |
| Sidecar API | http://localhost:13324 | STT/LLM 서비스 |
| 헬스 체크 | http://localhost:13323/api/v1/health | 서버 상태 확인 |
| Sidecar 헬스 | http://localhost:13324/health | STT 엔진 상태 확인 |

---

## 데스크톱 앱 (Tauri)

Tauri 2.10 기반 크로스플랫폼 데스크톱 앱으로도 사용할 수 있습니다.

### 지원 플랫폼

| 플랫폼 | 아키텍처 | 포맷 |
|--------|----------|------|
| macOS | ARM64 (Apple Silicon), x64 (Intel) | `.dmg` |
| Windows | x64 | `.msi`, `.exe` |
| Linux | x64 | `.deb`, `.AppImage` |

### 로컬/서버 모드

데스크톱 앱은 두 가지 모드를 지원합니다:

- **로컬 모드**: 앱이 백엔드(Rails + Sidecar)를 로컬에서 자동 실행
- **서버 모드**: 원격 서버에 접속하여 사용 (서버 URL 입력 + 헬스체크)

첫 실행 시 SetupPage에서 모드를 선택합니다.

### 개발 모드 실행

```bash
cd frontend
npm run tauri dev
```

### 프로덕션 빌드

```bash
cd frontend
npm run tauri build
```

### CI/CD 자동 빌드

Git 태그를 푸시하면 GitHub Actions가 자동으로 멀티플랫폼 빌드를 수행하고 GitHub Release에 업로드합니다:

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## 테스트

### Backend (RSpec)

```bash
cd backend
bundle exec rspec
```

### Frontend (Vitest)

```bash
cd frontend
npm run test
```

### Sidecar (pytest)

```bash
cd sidecar
uv run pytest
```

### E2E (Playwright)

모든 서비스가 실행 중인 상태에서:

```bash
cd e2e
npx playwright install    # 최초 1회: 브라우저 설치
npx playwright test
```

E2E 테스트 범위:
- 회원가입 / 로그인 / 로그아웃 흐름
- 회의 CRUD (생성, 조회, 수정)
- 실시간 녹음 및 전사
- 전체 파이프라인 (녹음 → 전사 → 요약)
- 팀 생성 및 초대
- Markdown 내보내기

> CI 환경에서는 Python Sidecar Stub을 사용하여 STT 모델 없이 테스트합니다.

---

## API 엔드포인트

### 인증

| Method | Endpoint | 설명 |
|--------|----------|------|
| `POST` | `/auth/login` | JWT 로그인 |
| `DELETE` | `/auth/logout` | 로그아웃 (토큰 폐기) |
| `POST` | `/auth/refresh` | Refresh Token |
| `GET` | `/auth/web_login` | 브라우저 로그인 폼 |
| `POST` | `/auth/web_login` | 브라우저 로그인 처리 |

### 회의

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET` | `/api/v1/meetings` | 회의 목록 |
| `POST` | `/api/v1/meetings` | 회의 생성 |
| `GET` | `/api/v1/meetings/:id` | 회의 상세 |
| `PATCH` | `/api/v1/meetings/:id` | 회의 수정 |
| `DELETE` | `/api/v1/meetings/:id` | 회의 삭제 |
| `POST` | `/api/v1/meetings/:id/start` | 녹음 시작 |
| `POST` | `/api/v1/meetings/:id/stop` | 녹음 종료 |
| `POST` | `/api/v1/meetings/:id/reopen` | 회의 재개 |
| `POST` | `/api/v1/meetings/upload_audio` | 오디오 파일 업로드 |
| `POST` | `/api/v1/meetings/:id/summarize` | AI 요약 요청 |
| `POST` | `/api/v1/meetings/:id/regenerate_stt` | STT 재생성 |
| `POST` | `/api/v1/meetings/:id/regenerate_notes` | 회의록 재생성 |
| `POST` | `/api/v1/meetings/:id/feedback` | AI 피드백 요청 |
| `PATCH` | `/api/v1/meetings/:id/update_notes` | 회의록 수정 |
| `POST` | `/api/v1/meetings/:id/reset_content` | 콘텐츠 초기화 |
| `GET` | `/api/v1/meetings/:id/export` | Markdown 내보내기 |
| `GET` | `/api/v1/meetings/:id/export_prompt` | 내보내기 프롬프트 |
| `GET` | `/api/v1/meetings/:id/summary` | 요약 조회 |
| `GET` | `/api/v1/meetings/:id/transcripts` | 전사 기록 조회 |
| `POST` | `/api/v1/meetings/:id/audio` | 녹음 중 오디오 업로드 |
| `GET` | `/api/v1/meetings/:id/audio` | 오디오 다운로드 |
| `GET` | `/api/v1/meetings/:id/peaks` | 오디오 파형 데이터 |
| `POST` | `/api/v1/meetings/move_to_folder` | 폴더 이동 |

### 회의 공유

| Method | Endpoint | 설명 |
|--------|----------|------|
| `POST` | `/api/v1/meetings/:id/share` | 공유 코드 생성 |
| `DELETE` | `/api/v1/meetings/:id/share` | 공유 코드 해제 |
| `POST` | `/api/v1/meetings/join` | 공유 코드로 참여 |
| `GET` | `/api/v1/meetings/:id/participants` | 참여자 목록 |
| `POST` | `/api/v1/meetings/:id/transfer_host` | 호스트 권한 이전 |

### 회의 하위 리소스

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET/POST` | `/api/v1/meetings/:id/action_items` | Action Item 조회/생성 |
| `PATCH/DELETE` | `/api/v1/action_items/:id` | Action Item 수정/삭제 |
| `GET/POST/PATCH/DELETE` | `/api/v1/meetings/:id/blocks` | 블록 CRUD |
| `PATCH` | `/api/v1/meetings/:id/blocks/:id/reorder` | 블록 순서 변경 |
| `DELETE` | `/api/v1/meetings/:id/transcripts/destroy_batch` | 전사 일괄 삭제 |
| `GET/POST/PATCH/DELETE` | `/api/v1/meetings/:id/attachments` | 첨부파일 CRUD |
| `GET` | `/api/v1/meetings/:id/attachments/:id/download` | 첨부파일 다운로드 |

### 폴더 & 태그

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET/POST/PATCH/DELETE` | `/api/v1/folders` | 폴더 CRUD |
| `GET/POST/PATCH/DELETE` | `/api/v1/tags` | 태그 CRUD |

### 설정

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET` | `/api/v1/settings` | 전체 설정 조회 |
| `POST` | `/api/v1/settings/stt_engine` | STT 엔진 변경 |
| `GET/PUT` | `/api/v1/settings/llm` | LLM 설정 조회/변경 |
| `POST` | `/api/v1/settings/llm/test` | LLM 연결 테스트 |
| `GET/PUT` | `/api/v1/settings/hf` | HF 토큰 조회/변경 |
| `GET/PUT` | `/api/v1/settings/app` | 앱 설정 조회/변경 |

### 사용자 LLM 설정

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET` | `/api/v1/user/llm_settings` | 사용자 LLM 설정 조회 |
| `PUT` | `/api/v1/user/llm_settings` | 사용자 LLM 설정 변경 |
| `POST` | `/api/v1/user/llm_settings/test` | 사용자 LLM 연결 테스트 |

### 프롬프트 템플릿

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET/POST/PATCH/DELETE` | `/api/v1/prompt_templates` | 프롬프트 템플릿 CRUD |
| `POST` | `/api/v1/prompt_templates/:id/reset` | 기본값으로 초기화 |

### 화자

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET` | `/api/v1/speakers` | 화자 목록 |
| `PATCH` | `/api/v1/speakers/:id` | 화자 이름 변경 |
| `DELETE` | `/api/v1/speakers` | 전체 화자 초기화 |

### 팀

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET/POST` | `/api/v1/teams` | 팀 목록/생성 |
| `POST` | `/api/v1/teams/:id/invite` | 팀원 초대 |
| `DELETE` | `/api/v1/teams/:id/members/:user_id` | 팀원 제거 |

### WebSocket

| 채널 | 구독 | 설명 |
|------|------|------|
| `TranscriptionChannel` | `meeting_{id}_transcription` | 실시간 오디오 스트리밍 및 전사 결과 수신 |

---

## 설정 가이드

### settings.yaml (런타임 설정)

프로젝트 루트의 `settings.yaml`에서 런타임 설정을 관리합니다. 앱 설정 UI에서도 변경 가능합니다:

```yaml
# STT 엔진
stt:
  engine: qwen3_asr_8bit

# HuggingFace 토큰 (화자 분리용)
hf:
  token: "your_hf_token"

# LLM 프리셋
llm:
  active_preset: claude_cli
  presets:
    claude_cli:
      provider: claude_cli
      model: opus
    anthropic:
      provider: anthropic
      auth_token: "your_api_key"
      base_url: ""
      model: claude-sonnet-4-6

# 화자 분리
diarization:
  enabled: false
  similarity_threshold: 0.45
  merge_threshold: 0.6
  max_embeddings_per_speaker: 17

# 오디오 VAD
audio:
  silence_threshold: 0.05
  speech_threshold: 0.06
  silence_duration_ms: 500
  max_chunk_sec: 20
  min_chunk_sec: 2

# AI 요약 간격
summary:
  interval_sec: 120

# 음성 인식 대상 언어
languages:
  selected: [ko, en]
```

### config.yaml (정적 설정)

API URL, UI 라벨, 오디오 파라미터 기본값 등의 정적 설정:

```yaml
# API / WebSocket
api:
  base_url: "http://localhost:13323/api/v1"
  ws_url: "ws://localhost:13323/cable"

# Sidecar 연결
sidecar:
  host: "localhost"
  port: 13324
  timeout_sec: 30
```

---

## 디렉터리 구조

```
ddobakddobak/
├── frontend/                  # React SPA
│   ├── src-tauri/            # Tauri 데스크톱 앱 설정
│   │   ├── tauri.conf.json   # 앱 이름, 창 크기, 번들 설정
│   │   ├── src/              # Rust 소스
│   │   └── Cargo.toml        # Tauri 의존성
│   ├── src/
│   │   ├── api/              # API 클라이언트 (ky 기반)
│   │   ├── channels/         # ActionCable WebSocket 연결
│   │   ├── components/       # UI 컴포넌트
│   │   │   ├── layout/       # AppLayout, Sidebar
│   │   │   ├── meeting/      # AudioRecorder, LiveRecord, ShareButton, ViewerHeader
│   │   │   ├── editor/       # MeetingEditor (BlockNote)
│   │   │   ├── auth/         # LoginPage, AuthGuard, ServerSetup
│   │   │   ├── folder/       # 폴더 관리
│   │   │   ├── action-item/  # Action Item 관리
│   │   │   ├── settings/     # UserLlmSettings
│   │   │   └── ui/           # 공통 UI 컴포넌트
│   │   ├── hooks/            # 커스텀 React 훅
│   │   │   ├── useAudioRecorder.ts    # AudioWorklet 녹음 + VAD
│   │   │   ├── useTranscription.ts    # WebSocket STT 연동
│   │   │   ├── useAudioPlayer.ts      # WaveSurfer 래퍼
│   │   │   ├── useBlockSync.ts        # 블록 에디터 동기화
│   │   │   ├── useSttBlockInserter.ts # STT 결과 블록 삽입
│   │   │   └── useAuth.ts            # JWT 인증 훅
│   │   ├── pages/            # 페이지 컴포넌트
│   │   │   ├── DashboardPage.tsx      # 대시보드 (통계 + 최근 회의)
│   │   │   ├── MeetingsPage.tsx       # 회의 CRUD, 필터, 업로드
│   │   │   ├── MeetingLivePage.tsx    # 실시간 녹음 (3패널 레이아웃)
│   │   │   ├── MeetingPage.tsx        # 회의 상세 (에디터 + 기록)
│   │   │   ├── MeetingViewerPage.tsx  # 공유 회의 뷰어
│   │   │   ├── SetupPage.tsx          # 로컬/서버 모드 설정
│   │   │   └── SettingsPage.tsx       # STT/LLM/오디오 설정
│   │   ├── stores/           # Zustand 상태 관리
│   │   │   ├── authStore.ts           # 인증 상태
│   │   │   ├── meetingStore.ts        # 회의 상태
│   │   │   ├── transcriptStore.ts     # 전사 기록 상태
│   │   │   ├── sharingStore.ts        # 실시간 공유 상태
│   │   │   ├── folderStore.ts         # 폴더 상태
│   │   │   ├── promptTemplateStore.ts # 프롬프트 템플릿 상태
│   │   │   ├── appSettingsStore.ts    # 앱 설정 상태
│   │   │   └── uiStore.ts            # UI 상태
│   │   ├── lib/              # 유틸리티
│   │   └── config.ts         # config.yaml 로더
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                   # Rails API 서버
│   ├── app/
│   │   ├── controllers/
│   │   │   ├── api/v1/       # REST API 컨트롤러
│   │   │   │   ├── meetings_controller.rb
│   │   │   │   ├── meeting_shares_controller.rb
│   │   │   │   ├── meeting_attachments_controller.rb
│   │   │   │   ├── meeting_action_items_controller.rb
│   │   │   │   ├── settings_controller.rb
│   │   │   │   ├── teams_controller.rb
│   │   │   │   ├── speakers_controller.rb
│   │   │   │   ├── folders_controller.rb
│   │   │   │   ├── tags_controller.rb
│   │   │   │   ├── prompt_templates_controller.rb
│   │   │   │   ├── health_controller.rb
│   │   │   │   └── user/llm_settings_controller.rb
│   │   │   └── auth/         # 인증 컨트롤러
│   │   │       ├── sessions_controller.rb
│   │   │       └── browser_sessions_controller.rb
│   │   ├── channels/         # ActionCable WebSocket
│   │   │   └── transcription_channel.rb
│   │   ├── jobs/             # Solid Queue 비동기 작업
│   │   │   ├── transcription_job.rb
│   │   │   ├── summarization_job.rb
│   │   │   ├── meeting_summarization_job.rb
│   │   │   ├── meeting_finalizer_job.rb
│   │   │   ├── audio_upload_job.rb
│   │   │   └── file_transcription_job.rb
│   │   ├── models/           # ActiveRecord 모델
│   │   │   ├── user.rb       # Devise JWT, 사용자별 LLM 설정
│   │   │   ├── meeting.rb    # 핵심 모델 (status, source, share_code)
│   │   │   ├── transcript.rb # 오디오 청크, 타임스탬프, 화자
│   │   │   ├── summary.rb    # AI 생성 요약
│   │   │   ├── block.rb      # BlockNote 직렬화
│   │   │   ├── action_item.rb
│   │   │   ├── folder.rb
│   │   │   ├── tag.rb / tagging.rb
│   │   │   ├── meeting_attachment.rb
│   │   │   ├── meeting_participant.rb  # 실시간 공유 참여자
│   │   │   ├── prompt_template.rb
│   │   │   ├── team.rb
│   │   │   └── team_membership.rb
│   │   └── services/         # 비즈니스 로직
│   │       ├── sidecar_client.rb
│   │       ├── meeting_finalizer_service.rb
│   │       ├── meeting_share_service.rb
│   │       ├── meeting_export_serializer.rb
│   │       ├── markdown_exporter.rb
│   │       ├── jwt_service.rb
│   │       └── login_form_template.rb
│   ├── config/
│   │   ├── routes.rb         # API 라우팅
│   │   └── database.yml      # SQLite WAL 설정
│   ├── db/                   # 마이그레이션 & 스키마
│   └── Gemfile
│
├── sidecar/                   # Python FastAPI 서비스
│   ├── app/
│   │   ├── main.py           # FastAPI 엔트리포인트
│   │   ├── config.py         # settings.yaml 로더 + Pydantic 설정
│   │   ├── stt/              # STT 어댑터 패턴
│   │   │   ├── base.py       # 추상 어댑터
│   │   │   ├── factory.py    # 엔진 팩토리 (자동 감지)
│   │   │   ├── qwen3_adapter.py          # Qwen3-ASR (MLX)
│   │   │   ├── qwen3_transformers_adapter.py  # Qwen3-ASR (CUDA)
│   │   │   ├── whisper_adapter.py        # whisper.cpp
│   │   │   ├── faster_whisper_adapter.py # CUDA Whisper
│   │   │   └── mock_adapter.py           # 테스트용
│   │   ├── diarization/      # 화자 분리
│   │   │   └── speaker_diarizer.py
│   │   └── llm/              # LLM 통합
│   │       └── summarizer.py # 요약, Action Item, 피드백
│   ├── pyproject.toml        # uv 패키지 정의
│   └── tests/
│
├── e2e/                       # Playwright E2E 테스트
│   ├── tests/
│   │   ├── auth.spec.ts      # 인증 흐름
│   │   ├── meeting.spec.ts   # 회의 CRUD
│   │   ├── minutes.spec.ts   # 실시간 전사
│   │   ├── pipeline.spec.ts  # 전체 파이프라인
│   │   ├── team.spec.ts      # 팀 관리
│   │   └── export.spec.ts    # 내보내기
│   ├── stubs/                # Sidecar 테스트 스텁
│   ├── playwright.config.ts
│   └── global-setup.ts       # 테스트 사용자 생성
│
├── docs/                      # 기획/설계 문서
│   ├── PRD.md                # 제품 요구사항 정의서
│   ├── TRD.md                # 기술 요구사항 정의서
│   ├── wbs.md                # 작업 분해 구조
│   ├── features.md           # 기능 가이드
│   ├── tauri-desktop-app-guide.md
│   ├── vad-chunking-design.md  # VAD 기술 스펙
│   └── screenshots/          # 스크린샷
│
├── .github/workflows/         # CI/CD
│   ├── build.yml             # Tauri 멀티플랫폼 빌드
│   └── e2e.yml               # E2E 테스트
│
├── settings.yaml              # 런타임 설정 (STT, LLM, 화자분리 등)
├── config.yaml                # 정적 설정 (URL, UI 라벨, 오디오 파라미터)
├── Procfile                   # foreman 프로세스 정의
└── .gitignore
```

---

## 설계 원칙

### Adapter Pattern (STT)

새로운 STT 엔진 추가 시 코어 코드 변경 없이 어댑터만 구현하면 됩니다:

```python
class MySttAdapter(SttAdapter):
    def load_model(self): ...
    def transcribe(self, audio_data, language): ...
```

### 로컬 우선 (Local-First)

- SQLite WAL 모드로 별도 DB 서버 불필요
- 모든 데이터가 로컬에 저장되어 프라이버시 보장
- 인터넷은 AI 요약 API 호출에만 필요 (CLI 모드 사용 시 불필요)
- STT는 완전히 로컬에서 실행

### 이벤트 기반 실시간 처리

- 폴링 없는 WebSocket 기반 아키텍처
- Solid Queue로 무거운 작업은 비동기 처리
- ActionCable 브로드캐스트로 결과 즉시 전달

---

## 라이선스

이 프로젝트는 개인/학습 목적으로 제작되었습니다.
