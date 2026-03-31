# PRD: 또박또박 (ddobakddobak) v2

> 회의 음성을 실시간으로 텍스트화하고, AI가 핵심 요약/결정사항/할 일을 자동 정리하는 회의 보조 앱

**문서 버전:** v2.0
**작성일:** 2026-03-31
**상태:** Active
**이전 버전:** [v1.0 PRD](../PRD.md)

---

## 1. 개요

### 1.1 프로젝트 비전

대면/온라인 회의에서 발생하는 음성을 실시간으로 텍스트로 변환하고, AI가 자동으로 핵심 요약/결정사항/Action Item을 정리하여 팀원과 공유할 수 있는 회의 보조 앱.

데스크톱 앱(Tauri)과 웹 브라우저 모두에서 사용 가능하며, 서버 배포를 통해 다중 사용자를 지원한다.

### 1.2 핵심 가치

| 가치 | 설명 |
|------|------|
| **실시간성** | 회의 중 음성이 즉시 텍스트로 변환되어 화면에 표시 |
| **자동 정리** | AI가 회의 내용을 구조화하여 요약/결정사항/할 일을 자동 생성 |
| **유연한 배포** | 데스크톱 로컬 실행 또는 서버 배포(웹) 중 선택 가능 |
| **다국어** | 한국어, 영어, 일본어, 중국어 등 9개 언어 지원 |
| **화자 구분** | AI 기반 화자 분리로 발언자별 자동 라벨링 |

### 1.3 대상 사용자

- 정기적으로 대면/온라인 회의를 진행하는 팀 (2~20명)
- 회의록 작성에 시간을 많이 소비하는 팀
- 서버 배포 시 여러 팀이 동시에 사용 가능

### 1.4 v1 → v2 주요 변경점

| 항목 | v1 (초기 계획) | v2 (현재) |
|------|--------------|----------|
| 배포 형태 | 로컬 전용 | **데스크톱 + 웹 서버** |
| 데스크톱 앱 | 없음 (브라우저만) | **Tauri v2 네이티브 앱** |
| DB | SQLite 전용 | SQLite (로컬) + **PostgreSQL (서버)** |
| STT 엔진 | Qwen3-ASR 단일 | **6종 엔진 플러그인 (자동 선택)** |
| 언어 | 한국어 전용 | **9개 언어 지원** |
| LLM | 로컬 LLM 전용 | **Anthropic, OpenAI, CLI 파이프, 로컬 LLM** |
| 파일 업로드 전사 | 미구현 | **구현 완료** |
| 시스템 오디오 캡처 | 미구현 | **구현 완료 (macOS)** |
| 내보내기 | Markdown만 | **Markdown + PDF + DOCX** |
| 폴더 관리 | 없음 | **계층형 폴더 구조** |
| 첨부파일 | 없음 | **파일/링크 첨부** |
| 회의 유형 템플릿 | 없음 | **9종 템플릿 (스탠드업, 브레인스토밍 등)** |
| Mermaid 다이어그램 | 없음 | **AI 요약에 자동 생성** |

---

## 2. 기술 스택

| 레이어 | 기술 | 비고 |
|--------|------|------|
| **프론트엔드** | React 19 + TypeScript + Tailwind CSS | SPA, Zustand 상태관리 |
| **데스크톱** | Tauri v2 (Rust) | macOS/Windows/Linux |
| **백엔드** | Ruby on Rails 8.1 (API 모드) | REST + WebSocket |
| **DB** | SQLite (로컬) / PostgreSQL (서버) | 환경별 자동 분기 |
| **ML 서비스** | Python FastAPI (Sidecar) | STT + 화자분리 + LLM |
| **STT** | 6종 엔진 (Qwen3-ASR, Whisper, faster-whisper 등) | 플랫폼 자동 선택 |
| **화자 분리** | pyannote.audio 3.1 | GPU 가속 지원 |
| **AI 요약** | Anthropic / OpenAI / CLI 파이프 | 다중 LLM 프로바이더 |
| **실시간 통신** | ActionCable (WebSocket) | Rails 내장 |
| **에디터** | BlockNote | Notion 스타일 블록 에디터 |

