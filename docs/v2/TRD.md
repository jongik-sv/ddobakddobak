# TRD: 또박또박 (ddobakddobak) v2

> Technical Requirements Document — PRD v2 기반 기술 설계 상세

**문서 버전:** v2.0
**작성일:** 2026-03-31
**상태:** Active
**참조:** [PRD v2](./PRD.md), [서버/클라이언트 전환 계획](../server-client-migration.md)
**이전 버전:** [TRD v1](../TRD.md)

---

## 1. 시스템 아키텍처

### 1.1 배포 모드별 구성

#### 모드 A: 데스크톱 로컬 실행 (현재)

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
│  │                                                            │  │
│  │  Web Audio API ──→ AudioWorklet ──→ WebSocket 전송         │  │
│  │  블록 에디터 (BlockNote)  라이브 기록 뷰  AI 요약 패널      │  │
│  │  폴더 트리  오디오 플레이어  설정  내보내기(MD/PDF/DOCX)     │  │
│  │                                                            │  │
│  └──────────────┬──────────────────┬─────────────────────────┘  │
│                 │ REST API         │ WebSocket (ActionCable)     │
│                 │ (JSON)           │ (오디오 스트림 + 이벤트)      │
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
└─────────────────────────────────────────────────────────────────┘
```

#### 모드 B: 서버 배포 (계획)

```
┌────────────────┐          ┌──────────────────────────────────────┐
│ 클라이언트       │  HTTPS   │ Linux 서버 (NVIDIA GPU)               │
│                │ ───────→ │                                      │
│ - 웹 브라우저   │          │  nginx (:443)                        │
│ - Tauri 앱     │ ←─────── │   ├→ Rails (:13323)                  │
│   (씬 클라이언트)│   WSS    │   │   ├─ REST API + ActionCable      │
│                │          │   │   ├─ Solid Queue (Jobs)           │
│ ML 없음        │          │   │   └─ SidecarClient                │
│ 프로세스 1개    │          │   │        │ HTTP                     │
└────────────────┘          │   │        ▼                          │
                            │   └→ Sidecar (:13324)                │
                            │       ├─ faster-whisper (CUDA)       │
                            │       ├─ PyAnnote (CUDA)             │
                            │       └─ LLM API (Anthropic/OpenAI)  │
                            │                                      │
                            │  PostgreSQL (:5432)                   │
                            │  오디오 파일 볼륨                      │
                            │  ML 모델 캐시 볼륨                     │
                            └──────────────────────────────────────┘
```

### 1.2 프로세스 구성

| 프로세스 | 역할 | 포트 | 비고 |
|---------|------|------|------|
| Rails API | REST API + WebSocket + Job Queue | 13323 | Puma 서버 |
| Python Sidecar | STT + 화자분리 + LLM 호출 | 13324 | Uvicorn (FastAPI) |
| PostgreSQL | DB (서버 모드) | 5432 | 서버 배포 시에만 |
| nginx | 리버스 프록시 + 정적 파일 | 443 | 서버 배포 시에만 |

### 1.3 통신 흐름

```
프론트엔드 → Rails 백엔드 : REST API (JSON) + WebSocket (ActionCable)
Rails 백엔드 → Sidecar   : HTTP (내부 네트워크, localhost)
프론트엔드 → Sidecar     : 없음 (항상 Rails를 경유)
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
| Tauri | @tauri-apps/api, plugin-dialog, plugin-fs, plugin-shell | 2.x |
| 설정 | config.yaml (yaml 라이브러리로 파싱) | |

### 2.2 디렉토리 구조

