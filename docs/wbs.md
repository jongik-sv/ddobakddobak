# WBS - 또박또박 (ddobakddobak)

> version: 1.0
> depth: 3
> updated: 2026-03-24

---

## WP-00: 프로젝트 초기화
- status: planned
- priority: critical
- schedule: 2026-03-25 ~ 2026-04-04
- progress: 100%

### TSK-00-01: Rails API 프로젝트 초기화
- category: infrastructure
- domain: backend
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-03-25 ~ 2026-03-26
- tags: setup, rails
- depends: -
- note: Rails 8+ API 모드 프로젝트 생성, Gemfile 의존성 설정

#### PRD 요구사항
- prd-ref: PRD 2.0 기술 스택
- requirements:
  - Ruby on Rails 8+ (API 모드) 프로젝트 생성
  - Gemfile 구성 (devise, devise-jwt, alba, rack-cors, solid_queue)
  - SQLite3 WAL 모드 설정
  - CORS 설정 (React SPA 통신)
- acceptance:
  - `rails server` 정상 기동
  - `/api/v1/health` 엔드포인트 응답

#### 기술 스펙 (TRD)
- tech-spec:
  - Framework: Ruby on Rails 8+ (API 모드, `--api` 플래그)
  - Ruby: 3.3+
  - DB: SQLite3 (WAL 모드, busy_timeout=5000)
  - Queue: Solid Queue (Rails 8 기본)
  - Serializer: Alba
- data-model:
  - SQLite PRAGMA: journal_mode=WAL, busy_timeout=5000

---

### TSK-00-02: React SPA 프로젝트 초기화
- category: infrastructure
- domain: frontend
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-03-25 ~ 2026-03-26
- tags: setup, react, vite
- depends: -
- note: Vite + React + TypeScript 프로젝트 생성

#### PRD 요구사항
- prd-ref: PRD 2.0 기술 스택
- requirements:
  - React 19+ SPA 프로젝트 생성 (Vite 6+)
  - Tailwind CSS 4+ 설정
  - shadcn/ui 초기화
  - React Router 7+ 라우팅 설정
  - Zustand 스토어 기본 구조
- acceptance:
  - `npm run dev` 정상 기동
  - 기본 라우팅 동작 (/, /login)

#### 기술 스펙 (TRD)
- tech-spec:
  - Framework: React 19+ (Vite 6+)
  - State: Zustand 5+
  - Styling: Tailwind CSS 4+ + shadcn/ui
  - Router: React Router 7+
  - HTTP: ky (fetch 기반)
  - WebSocket: @rails/actioncable
- ui-spec:
  - 디렉토리: frontend/src/{api,channels,components,pages,stores,hooks,lib}

---

### TSK-00-03: Python Sidecar 프로젝트 초기화
- category: infrastructure
- domain: sidecar
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-03-25 ~ 2026-03-26
- tags: setup, python, fastapi
- depends: -
- note: FastAPI + uv 프로젝트 생성

#### PRD 요구사항
- prd-ref: PRD 2.0 기술 스택, 2.1 STT 모델 추상화
- requirements:
  - FastAPI 프로젝트 생성 (uv 패키지 관리)
  - SttAdapter 추상 클래스 정의
  - STT Factory 패턴 구현
  - `/health` 엔드포인트
- acceptance:
  - `uv run uvicorn app.main:app` 정상 기동
  - `/health` 응답 정상

#### 기술 스펙 (TRD)
- tech-spec:
  - Framework: FastAPI
  - Python: 3.11+
  - Package: uv
  - STT: Adapter 패턴 (base.py, factory.py)
- api-spec:
  - GET /health → { status, stt_engine, model_loaded }

---

### TSK-00-04: DB 스키마 마이그레이션 생성
- category: infrastructure
- domain: database
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-03-26 ~ 2026-03-27
- tags: database, migration
- depends: TSK-00-01
- note: PRD 데이터 모델 기반 전체 마이그레이션 생성

#### PRD 요구사항
- prd-ref: PRD 6.0 데이터 모델
- requirements:
  - users, teams, team_memberships 테이블
  - meetings, transcripts, summaries 테이블
  - action_items, blocks 테이블
  - 인덱스 생성 (transcripts, summaries, action_items, blocks)
- acceptance:
  - `rails db:migrate` 성공
  - 모든 테이블/인덱스 정상 생성

#### 기술 스펙 (TRD)
- data-model:
  - users: id, email, encrypted_password, name, jti
  - teams: id, name, created_by_id
  - team_memberships: id, user_id, team_id, role (admin|member)
  - meetings: id, title, team_id, created_by_id, status (pending|recording|completed), started_at, ended_at, audio_file_path
  - transcripts: id, meeting_id, speaker_label, content, started_at_ms, ended_at_ms, sequence_number
  - summaries: id, meeting_id, key_points, decisions, discussion_details, summary_type (realtime|final), generated_at
  - action_items: id, meeting_id, assignee_id, content, due_date, status (todo|done), ai_generated
  - blocks: id, meeting_id, block_type, content, position (REAL, fractional indexing), parent_block_id

---

### TSK-00-05: Procfile 및 개발 환경 설정
- category: infrastructure
- domain: infra
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-03-27 ~ 2026-03-28
- tags: devops, setup
- depends: TSK-00-01, TSK-00-02, TSK-00-03
- note: foreman/overmind으로 3개 프로세스 동시 기동

