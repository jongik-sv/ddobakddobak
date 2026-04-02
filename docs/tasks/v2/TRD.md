# TRD: 또박또박 (ddobakddobak) v2

> Technical Requirements Document — PRD v2 기반 기술 설계 상세

**문서 버전:** v2.0
**작성일:** 2026-04-02
**상태:** Draft
**참조:** [PRD v2](./PRD.md), [서버/클라이언트 전환 계획](./server-client-migration.md)
**이전 버전:** [TRD v1](../V1/TRD.md)

---

## 1. 시스템 아키텍처

### 1.1 배포 모드별 구성

#### 모드 A: 데스크톱 로컬 실행 (V1 호환)

```
┌─ Tauri 앱 ─────────────────────────────────────────────────────┐
│                                                                 │
│  Tauri Runtime (Rust)                                           │
│  ├─ 환경 확인 (ruby, uv, ffmpeg)                                │
│  ├─ 의존성 설치 (bundle install, uv sync)                       │
│  ├─ 프로세스 관리 (Rails, Sidecar spawn/kill)                   │
│  └─ 헬스체크 (포트 모니터링)                                     │
│                                                                 │
│  ┌─ React SPA (WebView) ─────────────────────────────────────┐  │
│  │  Web Audio API ──→ AudioWorklet ──→ WebSocket 전송         │  │
│  │  블록 에디터 (BlockNote)  라이브 기록 뷰  AI 요약 패널      │  │
│  └──────────────┬──────────────────┬─────────────────────────┘  │
│                 │ REST API         │ WebSocket (ActionCable)     │
│  ┌──────────────┴──────────────────┴─────────────────────────┐  │
│  │              Ruby on Rails API (:13323)                     │  │
│  │  Solid Queue (Jobs) + ActionCable (WS) + SidecarClient     │  │
│  └──────────────┬────────────────────────────────────────────┘  │
│                 │ HTTP (localhost:13324)                         │
│  ┌──────────────┴────────────────────────────────────────────┐  │
│  │              Python Sidecar (:13324)                        │  │
│  │  STT (Qwen3-ASR/Whisper) + PyAnnote + LLM Client          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  SQLite (WAL) ── storage/audio/ ── models/ ── speaker_dbs/     │
│  인증 없음: desktop@local 자동 생성                               │
└─────────────────────────────────────────────────────────────────┘
```

#### 모드 B: 서버 배포 (V2)

```
┌──────────────┐           ┌───────────────────────────────────────┐
│ Tauri 클라이언트│  HTTPS    │ Linux 서버 (GTX 1080, 8GB VRAM)       │
│              │ ────────→ │                                       │
│ React SPA   │           │  Cloudflare Tunnel (HTTPS 자동)        │
│ (ML 없음)   │ ←──WSS──  │    │                                   │
│              │           │    ├→ Rails (:13323)                   │
│ JWT 토큰    │           │    │   ├─ REST API + ActionCable        │
│ localStorage│           │    │   ├─ Solid Queue (Jobs)            │
│              │           │    │   ├─ JWT 인증 (Devise)             │
│ 서버 URL 설정│           │    │   └─ SidecarClient                 │
└──────────────┘           │    │        │ HTTP (localhost)          │
                           │    │        ▼                          │
                           │    └→ Sidecar (:13324)                │
                           │        ├─ Qwen3-ASR (CUDA)            │
                           │        ├─ faster-whisper (CUDA)       │
                           │        ├─ PyAnnote (CUDA)             │
                           │        └─ LLM API (사용자별 키)        │
                           │                                       │
                           │  SQLite (WAL) ── storage/audio/       │
                           │  systemd 서비스 (자동 시작/재시작)       │
                           └───────────────────────────────────────┘
```

### 1.2 프로세스 구성