```
frontend/src/
├── api/                    # API 클라이언트 (13개 모듈)
│   ├── client.ts           # ky 인스턴스
│   ├── meetings.ts         # 회의 CRUD + 녹음/전사/요약
│   ├── folders.ts          # 폴더 CRUD
│   ├── tags.ts             # 태그 CRUD
│   ├── settings.ts         # STT/LLM/앱 설정
│   ├── attachments.ts      # 첨부파일
│   └── ...
├── channels/               # ActionCable 채널
│   └── transcription.ts    # 실시간 STT 채널
├── components/
│   ├── meeting/            # 회의 관련 (13개)
│   │   ├── AudioPlayer.tsx
│   │   ├── TranscriptPanel.tsx
│   │   ├── AiSummaryPanel.tsx
│   │   ├── ExportButton.tsx
│   │   ├── AttachmentSection.tsx
│   │   ├── SpeakerPanel.tsx
│   │   └── ...
│   ├── editor/             # BlockNote + 커스텀 블록
│   ├── folder/             # 폴더 트리 + 다이얼로그
│   ├── layout/             # AppLayout, Sidebar
│   ├── action-item/        # Action Item UI
│   ├── settings/           # 설정 모달
│   └── ui/                 # 공통 UI 컴포넌트
├── pages/
│   ├── SetupPage.tsx       # 첫 실행 환경 확인
│   ├── MeetingsPage.tsx    # 회의 목록
│   ├── MeetingPage.tsx     # 회의 상세 (완료 후)
│   ├── MeetingLivePage.tsx # 실시간 녹음
│   └── DashboardPage.tsx   # 대시보드
├── stores/                 # Zustand 스토어 (6개)
│   ├── meetingStore.ts     # 회의 목록/필터
│   ├── transcriptStore.ts  # 실시간 전사 상태
│   ├── folderStore.ts      # 폴더 트리
│   ├── appSettingsStore.ts # 오디오/AI 설정
│   ├── uiStore.ts          # UI 상태
│   └── promptTemplateStore.ts
├── hooks/                  # 커스텀 훅 (16개)
│   ├── useAudioRecorder.ts # Web Audio API + VAD
│   ├── useAudioPlayer.ts   # 오디오 재생 제어
│   ├── useTranscription.ts # ActionCable STT 연결
│   ├── useSystemAudioCapture.ts # macOS 시스템 오디오
│   └── ...
├── lib/                    # 유틸리티
│   ├── pdfExporter.ts
│   ├── docxExporter.ts
│   └── markdownToDocx.ts
├── config.ts               # API URL, 환경변수 분기
└── App.tsx                 # 라우팅 정의
```

### 2.3 API URL 분기

```typescript
// frontend/src/config.ts
export const API_BASE_URL = IS_TAURI
  ? 'http://127.0.0.1:13323/api/v1'                    // 데스크톱 로컬
  : import.meta.env.VITE_API_BASE_URL || cfg.api.base_url  // 웹 (환경변수)

export const WS_URL = IS_TAURI
  ? 'ws://127.0.0.1:13323/cable'
  : import.meta.env.VITE_WS_URL || cfg.api.ws_url
```

서버 배포 시 빌드 환경변수로 URL 지정:
```bash
VITE_API_BASE_URL=https://app.ddobak.com/api/v1 \
VITE_WS_URL=wss://app.ddobak.com/cable \
  npm run build
```

### 2.4 오디오 캡처 파이프라인

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
| DB | SQLite (로컬) / PostgreSQL (서버) | |
| WebSocket | ActionCable | Rails 내장 |
| 백그라운드 잡 | Solid Queue | DB 기반 큐 |
| CORS | rack-cors | |
| 서버 | Puma | 7.2 |

### 3.2 데이터베이스 설정

```yaml
# 로컬 개발 / 데스크톱
development / production (desktop):
  adapter: sqlite3
  database: storage/production.sqlite3   # 또는 DB_PATH 환경변수
  pragmas:
    journal_mode: wal
    busy_timeout: 5000

# 서버 배포
production (server):
  adapter: postgresql
  url: $DATABASE_URL
```

### 3.3 API 엔드포인트