#### PRD 요구사항
- prd-ref: PRD 2.2 아키텍처 개요
- requirements:
  - Procfile 작성 (Rails 3000, Sidecar 8000, Frontend 5173)
  - .env.example 작성
  - .gitignore 설정
- acceptance:
  - `foreman start`로 3개 서비스 동시 기동
  - 서비스 간 통신 정상

#### 기술 스펙 (TRD)
- tech-spec:
  - Procfile: rails(3000), sidecar(8000), frontend(5173)
  - 환경 변수: STT_ENGINE, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, SIDECAR_HOST, SIDECAR_PORT, HF_TOKEN

---

## WP-01: 인증 및 사용자/팀 관리
- status: done
- priority: critical
- schedule: 2026-03-28 ~ 2026-04-11
- progress: 100%

### TSK-01-01: Devise + JWT 인증 백엔드 구현
- category: development
- domain: backend
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-03-28 ~ 2026-04-01
- tags: auth, devise, jwt
- depends: TSK-00-04

#### PRD 요구사항
- prd-ref: PRD 3.5 사용자/팀 관리
- requirements:
  - 이메일/비밀번호 회원가입
  - 로그인 시 JWT 토큰 발급
  - 로그아웃 시 JWT 무효화 (jti 갱신)
- acceptance:
  - POST /api/v1/signup → 사용자 생성 + JWT 반환
  - POST /api/v1/login → JWT 발급
  - DELETE /api/v1/logout → JWT 무효화
  - 잘못된 자격증명 → 401 에러
- constraints:
  - 비밀번호 bcrypt 해싱 (Devise 기본)

#### 기술 스펙 (TRD)
- tech-spec:
  - Auth: Devise + devise-jwt
  - JWT payload: { sub: user_id, jti: unique_id, exp: 24h }
  - JWT 서명: HS256 (SECRET_KEY_BASE)
- api-spec:
  - POST /api/v1/signup { email, password, name } → { token, user }
  - POST /api/v1/login { email, password } → { token, user }
  - DELETE /api/v1/logout (Authorization header) → 204

---

### TSK-01-02: 팀 CRUD 및 초대 API
- category: development
- domain: backend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-04-01 ~ 2026-04-03
- tags: team, api
- depends: TSK-01-01

#### PRD 요구사항
- prd-ref: PRD 3.5 사용자/팀 관리
- requirements:
  - 팀 생성 (생성자 자동 admin)
  - 팀원 초대 (이메일 기반)
  - 팀원 제거 (admin만)
  - 내 팀 목록 조회
- acceptance:
  - POST /api/v1/teams → 팀 생성, 생성자 admin 역할
  - POST /api/v1/teams/:id/invite → 팀원 추가
  - DELETE /api/v1/teams/:id/members/:user_id → 팀원 제거 (admin만)
  - GET /api/v1/teams → 내 팀 목록

#### 기술 스펙 (TRD)
- api-spec:
  - GET /api/v1/teams → [{ id, name, role, member_count }]
  - POST /api/v1/teams { name } → { team }
  - POST /api/v1/teams/:id/invite { email } → { membership }
  - DELETE /api/v1/teams/:id/members/:user_id → 204
- data-model:
  - team_memberships.role: 'admin' | 'member'
  - 권한: 팀 관리(초대/제거)는 admin만

---

### TSK-01-03: 권한 제어 미들웨어
- category: development
- domain: backend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-04-03 ~ 2026-04-04
- tags: auth, authorization
- depends: TSK-01-01, TSK-01-02

#### PRD 요구사항
- prd-ref: PRD 3.5 사용자/팀 관리
- requirements:
  - 같은 팀 소속 사용자만 회의 접근
  - 팀 admin만 팀 관리 가능
  - 회의 삭제는 생성자 또는 admin만
- acceptance:
  - 다른 팀 회의 접근 시 403
  - 비-admin 사용자 팀원 초대 시 403

#### 기술 스펙 (TRD)
- tech-spec:
  - ApplicationController에 current_user, authenticate_user! 메서드
  - 팀 기반 리소스 접근 제어 (before_action)

---

### TSK-01-04: 로그인/회원가입 프론트엔드 UI
- category: development
- domain: frontend
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-04-01 ~ 2026-04-04
- tags: auth, ui, react
- depends: TSK-00-02, TSK-01-01

#### PRD 요구사항
- prd-ref: PRD 3.5 사용자/팀 관리
- requirements:
  - 로그인 페이지 (이메일/비밀번호)
  - 회원가입 페이지
  - JWT 토큰 저장 및 자동 첨부 (ky 인터셉터)
  - 인증 상태 관리 (Zustand authStore)
- acceptance:
  - 로그인 성공 → 대시보드 리다이렉트
  - 미인증 접근 → 로그인 페이지 리다이렉트
  - 토큰 만료 → 자동 로그아웃

#### 기술 스펙 (TRD)
- ui-spec:
  - LoginPage.tsx, SignupPage.tsx
  - authStore.ts (Zustand): token, user, login(), logout()
  - api/client.ts: ky 인스턴스, Authorization 헤더 인터셉터

---

