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
- 전사 기록 행 단위 화자변경/발언분할 모드: 화자만 변경(내용 유지) 또는 발언 분할, 둘 중 선택
- 설정에서 on/off 전환 가능 (HF 토큰 필요)

### AI 회의록 자동 생성

- 실시간 중간 요약 (회의별 자동 요약 주기 설정 가능, 0이면 자동 요약 끔)
- 회의 종료 시 최종 요약 자동 생성 (단일 LLM 호출로 요약·Action Items를 함께 생성)
- 구조화된 결과물: 핵심 요약, 논의 사항, 결정사항 표, Action Items — 회의 유형에 따라 섹션 구성이 달라짐 (예: 개발진행회의는 업무 진행 현황·기술 결정·이슈/리스크 중심)
- 요약에 추가 지시사항을 자유 텍스트로 입력해 반영 (summary_custom_prompt)
- 회의 첨부파일 중 "이해관계자" 카테고리는 LLM이 압축해 요약 프롬프트에 자동 주입
- 연결회의: 이전 회의 요약을 상단에 고정해 이어지는 회의의 맥락 유지, 재요약 시 이전 내용 응축 결과 캐시로 LLM 재호출 최소화
- AI 피드백: 자연어로 수정 요청하면 AI가 회의록 수정
- 회의 유형별 맞춤 프롬프트 (일반 회의, 팀 회의, 개발진행회의, 스탠드업, 브레인스토밍, 리뷰/회고, 인터뷰, 워크숍, 1:1 미팅, 강연, 교육 — `config.yaml` 정의 순서)
- 커스텀 프롬프트 템플릿 관리

### 블록 에디터

- Notion 스타일 WYSIWYG 편집 (BlockNote 기반)
- AI 요약 결과를 직접 편집 가능
- Mermaid 다이어그램 자동 렌더링
- 요약 글자 크기 조절 (localStorage에 저장)

### AI 챗

- 회의 · 폴더 · 프로젝트 단위로 스코프를 선택해 내용에 대해 AI와 대화
- 답변 확대보기 + Markdown 파일로 저장
- ActionCable(ChatChannel) 기반 실시간 스트리밍

### 회의 접근 제어 · 잠금

- 회의 협업자 초대: 소유자/관리자 외 협업자는 읽기 전용(readOnly)으로 접근
- 회의 잠금(읽기 전용) 및 중요 표시(최근 목록 필터)
- 단일 녹음 기기 잠금: 한 회의는 점유 중인 기기에서만 녹음 시작/중지/일시정지 가능, 다른 기기는 실시간 뷰어로 전환
- 기밀 구간 절단(redact): 전사 구간을 선택해 비가역적으로 파기 (되돌리기 불가 확인 다이얼로그 포함)
- 휴지통: 삭제된 회의/폴더를 복구 가능

### 오디오 파일 업로드

- 녹음 파일 (mp3, wav, m4a) 업로드로 회의록 생성
- 다중 음성 파일 병합 업로드: 파일 순서 변경 후 파일 사이 무음(기본 3초)을 넣어 하나의 오디오로 병합
- 회의 페이지 전체를 드롭존으로 사용하는 드래그앤드롭 업로드 (오디오/첨부파일 자동 분기)
- 대용량 파일 분할 처리 (최대 30분 타임아웃)
- 업로드 파일도 화자 분리 · AI 요약 동일 적용

### 오디오 재생 + 기록 동기화

- 네이티브 HTML5 Audio + 서버 peaks API 기반 파형 시각화
- 기록 클릭 시 해당 시점으로 오디오 점프
- 재생 위치에 따른 현재 기록 하이라이트

### 내보내기 & 관리

- Markdown 파일로 회의록 내보내기
- 폴더 · 프로젝트 단위 요약 zip 일괄 내보내기
- 외부 LLM에 붙여넣을 프롬프트 내보내기 시 화자 실명 표기 (내부 요약 경로는 실명 비노출 유지)
- 폴더별 회의 정리, 태그 기반 분류, 파일 첨부 기능
- 도메인 파일(용어집 문서)·용어 오인식 교정 규칙 관리
- D'Flow 연동: 회의록 전송 상태 배지·필터, 기존 회의 선택 또는 신규 등록 연결

### 프로젝트 기반 조직화