모든 엔드포인트는 `/api/v1` 네임스페이스 하위.

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
| POST | `/meetings/:id/reopen` | 완료된 회의 재오픈 |
| POST | `/meetings/:id/reset_content` | 전사/요약 초기화 |
| POST | `/meetings/:id/summarize` | 수동 요약 트리거 |
| POST | `/meetings/:id/regenerate_stt` | STT 재실행 |
| POST | `/meetings/:id/regenerate_notes` | AI 요약 재생성 |
| POST | `/meetings/:id/feedback` | 요약 피드백 |
| PATCH | `/meetings/:id/update_notes` | 메모/노트 수정 |
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
| PATCH | `/meetings/:id/blocks/:id/reorder` | 순서 변경 |

#### 첨부파일

| Method | Path | 설명 |
|--------|------|------|
| GET | `/meetings/:id/attachments` | 목록 |
| POST | `/meetings/:id/attachments` | 업로드 |
| PATCH | `/meetings/:id/attachments/:id` | 수정 |
| DELETE | `/meetings/:id/attachments/:id` | 삭제 |
| GET | `/meetings/:id/attachments/:id/download` | 다운로드 |

#### 폴더

| Method | Path | 설명 |
|--------|------|------|
| GET | `/folders` | 폴더 트리 |
| POST | `/folders` | 생성 |
| PATCH | `/folders/:id` | 수정 |
| DELETE | `/folders/:id` | 삭제 |

#### 태그

| Method | Path | 설명 |
|--------|------|------|
| GET | `/tags` | 목록 |
| POST | `/tags` | 생성 |
| PATCH | `/tags/:id` | 수정 |
| DELETE | `/tags/:id` | 삭제 |

#### 화자

| Method | Path | 설명 |
|--------|------|------|
| GET | `/speakers` | 화자 목록 (빈도 포함) |
| PATCH | `/speakers/:id` | 이름 변경 |
| DELETE | `/speakers/destroy_all` | 전체 초기화 |

#### 설정

| Method | Path | 설명 |
|--------|------|------|
| GET | `/settings` | 현재 설정 |
| POST | `/settings/stt_engine` | STT 엔진 변경 |
| GET/PUT | `/settings/llm` | LLM 설정 조회/변경 |
| POST | `/settings/llm/test` | LLM 연결 테스트 |
| GET/PUT | `/settings/hf` | Hugging Face 설정 |
| GET/PUT | `/settings/app` | 앱 설정 |

#### 회의 유형 템플릿

| Method | Path | 설명 |
|--------|------|------|
| GET | `/prompt_templates` | 목록 |
| POST | `/prompt_templates` | 생성 |
| PATCH | `/prompt_templates/:id` | 수정 |
| DELETE | `/prompt_templates/:id` | 삭제 |
| POST | `/prompt_templates/:id/reset` | 기본값 복원 |

#### WebSocket 채널

| 채널 | 스트림 이름 | 설명 |
|------|-----------|------|
| TranscriptionChannel | `meeting_{id}_transcription` | 오디오 청크 수신 → STT 결과 브로드캐스트 |

```ruby
# 클라이언트 → 서버: 오디오 청크
{ action: "audio_chunk",
  data: "<base64_pcm>",
  sequence: 42,
  offset_ms: 126000,
  diarization_config: { similarity_threshold: 0.10, ... },
  languages: ["ko", "en"],
  audio_source: "mic" }

# 서버 → 클라이언트: 확정 트랜스크립트
{ type: "final",
  text: "이번 분기 매출 목표에 대해 논의하겠습니다.",
  speaker: "Speaker 0",
  started_at_ms: 12340,
  ended_at_ms: 15670,
  id: 123 }

# 서버 → 클라이언트: AI 요약 업데이트
{ type: "meeting_notes_update",
  notes_markdown: "## 핵심 요약\n- ...",
  applied_ids: [101, 102, 103] }

# 서버 → 클라이언트: 파일 전사 진행률
{ type: "file_transcription_progress",
  progress: 70,
  message: "음성 인식 완료" }
```

### 3.4 백그라운드 잡