### TSK-01-05: 팀 관리 프론트엔드 UI
- category: development
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-04-04 ~ 2026-04-07
- tags: team, ui, react
- depends: TSK-01-02, TSK-01-04

#### PRD 요구사항
- prd-ref: PRD 3.5 사용자/팀 관리
- requirements:
  - 팀 생성 폼
  - 팀원 초대 (이메일 입력)
  - 팀원 목록 표시
  - 팀원 제거 (admin만 버튼 노출)
- acceptance:
  - 팀 생성 후 팀 목록에 표시
  - 초대된 사용자가 팀원 목록에 표시
  - admin이 아닌 사용자에게 관리 버튼 미노출

#### 기술 스펙 (TRD)
- ui-spec:
  - TeamPage.tsx
  - api/teams.ts: createTeam(), inviteMember(), removeMemember()

---

### TSK-01-06: 앱 레이아웃 및 네비게이션
- category: development
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-04-07 ~ 2026-04-09
- tags: layout, ui
- depends: TSK-01-04

#### PRD 요구사항
- prd-ref: PRD 3.4 회의 관리
- requirements:
  - 사이드바 (팀 목록, 회의 목록 네비게이션)
  - 헤더 (사용자 정보, 로그아웃)
  - 앱 전체 레이아웃 (AppLayout)
- acceptance:
  - 사이드바에서 팀/회의 전환 가능
  - 반응형 레이아웃 기본 동작

#### 기술 스펙 (TRD)
- ui-spec:
  - AppLayout.tsx, Sidebar.tsx, Header.tsx
  - React Router 중첩 라우트

---

## WP-02: STT 파이프라인
- status: done
- priority: critical
- schedule: 2026-04-07 ~ 2026-04-25
- progress: 100%

### TSK-02-01: Qwen3-ASR Adapter 구현
- category: development
- domain: sidecar
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-04-07 ~ 2026-04-11
- tags: stt, qwen3, ai
- depends: TSK-00-03

#### PRD 요구사항
- prd-ref: PRD 3.1 실시간 음성→텍스트 변환, 2.1 STT 모델 추상화
- requirements:
  - Qwen3-ASR-1.7B 모델 로드 및 추론
  - SttAdapter 인터페이스 구현 (transcribe, transcribe_stream, transcribe_file)
  - 한국어 전용 STT
  - 3초 오디오 청크 입력 → TranscriptSegment 출력
- acceptance:
  - 한국어 음성 입력 → 정확한 텍스트 출력
  - 3초 이내 응답 (발화 후 텍스트 표시)
  - 모델 로드 1회 후 재사용
- constraints:
  - STT 지연 시간 3초 이내
  - PCM 16kHz mono 입력

#### 기술 스펙 (TRD)
- tech-spec:
  - Model: Qwen3-ASR-1.7B (vLLM 추론)
  - Input: PCM 16kHz Int16 (3초 청크)
  - Output: TranscriptSegment(text, started_at_ms, ended_at_ms, language, confidence)
  - Interface: SttAdapter ABC 구현
- api-spec:
  - POST /transcribe { audio: base64 } → { segments: [TranscriptSegment] }
  - WS /ws/transcribe → 실시간 스트리밍

---

### TSK-02-02: whisper.cpp Adapter 구현
- category: development
- domain: sidecar
- status: [xx]
- priority: medium
- assignee: -
- schedule: 2026-04-11 ~ 2026-04-14
- tags: stt, whisper
- depends: TSK-02-01

#### PRD 요구사항
- prd-ref: PRD 2.1 STT 모델 추상화
- requirements:
  - whisper.cpp (large-v3-turbo) Adapter 구현
  - SttAdapter 인터페이스 준수
  - STT_ENGINE 환경 변수로 전환 가능
- acceptance:
  - STT_ENGINE=whisper_cpp 설정 시 whisper.cpp 엔진 사용
  - 한국어 음성 정상 변환
  - Qwen3 Adapter와 동일한 출력 형식

#### 기술 스펙 (TRD)
- tech-spec:
  - Model: whisper.cpp large-v3-turbo (Metal/ANE 최적화)
  - Factory: STT_ENGINE → WhisperAdapter 매핑

---

### TSK-02-03: pyannote 화자 분리 구현
- category: development
- domain: sidecar
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-04-11 ~ 2026-04-16
- tags: diarization, pyannote
- depends: TSK-00-03

#### PRD 요구사항
- prd-ref: PRD 3.1 실시간 음성→텍스트 변환
- requirements:
  - pyannote.audio 3.x 화자 분리 구현
  - 화자별 라벨 매핑 ("화자 1", "화자 2", ...)
  - STT 결과에 화자 라벨 병합
- acceptance:
  - 2인 이상 발화 시 화자 구분
  - speaker_label이 TranscriptSegment에 포함
- constraints:
  - Hugging Face 토큰 필요 (HF_TOKEN)

#### 기술 스펙 (TRD)
- tech-spec:
  - Model: pyannote.audio 3.x
  - Module: sidecar/app/diarization/speaker.py
  - Input: 오디오 청크
  - Output: speaker_label 매핑

---

### TSK-02-04: STT WebSocket 스트리밍 엔드포인트
- category: development
- domain: sidecar
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-04-14 ~ 2026-04-18
- tags: websocket, stt, streaming
- depends: TSK-02-01, TSK-02-03

