# TRD: 또박또박 (ddobakddobak)

> Technical Requirements Document — PRD 기반 기술 설계 상세

**문서 버전:** v1.0
**작성일:** 2026-03-24
**상태:** Draft
**참조:** [PRD.md](./PRD.md)

---

## 1. 시스템 아키텍처

### 1.1 전체 구성

```
┌─ 브라우저 (React SPA) ──────────────────────────────────┐
│                                                          │
│  Web Audio API ──→ AudioWorklet ──→ WebSocket 전송       │
│                                                          │
│  블록 에디터 (BlockNote)    실시간 자막 뷰    AI 요약 패널  │
│                                                          │
└────────────┬──────────────────┬───────────────────────────┘
             │ REST API         │ WebSocket (ActionCable)
             │ (JSON)           │ (오디오 스트림 + 이벤트)
┌────────────┴──────────────────┴───────────────────────────┐
│                Ruby on Rails API (API 모드)                │
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ MeetingsCtrl│  │ AuthCtrl    │  │ ExportService    │  │
│  │ TeamsCtrl   │  │ (Devise+JWT)│  │ (Markdown 생성)  │  │
│  └─────────────┘  └─────────────┘  └──────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ TranscriptionChannel (ActionCable)                  │  │
│  │ - 오디오 청크 수신 → Python Sidecar 전달             │  │
│  │ - STT 결과 브로드캐스트                              │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ SummarizationJob (ActiveJob + Solid Queue)          │  │
│  │ - 5분 간격 실시간 요약                               │  │
│  │ - 회의 종료 시 최종 요약                              │  │
│  └─────────────────────────────────────────────────────┘  │
└────────────┬──────────────────┬───────────────────────────┘
             │                  │
┌────────────┴───┐  ┌──────────┴────────────────────────────┐
│   SQLite       │  │   Python Sidecar (FastAPI)             │
│   (WAL 모드)   │  │                                        │
│                │  │  ┌──────────────────────────────────┐  │
│   storage/     │  │  │ STT Adapter                      │  │
│   └─ audio/    │  │  │ ┌────────────┐ ┌──────────────┐ │  │
│      └─ *.webm │  │  │ │Qwen3Adapter│ │WhisperAdapter│ │  │
│                │  │  │ └────────────┘ └──────────────┘ │  │
│                │  │  └──────────────────────────────────┘  │
│                │  │  ┌──────────────────────────────────┐  │
│                │  │  │ pyannote.audio (화자 분리)        │  │
│                │  │  └──────────────────────────────────┘  │
│                │  │  ┌──────────────────────────────────┐  │
│                │  │  │ LLM Client (Anthropic SDK)       │  │
│                │  │  │ → ZAI GLM / Ollama               │  │
│                │  │  └──────────────────────────────────┘  │
└────────────────┘  └───────────────────────────────────────┘
```

### 1.2 프로세스 구성

| 프로세스 | 역할 | 포트 |
|---------|------|------|
| Rails API | REST API + WebSocket + 정적 파일 서빙 | 3000 |
| Python Sidecar | STT 추론 + 화자 분리 + LLM 호출 | 8000 |
| SQLite | 임베디드 DB (별도 프로세스 없음) | — |

Rails ↔ Python Sidecar 간 통신은 **HTTP (FastAPI)** 로 처리. 실시간 STT 스트리밍은 Python Sidecar 내부 WebSocket 엔드포인트(`ws://localhost:8000/ws/transcribe`)를 Rails가 중계.

---

## 2. 프론트엔드 상세

### 2.1 기술 스택

| 항목 | 기술 | 버전 | 비고 |
|------|------|------|------|
| 프레임워크 | React | 19+ | SPA |
| 빌드 도구 | Vite | 6+ | HMR, 빠른 빌드 |
| 상태 관리 | Zustand | 5+ | 경량, 보일러플레이트 적음 |
| 블록 에디터 | BlockNote | 최신 | Notion 스타일, React 네이티브 |
| WebSocket | @rails/actioncable | — | Rails ActionCable 클라이언트 |
| HTTP 클라이언트 | ky | 최신 | fetch 기반 경량 클라이언트 |
| 스타일링 | Tailwind CSS | 4+ | 유틸리티 퍼스트 |
| UI 컴포넌트 | shadcn/ui | — | Tailwind 기반, 복사-붙여넣기 방식 |
| 오디오 재생 | WaveSurfer.js | 7+ | 파형 시각화 + 재생 |
| 라우팅 | React Router | 7+ | SPA 라우팅 |
| 날짜 처리 | date-fns | 최신 | 경량 날짜 라이브러리 |