### 2.1 배포 모드

```
모드 A: 데스크톱 로컬 실행
┌──────────────────────────────────────┐
│ Tauri 앱 (단일 머신)                  │
│  React ─→ Rails ─→ Python Sidecar   │
│  WebView   SQLite    ML (CPU/GPU)    │
└──────────────────────────────────────┘

모드 B: 서버 배포 (웹)
┌────────────┐      ┌──────────────────────────┐
│ 웹 브라우저  │ ───→ │ Linux 서버 (NVIDIA GPU)   │
│ Tauri 앱   │ ←─── │ Rails + Sidecar + PgSQL  │
└────────────┘      └──────────────────────────┘
```

### 2.2 STT 엔진 (플랫폼 자동 선택)

| 엔진 | 플랫폼 | 가속 | 한국어 품질 |
|------|--------|------|-----------|
| Qwen3-ASR 1.7B (MLX 8bit) | macOS Apple Silicon | Metal GPU | 최우수 |
| Qwen3-ASR 1.7B (Transformers) | Linux NVIDIA | CUDA | 최우수 |
| faster-whisper large-v3-turbo | Linux NVIDIA | CUDA | 매우 좋음 |
| whisper.cpp large-v3-turbo | 모든 플랫폼 | CPU/Metal | 매우 좋음 |
| faster-whisper (CPU) | 모든 플랫폼 | CPU | 좋음 |
| Mock | 개발용 | — | — |

---

## 3. 구현 완료 기능

### 3.1 실시간 음성→텍스트 변환 (P0)

- 브라우저 마이크 + 시스템 오디오 캡처 (macOS)
- Web Audio API AudioWorklet 기반 VAD (Voice Activity Detection)
- PCM 16kHz mono 청크 → WebSocket → STT 처리
- 실시간 텍스트 스트림 + 타임스탬프
- 9개 언어 지원 (한/영/일/중/스페인/프랑스/독일/태국/베트남)

### 3.2 화자 분리 (P0)

- pyannote.audio 3.1 기반 화자 임베딩
- 회의별 화자 DB 자동 생성/유지
- 화자 이름 변경 기능
- 유사도 기반 화자 매칭 (임계값 조절 가능)
- 사후 화자 병합 (중복 감지)

### 3.3 AI 요약 및 정리 (P0)

- 실시간 요약: 설정 간격(30초~5분)으로 중간 요약 업데이트
- 최종 요약: 회의 종료 시 전체 내용 기반 최종 요약 생성
- 회의 유형별 맞춤 요약 템플릿 (9종)
- Action Item 자동 추출 (담당자 힌트, 마감일 힌트)
- Mermaid 다이어그램 자동 생성 (플로차트, 시퀀스, 마인드맵 등)
- 사용자 피드백 반영 (요약 수정 요청)
- STT 오타 자동 교정

**회의 유형 템플릿:**

| 유형 | 요약 특화 내용 |
|------|-------------|
| 일반 회의 | 핵심 요약, 결정사항, Action Items |
| 팀 회의 | 팀별 진행상황 테이블 |
| 스탠드업 | 진행/이슈/블로커 테이블 |
| 브레인스토밍 | 아이디어 목록, 카테고리, 우선순위 |
| 리뷰/회고 | 잘한 점/개선할 점/액션 |
| 인터뷰 | Q&A, 평가 포인트 |
| 워크숍 | 활동별 산출물, 합의사항 |
| 1:1 미팅 | 개인 목표, 피드백, 다음 단계 |
| 강연 | 주제별 요약, 핵심 인용 |

### 3.4 블록 기반 에디터 (P0)