#### PRD 요구사항
- prd-ref: PRD 3.1 실시간 음성→텍스트 변환
- requirements:
  - WebSocket 엔드포인트로 실시간 오디오 스트리밍 수신
  - STT + 화자 분리 파이프라인 통합
  - partial/final 텍스트 구분 전송
- acceptance:
  - WS 연결 후 오디오 청크 전송 → 텍스트 응답
  - partial (진행 중) / final (확정) 구분
  - 화자 라벨 포함

#### 기술 스펙 (TRD)
- api-spec:
  - WS /ws/transcribe
  - Input: binary PCM 16kHz
  - Output: { type: "partial"|"final", text, speaker, started_at_ms, ended_at_ms, seq }

---

### TSK-02-05: Rails TranscriptionChannel 구현
- category: development
- domain: backend
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-04-16 ~ 2026-04-21
- tags: actioncable, websocket, stt
- depends: TSK-02-04, TSK-00-04

#### PRD 요구사항
- prd-ref: PRD 3.1 실시간 음성→텍스트 변환
- requirements:
  - ActionCable TranscriptionChannel 구현
  - 브라우저 → Rails → Python Sidecar 오디오 중계
  - STT 결과를 DB 저장 (transcripts 테이블) 및 브로드캐스트
- acceptance:
  - 오디오 청크 수신 → Sidecar 전달 → 결과 브로드캐스트
  - transcript 레코드 DB 저장
  - 여러 클라이언트에게 동시 브로드캐스트

#### 기술 스펙 (TRD)
- tech-spec:
  - Channel: TranscriptionChannel (ActionCable)
  - Service: SidecarClient (HTTP/WS 클라이언트)
  - Job: TranscriptionJob (오디오 청크 처리)
- api-spec:
  - Client → Server: { action: "audio_chunk", data: "<base64_pcm>", meeting_id }
  - Server → Client: { type: "partial"|"final", text, speaker, started_at_ms, ended_at_ms, seq }

---

### TSK-02-06: SidecarClient 서비스 구현
- category: development
- domain: backend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-04-16 ~ 2026-04-18
- tags: service, http-client
- depends: TSK-00-01, TSK-02-04

#### PRD 요구사항
- prd-ref: PRD 2.2 아키텍처 개요
- requirements:
  - Rails → Python Sidecar HTTP/WS 통신 클라이언트
  - /transcribe, /summarize, /health 호출
  - 에러 핸들링 및 타임아웃
- acceptance:
  - Sidecar 헬스체크 성공
  - 오디오 청크 전달 → 응답 수신 정상

#### 기술 스펙 (TRD)
- tech-spec:
  - Service: SidecarClient (app/services/sidecar_client.rb)
  - Host: ENV['SIDECAR_HOST']:ENV['SIDECAR_PORT']
  - Endpoints: /transcribe, /ws/transcribe, /summarize, /summarize/action-items, /health

---

## WP-03: 실시간 UI
- status: done
- priority: critical
- schedule: 2026-04-21 ~ 2026-05-05
- progress: 100%

### TSK-03-01: Web Audio API 오디오 캡처
- category: development
- domain: frontend
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-04-21 ~ 2026-04-25
- tags: audio, web-audio-api, recorder
- depends: TSK-00-02

#### PRD 요구사항
- prd-ref: PRD 3.1 실시간 음성→텍스트 변환
- requirements:
  - 마이크 권한 요청 및 MediaStream 획득
  - AudioWorklet으로 PCM 16kHz mono 변환
  - 3초 청크 단위로 WebSocket 전송
  - MediaRecorder로 원본 오디오 동시 녹음 (WebM/Opus)
- acceptance:
  - "회의 시작" 클릭 → 마이크 권한 요청
  - 오디오 캡처 및 3초 청크 생성 정상
  - 회의 종료 시 원본 오디오 Blob 생성

#### 기술 스펙 (TRD)
- tech-spec:
  - Web Audio API → AudioWorklet
  - 샘플링: 16kHz mono
  - 청크: 3초, PCM Float32 → Int16 변환
  - 원본: MediaRecorder (WebM/Opus)
- ui-spec:
  - hooks/useAudioRecorder.ts
  - components/meeting/AudioRecorder.tsx

---

### TSK-03-02: ActionCable 실시간 연결 클라이언트
- category: development
- domain: frontend
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-04-23 ~ 2026-04-28
- tags: actioncable, websocket, react
- depends: TSK-02-05, TSK-03-01

#### PRD 요구사항
- prd-ref: PRD 3.1 실시간 음성→텍스트 변환
- requirements:
  - @rails/actioncable 클라이언트 설정
  - TranscriptionChannel 구독
  - 오디오 청크 전송 (WebSocket)
  - 수신 이벤트 처리 (partial, final, speaker_change, summary_update)
- acceptance:
  - WebSocket 연결/해제 정상
  - 오디오 청크 전송 후 STT 결과 수신
  - 여러 이벤트 타입별 정상 처리

#### 기술 스펙 (TRD)
- tech-spec:
  - Library: @rails/actioncable
  - Channel: TranscriptionChannel
- ui-spec:
  - channels/transcription.ts
  - hooks/useTranscription.ts
  - stores/transcriptStore.ts (Zustand)