### 2.2 디렉토리 구조

```
frontend/
├── public/
├── src/
│   ├── api/                    # API 클라이언트
│   │   ├── client.ts           # ky 인스턴스 (baseURL, 인터셉터)
│   │   ├── meetings.ts         # 회의 API
│   │   ├── teams.ts            # 팀 API
│   │   └── auth.ts             # 인증 API
│   ├── channels/               # ActionCable 채널
│   │   └── transcription.ts    # 실시간 STT 채널
│   ├── components/
│   │   ├── ui/                 # shadcn/ui 컴포넌트
│   │   ├── editor/             # 블록 에디터 관련
│   │   │   ├── MeetingEditor.tsx
│   │   │   └── blocks/         # 커스텀 블록 타입
│   │   ├── meeting/            # 회의 관련
│   │   │   ├── LiveTranscript.tsx
│   │   │   ├── AiSummaryPanel.tsx
│   │   │   ├── AudioRecorder.tsx
│   │   │   ├── AudioPlayer.tsx
│   │   │   └── SpeakerLabel.tsx
│   │   ├── action-item/        # Action Item 관련
│   │   │   ├── ActionItemList.tsx
│   │   │   └── ActionItemForm.tsx
│   │   └── layout/             # 레이아웃
│   │       ├── AppLayout.tsx
│   │       ├── Sidebar.tsx
│   │       └── Header.tsx
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── SignupPage.tsx
│   │   ├── MeetingsPage.tsx    # 회의 목록
│   │   ├── MeetingPage.tsx     # 회의 상세 (에디터 + 자막)
│   │   ├── MeetingLivePage.tsx # 회의 진행 중 (녹음 + 실시간)
│   │   └── TeamPage.tsx        # 팀 관리
│   ├── stores/                 # Zustand 스토어
│   │   ├── authStore.ts
│   │   ├── meetingStore.ts
│   │   └── transcriptStore.ts
│   ├── hooks/                  # 커스텀 훅
│   │   ├── useAudioRecorder.ts # Web Audio API 녹음
│   │   ├── useTranscription.ts # ActionCable STT 연결
│   │   └── useAuth.ts
│   ├── lib/                    # 유틸리티
│   │   ├── audio.ts            # 오디오 처리 헬퍼
│   │   └── markdown.ts         # Markdown 내보내기
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── tailwind.config.ts
├── tsconfig.json
├── vite.config.ts
└── package.json
```

### 2.3 오디오 캡처 파이프라인

```
마이크 → MediaStream → AudioWorklet → PCM 16kHz mono
                                          │
                        ┌─────────────────┤
                        │                 │
                   WebSocket 전송      MediaRecorder
                   (STT용 청크)       (원본 녹음 저장)
                        │                 │
                   Rails API         Blob → 업로드
                   → Python Sidecar  → storage/audio/
```

**AudioWorklet 처리:**
- 샘플링 레이트: 16kHz (STT 모델 입력 요구사항)
- 채널: mono
- 청크 크기: 3초 (STT 지연과 정확도 균형)
- 포맷: PCM Float32 → Int16 변환 후 전송

**원본 녹음:**
- MediaRecorder API 사용
- 포맷: WebM/Opus (브라우저 네이티브)
- 회의 종료 시 서버 업로드

### 2.4 실시간 자막 UI

```
TranscriptionChannel (ActionCable)
    │
    ├─ onTranscriptPartial(data)  → 현재 발화 중인 텍스트 (회색, 변동)
    ├─ onTranscriptFinal(data)    → 확정된 텍스트 (검정, 고정)
    ├─ onSpeakerChange(data)      → 화자 전환 이벤트
    └─ onSummaryUpdate(data)      → AI 실시간 요약 업데이트
```