- BlockNote 기반 Notion 스타일 편집기
- 블록 타입: 텍스트, 제목(H1~H3), 불릿/번호 리스트, 체크리스트, 인용, 구분선
- 커스텀 블록: 트랜스크립트 블록, Mermaid 다이어그램 블록
- Slash(/) 메뉴로 블록 타입 변경
- 편집/읽기 전용 모드 전환
- 블록 동기화 (서버 자동 저장)

### 3.5 회의 관리 (P0)

- 회의 CRUD (생성, 조회, 수정, 삭제)
- 상태 관리: 대기 → 녹음 중 → 전사 중 → 완료
- 그리드/리스트 뷰 전환
- 검색 (제목 기반)
- 상태/날짜 범위 필터링
- 회의 유형 선택 (9종)

### 3.6 폴더 관리 (P0)

- 계층형 폴더 트리 (무한 중첩)
- 폴더 내 회의 이동 (드래그 앤 드롭)
- 폴더별 회의 필터링
- 폴더 생성/이름 변경/삭제

### 3.7 오디오 재생 (P0)

- 녹음 오디오 스트리밍 재생
- 재생 속도 조절 (0.5x ~ 2x)
- 트랜스크립트 클릭 시 해당 시점으로 이동
- 오디오 다운로드

### 3.8 파일 업로드 전사 (P1)

- 오디오 파일 업로드 (mp3, wav, m4a, webm 등)
- 업로드 후 STT + 화자분리 + AI 요약 일괄 처리
- 전사 진행률 실시간 표시
- 한국어 문장 분리 후처리

### 3.9 내보내기 (P1)

- Markdown 내보내기
- PDF 내보내기 (html2pdf.js)
- DOCX 내보내기 (docx 라이브러리)
- 포함 내용 선택: 요약/메모/트랜스크립트

### 3.10 첨부파일 (P1)

- 파일 첨부 (PDF, Word, Excel, 이미지, HWP 등, 50MB 제한)
- 링크 첨부 (URL)
- 카테고리: 안건, 참고자료, 회의록
- 순서 변경

### 3.11 사용자 메모 (P1)

- 회의별 자유 메모 영역
- AI 요약과 별도 저장 (원문 그대로 보존)
- 자동 저장

### 3.12 태그 (P1)

- 회의/폴더에 색상 태그 부여
- 태그 CRUD

### 3.13 설정 (P1)

- STT 엔진 선택 및 전환
- LLM 프로바이더/모델/API 키 설정
- LLM 연결 테스트
- Hugging Face 토큰 설정
- 오디오 청킹 파라미터 조절 (무음 감지 임계값, 청크 크기 등)
- 화자분리 임계값 조절
- AI 요약 간격 설정
- 언어 선택

### 3.14 데스크톱 앱 (P1)

- Tauri v2 기반 macOS 네이티브 앱
- 앱 시작 시 환경 확인 + 의존성 자동 설치
- Rails + Sidecar 프로세스 자동 관리
- 시스템 오디오 캡처 (macOS)

---

## 4. 미구현 기능 (향후 개발)

| 기능 | 우선순위 | 비고 |
|------|---------|------|
| 서버/클라이언트 배포 (웹 서비스) | **P0** | [migration 문서](./server-client-migration.md) 참조 |
| 사용자 인증 (다중 사용자) | P0 | 서버 배포 시 필수 |
| AI 시멘틱 검색 | P2 | 벡터 임베딩 기반 의미 검색 |
| 실시간 협업 편집 | P2 | CRDT 기반 동시 편집 |
| 캘린더 연동 | P3 | Google Calendar / Outlook |
| Slack 연동 | P3 | 회의 종료 후 자동 요약 전송 |
| Action Item 대시보드 | P3 | 전체 회의 통합 Task 관리 |
| 회의 통계 | P3 | 화자별 발언 시간, 월간 리포트 |
| Windows/Linux 데스크톱 빌드 | P2 | Tauri 크로스플랫폼 |
| SenseVoice STT 엔진 | P3 | Alibaba 경량 ASR 모델 |