---

### TSK-03-03: 실시간 자막 UI 컴포넌트
- category: development
- domain: frontend
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-04-28 ~ 2026-05-01
- tags: ui, transcript, realtime
- depends: TSK-03-02

#### PRD 요구사항
- prd-ref: PRD 3.1 실시간 음성→텍스트 변환
- requirements:
  - 실시간 텍스트 스트림 표시 (자막 형태)
  - partial 텍스트: 회색, 변동 표시
  - final 텍스트: 검정, 고정 표시
  - 화자별 다른 색상/라벨 구분
  - 자동 스크롤 (최신 발화 추적)
- acceptance:
  - 발화 시 3초 이내 텍스트 표시
  - 화자 전환 시 색상/라벨 변경
  - 스크롤 자동 추적

#### 기술 스펙 (TRD)
- ui-spec:
  - components/meeting/LiveTranscript.tsx
  - components/meeting/SpeakerLabel.tsx

---

### TSK-03-04: 회의 진행 페이지 (녹음 + 실시간)
- category: development
- domain: frontend
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-04-30 ~ 2026-05-05
- tags: ui, meeting, live
- depends: TSK-03-01, TSK-03-02, TSK-03-03

#### PRD 요구사항
- prd-ref: PRD 3.1, 3.3 블록 기반 에디터 (레이아웃)
- requirements:
  - "회의 시작" / "회의 종료" 버튼
  - 실시간 자막 영역 + AI 실시간 요약 영역 + 메모 영역 레이아웃
  - 녹음 상태 표시 (🔴 녹음 중)
  - 회의 종료 시 원본 오디오 업로드 트리거
- acceptance:
  - 회의 시작 → 녹음 + 실시간 자막 동작
  - 회의 종료 → 녹음 중지 + 오디오 업로드 + 최종 요약 트리거
  - 3영역 레이아웃 정상 표시

#### 기술 스펙 (TRD)
- ui-spec:
  - pages/MeetingLivePage.tsx
  - 레이아웃: [실시간 자막] | [AI 요약] | [메모 에디터]
- api-spec:
  - POST /api/v1/meetings/:id/start
  - POST /api/v1/meetings/:id/stop

---

## WP-04: 블록 에디터
- status: planned
- priority: high
- schedule: 2026-05-05 ~ 2026-05-19
- progress: 0%

### TSK-04-01: BlockNote 에디터 통합
- category: development
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-05 ~ 2026-05-09
- tags: editor, blocknote
- depends: TSK-00-02

#### PRD 요구사항
- prd-ref: PRD 3.3 블록 기반 에디터
- requirements:
  - BlockNote 에디터 React 통합
  - 블록 타입: 텍스트, 제목(H1~H3), 불릿 리스트, 번호 리스트, 체크리스트, 구분선, 인용
  - `/` 명령어로 블록 타입 변경
  - 블록 드래그 앤 드롭 이동
- acceptance:
  - 에디터 렌더링 및 기본 편집 동작
  - 모든 블록 타입 생성/편집 가능
  - `/` 메뉴 동작

#### 기술 스펙 (TRD)
- tech-spec:
  - Library: BlockNote (최신, React 네이티브)
- ui-spec:
  - components/editor/MeetingEditor.tsx
  - components/editor/blocks/ (커스텀 블록)

---

### TSK-04-02: 블록 CRUD API
- category: development
- domain: backend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-05 ~ 2026-05-08
- tags: api, blocks
- depends: TSK-00-04

#### PRD 요구사항
- prd-ref: PRD 3.3 블록 기반 에디터
- requirements:
  - 블록 목록 조회 (position 순)
  - 블록 추가/수정/삭제
  - 블록 순서 변경 (reorder)
- acceptance:
  - CRUD 엔드포인트 정상 동작
  - fractional indexing으로 순서 관리
  - 중첩 블록 지원 (parent_block_id)

#### 기술 스펙 (TRD)
- api-spec:
  - GET /api/v1/meetings/:id/blocks → [blocks] (position 순)
  - POST /api/v1/meetings/:id/blocks { block_type, content, position }
  - PATCH /api/v1/blocks/:id { content, block_type }
  - DELETE /api/v1/blocks/:id
  - PATCH /api/v1/meetings/:id/blocks/reorder { block_ids: [ordered] }
- data-model:
  - blocks.position: REAL (fractional indexing)

---

### TSK-04-03: 에디터 ↔ API 동기화
- category: development
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-09 ~ 2026-05-13
- tags: editor, api, sync
- depends: TSK-04-01, TSK-04-02

#### PRD 요구사항
- prd-ref: PRD 3.3 블록 기반 에디터
- requirements:
  - BlockNote 에디터 변경사항 → API 저장 (디바운스)
  - API 데이터 → 에디터 초기 로드
  - 블록 추가/삭제/이동 시 API 자동 반영
- acceptance:
  - 편집 후 일정 시간 뒤 자동 저장
  - 페이지 새로고침 시 저장된 내용 복원
  - 블록 순서 변경 시 API 업데이트

---

### TSK-04-04: STT 텍스트 → 블록 자동 구성
- category: development
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-13 ~ 2026-05-16
- tags: editor, stt, auto-block
- depends: TSK-04-01, TSK-03-02