| 잡 | 큐 | 역할 |
|----|---|------|
| TranscriptionJob | real_time | 오디오 청크 → Sidecar STT → DB 저장 → 브로드캐스트 |
| SummarizationJob | summarization | 주기적으로 recording 상태 회의 스캔 → 요약 트리거 |
| MeetingSummarizationJob | summarization | 개별 회의 실시간/최종 요약 |
| FileTranscriptionJob | file_transcription | 파일 → PCM 변환 → Sidecar 전사 → 요약 → 완료 |
| MeetingFinalizerJob | summarization | Action Item 추출 |

### 3.5 서비스

| 서비스 | 역할 |
|--------|------|
| SidecarClient | Python Sidecar HTTP 클라이언트 (STT, 요약, 설정 프록시) |
| MarkdownExporter | 회의 데이터 → Markdown 변환 |
| MeetingExportSerializer | 내보내기용 직렬화 |
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
- 화자별 최대 10개 임베딩 벡터 저장 (다중 벡터 매칭)
- base64 인코딩된 numpy 배열

### 4.5 LLM 요약

**지원 프로바이더:**

| 프로바이더 | 환경변수 | 비고 |
|-----------|---------|------|
| Anthropic | ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL | 기본값 |
| OpenAI 호환 | OPENAI_API_KEY, OPENAI_BASE_URL | Ollama, vLLM 등 |
| CLI 파이프 | CLAUDE_CLI_PATH, GEMINI_CLI_PATH | 토큰 불필요 |

**요약 출력 구조 (JSON):**
```json
{
  "key_points": ["..."],
  "decisions": ["..."],
  "discussion_details": ["..."],
  "action_items": [
    { "content": "...", "assignee_hint": "화자2", "due_date_hint": "2026-04-05" }
  ]
}
```

**노트 개선 (refine-notes) 기능:**
- 기존 Markdown 노트 + 신규 전사 → 통합/개선된 노트
- STT 오타 자동 교정 (문맥 기반)
- 회의 유형별 맞춤 섹션 구조
- Mermaid 다이어그램 자동 생성 (flowchart, sequence, gantt, pie, mindmap)
- 기존 내용 보존 (삭제/요약 금지, 추가만)

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

- `gpu_lock`: Metal GPU 동시 접근 방지 (pywhispercpp + MLX 충돌)
- `engine_lock`: STT 엔진 런타임 전환 시 직렬화
- 모델 전환 후 명시적 GC + Metal 메모리 해제
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
    │   → Job: SidecarClient.transcribe(audio, diarization_config, languages)
    │   → Sidecar: STT + 화자분리 → segments
    │   → Job: Transcript.create! + ActionCable broadcast
    │
    └─ 설정 간격(기본 60초): SummarizationJob 실행
        → 미적용 트랜스크립트 수집
        → SidecarClient.refine_notes(current_notes, transcripts, ...)
        → Summary 저장 + ActionCable broadcast (notes_markdown)

[3] 사용자: "회의 종료" 클릭
    ├─ POST /api/v1/meetings/:id/stop → status = 'completed'
    ├─ 브라우저: 녹음 중지 → 원본 오디오 업로드
    └─ MeetingSummarizationJob (type: final)
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
    │   → Sidecar: 30초 단위 분할 + STT + 화자분리 + 한국어 문장 분리
    ├─ Transcript 일괄 생성 (progress broadcast: 10% → 70%)
    ├─ MeetingSummarizationJob (type: final) → 요약 (progress: 80% → 95%)
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
│   └── audio.rs        # 시스템 오디오 캡처 (macOS)
├── tauri.conf.json     # 앱 설정
├── Cargo.toml          # Rust 의존성
├── Entitlements.plist  # macOS 권한
└── Info.plist          # macOS 앱 정보
```

### 6.2 Tauri 커맨드 (invoke 가능)

| 커맨드 | 역할 |
|--------|------|
| `check_environment` | ruby, uv, ffmpeg 존재 확인 |
| `run_setup` | bundle install + uv sync + db:migrate |
| `start_services` | Rails(:13323) + Sidecar(:13324) 프로세스 spawn |
| `stop_services` | 프로세스 종료 |
| `check_health` | 양 서비스 헬스체크 |
| `start_system_audio_capture` | macOS 시스템 오디오 캡처 시작 |
| `stop_system_audio_capture` | 시스템 오디오 캡처 중지 |

### 6.3 앱 시작 플로우

```
앱 실행
  ├─ Rust: resolve_shell_path() → PATH 해결
  ├─ Rust: detect_tools() → ruby, bundle, uv, ffmpeg 경로 탐색
  ├─ WebView 로드 → SetupPage.tsx 렌더링
  ├─ Frontend: invoke('check_environment') → 환경 상태 표시
  ├─ Frontend: invoke('run_setup') → 의존성 설치 (진행률 표시)
  ├─ Frontend: invoke('start_services') → 서비스 기동
  ├─ Frontend: invoke('check_health') → 준비 완료 확인
  └─ 메인 화면으로 전환