---

## 3. 백엔드 상세 (Rails API)

### 3.1 기술 스택

| 항목 | 기술 | 비고 |
|------|------|------|
| 프레임워크 | Ruby on Rails 8+ (API 모드) | `--api` 플래그 |
| Ruby 버전 | 3.3+ | |
| DB | SQLite3 (WAL 모드) | 로컬 저장 |
| 인증 | Devise + devise-jwt | JWT 토큰 기반 |
| WebSocket | ActionCable | Rails 내장 |
| 백그라운드 잡 | Solid Queue | Rails 8 기본, DB 기반 큐 |
| 파일 저장 | ActiveStorage (로컬 디스크) | 오디오 파일 저장 |
| CORS | rack-cors | React SPA 통신 |
| 시리얼라이저 | Alba | 경량 JSON 시리얼라이저 |

### 3.2 디렉토리 구조

```
backend/
├── app/
│   ├── channels/
│   │   └── transcription_channel.rb  # 실시간 STT WebSocket
│   ├── controllers/
│   │   ├── api/
│   │   │   └── v1/
│   │   │       ├── meetings_controller.rb
│   │   │       ├── transcripts_controller.rb
│   │   │       ├── action_items_controller.rb
│   │   │       ├── summaries_controller.rb
│   │   │       ├── teams_controller.rb
│   │   │       ├── team_memberships_controller.rb
│   │   │       ├── exports_controller.rb
│   │   │       └── sessions_controller.rb
│   │   └── application_controller.rb
│   ├── models/
│   │   ├── user.rb
│   │   ├── team.rb
│   │   ├── team_membership.rb
│   │   ├── meeting.rb
│   │   ├── transcript.rb
│   │   ├── summary.rb
│   │   ├── action_item.rb
│   │   └── block.rb
│   ├── jobs/
│   │   ├── transcription_job.rb      # 오디오 청크 → Python Sidecar 전송
│   │   ├── summarization_job.rb      # AI 요약 요청
│   │   └── audio_upload_job.rb       # 오디오 파일 저장
│   ├── services/
│   │   ├── sidecar_client.rb         # Python Sidecar HTTP 클라이언트
│   │   ├── markdown_exporter.rb      # Markdown 내보내기
│   │   └── meeting_finalizer.rb      # 회의 종료 처리 (최종 요약 등)
│   └── serializers/
│       ├── meeting_serializer.rb
│       ├── transcript_serializer.rb
│       └── action_item_serializer.rb
├── config/
│   ├── routes.rb
│   ├── cable.yml                     # ActionCable 설정
│   └── database.yml                  # SQLite WAL 모드
├── db/
│   ├── migrate/
│   └── schema.rb
├── storage/                          # 오디오 파일 저장 위치
│   └── audio/
├── Gemfile
└── Procfile                          # Rails + Python Sidecar 동시 기동
```

### 3.3 API 엔드포인트

#### 인증

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/v1/signup` | 회원가입 |
| POST | `/api/v1/login` | 로그인 (JWT 발급) |
| DELETE | `/api/v1/logout` | 로그아웃 (JWT 무효화) |

#### 회의

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/meetings` | 회의 목록 (페이징, 검색) |
| POST | `/api/v1/meetings` | 회의 생성 |
| GET | `/api/v1/meetings/:id` | 회의 상세 (트랜스크립트, 요약 포함) |
| PATCH | `/api/v1/meetings/:id` | 회의 수정 (제목, 상태 변경) |
| DELETE | `/api/v1/meetings/:id` | 회의 삭제 |
| POST | `/api/v1/meetings/:id/start` | 녹음 시작 (status → recording) |
| POST | `/api/v1/meetings/:id/stop` | 녹음 종료 (status → completed, 최종 요약 트리거) |
| GET | `/api/v1/meetings/:id/audio` | 오디오 파일 스트리밍 |
| GET | `/api/v1/meetings/:id/export` | Markdown 내보내기 |