#### PRD 요구사항
- prd-ref: PRD 3.3 블록 기반 에디터
- requirements:
  - 확정(final) 트랜스크립트 → 화자별 텍스트 블록 자동 삽입
  - 화자 라벨 포함
  - 회의 종료 후 전문이 블록으로 구성
- acceptance:
  - 실시간 STT final 이벤트 → 에디터에 블록 자동 추가
  - 화자별 구분 표시

---

### TSK-04-05: AI 요약 블록 자동 삽입
- category: development
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-16 ~ 2026-05-19
- tags: editor, ai-summary
- depends: TSK-04-01, TSK-05-02

#### PRD 요구사항
- prd-ref: PRD 3.3 블록 기반 에디터
- requirements:
  - 회의 종료 후 AI 요약 결과를 블록 형태로 에디터에 삽입
  - 핵심 요약, 결정사항, Action Items 구조화 블록
  - 삽입 후 수동 편집 가능
- acceptance:
  - 최종 요약 생성 → 에디터 상단에 요약 블록 삽입
  - 삽입된 블록 편집 가능

---

## WP-05: AI 요약
- status: planned
- priority: critical
- schedule: 2026-05-05 ~ 2026-05-23
- progress: 0%

### TSK-05-01: LLM 요약 클라이언트 구현 (Sidecar)
- category: development
- domain: sidecar
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-05-05 ~ 2026-05-09
- tags: llm, summarize, ai
- depends: TSK-00-03

#### PRD 요구사항
- prd-ref: PRD 3.2 AI 요약 및 정리
- requirements:
  - ZAI GLM / Ollama 로컬 LLM 연동
  - 트랜스크립트 입력 → 구조화 요약 출력
  - 실시간 요약 (5분 분량) / 최종 요약 (전체) 구분
  - Action Item 자동 추출
- acceptance:
  - POST /summarize → 핵심 요약, 결정사항, 논의 내용
  - POST /summarize/action-items → 할 일 목록 (담당자 힌트, 마감일 힌트)
  - 1시간 회의 기준 30초 이내 최종 요약 생성

#### 기술 스펙 (TRD)
- tech-spec:
  - Client: anthropic SDK (Anthropic 호환 API)
  - Base URL: ENV['ANTHROPIC_BASE_URL'] (ZAI GLM)
  - Module: sidecar/app/llm/summarizer.py
- api-spec:
  - POST /summarize { transcripts, type, context } → { key_points, decisions, discussion_details, action_items }
  - POST /summarize/action-items { transcripts } → { action_items: [{ content, assignee_hint, due_date_hint }] }

---

### TSK-05-02: SummarizationJob 및 실시간 요약 (Rails)
- category: development
- domain: backend
- status: [xx]
- priority: critical
- assignee: -
- schedule: 2026-05-09 ~ 2026-05-14
- tags: job, summarize, actioncable
- depends: TSK-05-01, TSK-02-06

#### PRD 요구사항
- prd-ref: PRD 3.2 AI 요약 및 정리
- requirements:
  - 5분 간격 실시간 요약 업데이트 (SummarizationJob)
  - 회의 종료 시 최종 요약 생성 (MeetingFinalizerService)
  - 요약 결과 DB 저장 (summaries 테이블)
  - 실시간 요약 WebSocket 브로드캐스트
- acceptance:
  - 녹음 중 5분 간격 실시간 요약 업데이트
  - 실시간 요약이 10초 이내 생성
  - 회의 종료 → 최종 요약 + Action Items DB 저장

#### 기술 스펙 (TRD)
- tech-spec:
  - Job: SummarizationJob (Solid Queue)
  - Service: MeetingFinalizerService
  - Channel: summary_update 이벤트 브로드캐스트
- api-spec:
  - Server → Client: { type: "summary_update", key_points, decisions }

---

### TSK-05-03: AI 요약 패널 UI
- category: development
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-12 ~ 2026-05-16
- tags: ui, ai-summary
- depends: TSK-05-02, TSK-03-02

#### PRD 요구사항
- prd-ref: PRD 3.2 AI 요약 및 정리
- requirements:
  - 실시간 요약 패널 (회의 진행 중 업데이트)
  - 핵심 요약, 결정사항, Action Items 구분 표시
  - 최종 요약 완성 시 전체 결과 표시
- acceptance:
  - 실시간 요약 이벤트 수신 → 패널 업데이트
  - 회의 종료 후 최종 요약 표시

#### 기술 스펙 (TRD)
- ui-spec:
  - components/meeting/AiSummaryPanel.tsx
  - summary_update 이벤트 구독

---

### TSK-05-04: Action Item CRUD API 및 UI
- category: development
- domain: fullstack
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-14 ~ 2026-05-20
- tags: action-items, api, ui
- depends: TSK-05-02, TSK-01-02

#### PRD 요구사항
- prd-ref: PRD 3.2 AI 요약 및 정리
- requirements:
  - AI 추출 Action Items 목록 표시
  - 담당자 지정 (팀원 목록에서 선택)
  - 마감일 설정
  - 완료/미완료 체크박스 토글
  - 수동 추가/수정/삭제
- acceptance:
  - AI 추출 항목 자동 표시
  - 담당자/마감일 수정 가능
  - 체크박스로 상태 변경 → API 반영