- 프로젝트가 회의 · 폴더의 최상위 소속 단위 (팀 개념을 대체)
- 프로젝트 멤버 초대(admin/member) 및 관리
- 프로젝트 즐겨찾기: 별 토글 + 스위처 필터
- 프로젝트 단위 도메인 파일(용어집) 공유

### LLM 설정

- 서버 LLM 프리셋 프로필: 여러 프로필을 등록해 전환 (`llm_profiles`, scope=server)
- 사용자별 LLM 설정: 요약용/챗용을 각각 자신의 LLM 프로바이더·API 키로 설정 가능 (scope=personal)
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

`docs/screenshots/` 디렉터리에서 스크린샷을 확인할 수 있습니다 (2026-08-14 실서버 기준 촬영).

| 파일 | 화면 |
|------|------|
| `03-dashboard.png` | 대시보드 |
| `04-meetings-folders.png` | 전체 회의 폴더 뷰 |
| `04-meetings-list.png` | 폴더 내 회의 목록 (D'Flow 전송 배지 · 회의 유형 표시) |
| `05-meeting-detail.png` | 회의 상세 (전사 · AI 회의록 · AI 챗) |
| `09-settings-top.png` | 설정 — 개인설정 |
| `11-settings-ai.png` | 설정 — LLM (프리셋 프로필 · CLI 모델) |
| `12-settings-stt.png` | 설정 — 음성·인식 (STT · 배치 STT 모델) |
| `13-settings-minutes.png` | 설정 — 회의록 설정 (유형별 구조화 프롬프트) |

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
│  │  AudioWorklet (VAD) │ Zustand │ 네이티브 Audio  │  │
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
│  │  TranscriptRedaction │ MarkdownExport││           │
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
│  - Project   │  │  │  화자 DB │ 임베딩 클러스터링     ││
│  - Folder    │  │  └─────────────────────────────────┘│
│  - Tag       │  │  ┌─────────────────────────────────┐│
│  - Attachment│  │  │ LLM (Anthropic/OpenAI/CLI)      ││
│  - Collaborator│  │  │  요약 │ 챗 │ 피드백           ││
│  - ChatMessage│  │  └─────────────────────────────────┘│
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
| | Zustand | 상태 관리 (auth, meeting, transcript, project, chat, recording, folder, appSettings 등) |
| | BlockNote | Notion 스타일 블록 에디터 |
| | 네이티브 HTML5 Audio + 서버 peaks API | 오디오 재생 · 파형 시각화 (WaveSurfer.js 제거됨) |
| | ky | HTTP 클라이언트 (fetch 기반) |
| | Mermaid | 다이어그램 렌더링 |
| **Backend** | Ruby on Rails 8.1.2 (API mode) | REST API 서버 |
| | SQLite3 (WAL mode) | 로컬 데이터베이스 |
| | ActionCable | WebSocket 실시간 통신 (전사 스트리밍 · AI 챗) |
| | Solid Queue | 비동기 작업 큐 |
| | Devise + JWT | 인증 (JTI 기반 토큰 폐기, Refresh Token) |
| **Sidecar** | Python 3.11+, FastAPI | 오디오 처리 서버 |
| | mlx-audio | Apple Silicon 최적화 STT |
| | pywhispercpp | Whisper Metal/ANE 가속 |
| | faster-whisper | CUDA GPU 가속 STT |
| | pyannote.audio | 화자 분리 |
| | KURE (한국어 임베딩) | 전사 검색용 임베딩, 유휴 시 GPU→CPU→언로드 2단계 오프로드 |
| | Anthropic/OpenAI SDK | LLM 요약 · 챗 (API 방식) |
| | Claude/Gemini/Codex CLI | LLM 요약 · 챗 (CLI 방식) |
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
| `qwen3_asr_transformers` | Qwen3-ASR 1.7B | Windows / Linux (NVIDIA CUDA) | HuggingFace transformers 기반. NVIDIA GPU 필수 |
| `qwen3_asr_vllm` | Qwen3-ASR 1.7B | Linux (NVIDIA CUDA) | **CUDA 기본값(vllm 설치 시).** vllm 서빙 기반, transformers보다 처리량 우수 |
| `whisper_cpp` | Whisper Large v3 Turbo | macOS / Linux / Windows | whisper.cpp, Metal/ANE 가속 |
| `faster_whisper` | Whisper Large v3 | NVIDIA GPU (CUDA) | Linux/Windows CUDA 가속 |
| `mock` | 테스트용 더미 | 모든 플랫폼 | 개발/테스트 시 사용 |

실시간 인식과 별개로 업로드 파일 재전사(배치 STT)에는 `mlx_whisper_turbo_*`, `faster_whisper_cpu`, `faster_whisper_ko` 등 추가 엔진이 플랫폼별로 선택 가능합니다 (설정 화면 "음성·인식" 탭에서 확인. `sidecar/app/stt/factory.py` 참고).

### 자동 감지

`stt.engine`을 지정하지 않으면 플랫폼에 따라 최적 엔진을 자동 선택합니다:

- **macOS ARM64** → `qwen3_asr_8bit` (MLX Metal GPU 가속)
- **NVIDIA CUDA 사용 가능** → vllm 설치되어 있으면 `qwen3_asr_vllm`, 없으면 `qwen3_asr_transformers`
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

서버 기본값 외에도 `llm_profiles` 테이블로 프리셋 프로필을 여러 개 등록해 UI에서 전환할 수 있습니다 (scope=server인 서버 풀 프로필, scope=personal인 사용자별 개인 프로필). 사용자별 LLM 설정도 지원하며, 요약용/챗용을 각각 독립적으로 설정할 수 있습니다. 개별 사용자가 자신의 API 키를 설정하면 서버 기본값 대신 사용됩니다.

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

### 방법 A: dev.sh (권장)

```bash
./dev.sh          # (기본값 all) 백엔드(rails·sidecar·caddy, tmux 세션)를 띄운 뒤 현재 터미널에서 Tauri 프론트엔드 실행
./dev.sh up       # 백엔드(rails · sidecar · caddy)만 tmux 세션(ddobak)에 띄움
./dev.sh attach   # 이미 떠 있는 tmux 세션에 다시 붙기
./dev.sh down     # tmux 세션·caddy 정리
```

Caddy가 LAN HTTPS 단일 origin으로 rails/sidecar/frontend 앞단을 묶어 443 포트로 서비스합니다 (macOS는 1024 미만 포트도 비루트로 바인딩 가능해 sudo 불필요). rails(13323)·sidecar(13324)는 tmux 창에서, 프론트엔드는 Tauri 데스크톱 앱으로 현재 터미널에서 포그라운드 실행됩니다.

### 방법 B: 한 번에 실행 (foreman, Vite 개발 서버만)

```bash
gem install foreman   # 최초 1회
foreman start
```

`Procfile`에 정의된 3개의 서비스가 동시에 시작됩니다 (Caddy·Tauri 없이 순수 Vite 브라우저 개발 용도):

| 프로세스 | 명령어 | 포트 |
|----------|--------|------|
| rails | `cd backend && bin/rails server -p 13323` | 13323 |
| sidecar | `cd sidecar && uv run uvicorn app.main:app --host 0.0.0.0 --port 13324` | 13324 |
| frontend | `cd frontend && npm run dev -- --port 13325` | 13325 |

### 방법 C: 터미널 3개로 각각 실행

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
| Sidecar 헬스 | http://localhost:13324/health | STT 엔진 · 임베딩(embed_state) 상주 상태 확인 |

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
npm run tauri:dev
```

### 프로덕션 빌드

```bash
cd frontend
npm run tauri:build
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

E2E 테스트 범위 (`e2e/tests/*.spec.ts`):
- 회원가입 / 로그인 / 로그아웃 흐름 (`auth.spec.ts`)
- 회의 CRUD (생성, 조회, 수정) (`meeting.spec.ts`)
- 실시간 녹음 및 전사 (`minutes.spec.ts`)
- 전체 파이프라인 (녹음 → 전사 → 요약) (`pipeline.spec.ts`)
- 프로젝트 생성 및 멤버 초대 (`team.spec.ts`)
- Markdown 내보내기 (`export.spec.ts`)
- 요약 확대보기 (`summary-fullview.spec.ts`)

> CI 환경에서는 Python Sidecar Stub을 사용하여 STT 모델 없이 테스트합니다.

---

## API 엔드포인트

> 아래는 주요 엔드포인트 발췌입니다. 전체 라우트는 `backend/config/routes.rb`를 참고하세요.

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
| `POST` | `/api/v1/meetings/:id/pause` / `resume` | 녹음 일시정지/재개 |
| `POST` | `/api/v1/meetings/upload_audio` | 오디오 파일 업로드 |
| `POST` | `/api/v1/meetings/:id/summarize` | AI 요약 요청 |
| `POST` | `/api/v1/meetings/:id/regenerate_stt` | STT 재생성 |
| `POST` | `/api/v1/meetings/:id/re_diarize` | 화자 분리 재실행 |
| `POST` | `/api/v1/meetings/:id/regenerate_notes` | 회의록 재생성 |
| `POST` | `/api/v1/meetings/:id/feedback` | AI 피드백 요청 |
| `PATCH` | `/api/v1/meetings/:id/update_notes` | 회의록 수정 |
| `POST` | `/api/v1/meetings/:id/reset_content` | 콘텐츠 초기화 |
| `GET` | `/api/v1/meetings/:id/export` | Markdown 내보내기 |
| `GET` | `/api/v1/meetings/:id/export_prompt` | 내보내기 프롬프트 (화자 실명 표기) |
| `GET` | `/api/v1/meetings/:id/summary` | 요약 조회 |
| `GET` | `/api/v1/meetings/:id/transcripts` | 전사 기록 조회 |
| `POST` | `/api/v1/meetings/:id/audio` | 녹음 중 오디오 업로드 |
| `GET` | `/api/v1/meetings/:id/audio` | 오디오 다운로드 |
| `GET` | `/api/v1/meetings/:id/peaks` | 오디오 파형 데이터 |
| `POST` | `/api/v1/meetings/:id/lock` / `DELETE .../lock` | 회의 잠금(읽기전용) 설정/해제 |
| `GET/POST/DELETE` | `/api/v1/meetings/:id/collaborators` | 협업자 조회/추가/제거 |
| `POST` | `/api/v1/meetings/move_to_folder` | 폴더 이동 |
| `POST` | `/api/v1/meetings/move_to_project` | 프로젝트 이동 |

### 전사 기록

| Method | Endpoint | 설명 |
|--------|----------|------|
| `PATCH` | `/api/v1/meetings/:id/transcripts/:id/update_content` | 전사 내용 수정 |
| `PATCH` | `/api/v1/meetings/:id/transcripts/:id/update_speaker` | 화자변경 모드(내용 유지, 화자만 변경) |
| `POST` | `/api/v1/meetings/:id/transcripts/:id/split` | 발언 분할 |
| `DELETE` | `/api/v1/meetings/:id/transcripts/destroy_batch` | 전사 일괄 삭제 |
| `POST` | `/api/v1/meetings/:id/transcripts/redact` | 기밀 구간 절단 (비가역) |

### 회의 하위 리소스

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET/POST/PATCH/DELETE` | `/api/v1/meetings/:id/blocks` | 블록 CRUD |
| `PATCH` | `/api/v1/meetings/:id/blocks/:id/reorder` | 블록 순서 변경 |
| `GET/POST/PATCH/DELETE` | `/api/v1/meetings/:id/attachments` | 첨부파일 CRUD |
| `GET` | `/api/v1/meetings/:id/attachments/:id/download` | 첨부파일 다운로드 |
| `GET/POST/PATCH/DELETE` | `/api/v1/meetings/:id/bookmarks` | 북마크 CRUD |
| `GET/PATCH/DELETE` | `/api/v1/meetings/:id/contacts` | 회의 연락처(명함) |
| `GET/POST` | `/api/v1/meetings/:id/chat_messages` | 회의 스코프 AI 챗 |

### 프로젝트

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET/POST/PATCH/DELETE` | `/api/v1/projects` | 프로젝트 CRUD |
| `GET/POST/PATCH/DELETE` | `/api/v1/projects/:id/members` | 멤버 조회/추가/변경/제거 |
| `PUT` | `/api/v1/projects/:id/favorite` | 즐겨찾기 토글 |
| `POST` | `/api/v1/projects/:id/export` / `export_summaries` | 내보내기 / 요약 zip 내보내기 |
| `GET/POST/DELETE` | `/api/v1/projects/:id/invites` | 초대 코드 조회/생성/취소 |
| `GET/POST` | `/api/v1/projects/:id/chat_messages` | 프로젝트 스코프 AI 챗 |
| `GET` | `/api/v1/invite/:code`, `POST .../redeem` | 초대 미리보기 / 참여 |

### 폴더 & 태그 & 휴지통

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET/POST/PATCH/DELETE` | `/api/v1/folders` | 폴더 CRUD |
| `POST` | `/api/v1/folders/:id/export_summaries` | 폴더 요약 zip 내보내기 |
| `GET/POST/PATCH/DELETE` | `/api/v1/tags` | 태그 CRUD |
| `GET` | `/api/v1/trash` | 휴지통 목록 |
| `POST` | `/api/v1/trash/:type/:id/restore` | 삭제 항목 복구 |

### 용어집 · 도메인 파일

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET/POST/PATCH/DELETE` | `/api/v1/domain_files` | 도메인 파일(용어집 문서) CRUD |
| `POST` | `/api/v1/meetings/:id/glossary_entries` | 오인식 교정 규칙 생성 (회의 스코프) |
| `GET/POST` | `/api/v1/folders/:id/glossary_entries` | 오인식 교정 규칙 조회/생성 (폴더 스코프) |
| `PATCH/DELETE` | `/api/v1/glossary_entries/:id` | 교정 규칙 수정/삭제 |

### 설정

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET` | `/api/v1/settings` | 전체 설정 조회 |
| `POST` | `/api/v1/settings/stt_engine` | STT 엔진 변경 |
| `GET/PUT` | `/api/v1/settings/llm` | LLM 설정 조회/변경 |
| `POST` | `/api/v1/settings/llm/test` | LLM 연결 테스트 |
| `GET/PUT` | `/api/v1/settings/hf` | HF 토큰 조회/변경 |
| `GET/PUT` | `/api/v1/settings/app` | 앱 설정 조회/변경 |
| `GET/PUT` | `/api/v1/settings/dflow` | D'Flow 연동 설정 조회/변경 |

### LLM 프로필 · 사용자 LLM 설정

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET/POST/PATCH/DELETE` | `/api/v1/llm_profiles` | LLM 프리셋 프로필 CRUD (서버 풀 · 개인 풀) |
| `GET/PUT` | `/api/v1/user/llm_settings` | 사용자 LLM 설정(요약용/챗용) 조회/변경 |
| `POST` | `/api/v1/user/llm_settings/test` | 사용자 LLM 연결 테스트 |
| `POST` | `/api/v1/user/llm_settings/models` | 프로바이더 모델 목록 조회 |
| `PATCH` | `/api/v1/user/llm_settings/toggle` | 사용자 LLM 사용 여부 토글 |

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
| `DELETE` | `/api/v1/speakers/destroy_all` | 전체 화자 초기화 |

### WebSocket

| 채널 | 구독 | 설명 |
|------|------|------|
| `TranscriptionChannel` | `meeting_{id}_transcription` | 실시간 오디오 스트리밍 및 전사 결과 수신 |
| `ChatChannel` | 회의/폴더/프로젝트 스코프 | AI 챗 실시간 스트리밍 |

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
  interval_sec: 120           # 기본값. 회의별로 summary_interval_sec 필드로 개별 재정의 가능 (0=자동요약 끔)

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
│   │   │   ├── meeting/      # AudioRecorder, LiveRecord, ChatExpandDialog, MeetingFileDropOverlay, UploadAudioModal 등
│   │   │   ├── editor/       # MeetingEditor (BlockNote)
│   │   │   ├── auth/         # LoginPage, AuthGuard, ServerSetup
│   │   │   ├── folder/       # 폴더 관리, 요약 zip 내보내기
│   │   │   ├── project/      # 프로젝트 관리, 즐겨찾기 스위처
│   │   │   ├── recording/    # 로컬/실시간 녹음 UI
│   │   │   ├── stt/          # STT 엔진 선택 UI
│   │   │   ├── transfer/     # 내보내기/가져오기(전송) UI
│   │   │   ├── settings/     # SettingsModal, UserLlmSettings 등
│   │   │   └── ui/           # 공통 UI 컴포넌트
│   │   ├── hooks/            # 커스텀 React 훅 (다수, 예)
│   │   │   ├── useAudioRecorder.ts    # AudioWorklet 녹음 + VAD
│   │   │   ├── useTranscription.ts    # WebSocket STT 연동
│   │   │   ├── useAudioPlayer.ts      # 네이티브 Audio + peaks 재생
│   │   │   ├── useMeeting.ts          # 회의 상세 데이터 훅
│   │   │   ├── useCollaborators.ts    # 협업자 관리
│   │   │   ├── useLiveRecording.ts / useLocalRecording.ts
│   │   │   ├── useBlockSync.ts        # 블록 에디터 동기화
│   │   │   ├── useSttBlockInserter.ts # STT 결과 블록 삽입
│   │   │   └── useAuth.ts            # JWT 인증 훅
│   │   ├── pages/            # 페이지 컴포넌트
│   │   │   ├── DashboardPage.tsx      # 대시보드 (통계 + 최근 회의)
│   │   │   ├── MeetingsPage.tsx       # 회의 CRUD, 필터, 업로드
│   │   │   ├── ProjectsPage.tsx       # 프로젝트 목록/즐겨찾기
│   │   │   ├── MeetingLivePage.tsx    # 실시간 녹음 (3패널 레이아웃)
│   │   │   ├── MeetingPage.tsx        # 회의 상세 (에디터 + 기록 + AI 챗)
│   │   │   ├── MeetingViewerPage.tsx  # 다른 기기 녹음 중 실시간 뷰어
│   │   │   ├── SearchPage.tsx / TrashPage.tsx / InviteRedeemPage.tsx
│   │   │   ├── SetupPage.tsx          # 로컬/서버 모드 설정
│   │   │   └── LocalMeeting*Page.tsx  # 로컬(오프라인) 모드 전용 페이지
│   │   ├── stores/           # Zustand 상태 관리
│   │   │   ├── authStore.ts / meetingStore.ts / transcriptStore.ts
│   │   │   ├── projectStore.ts        # 프로젝트/즐겨찾기 상태
│   │   │   ├── chatStore.ts           # AI 챗 상태
│   │   │   ├── recordingStore.ts      # 녹음 상태
│   │   │   ├── folderStore.ts / promptTemplateStore.ts / appSettingsStore.ts
│   │   │   └── uiStore.ts            # UI 상태 (글자크기 등)
│   │   ├── lib/              # 유틸리티
│   │   └── config.ts         # config.yaml 로더
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                   # Rails API 서버
│   ├── app/
│   │   ├── controllers/
│   │   │   ├── api/v1/       # REST API 컨트롤러
│   │   │   │   ├── meetings_controller.rb / meetings_audio_controller.rb
│   │   │   │   ├── transcripts_controller.rb
│   │   │   │   ├── meeting_attachments_controller.rb / meeting_bookmarks_controller.rb / meeting_contacts_controller.rb
│   │   │   │   ├── meeting_dflow_controller.rb   # D'Flow 연동
│   │   │   │   ├── chat_messages_controller.rb / scoped_chat_messages_controller.rb
│   │   │   │   ├── projects_controller.rb / project_invites_controller.rb / project_transfers_controller.rb
│   │   │   │   ├── domain_files_controller.rb / glossary_entries_controller.rb
│   │   │   │   ├── llm_profiles_controller.rb / settings_controller.rb
│   │   │   │   ├── trash_controller.rb / search_controller.rb / invites_controller.rb
│   │   │   │   ├── speakers_controller.rb / folders_controller.rb / tags_controller.rb
│   │   │   │   ├── prompt_templates_controller.rb / meeting_templates_controller.rb
│   │   │   │   ├── health_controller.rb
│   │   │   │   ├── admin/         # 관리자 API
│   │   │   │   └── user/          # llm_settings, language_settings, password
│   │   │   └── auth/         # 인증 컨트롤러
│   │   │       ├── sessions_controller.rb
│   │   │       └── browser_sessions_controller.rb
│   │   ├── channels/         # ActionCable WebSocket
│   │   │   ├── transcription_channel.rb
│   │   │   └── chat_channel.rb
│   │   ├── jobs/             # Solid Queue 비동기 작업
│   │   │   ├── transcription_job.rb
│   │   │   ├── summarization_job.rb
│   │   │   ├── meeting_summarization_job.rb
│   │   │   ├── meeting_finalizer_job.rb
│   │   │   ├── audio_upload_job.rb
│   │   │   └── file_transcription_job.rb
│   │   ├── models/           # ActiveRecord 모델
│   │   │   ├── user.rb       # Devise JWT, 요약/챗 각각의 LLM 설정
│   │   │   ├── meeting.rb    # 핵심 모델, meeting/ concern 7개로 분해
│   │   │   ├── meeting/      # access_control, audio_duration, dflow, recording_healing,
│   │   │   │                 # recurring_schedule, summary_management, transcription_queue
│   │   │   ├── transcript.rb / transcript_embedding.rb # 오디오 청크, 타임스탬프, 화자, 검색 임베딩
│   │   │   ├── summary.rb    # AI 생성 요약
│   │   │   ├── block.rb      # BlockNote 직렬화
│   │   │   ├── project.rb / project_membership.rb / project_invite.rb / project_favorite.rb  # 팀(team) 대체
│   │   │   ├── folder.rb
│   │   │   ├── tag.rb / tagging.rb
│   │   │   ├── meeting_attachment.rb / meeting_bookmark.rb / meeting_contact.rb
│   │   │   ├── meeting_collaborator.rb  # 회의 협업자 (읽기전용 권한)
│   │   │   ├── meeting_template.rb / prompt_template.rb
│   │   │   ├── chat_message.rb    # 회의/폴더/프로젝트 스코프 AI 챗
│   │   │   ├── llm_profile.rb     # 서버/개인 LLM 프리셋 프로필
│   │   │   └── domain_file.rb / domain_file_link.rb / glossary_entry.rb  # 용어집·오인식 교정
│   │   └── services/         # 비즈니스 로직
│   │       ├── sidecar_client.rb
│   │       ├── meeting_finalizer_service.rb
│   │       ├── transcript_redaction_service.rb / audio_redactor.rb  # 기밀 구간 절단
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
│   │   ├── main.py           # FastAPI 엔트리포인트 (idle offload 루프 포함)
│   │   ├── config.py         # settings.yaml 로더 + Pydantic 설정
│   │   ├── schemas.py        # 응답 스키마 (HealthResponse의 embed_state 등)
│   │   ├── routers/          # health, stt, embeddings, llm, settings, speakers
│   │   ├── stt/              # STT 어댑터 패턴
│   │   │   ├── base.py       # 추상 어댑터
│   │   │   ├── factory.py    # 엔진 팩토리 (자동 감지)
│   │   │   ├── qwen3_adapter.py          # Qwen3-ASR (MLX)
│   │   │   ├── qwen3_transformers_adapter.py  # Qwen3-ASR (CUDA/vllm)
│   │   │   ├── whisper_adapter.py / mlx_whisper_adapter.py / faster_whisper_adapter.py
│   │   │   ├── idle_offload.py           # 유휴 시 GPU→CPU→언로드 상태 머신 (STT·임베딩 공용)
│   │   │   └── mock_adapter.py           # 테스트용
│   │   ├── embeddings/       # KURE 임베딩 인코더 (encoder.py)
│   │   ├── diarization/      # 화자 분리 (speaker.py, speaker_db.py, batch_processor.py 등)
│   │   └── llm/              # LLM 통합 (summarizer.py, prompts.py)
│   ├── speakrs-cli/           # 화자 분리 Rust 서브프로젝트
│   ├── pyproject.toml        # uv 패키지 정의
│   └── tests/                 # 약 40개 test_*.py
│
├── e2e/                       # Playwright E2E 테스트
│   ├── tests/
│   │   ├── auth.spec.ts      # 인증 흐름
│   │   ├── meeting.spec.ts   # 회의 CRUD
│   │   ├── minutes.spec.ts   # 실시간 전사
│   │   ├── pipeline.spec.ts  # 전체 파이프라인
│   │   ├── team.spec.ts      # 프로젝트 생성·초대
│   │   ├── export.spec.ts    # 내보내기
│   │   └── summary-fullview.spec.ts  # 요약 확대보기
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
├── config.yaml                # 정적 설정 (URL, UI 라벨, 오디오 파라미터, 회의 유형)
├── Procfile                   # foreman 프로세스 정의 (Vite 개발 서버 용도)
├── dev.sh                     # tmux + Caddy 기반 통합 실행 스크립트 (권장)
├── Caddyfile.local             # LAN HTTPS 단일 origin 설정
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