#### 트랜스크립트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/meetings/:id/transcripts` | 트랜스크립트 목록 (타임스탬프순) |

#### Action Items

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/meetings/:id/action_items` | Action Item 목록 |
| PATCH | `/api/v1/action_items/:id` | 수정 (담당자, 마감일, 상태) |
| DELETE | `/api/v1/action_items/:id` | 삭제 |

#### 블록 (에디터)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/meetings/:id/blocks` | 블록 목록 (position 순) |
| POST | `/api/v1/meetings/:id/blocks` | 블록 추가 |
| PATCH | `/api/v1/blocks/:id` | 블록 수정 |
| DELETE | `/api/v1/blocks/:id` | 블록 삭제 |
| PATCH | `/api/v1/meetings/:id/blocks/reorder` | 블록 순서 변경 |

#### 팀

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/teams` | 내 팀 목록 |
| POST | `/api/v1/teams` | 팀 생성 |
| POST | `/api/v1/teams/:id/invite` | 팀원 초대 (이메일) |
| DELETE | `/api/v1/teams/:id/members/:user_id` | 팀원 제거 |

#### WebSocket 채널

| 채널 | 설명 |
|------|------|
| `TranscriptionChannel` | 오디오 청크 수신 → STT 결과 브로드캐스트 |

```ruby
# 클라이언트 → 서버: 오디오 청크
{ action: "audio_chunk", data: "<base64_pcm>", meeting_id: 1 }

# 서버 → 클라이언트: 부분 트랜스크립트
{ type: "partial", text: "이번 분기 매출...", speaker: "화자1" }

# 서버 → 클라이언트: 확정 트랜스크립트
{ type: "final", text: "이번 분기 매출 목표에 대해 논의하겠습니다.",
  speaker: "화자1", started_at_ms: 12340, ended_at_ms: 15670, seq: 42 }

# 서버 → 클라이언트: AI 실시간 요약
{ type: "summary_update", key_points: ["..."], decisions: ["..."] }
```

### 3.4 DB 스키마

```sql
-- SQLite WAL 모드 활성화
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  encrypted_password TEXT NOT NULL,
  name TEXT NOT NULL,
  jti TEXT NOT NULL,  -- JWT 무효화용
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_by_id INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE team_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  role TEXT NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
  created_at DATETIME NOT NULL,
  UNIQUE(user_id, team_id)
);

CREATE TABLE meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  created_by_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'recording' | 'completed'
  started_at DATETIME,
  ended_at DATETIME,
  audio_file_path TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_label TEXT NOT NULL,           -- '화자1', '화자2', ...
  content TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,        -- 오디오 시작 지점 (ms)
  ended_at_ms INTEGER NOT NULL,          -- 오디오 종료 지점 (ms)
  sequence_number INTEGER NOT NULL,
  created_at DATETIME NOT NULL
);
CREATE INDEX idx_transcripts_meeting_seq ON transcripts(meeting_id, sequence_number);

CREATE TABLE summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  key_points TEXT,              -- JSON array
  decisions TEXT,               -- JSON array
  discussion_details TEXT,      -- JSON array
  summary_type TEXT NOT NULL DEFAULT 'final',  -- 'realtime' | 'final'
  generated_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
CREATE INDEX idx_summaries_meeting ON summaries(meeting_id);

CREATE TABLE action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  assignee_id INTEGER REFERENCES users(id),
  content TEXT NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'todo',  -- 'todo' | 'done'
  ai_generated INTEGER NOT NULL DEFAULT 0,  -- boolean
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
CREATE INDEX idx_action_items_meeting ON action_items(meeting_id);
CREATE INDEX idx_action_items_assignee ON action_items(assignee_id);

CREATE TABLE blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  block_type TEXT NOT NULL DEFAULT 'text',
  content TEXT,
  position REAL NOT NULL,       -- fractional indexing (삽입 시 재정렬 최소화)
  parent_block_id INTEGER REFERENCES blocks(id),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