#### 기술 스펙 (TRD)
- api-spec:
  - GET /api/v1/meetings/:id/action_items
  - PATCH /api/v1/action_items/:id { assignee_id, due_date, status }
  - DELETE /api/v1/action_items/:id
- ui-spec:
  - components/action-item/ActionItemList.tsx
  - components/action-item/ActionItemForm.tsx

---

## WP-06: 회의 관리
- status: planned
- priority: high
- schedule: 2026-05-19 ~ 2026-06-02
- progress: 0%

### TSK-06-01: 회의 CRUD API
- category: development
- domain: backend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-19 ~ 2026-05-22
- tags: api, meetings
- depends: TSK-00-04, TSK-01-03

#### PRD 요구사항
- prd-ref: PRD 3.4 회의 관리
- requirements:
  - 회의 생성 (제목, team_id)
  - 회의 목록 (페이징, 검색)
  - 회의 상세 (트랜스크립트, 요약 포함)
  - 회의 수정/삭제
  - 녹음 시작/종료 API
- acceptance:
  - CRUD 엔드포인트 정상 동작
  - 페이징/검색 정상
  - 회의 상세에 transcript + summary + action_items 포함

#### 기술 스펙 (TRD)
- api-spec:
  - GET /api/v1/meetings (pagination, search)
  - POST /api/v1/meetings { title, team_id }
  - GET /api/v1/meetings/:id (includes: transcripts, summary, action_items)
  - PATCH /api/v1/meetings/:id { title }
  - DELETE /api/v1/meetings/:id
  - POST /api/v1/meetings/:id/start
  - POST /api/v1/meetings/:id/stop
- data-model:
  - MeetingSerializer (Alba): id, title, status, started_at, ended_at, team, transcripts, summary, action_items

---

### TSK-06-02: 회의 목록 페이지 UI
- category: development
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-22 ~ 2026-05-26
- tags: ui, meetings, list
- depends: TSK-06-01, TSK-01-06

#### PRD 요구사항
- prd-ref: PRD 3.4 회의 관리
- requirements:
  - 회의 목록 (최신순)
  - 검색 기능
  - 회의 생성 버튼
  - 회의 상태 표시 (pending/recording/completed)
- acceptance:
  - 팀별 회의 목록 표시
  - 검색어 입력 → 필터링
  - 회의 클릭 → 상세 페이지 이동

#### 기술 스펙 (TRD)
- ui-spec:
  - pages/MeetingsPage.tsx
  - stores/meetingStore.ts
  - api/meetings.ts

---

### TSK-06-03: 회의 상세 페이지 UI
- category: development
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-26 ~ 2026-05-29
- tags: ui, meetings, detail
- depends: TSK-06-01, TSK-04-01

#### PRD 요구사항
- prd-ref: PRD 3.4 회의 관리
- requirements:
  - 텍스트 전문 표시 (블록 에디터)
  - AI 요약 표시
  - Action Items 목록
  - 편집 가능한 블록 에디터
- acceptance:
  - 완료된 회의의 전체 데이터 표시
  - 블록 에디터로 회의록 편집 가능

#### 기술 스펙 (TRD)
- ui-spec:
  - pages/MeetingPage.tsx (에디터 + 요약 + Action Items 통합)

---

### TSK-06-04: 오디오 재생 및 타임라인 동기화
- category: development
- domain: fullstack
- status: [xx]
- priority: medium
- assignee: -
- schedule: 2026-05-29 ~ 2026-06-02
- tags: audio, player, wavesurfer
- depends: TSK-06-01

#### PRD 요구사항
- prd-ref: PRD 3.4 회의 관리
- requirements:
  - 녹음 원본 오디오 파일 재생
  - 파형 시각화 (WaveSurfer.js)
  - 오디오 타임라인과 텍스트 동기화 (클릭 시 해당 시점 재생)
- acceptance:
  - 오디오 파형 표시 및 재생/정지
  - 텍스트 클릭 → 해당 타임스탬프 위치 재생
  - 재생 위치에 따른 텍스트 하이라이트

#### 기술 스펙 (TRD)
- tech-spec:
  - Library: WaveSurfer.js 7+
  - API: GET /api/v1/meetings/:id/audio (스트리밍)
- ui-spec:
  - components/meeting/AudioPlayer.tsx
  - transcript started_at_ms / ended_at_ms 기반 동기화

---

### TSK-06-05: 오디오 업로드 처리 (서버)
- category: development
- domain: backend
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-05-22 ~ 2026-05-25
- tags: audio, upload, storage
- depends: TSK-00-04

#### PRD 요구사항
- prd-ref: PRD 3.4 회의 관리
- requirements:
  - 원본 오디오 파일 업로드 수신
  - storage/audio/ 디렉토리에 저장
  - meetings.audio_file_path 업데이트
- acceptance:
  - WebM/Opus 파일 업로드 성공
  - 저장 경로 DB 기록
  - GET /api/v1/meetings/:id/audio로 스트리밍 가능

#### 기술 스펙 (TRD)
- tech-spec:
  - Storage: ActiveStorage (로컬 디스크)
  - Job: AudioUploadJob
  - Path: storage/audio/{meeting_id}.webm

---

## WP-07: 내보내기 및 마무리
- status: planned
- priority: medium
- schedule: 2026-06-02 ~ 2026-06-13
- progress: 0%