| 프로세스 | 역할 | 포트 | 비고 |
|---------|------|------|------|
| Rails API (Puma) | REST API + WebSocket + Job Queue | 13323 | systemd 서비스 |
| Python Sidecar (Uvicorn) | STT + 화자분리 + LLM 호출 | 13324 | systemd 서비스 |
| Cloudflare Tunnel | HTTPS 터널링 | — | 서버 모드에서만, systemd 서비스 |

### 1.3 통신 흐름

```
클라이언트 → Cloudflare Tunnel → Rails : REST API (JSON) + WebSocket (ActionCable)
Rails → Sidecar                        : HTTP (localhost, 내부)
클라이언트 → Sidecar                    : 없음 (항상 Rails 경유)
```

---

## 2. 프론트엔드 상세

### 2.1 기술 스택

| 항목 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | React | 19 |
| 언어 | TypeScript | 5.9 |
| 빌드 도구 | Vite | 6+ |
| 상태 관리 | Zustand | 5 |
| 블록 에디터 | BlockNote | 0.47 |
| 다이어그램 | Mermaid | 11 |
| 오디오 재생 | wavesurfer.js | 7 |
| WebSocket | @rails/actioncable | 8.1 |
| HTTP | ky | 1.14 |
| 스타일링 | Tailwind CSS + tailwind-merge | 4+ |
| 아이콘 | lucide-react | 1.0 |
| 날짜 | date-fns | 4.1 |
| 레이아웃 | react-resizable-panels | 4.7 |
| 라우팅 | React Router | 7 |
| 내보내기 | html2pdf.js (PDF), docx (DOCX) | |
| Tauri | @tauri-apps/api, plugin-dialog, plugin-fs, plugin-shell, plugin-deep-link | 2.x |

### 2.2 디렉토리 구조

```
frontend/src/
├── api/                    # API 클라이언트 (13개 모듈)
│   ├── client.ts           # ky 인스턴스 (JWT 헤더 자동 첨부)
│   ├── auth.ts             # 로그인/로그아웃/토큰 갱신 (V2 신규)
│   ├── meetings.ts         # 회의 CRUD + 녹음/전사/요약
│   ├── folders.ts          # 폴더 CRUD
│   ├── tags.ts             # 태그 CRUD
│   ├── settings.ts         # STT/LLM/앱 설정
│   ├── attachments.ts      # 첨부파일
│   └── ...
├── channels/               # ActionCable 채널
│   └── transcription.ts    # 실시간 STT 채널
├── components/
│   ├── auth/               # 로그인 UI (V2 신규)
│   │   ├── LoginPage.tsx
│   │   └── ServerSetup.tsx
│   ├── meeting/            # 회의 관련 (13개)
│   ├── editor/             # BlockNote + 커스텀 블록
│   ├── folder/             # 폴더 트리 + 다이얼로그
│   ├── layout/             # AppLayout, Sidebar
│   ├── action-item/        # Action Item UI
│   ├── settings/           # 설정 모달 (개인 LLM 설정 포함)
│   └── ui/                 # 공통 UI 컴포넌트
├── pages/
│   ├── SetupPage.tsx       # 첫 실행 환경 확인 (로컬 모드)
│   ├── MeetingsPage.tsx    # 회의 목록
│   ├── MeetingPage.tsx     # 회의 상세 (완료 후)
│   ├── MeetingLivePage.tsx # 실시간 녹음
│   └── DashboardPage.tsx   # 대시보드
├── stores/                 # Zustand 스토어
│   ├── authStore.ts        # 인증 상태 (V2 신규)
│   ├── meetingStore.ts     # 회의 목록/필터
│   ├── transcriptStore.ts  # 실시간 전사 상태
│   ├── folderStore.ts      # 폴더 트리
│   ├── appSettingsStore.ts # 오디오/AI 설정
│   ├── uiStore.ts          # UI 상태
│   └── promptTemplateStore.ts
├── hooks/                  # 커스텀 훅
│   ├── useAuth.ts          # 인증 흐름 (V2 신규)
│   ├── useAudioRecorder.ts # Web Audio API + VAD
│   ├── useAudioPlayer.ts   # 오디오 재생 제어
│   ├── useTranscription.ts # ActionCable STT 연결
│   ├── useSystemAudioCapture.ts # macOS 시스템 오디오
│   └── ...
├── lib/                    # 유틸리티
├── config.ts               # API URL, 환경변수, 모드 분기
└── App.tsx                 # 라우팅 정의 (인증 가드 추가)
```