CREATE INDEX idx_blocks_meeting_pos ON blocks(meeting_id, position);
```

**position 필드 (Fractional Indexing):**
블록 순서에 `REAL` 타입을 사용하여 삽입 시 기존 블록 재정렬 없이 중간값을 할당. 예: 블록 A(1.0)와 B(2.0) 사이에 삽입 → 1.5.

---

## 4. Python Sidecar 상세

### 4.1 기술 스택

| 항목 | 기술 | 비고 |
|------|------|------|
| 프레임워크 | FastAPI | 비동기 HTTP + WebSocket |
| STT | Qwen3-ASR-1.7B (기본) | macOS: mlx-lm, Linux: vLLM |
| 화자 분리 | pyannote.audio 3.x | Hugging Face 모델 |
| LLM 클라이언트 | anthropic SDK | ZAI GLM (Anthropic 호환 API) |
| 패키지 관리 | uv | 빠른 의존성 관리 |
| Python 버전 | 3.11+ | |

### 4.2 디렉토리 구조

```
sidecar/
├── app/
│   ├── main.py                  # FastAPI 앱 진입점
│   ├── config.py                # 환경 변수 로드 (STT_ENGINE 등)
│   ├── routers/
│   │   ├── transcribe.py        # POST /transcribe, WS /ws/transcribe
│   │   └── summarize.py         # POST /summarize
│   ├── stt/
│   │   ├── base.py              # SttAdapter 추상 클래스
│   │   ├── factory.py           # STT_ENGINE → Adapter 매핑
│   │   ├── qwen3_adapter.py     # Qwen3-ASR-1.7B 구현
│   │   ├── whisper_adapter.py   # whisper.cpp 구현
│   │   ├── faster_whisper_adapter.py
│   │   └── sensevoice_adapter.py
│   ├── diarization/
│   │   └── speaker.py           # pyannote.audio 래퍼
│   ├── llm/
│   │   └── summarizer.py        # LLM 요약 클라이언트
│   └── models/
│       └── schemas.py           # Pydantic 모델 (요청/응답)
├── pyproject.toml
└── uv.lock
```

### 4.3 STT Adapter 인터페이스

```python
# sidecar/app/stt/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class TranscriptSegment:
    text: str
    started_at_ms: int
    ended_at_ms: int
    language: str = "ko"
    confidence: float = 0.0

class SttAdapter(ABC):
    """모든 STT 엔진이 구현해야 하는 공통 인터페이스"""

    @abstractmethod
    async def load_model(self) -> None:
        """모델 로드 (앱 시작 시 1회)"""
        ...

    @abstractmethod
    async def transcribe(self, audio_chunk: bytes) -> list[TranscriptSegment]:
        """오디오 청크 → 텍스트 세그먼트 변환"""
        ...

    @abstractmethod
    async def transcribe_stream(self, audio_stream) -> AsyncIterator[TranscriptSegment]:
        """실시간 스트리밍 변환"""
        ...

    @abstractmethod
    async def transcribe_file(self, file_path: str) -> list[TranscriptSegment]:
        """파일 전체 변환 (녹음 원본 후처리용)"""
        ...
```

```python
# sidecar/app/stt/factory.py
from app.config import settings
from app.stt.base import SttAdapter
from app.stt.qwen3_adapter import Qwen3Adapter
from app.stt.whisper_adapter import WhisperAdapter

def create_stt_adapter() -> SttAdapter:
    adapters = {
        "qwen3_asr": Qwen3Adapter,
        "whisper_cpp": WhisperAdapter,
        "faster_whisper": FasterWhisperAdapter,
        "sensevoice": SenseVoiceAdapter,
    }
    adapter_cls = adapters.get(settings.STT_ENGINE)
    if not adapter_cls:
        raise ValueError(f"Unknown STT engine: {settings.STT_ENGINE}")
    return adapter_cls()
```

### 4.4 API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/transcribe` | 오디오 청크 → 텍스트 (동기) |
| WS | `/ws/transcribe` | 실시간 오디오 스트리밍 → 텍스트 |
| POST | `/transcribe/file` | 파일 전체 변환 |
| POST | `/summarize` | 텍스트 → AI 요약 |
| POST | `/summarize/action-items` | 텍스트 → Action Item 추출 |
| GET | `/health` | 헬스체크 (모델 로드 상태 포함) |