### TSK-07-01: Markdown 내보내기 서비스
- category: development
- domain: backend
- status: [xx]
- priority: medium
- assignee: -
- schedule: 2026-06-02 ~ 2026-06-04
- tags: export, markdown
- depends: TSK-06-01

#### PRD 요구사항
- prd-ref: PRD 3.6 Markdown 내보내기
- requirements:
  - 회의록 전체를 Markdown 파일로 변환
  - AI 요약 포함/제외 옵션
  - 원본 텍스트 포함/제외 옵션
- acceptance:
  - GET /api/v1/meetings/:id/export → Markdown 텍스트 반환
  - 옵션에 따라 내용 구성 변경
  - 올바른 Markdown 형식 (제목, 불릿, 체크박스)

#### 기술 스펙 (TRD)
- tech-spec:
  - Service: MarkdownExporter (app/services/markdown_exporter.rb)
- api-spec:
  - GET /api/v1/meetings/:id/export?include_summary=true&include_transcript=true
  - Response: Content-Type: text/markdown

---

### TSK-07-02: Markdown 내보내기 UI
- category: development
- domain: frontend
- status: [xx]
- priority: medium
- assignee: -
- schedule: 2026-06-04 ~ 2026-06-06
- tags: export, ui
- depends: TSK-07-01, TSK-06-03

#### PRD 요구사항
- prd-ref: PRD 3.6 Markdown 내보내기
- requirements:
  - 내보내기 버튼 (회의 상세 페이지)
  - AI 요약 포함/제외 체크박스
  - 원본 텍스트 포함/제외 체크박스
  - 파일 다운로드
- acceptance:
  - 내보내기 클릭 → 옵션 선택 → .md 파일 다운로드
  - 다운로드 파일 정상 Markdown 형식

#### 기술 스펙 (TRD)
- ui-spec:
  - lib/markdown.ts (다운로드 헬퍼)
  - 회의 상세 페이지에 내보내기 버튼 통합

---

### TSK-07-03: 회의록 공유 기능
- category: development
- domain: fullstack
- status: [xx]
- priority: medium
- assignee: -
- schedule: 2026-06-06 ~ 2026-06-09
- tags: share, link
- depends: TSK-06-03, TSK-01-03

#### PRD 요구사항
- prd-ref: PRD 3.5 사용자/팀 관리
- requirements:
  - 팀원에게 회의록 링크 공유
  - 같은 팀 소속만 접근 가능
- acceptance:
  - 공유 링크로 회의 상세 페이지 접근
  - 비팀원 접근 시 권한 에러

---

### TSK-07-04: E2E 테스트 작성
- category: development
- domain: test
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-06-06 ~ 2026-06-11
- tags: test, e2e, playwright
- depends: TSK-06-03, TSK-03-04

#### PRD 요구사항
- prd-ref: PRD 전체 기능
- requirements:
  - 주요 사용자 흐름 E2E 테스트
  - 회원가입 → 로그인 → 팀 생성 → 회의 생성 → 회의록 확인 플로우
  - 실시간 파이프라인 E2E (오디오 입력 → STT → 표시)
- acceptance:
  - Playwright 테스트 스위트 통과
  - CI에서 실행 가능

#### 기술 스펙 (TRD)
- tech-spec:
  - Framework: Playwright
  - 핵심 시나리오: 회원가입-로그인-팀생성-회의-요약-내보내기

---

### TSK-07-05: 성능 최적화 및 버그 수정
- category: defect
- domain: fullstack
- status: [xx]
- priority: high
- assignee: -
- schedule: 2026-06-09 ~ 2026-06-13
- tags: performance, bugfix
- depends: TSK-07-04

#### PRD 요구사항
- prd-ref: PRD 5.0 비기능 요구사항
- requirements:
  - STT 지연 3초 이내 검증 및 최적화
  - 동시 접속 10명 테스트
  - SQLite WAL 모드 동시 쓰기 검증
  - E2E 테스트에서 발견된 버그 수정
- acceptance:
  - STT 지연 ≤ 3초
  - AI 실시간 요약 ≤ 10초
  - 10명 동시 WebSocket 안정
- constraints:
  - 동시 접속 10명 이내
  - Chrome 90+, Safari 15+, Firefox 90+

---

## 일정 요약

| WP | 기간 | 작업 수 |
|----|------|---------|
| WP-00: 프로젝트 초기화 | 2026-03-25 ~ 2026-04-04 | 5 |
| WP-01: 인증 및 사용자/팀 관리 | 2026-03-28 ~ 2026-04-11 | 6 |
| WP-02: STT 파이프라인 | 2026-04-07 ~ 2026-04-25 | 6 |
| WP-03: 실시간 UI | 2026-04-21 ~ 2026-05-05 | 4 |
| WP-04: 블록 에디터 | 2026-05-05 ~ 2026-05-19 | 5 |
| WP-05: AI 요약 | 2026-05-05 ~ 2026-05-23 | 4 |
| WP-06: 회의 관리 | 2026-05-19 ~ 2026-06-02 | 5 |
| WP-07: 내보내기 및 마무리 | 2026-06-02 ~ 2026-06-13 | 5 |
| **합계** | **2026-03-25 ~ 2026-06-13** | **40** |