---

## 5. 비기능 요구사항

### 5.1 성능

| 항목 | 목표 | 현재 달성 |
|------|------|----------|
| STT 지연 시간 | 발화 후 3초 이내 | macOS MLX ~2-3초, CUDA ~2초 |
| AI 실시간 요약 | 설정 간격 내 생성 | 달성 |
| 1시간 파일 전사 | 10분 이내 | CUDA ~4-6분, MLX ~8-10분 |
| 동시 접속 (서버) | 10명 | 서버 배포 후 측정 예정 |

### 5.2 보안 및 프라이버시

| 항목 | 데스크톱 모드 | 서버 모드 |
|------|-------------|----------|
| 데이터 저장 | 로컬 (외부 전송 없음) | 서버 (HTTPS 암호화) |
| AI 모델 | 로컬 실행 가능 | 서버 GPU에서 실행 |
| LLM 요약 | 외부 API 호출 시에만 통신 | 동일 |
| 인증 | 단일 사용자 (인증 없음) | JWT 기반 인증 (구현 예정) |

### 5.3 브라우저 지원

- Chrome 90+ (권장)
- Safari 15+ (macOS, Tauri WebView)
- Firefox 90+
- Web Audio API, WebSocket 필수

---

## 6. 데이터 모델

```
User
├── email, name, encrypted_password, jti
└── has_many :meetings, :team_memberships

Team
├── name, created_by_id
├── has_many :members (through team_memberships)
├── has_many :meetings, :folders
└── 현재 데스크톱 모드에서는 단일 팀 자동 생성

Meeting
├── title, status (pending/recording/transcribing/completed)
├── source (live/upload), meeting_type (9종)
├── folder_id, team_id, created_by_id
├── started_at, ended_at, audio_file_path
├── brief_summary, memo
├── has_many :transcripts, :summaries, :action_items
├── has_many :blocks, :meeting_attachments
└── has_many :tags (through taggings)

Transcript
├── meeting_id, content, speaker_label
├── started_at_ms, ended_at_ms, sequence_number
├── audio_source (mic/external)
└── applied_to_minutes (AI 요약에 사용 여부)

Summary
├── meeting_id, summary_type (realtime/final)
├── notes_markdown (구조화된 Markdown)
├── key_points, decisions, discussion_details
└── generated_at

ActionItem
├── meeting_id, content, status (todo/in_progress/done)
├── assignee_id, due_date
└── ai_generated (boolean)

Block
├── meeting_id, block_type (9종), content
├── position (fractional indexing)
└── parent_block_id (중첩 블록)

Folder
├── team_id, name, parent_id (계층 구조)
├── position
└── has_many :children, :meetings, :tags

MeetingAttachment
├── meeting_id, kind (file/link), category (agenda/reference/minutes)
├── display_name, file_path/url
└── uploaded_by_id, position

Tag
├── team_id, name, color (hex)
└── has_many :taggings (polymorphic: Meeting, Folder)

PromptTemplate
├── meeting_type (unique), label
└── sections_prompt (LLM 프롬프트)
```

---

## 7. 용어 정의

| 용어 | 설명 |
|------|------|
| STT (Speech-to-Text) | 음성을 텍스트로 변환하는 기술 |
| 화자 분리 (Speaker Diarization) | 음성에서 각 발언자를 구분하는 기술 |
| Action Item | 회의에서 도출된 할 일/과제 |
| 블록 에디터 | Notion처럼 콘텐츠를 블록 단위로 편집하는 에디터 |
| Sidecar | 메인 앱과 함께 실행되는 보조 서비스 (여기서는 Python ML 서비스) |
| VAD (Voice Activity Detection) | 음성 구간을 자동으로 감지하는 기술 |
| Mermaid | 텍스트 기반 다이어그램 렌더링 라이브러리 |
| fractional indexing | 블록 순서를 실수(float)로 관리하여 삽입 시 재정렬 최소화 |