### 4.5 실시간 STT 파이프라인

```
브라우저 AudioWorklet
    │ PCM 16kHz Int16 (3초 청크)
    ▼
Rails TranscriptionChannel
    │ base64 → binary 디코딩
    ▼
Python Sidecar WS /ws/transcribe
    │
    ├─→ STT Adapter.transcribe(chunk)
    │       │
    │       ▼
    │   TranscriptSegment(text, timestamps)
    │       │
    ├─→ pyannote.Speaker Diarization
    │       │
    │       ▼
    │   speaker_label 매핑
    │
    ▼
WebSocket 응답 → Rails → 브라우저 브로드캐스트
```

### 4.6 AI 요약 파이프라인

```python
# POST /summarize 요청 바디
{
  "transcripts": [
    {"speaker": "화자1", "text": "...", "started_at_ms": 0},
    ...
  ],
  "type": "realtime" | "final",
  "context": "이전 실시간 요약 내용 (있으면)"
}

# 응답
{
  "key_points": ["..."],
  "decisions": ["..."],
  "action_items": [
    {"content": "...", "assignee_hint": "화자2", "due_date_hint": "2026-03-28"}
  ],
  "discussion_details": ["..."]
}
```

**LLM 호출 설정:**
```python
# ZAI GLM (Anthropic 호환 API)
client = anthropic.Anthropic(
    api_key=os.environ["ANTHROPIC_AUTH_TOKEN"],
    base_url=os.environ["ANTHROPIC_BASE_URL"],
)
```

---

## 5. 실시간 데이터 플로우

### 5.1 회의 녹음 시작 ~ 종료 전체 흐름

```
[1] 사용자: "회의 시작" 클릭
    │
    ├─ POST /api/v1/meetings/:id/start
    │   → meeting.status = 'recording'
    │
    ├─ 브라우저: MediaStream 획득 (getUserMedia)
    │   ├─ AudioWorklet 시작 (PCM 16kHz)
    │   └─ MediaRecorder 시작 (원본 녹음)
    │
    └─ ActionCable: TranscriptionChannel 구독

[2] 녹음 중 (반복)
    │
    ├─ AudioWorklet → 3초 PCM 청크
    │   → WebSocket → Rails → Python Sidecar
    │   → STT + 화자분리 → TranscriptSegment
    │   → DB 저장 + 브로드캐스트
    │
    └─ 매 5분: SummarizationJob 실행
        → 직전 5분 트랜스크립트 수집
        → POST /summarize (type: realtime)
        → 실시간 요약 브로드캐스트

[3] 사용자: "회의 종료" 클릭
    │
    ├─ POST /api/v1/meetings/:id/stop
    │   → meeting.status = 'completed'
    │
    ├─ 브라우저: 녹음 중지
    │   → 원본 오디오 Blob 업로드
    │   → AudioUploadJob → storage/audio/
    │
    └─ MeetingFinalizerService 실행
        ├─ 전체 트랜스크립트 수집
        ├─ POST /summarize (type: final)
        ├─ POST /summarize/action-items
        ├─ Summary 레코드 저장
        ├─ ActionItem 레코드 저장
        └─ 블록 에디터에 요약 블록 자동 삽입
```

---

## 6. 보안

### 6.1 인증 흐름

```
POST /api/v1/login { email, password }
    → Devise 인증
    → JWT 발급 (Authorization: Bearer <token>)
    → 이후 모든 요청에 JWT 헤더 포함

JWT 구조:
- payload: { sub: user_id, jti: <unique_id>, exp: 24h }
- jti로 로그아웃 시 토큰 무효화 (DB의 user.jti와 비교)
```

### 6.2 권한 제어

| 리소스 | 권한 |
|--------|------|
| 회의 | 같은 팀 소속 사용자만 접근 |
| 팀 관리 (초대/제거) | 팀 admin만 가능 |
| Action Item 수정 | 같은 팀 소속 사용자 |
| 회의 삭제 | 회의 생성자 또는 팀 admin |

### 6.3 데이터 보안