```

### 6.4 데이터 디렉토리

```
~/Library/Application Support/com.ddobakddobak.app/
├── backend/          # Rails 코드 복사본
├── sidecar/          # Python 코드 + .venv
├── db/               # SQLite DB
├── audio/            # 녹음 파일
├── models/           # ML 모델 캐시
└── speaker_dbs/      # 화자 임베딩 DB
```

---

## 7. 보안

### 7.1 현재 (데스크톱 단일 사용자)

- 인증 없음 (DefaultUserLookup concern으로 자동 사용자 생성)
- 모든 데이터 로컬 저장
- LLM API 호출 시에만 외부 통신

### 7.2 서버 배포 시 추가 필요

- JWT 기반 인증 (Devise + devise-jwt, 기존 코드 비활성화 상태)
- HTTPS 필수 (nginx SSL 종료)
- CORS 화이트리스트 (환경변수로 관리)
- API Rate Limiting
- 팀 간 데이터 격리
- 비밀번호 bcrypt 해싱

---

## 8. 환경 설정

### 8.1 환경변수

```bash
# ── Rails ──
RAILS_ENV=production
SECRET_KEY_BASE=<생성된 값>
DATABASE_URL=postgresql://...        # 서버 모드 시
DB_PATH=<sqlite_path>                # 데스크톱 모드 시
AUDIO_DIR=<오디오 저장 경로>
SIDECAR_HOST=localhost               # 또는 sidecar (Docker)
SIDECAR_PORT=13324
CORS_ORIGIN=https://app.ddobak.com   # 서버 모드 시

# ── Sidecar ──
STT_ENGINE=auto                      # auto | qwen3_asr_8bit | faster_whisper | ...
HF_TOKEN=<huggingface_token>
LLM_PROVIDER=anthropic               # anthropic | openai | claude_cli
ANTHROPIC_AUTH_TOKEN=<api_key>
ANTHROPIC_BASE_URL=                  # 커스텀 엔드포인트 (선택)
OPENAI_API_KEY=<api_key>
OPENAI_BASE_URL=                     # Ollama: http://localhost:11434/v1
LLM_MODEL=<model_name>
MODELS_DIR=<모델 캐시 경로>
SPEAKER_DBS_DIR=<화자 DB 경로>
```

### 8.2 config.yaml (프론트엔드 공유 설정)

프로젝트 루트 `config.yaml`에서 프론트엔드가 사용하는 설정값을 관리:
- API/WS URL 기본값
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
│   ├── v2/
│   │   ├── PRD.md      # 이 문서
│   │   └── TRD.md      # 기술 설계
│   ├── server-client-migration.md
│   ├── PRD.md          # v1 (아카이브)
│   └── TRD.md          # v1 (아카이브)
├── config.yaml         # 공유 설정
├── Procfile            # 로컬 개발용
├── docker-compose.yml  # 서버 배포용 (작성 예정)
└── deploy/             # 서버 배포 설정 (작성 예정)
    ├── nginx.conf
    └── Dockerfile.*
```