### 2.3 API URL 분기 (V2 변경)

```typescript
// frontend/src/config.ts
// 서버 모드: 사용자가 설정한 서버 URL
// 로컬 모드: localhost:13323 (V1 호환)

const serverUrl = localStorage.getItem('server_url')
const mode = localStorage.getItem('mode') || 'local'  // 'local' | 'server'

export const API_BASE_URL = mode === 'server'
  ? `${serverUrl}/api/v1`
  : 'http://127.0.0.1:13323/api/v1'

export const WS_URL = mode === 'server'
  ? `${serverUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/cable`
  : 'ws://127.0.0.1:13323/cable'
```

### 2.4 인증 흐름 (V2 신규)

```
[앱 시작]
  ├─ mode === 'local' → SetupPage (기존 V1 흐름)
  └─ mode === 'server'
       ├─ JWT 토큰 있음? → 토큰 유효성 검증
       │    ├─ 유효 → 메인 화면
       │    └─ 만료 → Refresh Token으로 갱신
       │         ├─ 갱신 성공 → 메인 화면
       │         └─ 갱신 실패 → 로그인 화면
       └─ JWT 토큰 없음 → 로그인 화면
            └─ 로그인 클릭 → 브라우저로 서버 로그인 페이지 열기
                 → 인증 성공 → ddobak://callback?token=xxx
                 → Tauri deep-link으로 수신 → localStorage 저장
```

### 2.5 오디오 캡처 파이프라인

```
마이크 ──────────────→ AudioWorklet (PCM 16kHz mono)
                              │
시스템 오디오 (macOS) ──→ Mix  │
                              │
                    ┌─────────┤
                    │         │
              WebSocket 전송  MediaRecorder
              (STT용 청크)    (원본 녹음 webm)
                    │              │
              Rails API       Blob → 서버 업로드
              → Sidecar STT   → storage/audio/
```

**VAD (Voice Activity Detection) 처리:**
- RMS 기반 음성/무음 판단 (히스테리시스)
- 무음 감지 임계값: 0.03 (조절 가능)
- 음성 복귀 임계값: 0.06 (조절 가능)
- 무음 지속 시 청크 전송: 800ms
- 최대 청크 길이: 15초 (강제 전송)
- 최소 청크 길이: 1초 (미만 무시)
- 프리롤: 300ms (문장 시작 포착)
- 오버랩: 200ms (청크 경계 음절 손실 방지)

---

## 3. 백엔드 상세 (Rails API)

### 3.1 기술 스택

| 항목 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | Ruby on Rails (API 모드) | 8.1 |
| Ruby | | 4.0.2 |
| DB | SQLite (WAL 모드) | 3.40+ |
| WebSocket | ActionCable | Rails 내장 |
| 백그라운드 잡 | Solid Queue | DB 기반 큐 |
| 인증 | Devise + devise-jwt | JWT 토큰 |
| CORS | rack-cors | |
| 서버 | Puma | 7.2 |

### 3.2 데이터베이스

```yaml
# 로컬 / 서버 공통 — SQLite (WAL 모드)
production:
  adapter: sqlite3
  database: db/production.sqlite3
  pool: 10
  timeout: 10000
  pragmas:
    journal_mode: wal
    busy_timeout: 10000
```

### 3.3 인증 (V2 신규)

#### JWT 토큰 구조

| 토큰 | 만료 | 용도 |
|------|------|------|
| Access Token | 24시간 | API 요청 인증 |
| Refresh Token | 30일 | Access Token 갱신 |

#### 인증 API

| Method | Path | 설명 |
|--------|------|------|
| POST | `/auth/login` | 이메일+비밀번호 → JWT 발급 |
| POST | `/auth/refresh` | Refresh Token → 새 Access Token |
| DELETE | `/auth/logout` | 토큰 무효화 (jti 폐기) |
| GET | `/auth/login` | 브라우저용 로그인 폼 (HTML) |
| GET | `/auth/callback` | 인증 성공 → 딥링크 리다이렉트 |

#### 모드별 인증 분기

```ruby
# app/controllers/concerns/default_user_lookup.rb
def default_user
  if server_mode?
    # 서버 모드: JWT 인증 필수
    authenticate_user!
    current_user
  else
    # 로컬 모드: 기존 동작 유지
    User.find_or_create_by!(email: "desktop@local") { |u| u.name = "사용자" }
  end
end
```

### 3.4 API 엔드포인트

모든 엔드포인트는 `/api/v1` 네임스페이스 하위. 서버 모드에서는 JWT 인증 필수.

#### 회의 관리

| Method | Path | 설명 |
|--------|------|------|
| GET | `/meetings` | 목록 (검색, 상태/날짜/폴더 필터, 페이징) |
| POST | `/meetings` | 생성 |
| GET | `/meetings/:id` | 상세 |
| PATCH | `/meetings/:id` | 수정 (제목, 메모, 유형, 폴더) |
| DELETE | `/meetings/:id` | 삭제 |
| POST | `/meetings/upload_audio` | 오디오 파일 업로드 → 전사 |
| POST | `/meetings/move_to_folder` | 다건 폴더 이동 |
| POST | `/meetings/:id/start` | 녹음 시작 |
| POST | `/meetings/:id/stop` | 녹음 종료 |
| POST | `/meetings/:id/summarize` | 수동 요약 트리거 |
| POST | `/meetings/:id/regenerate_stt` | STT 재실행 |
| POST | `/meetings/:id/regenerate_notes` | AI 요약 재생성 |
| POST | `/meetings/:id/feedback` | 요약 피드백 |
| GET | `/meetings/:id/summary` | 최신 요약 조회 |
| GET | `/meetings/:id/export` | Markdown 내보내기 |
| GET | `/meetings/:id/transcripts` | 전사 목록 |

#### 오디오

| Method | Path | 설명 |
|--------|------|------|
| POST | `/meetings/:id/audio` | 오디오 청크 업로드 |
| GET | `/meetings/:id/audio` | 오디오 파일 다운로드/스트리밍 |
| GET | `/meetings/:id/peaks` | 오디오 길이 메타데이터 |

#### Action Items

| Method | Path | 설명 |
|--------|------|------|
| GET | `/meetings/:id/action_items` | 회의별 목록 |
| POST | `/meetings/:id/action_items` | 생성 |
| PATCH | `/action_items/:id` | 수정 (상태, 담당자, 마감일) |
| DELETE | `/action_items/:id` | 삭제 |

#### 블록 (에디터)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/meetings/:id/blocks` | 블록 목록 |
| POST | `/meetings/:id/blocks` | 블록 추가 |
| PATCH | `/meetings/:id/blocks/:id` | 블록 수정 |
| DELETE | `/meetings/:id/blocks/:id` | 블록 삭제 |

#### 첨부파일

| Method | Path | 설명 |
|--------|------|------|
| GET | `/meetings/:id/attachments` | 목록 |
| POST | `/meetings/:id/attachments` | 업로드 |
| PATCH | `/meetings/:id/attachments/:id` | 수정 |
| DELETE | `/meetings/:id/attachments/:id` | 삭제 |
| GET | `/meetings/:id/attachments/:id/download` | 다운로드 |

#### 폴더 / 태그 / 화자

| Method | Path | 설명 |
|--------|------|------|
| GET/POST/PATCH/DELETE | `/folders` | 폴더 CRUD |
| GET/POST/PATCH/DELETE | `/tags` | 태그 CRUD |
| GET/PATCH/DELETE | `/speakers` | 화자 관리 |

#### 설정

| Method | Path | 설명 |
|--------|------|------|
| GET | `/settings` | 현재 설정 |
| POST | `/settings/stt_engine` | STT 엔진 변경 |
| GET/PUT | `/settings/llm` | LLM 설정 (V2: 사용자별) |
| POST | `/settings/llm/test` | LLM 연결 테스트 |
| GET/PUT | `/settings/hf` | Hugging Face 설정 |
| GET/PUT | `/settings/app` | 앱 설정 |

#### 사용자 설정 (V2 신규)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/user/llm_settings` | 내 LLM 설정 조회 |
| PUT | `/user/llm_settings` | 내 LLM 설정 변경 |
| POST | `/user/llm_settings/test` | 내 LLM 연결 테스트 |

#### WebSocket 채널

| 채널 | 스트림 이름 | 설명 |
|------|-----------|------|
| TranscriptionChannel | `meeting_{id}_transcription` | 오디오 청크 수신 → STT 결과 브로드캐스트 |

### 3.5 백그라운드 잡

| 잡 | 큐 | 역할 |
|----|---|------|
| TranscriptionJob | real_time | 오디오 청크 → Sidecar STT → DB 저장 → 브로드캐스트 |
| SummarizationJob | summarization | 주기적으로 recording 상태 회의 스캔 → 요약 트리거 |
| MeetingSummarizationJob | summarization | 개별 회의 실시간/최종 요약 (사용자별 LLM 사용) |
| FileTranscriptionJob | file_transcription | 파일 → PCM 변환 → Sidecar 전사 → 요약 → 완료 |
| MeetingFinalizerJob | summarization | Action Item 추출 |

### 3.6 서비스

| 서비스 | 역할 |
|--------|------|
| SidecarClient | Python Sidecar HTTP 클라이언트 (STT, 요약, 설정 프록시) |
| MarkdownExporter | 회의 데이터 → Markdown 변환 |
| MeetingFinalizerService | 회의 종료 시 Action Item 추출 |

---

## 4. Python Sidecar 상세

### 4.1 기술 스택

| 항목 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | FastAPI | 0.135+ |
| ASGI | Uvicorn | 0.42+ |
| 설정 | pydantic-settings | 2.13+ |
| STT | pywhispercpp, faster-whisper, mlx-audio | 플랫폼별 |
| 화자분리 | pyannote-audio | 4.0+ |
| LLM | anthropic SDK, openai SDK | |
| 패키지 관리 | uv | 최신 |
| Python | | 3.11+ |

### 4.2 STT 엔진 자동 선택

```python
def auto_select_engine() -> str:
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "qwen3_asr_8bit"      # Apple Silicon → MLX (Metal GPU)
    if torch.cuda.is_available():
        return "qwen3_asr_transformers"  # NVIDIA → Transformers (CUDA)
    return "whisper_cpp"              # 기타 → CPU 폴백
```

| 엔진 | 플랫폼 | 라이브러리 | 모델 |
|------|--------|----------|------|
| qwen3_asr_8bit | macOS Apple Silicon | mlx-audio, mlx-lm | Qwen3-ASR-1.7B-8bit |
| qwen3_asr_6bit | macOS Apple Silicon | mlx-audio, mlx-lm | Qwen3-ASR-1.7B-6bit |
| qwen3_asr_4bit | macOS Apple Silicon | mlx-audio, mlx-lm | Qwen3-ASR-1.7B-4bit |
| qwen3_asr_transformers | NVIDIA CUDA | torch, transformers | Qwen3-ASR-1.7B |
| faster_whisper | NVIDIA CUDA / CPU | faster-whisper (CTranslate2) | large-v3-turbo |
| whisper_cpp | 모든 플랫폼 | pywhispercpp | large-v3-turbo |
| mock | 개발용 | — | — |

### 4.3 API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/transcribe` | 오디오 청크 → 텍스트 (화자분리 포함) |
| POST | `/transcribe-file` | 파일 전체 전사 (청크 분할 + 후처리) |
| WS | `/ws/transcribe` | 실시간 오디오 스트리밍 |
| POST | `/summarize` | 트랜스크립트 → AI 요약 (JSON) |
| POST | `/refine-notes` | 기존 노트 + 신규 전사 → 개선된 노트 |
| POST | `/feedback-notes` | 사용자 피드백 반영 |
| GET | `/speakers` | 회의별 화자 목록 |
| PUT | `/speakers/{id}` | 화자 이름 변경 |
| DELETE | `/speakers` | 화자 초기화 |
| GET/PUT | `/settings/stt-engine` | STT 엔진 조회/변경 |
| GET/PUT | `/settings/llm` | LLM 설정 조회/변경 |
| POST | `/settings/llm/test` | LLM 연결 테스트 |
| GET/PUT | `/settings/hf` | HuggingFace 토큰 |
| GET | `/health` | 헬스체크 (엔진 상태, 모델 로드 여부) |

### 4.4 화자분리 파이프라인

```
오디오 청크 (PCM 16kHz Int16)
    │
    ▼
STT 엔진 → TranscriptSegment[] (text, timestamps)
    │
    ▼
PyAnnote Speaker Diarization
    ├─ 음성 구간 감지 (VAD)
    ├─ 화자 임베딩 추출 (WeSpeaker ResNet34)
    ├─ 유사도 기반 매칭 (임계값: 0.10)
    │   ├─ 기존 화자 매칭 → 기존 라벨
    │   └─ 새 화자 → 새 라벨 + 임베딩 저장
    └─ 사후 병합 (임계값: 0.35)
    │
    ▼
화자 라벨 매핑된 최종 Segment[]
```

**화자 DB 구조:** 회의별 JSON 파일 (`speaker_dbs/meeting_{id}.json`)

### 4.5 LLM 요약

**V2 변경:** 요약 요청 시 사용자별 LLM 설정을 Rails에서 전달받는다.

```python
# POST /summarize 요청 body에 사용자 LLM 설정 포함
{
  "transcripts": [...],
  "llm_config": {                    # V2: 사용자별 설정
    "provider": "anthropic",
    "api_key": "sk-xxx",
    "model": "claude-sonnet-4-6",
    "base_url": ""
  }
}
```

**지원 프로바이더:**

| 프로바이더 | 비고 |
|-----------|------|
| Anthropic | Claude 시리즈 |
| OpenAI 호환 | OpenAI, Ollama, vLLM 등 |
| CLI 파이프 | Claude CLI, Gemini CLI (토큰 불필요) |

### 4.6 플랫폼별 의존성

```toml
[project.optional-dependencies]
macos = [
    "mlx-audio>=0.4.1",
    "mlx-lm>=0.31.1",
    "pywhispercpp>=1.4.1",
    "pyannote-audio>=4.0.4",
]
cuda = [
    "faster-whisper>=1.1.0",
    "pyannote-audio>=4.0.4",
]
cpu = [
    "pywhispercpp>=1.4.1",
]
```

### 4.7 리소스 관리

- `gpu_lock`: GPU 동시 접근 방지 (STT + 화자분리 직렬화)
- `engine_lock`: STT 엔진 런타임 전환 시 직렬화
- 모델 전환 후 명시적 GC + 메모리 해제
- 회의별 화자 분리기 인스턴스 (lazy 생성)

---

## 5. 실시간 데이터 플로우

### 5.1 실시간 녹음 전체 흐름

```
[1] 사용자: "회의 시작" 클릭
    ├─ POST /api/v1/meetings/:id/start → status = 'recording'
    ├─ 브라우저: getUserMedia + AudioWorklet + MediaRecorder 시작
    └─ ActionCable: TranscriptionChannel 구독

[2] 녹음 중 (반복, VAD 기반)
    ├─ AudioWorklet → VAD → 음성 구간 PCM 청크 (1~15초)
    │   → WebSocket perform('audio_chunk', { base64, seq, offset_ms, ... })
    │   → Rails TranscriptionChannel → TranscriptionJob enqueue
    │   → Job: SidecarClient.transcribe(audio, config)
    │   → Sidecar: STT + 화자분리 → segments
    │   → Job: Transcript.create! + ActionCable broadcast
    │
    └─ 설정 간격(기본 60초): SummarizationJob 실행
        → 미적용 트랜스크립트 수집
        → SidecarClient.refine_notes(notes, transcripts, user_llm_config)
        → Summary 저장 + ActionCable broadcast

[3] 사용자: "회의 종료" 클릭
    ├─ POST /api/v1/meetings/:id/stop → status = 'completed'
    ├─ 브라우저: 녹음 중지 → 원본 오디오 업로드
    └─ MeetingSummarizationJob (type: final, user_llm_config)
        ├─ 전체 트랜스크립트 → 최종 요약
        └─ MeetingFinalizerJob → Action Item 추출
```

### 5.2 파일 업로드 전사 흐름

```
[1] POST /api/v1/meetings/upload_audio (파일 첨부)
    → Meeting 생성 (status: transcribing)
    → 파일 저장 → FileTranscriptionJob enqueue

[2] FileTranscriptionJob 실행
    ├─ ffmpeg: 원본 → PCM 16kHz mono 변환
    ├─ SidecarClient.transcribe_file(pcm_path, languages, chunk_sec)
    ├─ Transcript 일괄 생성 (progress broadcast: 10% → 70%)
    ├─ MeetingSummarizationJob (type: final) → 요약 (80% → 95%)
    ├─ MeetingFinalizerJob → Action Item 추출
    └─ status = 'completed' (progress: 100%)
```

---

## 6. Tauri 데스크톱 앱

### 6.1 구성

```
frontend/src-tauri/
├── src/
│   ├── lib.rs          # 프로세스 오케스트레이션, Tauri 커맨드
│   ├── main.rs         # 엔트리포인트
│   └── audio/
│       ├── mod.rs      # 플랫폼별 모듈 로딩
│       ├── capture_macos.rs   # ScreenCaptureKit
│       └── capture_windows.rs # WASAPI loopback
├── tauri.conf.json     # 앱 설정 (deep-link 스킴 포함)
├── Cargo.toml          # Rust 의존성
└── Entitlements.plist  # macOS 권한
```

### 6.2 Tauri 커맨드

| 커맨드 | 로컬 모드 | 서버 모드 |
|--------|----------|----------|
| `check_environment` | ruby, uv, ffmpeg 확인 | 사용 안 함 |
| `run_setup` | bundle install + uv sync | 사용 안 함 |
| `start_services` | Rails + Sidecar spawn | 사용 안 함 |
| `stop_services` | 프로세스 종료 | 사용 안 함 |
| `check_health` | 양 서비스 헬스체크 | 서버 URL 헬스체크 |
| `start_system_audio_capture` | macOS 시스템 오디오 캡처 | 사용 안 함 |
| `stop_system_audio_capture` | 시스템 오디오 캡처 중지 | 사용 안 함 |

### 6.3 앱 시작 플로우 (V2: 모드 분기)

```
앱 실행
  ├─ localStorage 확인: mode = ?
  │
  ├─ mode === 'local' (V1 호환)
  │    ├─ SetupPage → 환경 확인 → 의존성 설치 → 서비스 시작 → 메인 화면
  │    └─ 인증 없음 (desktop@local)
  │
  └─ mode === 'server' (V2)
       ├─ JWT 토큰 확인 → 유효하면 메인 화면
       └─ 토큰 없음/만료 → 브라우저 로그인 → 딥링크로 토큰 수신 → 메인 화면
```

---

## 7. 보안

### 7.1 로컬 모드

- 인증 없음 (DefaultUserLookup으로 자동 사용자 생성)
- 모든 데이터 로컬 저장
- LLM API 호출 시에만 외부 통신

### 7.2 서버 모드

| 항목 | 설명 |
|------|------|
| 통신 | HTTPS (Cloudflare Tunnel 자동 SSL) |
| 인증 | JWT (Access Token + Refresh Token) |
| 비밀번호 | bcrypt 해싱 (Devise 기본) |
| LLM API 키 | Rails encrypted attributes로 암호화 저장 |
| CORS | 화이트리스트 (환경변수 관리) |
| 팀 격리 | 팀 간 데이터 접근 차단 |
| WebSocket | JWT 토큰으로 채널 인증 |

---

## 8. 환경 설정

### 8.1 환경변수

```bash
# ── Rails ──
RAILS_ENV=production
SECRET_KEY_BASE=<생성된 값>
AUDIO_DIR=<오디오 저장 경로>           # 기본: storage/audio
SIDECAR_HOST=localhost
SIDECAR_PORT=13324
CORS_ORIGIN=https://api.도메인.com     # 서버 모드 시
SERVER_MODE=true                       # 서버/로컬 모드 분기

# ── Sidecar ──
STT_ENGINE=auto                        # auto | qwen3_asr_transformers | faster_whisper | ...
HF_TOKEN=<huggingface_token>
HOST=0.0.0.0
PORT=13324
MODELS_DIR=<모델 캐시 경로>
SPEAKER_DBS_DIR=<화자 DB 경로>
```

### 8.2 config.yaml (프론트엔드 공유 설정)

프로젝트 루트 `config.yaml`에서 프론트엔드가 사용하는 설정값을 관리:
- STT 엔진 라벨
- 오디오 청킹 파라미터 기본값
- 화자분리 임계값 기본값
- 지원 언어 목록
- 회의 유형 목록
- AI 요약 간격 옵션

---

## 9. 개발 환경

### 9.1 사전 요구사항

| 항목 | 버전 | 설치 |
|------|------|------|
| Ruby | 4.0+ | `rbenv install 4.0.2` |
| Node.js | 20+ | `nvm install 20` |
| Python | 3.11+ | 시스템 Python 또는 pyenv |
| uv | 최신 | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Rust | stable | `rustup` (Tauri 빌드 시) |
| ffmpeg | 6+ | `brew install ffmpeg` |
| SQLite | 3.40+ | macOS 기본 포함 |

### 9.2 로컬 실행

```bash
# 터미널 1: Rails
cd backend && bin/rails server -p 13323

# 터미널 2: Sidecar
cd sidecar && uv run uvicorn app.main:app --port 13324

# 터미널 3: Frontend (웹)
cd frontend && npm run dev -- --port 13325

# 또는 Tauri 개발 모드 (데스크톱)
cd frontend && npm run tauri dev
```

### 9.3 테스트

| 레이어 | 도구 | 대상 |
|--------|------|------|
| Rails 모델/서비스 | RSpec | 비즈니스 로직, DB 쿼리 |
| Rails API | RSpec (request spec) | API 엔드포인트 |
| Rails 채널 | RSpec (channel spec) | ActionCable |
| Python Sidecar | pytest + httpx | STT, 요약, 설정 |
| React 컴포넌트 | Vitest + Testing Library | UI |
| E2E | Playwright | 주요 사용자 흐름 |

### 9.4 프로젝트 루트 구조

```
ddobakddobak/
├── backend/            # Ruby on Rails API
├── frontend/           # React SPA + Tauri
│   └── src-tauri/      # Rust (Tauri 런타임)
├── sidecar/            # Python ML 서비스
├── e2e/                # E2E 테스트 (Playwright)
├── docs/
│   └── tasks/
│       ├── V1/         # V1 문서 아카이브
│       └── v2/
│           ├── PRD.md
│           ├── TRD.md  # 이 문서
│           └── server-client-migration.md
├── config.yaml         # 공유 설정
├── settings.yaml       # 런타임 설정 (STT/LLM/오디오)
└── Procfile            # 로컬 개발용
```