- 모든 데이터 로컬 저장 (네트워크 외부 전송 없음)
- 비밀번호: bcrypt 해싱 (Devise 기본)
- JWT: HS256 서명 (Rails SECRET_KEY_BASE)
- `.env` 파일 gitignore 처리
- AI 요약은 ZAI GLM API 호출 시에만 외부 통신 발생 (ANTHROPIC_BASE_URL)

---

## 7. 개발 환경 설정

### 7.1 사전 요구사항

| 항목 | 버전 | 설치 방법 |
|------|------|----------|
| Ruby | 3.3+ | `rbenv install 3.3.x` |
| Node.js | 20+ | `nvm install 20` |
| Python | 3.11+ | `pyenv install 3.11.x` |
| uv | 최신 | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| SQLite | 3.40+ | macOS 기본 포함 |
| ffmpeg | 6+ | `brew install ffmpeg` (오디오 변환용) |

### 7.2 환경 변수 (.env)

```bash
# STT 엔진 (qwen3_asr | whisper_cpp | faster_whisper | sensevoice)
STT_ENGINE="qwen3_asr"

# AI 요약 모델 (ZAI GLM)
ANTHROPIC_AUTH_TOKEN="your_token_here"
ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic"

# Rails
RAILS_ENV="development"
SECRET_KEY_BASE="<rails secret>"

# Python Sidecar
SIDECAR_HOST="localhost"
SIDECAR_PORT="8000"

# Hugging Face (pyannote 모델 다운로드용)
HF_TOKEN="your_hf_token_here"
```

### 7.3 프로젝트 루트 구조

```
ddobakddobak/
├── backend/            # Ruby on Rails API
├── frontend/           # React SPA
├── sidecar/            # Python STT/AI 서비스
├── docs/
│   ├── PRD.md
│   └── TRD.md
├── .env
├── .env.example
├── .gitignore
├── Procfile            # 전체 서비스 기동
└── README.md
```

### 7.4 Procfile

```procfile
rails: cd backend && bin/rails server -p 3000
sidecar: cd sidecar && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
frontend: cd frontend && npm run dev -- --port 5173
```

`foreman start` 또는 `overmind start`로 전체 서비스 동시 기동.

---

## 8. 테스트 전략

| 레이어 | 도구 | 대상 |
|--------|------|------|
| Rails 모델/서비스 | RSpec | 비즈니스 로직, DB 쿼리 |
| Rails API | RSpec (request spec) | API 엔드포인트, 인증 |
| Rails 채널 | RSpec (channel spec) | ActionCable 동작 |
| Python Sidecar | pytest | STT Adapter, 요약 로직 |
| React 컴포넌트 | Vitest + Testing Library | UI 컴포넌트 |
| E2E | Playwright | 주요 사용자 흐름 |

### 핵심 테스트 시나리오

1. **STT Adapter 교체 테스트**: 환경 변수 변경 후 다른 엔진으로 정상 동작 확인
2. **실시간 파이프라인 테스트**: 오디오 청크 → STT → 브로드캐스트 E2E
3. **AI 요약 테스트**: 트랜스크립트 입력 → 구조화된 요약 출력
4. **동시 접속 테스트**: 10명 동시 WebSocket 연결 시 안정성

---

## 9. 배포

### 9.1 로컬 배포 (MVP 대상)

모든 서비스가 단일 머신에서 실행되는 로컬 배포:

```bash
# 1. 의존성 설치
cd backend && bundle install
cd frontend && npm install
cd sidecar && uv sync

# 2. DB 초기화
cd backend && bin/rails db:create db:migrate db:seed

# 3. STT 모델 다운로드
cd sidecar && python -m app.stt.factory --download

# 4. 전체 서비스 시작
foreman start  # Procfile 기반
```

### 9.2 시스템 요구사항

| 항목 | 최소 | 권장 |
|------|------|------|
| CPU | Apple M1 | Apple M2 Pro 이상 |
| RAM | 16GB | 32GB |
| 디스크 | 20GB (모델 + 데이터) | 50GB+ |
| OS | macOS 13+ | macOS 14+ |
