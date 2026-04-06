# WBS - 또박또박 v3 (서버 배포 + 사용자 인증)

> version: 3.0
> depth: 3
> updated: 2026-04-05

---

# Phase A: Mac에서 개발 (GPU 불필요)

---

## WP-01: 사용자 인증 (서버 측)
- status: done
- priority: critical
- progress: 100%
- note: Mac 로컬에서 SERVER_MODE=true로 개발/테스트 가능

### TSK-01-01: Devise JWT 인증 구현
- category: feature
- domain: backend
- status: [xx]
- priority: critical
- assignee: -
- tags: auth, jwt, devise
- depends: -
- note: 기존 Devise + User 모델을 활용하여 JWT 인증 추가

#### PRD 요구사항
- prd-ref: PRD 3.1 사용자 인증
- requirements:
  - devise-jwt gem 추가 및 설정
  - JWT Access Token (24시간) + Refresh Token (30일) 발급
  - `POST /auth/login` — 이메일+비밀번호 → JWT 발급
  - `POST /auth/refresh` — Refresh Token → 새 Access Token
  - `DELETE /auth/logout` — 토큰 무효화 (jti 폐기)
  - User 모델에 `refresh_token_jti` 필드 추가
- acceptance:
  - 로그인 API로 JWT 토큰 발급 성공
  - 토큰으로 인증된 API 호출 성공
  - 만료된 토큰으로 401 응답

#### 기술 스펙 (TRD)
- tech-spec:
  - Gem: devise-jwt
  - 기존 코드: User 모델 (email, encrypted_password, jti), authenticate_user!
  - Token: JWT HS256, jti 기반 revocation
- data-model:
  - users 테이블 추가: refresh_token_jti (string)

---

### TSK-01-02: 브라우저 로그인 페이지
- category: feature
- domain: backend
- status: [xx]
- priority: critical
- assignee: -
- tags: auth, web, html
- depends: TSK-01-01
- note: Tauri 앱에서 브라우저로 열 로그인 폼 (서버 렌더링 HTML)

#### PRD 요구사항
- prd-ref: PRD 3.1.1 인증 흐름
- requirements:
  - `GET /auth/login?callback=ddobak://` — 로그인 폼 HTML 렌더링
  - 이메일+비밀번호 제출 → 인증 성공 시 `ddobak://callback?token=xxx` 리다이렉트
  - 인증 실패 시 에러 메시지 표시
  - 간결한 UI (Tailwind CSS standalone)
- acceptance:
  - 브라우저에서 로그인 폼 표시
  - 로그인 성공 시 딥링크 리다이렉트 확인

---

### TSK-01-03: 서버/로컬 모드 분기
- category: feature
- domain: backend
- status: [xx]
- priority: high
- assignee: -
- tags: auth, mode
- depends: TSK-01-01
- note: SERVER_MODE 환경변수로 인증 동작 분기

#### PRD 요구사항
- prd-ref: PRD 3.1.3 기존 코드 활용
- requirements:
  - `SERVER_MODE=true` 시 JWT 인증 필수
  - `SERVER_MODE=false` (기본) 시 기존 desktop@local 자동 생성
  - DefaultUserLookup concern 수정
  - CORS 설정에 서버 도메인 추가 (CORS_ORIGIN 환경변수)
- acceptance:
  - 로컬 모드: 기존 동작 유지 (인증 없이 API 접근 가능)
  - 서버 모드: JWT 없이 API 접근 시 401

---

## WP-02: 사용자 인증 (클라이언트 측)
- status: done
- priority: critical
- progress: 100%
- note: Mac에서 Tauri dev 모드로 개발/테스트 가능

### TSK-02-01: Tauri 딥링크 설정
- category: feature
- domain: frontend
- status: [xx]
- priority: critical
- assignee: -
- tags: tauri, deep-link
- depends: -
- note: Tauri v2 deep-link 플러그인으로 `ddobak://` 스킴 등록

#### PRD 요구사항
- prd-ref: PRD 3.1.1 인증 흐름, TRD 2.4
- requirements:
  - tauri-plugin-deep-link 설치 및 설정
  - `ddobak://callback?token=xxx` 수신 처리
  - 수신한 JWT를 localStorage에 저장
  - tauri.conf.json에 딥링크 스킴 등록
- acceptance:
  - 브라우저에서 `ddobak://callback?token=test` 열면 앱 활성화
  - 토큰이 localStorage에 저장됨

---

### TSK-02-02: 서버 URL 설정 UI
- category: feature
- domain: frontend
- status: [xx]
- priority: critical
- assignee: -
- tags: ui, settings, auth
- depends: -
- note: 앱 첫 실행 시 로컬/서버 모드 선택 및 서버 URL 입력

#### PRD 요구사항
- prd-ref: PRD 3.4 Tauri 클라이언트 변경, TRD 2.3
- requirements:
  - 모드 선택 UI: "로컬 실행" / "서버 연결"
  - 서버 모드 선택 시 서버 URL 입력 필드
  - URL 헬스체크 (서버 접근 가능 여부 확인)
  - 설정을 localStorage에 저장 (mode, server_url)
- acceptance:
  - 서버 URL 입력 후 연결 확인 성공
  - 모드/URL이 localStorage에 저장됨
  - 앱 재시작 시 설정 유지

---

### TSK-02-03: 로그인 흐름 구현
- category: feature
- domain: frontend
- status: [xx]
- priority: critical
- assignee: -
- tags: auth, ui, jwt
- depends: TSK-02-01, TSK-02-02, TSK-01-02
- note: 서버 모드에서 브라우저 로그인 → 딥링크 토큰 수신 → 자동 로그인

#### PRD 요구사항
- prd-ref: PRD 3.1.1, TRD 2.4
- requirements:
  - authStore (Zustand): 토큰 상태 관리, 로그인/로그아웃 액션
  - 로그인 버튼 클릭 → `open(serverUrl + '/auth/login?callback=ddobak://')`
  - 딥링크로 토큰 수신 → authStore에 저장
  - API 클라이언트(ky)에 JWT Authorization 헤더 자동 첨부
  - Refresh Token 만료 시 자동 갱신
  - 로그아웃: 토큰 삭제 → 로그인 화면
  - 앱 시작 시 토큰 유효성 검증 → 자동 로그인 또는 로그인 화면
- acceptance:
  - 전체 로그인 흐름 동작 (브라우저 → 딥링크 → 메인 화면)
  - 앱 재시작 시 자동 로그인
  - 로그아웃 후 재로그인

---

### TSK-02-04: 라우팅 인증 가드
- category: feature
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- tags: auth, routing
- depends: TSK-02-03
- note: 서버 모드에서 미인증 사용자의 페이지 접근 차단

#### PRD 요구사항
- prd-ref: TRD 2.4
- requirements:
  - App.tsx 라우팅에 인증 가드 추가
  - 서버 모드 + 미인증 → 로그인 페이지로 리다이렉트
  - 로컬 모드 → 기존 동작 유지 (가드 없음)
- acceptance:
  - 서버 모드에서 토큰 없이 /meetings 접근 → 로그인 화면
  - 로컬 모드에서 인증 없이 정상 접근

---

## WP-03: 사용자별 LLM 설정
- status: done
- priority: critical
- progress: 100%
- note: Mac에서 SERVER_MODE=true + 로컬 Sidecar로 개발/테스트 가능

### TSK-03-01: User 모델 LLM 필드 추가
- category: feature
- domain: backend
- status: [xx]
- priority: critical
- assignee: -
- tags: database, user, llm
- depends: TSK-01-01
- note: User 모델에 개인 LLM 설정 필드 추가 (암호화)

#### PRD 요구사항
- prd-ref: PRD 3.2, PRD 4.1
- requirements:
  - 마이그레이션: llm_provider, llm_api_key, llm_model, llm_base_url 추가
  - llm_api_key는 Rails encrypted attributes로 암호화 저장
  - LLM 미설정 시 서버 기본값(settings.yaml) 폴백
- acceptance:
  - User에 LLM 설정 저장/조회 가능
  - API 키가 DB에 암호화 저장됨

#### 기술 스펙 (TRD)
- data-model:
  - users 테이블 추가: llm_provider (string), llm_api_key (encrypted string), llm_model (string), llm_base_url (string)

---

### TSK-03-02: 사용자별 LLM API 구현
- category: feature
- domain: backend
- status: [xx]
- priority: critical
- assignee: -
- tags: api, llm, user
- depends: TSK-03-01
- note: 사용자별 LLM 설정 CRUD API + 요약 시 사용자 LLM 사용

#### PRD 요구사항
- prd-ref: PRD 3.2.2, TRD 3.4 사용자 설정 API
- requirements:
  - `GET /api/v1/user/llm_settings` — 내 LLM 설정 조회
  - `PUT /api/v1/user/llm_settings` — 내 LLM 설정 변경
  - `POST /api/v1/user/llm_settings/test` — LLM 연결 테스트
  - MeetingSummarizationJob에서 current_user의 LLM 설정으로 Sidecar 호출
  - Sidecar `/summarize` API에 llm_config 파라미터 전달
- acceptance:
  - 사용자 A (Anthropic) / 사용자 B (OpenAI)가 각자 LLM으로 요약 생성

---

### TSK-03-03: 사용자 LLM 설정 UI
- category: feature
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- tags: ui, settings, llm
- depends: TSK-03-02
- note: 설정 모달에 개인 LLM 설정 UI 추가

#### PRD 요구사항
- prd-ref: PRD 3.2.2
- requirements:
  - 설정 모달에 "내 LLM 설정" 탭/섹션 추가
  - Provider 선택 (Anthropic, OpenAI, 커스텀)
  - API 키 입력 (마스킹)
  - 모델명 입력
  - Base URL 입력 (Ollama 등 커스텀 엔드포인트용)
  - 연결 테스트 버튼
  - 미설정 시 "서버 기본값 사용 중" 표시
- acceptance:
  - LLM 설정 저장 후 요약 생성 시 해당 LLM 사용 확인
  - 연결 테스트 성공/실패 UI 표시

---

## WP-04: Tauri 클라이언트 모드 분기
- status: done
- priority: high
- progress: 100%
- note: Mac에서 Tauri dev 모드로 개발/테스트 가능

### TSK-04-01: config.ts 모드 분기
- category: feature
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- tags: config, mode
- depends: TSK-02-02
- note: API_BASE_URL, WS_URL을 로컬/서버 모드에 따라 분기

#### PRD 요구사항
- prd-ref: TRD 2.3
- requirements:
  - localStorage의 mode, server_url 기반으로 API/WS URL 결정
  - 로컬 모드: localhost:13323 (기존)
  - 서버 모드: 사용자 설정 URL
  - ActionCable 연결 URL도 분기
- acceptance:
  - 서버 모드에서 원격 서버 API 호출 성공
  - 로컬 모드에서 기존 동작 유지

---

### TSK-04-02: SetupPage 모드 분기
- category: feature
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- tags: setup, tauri, mode
- depends: TSK-04-01, TSK-02-03
- note: 서버 모드에서 프로세스 관리(Rails/Sidecar 시작) 비활성화

#### PRD 요구사항
- prd-ref: PRD 3.4, TRD 6.3
- requirements:
  - 서버 모드: SetupPage 건너뛰기 (환경 확인/설치 불필요)
  - 서버 모드: start_services/stop_services invoke 비활성화
  - 로컬 모드: 기존 SetupPage 유지
  - 앱 시작 흐름: 모드 확인 → 분기
- acceptance:
  - 서버 모드에서 앱 즉시 시작 (Python 설치 없이)
  - 로컬 모드에서 기존 셋업 흐름 정상 동작

---

## WP-05: 실시간 회의 공유
- status: done
- priority: high
- progress: 100%
- note: 서버 모드 전용. Phase A 완료 후 개발 가능. Mac에서 SERVER_MODE=true로 개발/테스트 가능

### TSK-05-01: 회의 공유 모델 및 API
- category: feature
- domain: backend
- status: [xx]
- priority: high
- assignee: -
- tags: meeting, sharing, api
- depends: TSK-01-01
- note: 회의 공유 코드 생성, 참여자 관리 API

#### PRD 요구사항
- prd-ref: PRD 3.5 실시간 회의 공유
- requirements:
  - MeetingParticipant 모델 생성 (meeting_id, user_id, role, joined_at, left_at)
  - Meeting 모델에 share_code 필드 추가 (6자리 영숫자, unique)
  - `POST /api/v1/meetings/:id/share` — 공유 코드 생성
  - `DELETE /api/v1/meetings/:id/share` — 공유 중지
  - `POST /api/v1/meetings/join` — 공유 코드로 회의 참여
  - `GET /api/v1/meetings/:id/participants` — 참여자 목록 조회
  - `POST /api/v1/meetings/:id/transfer_host` — 호스트 권한을 특정 참여자에게 위임
  - 호스트 나가기 시 참여자가 있으면 자동 위임 또는 위임 대상 선택
- acceptance:
  - 공유 코드 생성 및 조회 성공
  - 공유 코드로 회의 참여 성공
  - 참여자 목록에 host + viewer 표시
  - 호스트 위임 후 새 호스트가 녹음 컨트롤 가능, 이전 호스트는 viewer로 전환

---

### TSK-05-02: 실시간 전사 브로드캐스트
- category: feature
- domain: backend
- status: [xx]
- priority: high
- assignee: -
- tags: actioncable, websocket, realtime
- depends: TSK-05-01
- note: 기존 TranscriptionChannel을 확장하여 참여자에게도 전사 이벤트 전송

#### PRD 요구사항
- prd-ref: PRD 3.5.2
- requirements:
  - TranscriptionChannel에서 회의 참여자(viewer)도 구독 가능하도록 확장
  - 참여/퇴장 시 다른 참여자에게 알림 브로드캐스트
  - 녹음 종료 시 참여자에게 종료 이벤트 전송
  - 참여자 수 제한 (최대 20명)
- acceptance:
  - viewer가 ActionCable 구독 후 실시간 전사 수신
  - 녹음 종료 시 viewer에게 종료 알림

---

### TSK-05-03: 회의 공유 UI (호스트)
- category: feature
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- tags: ui, sharing, meeting
- depends: TSK-05-01
- note: 녹음 중인 회의에서 공유 버튼, 공유 코드 표시, 참여자 목록

#### PRD 요구사항
- prd-ref: PRD 3.5.1
- requirements:
  - 회의 녹음 화면에 "공유" 버튼 추가
  - 공유 코드 표시 + 클립보드 복사
  - 현재 참여자 목록 실시간 표시
  - 공유 중지 버튼
  - 참여자 목록에서 특정 뷰어에게 "호스트 넘기기" 버튼
  - 호스트가 나갈 때 참여자가 있으면 위임 확인 다이얼로그
- acceptance:
  - 공유 코드 생성 후 UI에 표시
  - 참여자 입장/퇴장 시 목록 실시간 업데이트
  - 호스트 위임 시 새 호스트에게 녹음 컨트롤 활성화

---

### TSK-05-04: 회의 참여 UI (뷰어)
- category: feature
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- tags: ui, viewer, realtime
- depends: TSK-05-02, TSK-05-03
- note: 공유 코드로 회의에 참여하여 실시간 전사를 보는 읽기 전용 화면

#### PRD 요구사항
- prd-ref: PRD 3.5.1, 3.5.2
- requirements:
  - 공유 코드 입력 화면 (메인 화면에 "회의 참여" 버튼)
  - 실시간 전사(스크립트) + AI 요약만 표시하는 읽기 전용 화면
  - 편집, 메모, 녹음 컨트롤, 내보내기 등 모든 조작 버튼 비활성화(숨김 또는 disabled)
  - 화자 라벨, 타임스탬프 표시
  - 녹음 종료 알림 → 최종 회의록(스크립트+요약) 읽기 전용 보기
  - 참여 중인 다른 사용자 아바타/이름 표시
- acceptance:
  - 공유 코드 입력 후 실시간 전사 화면 진입
  - 호스트의 전사 내용이 실시간으로 표시
  - 편집/메모/녹음/내보내기 버튼이 뷰어에게 보이지 않거나 비활성화
  - 녹음 종료 후 회의록 읽기 전용 열람 가능

---

## WP-06: AI 회의록 UX 개선
- status: done
- priority: high
- progress: 100%
- note: 적용주기를 설정→회의 화면으로 이동, 장시간 회의 요약 타임아웃 해결

### TSK-06-01: 적용주기 설정을 회의 화면으로 이동
- category: enhancement
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- tags: ui, summary, meeting
- depends: -
- note: 글로벌 설정에서 제거하고 회의별로 녹음 중 변경 가능하게

#### 요구사항
- requirements:
  - `config.yaml` default_interval_sec를 60 → 120 (2분)으로 변경
  - SettingsContent.tsx에서 "AI 회의록 적용 주기" 섹션 전체 제거
  - MeetingLivePage.tsx 녹음 컨트롤 영역에 적용주기 선택 UI 추가
  - appSettingsStore에서 summaryIntervalSec 글로벌 저장 제거, MeetingLivePage 로컬 상태로 전환
  - 기존 interval_options (안함/30초/1분/2분/5분) 재사용
- acceptance:
  - 설정 페이지에 적용주기 섹션 없음
  - 회의 녹음 화면에서 주기 변경 가능
  - 디폴트 2분으로 동작
  - 회의마다 독립적으로 주기 설정

---

### TSK-06-02: 요약 타임아웃 5분으로 확대
- category: enhancement
- domain: backend
- status: [xx]
- priority: high
- assignee: -
- tags: timeout, summary, sidecar
- depends: -
- note: 2시간+ 장시간 회의 요약 시 타임아웃 발생 해결

#### 요구사항
- requirements:
  - `sidecar_client.rb` — `/summarize` 타임아웃 120 → 300초
  - `sidecar_client.rb` — `/summarize/action-items` 타임아웃 120 → 300초
  - `sidecar_client.rb` — `/refine-notes` 타임아웃 120 → 300초
- acceptance:
  - 2시간 이상 회의 요약 시 타임아웃 없이 완료
  - 정상 회의(30분 이하)에서 기존과 동일하게 동작

---

### TSK-06-03: AI 피드백을 오타 수정으로 변경
- category: enhancement
- domain: frontend, backend, sidecar
- status: [xx]
- priority: high
- assignee: -
- tags: ui, stt, typo, feedback
- depends: -
- note: STT 오인식 용어를 사용자가 등록하면 회의록에 일괄 반영

#### 요구사항
- requirements:
  - "AI 피드백" UI를 "오타 수정"으로 변경 (라벨, placeholder 등)
  - 용어 매핑 입력 UI: 잘못된 용어 → 올바른 용어 쌍 입력 (예: "크루드" → "CRUD")
  - 등록된 용어 매핑을 회의록(notes_markdown) + 트랜스크립트 텍스트에 일괄 치환 반영
  - 기존 `POST /meetings/:id/feedback` API를 용어 치환 방식으로 변경 또는 새 엔드포인트 추가
  - Sidecar `/feedback-notes` 엔드포인트도 용어 치환 로직에 맞게 수정
  - MeetingPage.tsx(회의 미리보기)에도 오타 수정 UI 추가 — 완료된 회의에서도 용어 수정 후 STT 재생성/회의록 재생성에 반영
- acceptance:
  - 오타 수정 용어 등록 후 회의록에 즉시 반영
  - 여러 용어 쌍을 한번에 등록 가능
  - 트랜스크립트 원문에도 치환 적용
  - 회의 미리보기(MeetingPage)에서도 오타 수정 가능

---

### TSK-06-04: 회의록 재생성 시 회의록 기반 요약
- category: enhancement
- domain: backend
- status: [--]
- priority: high
- assignee: -
- tags: summary, regenerate, notes
- depends: -
- note: 현재 regenerate_notes는 트랜스크립트 기반 재요약인데, 수정된 회의록 내용을 입력으로 요약하도록 변경

#### 요구사항
- requirements:
  - `regenerate_notes` 액션에서 기존 notes_markdown이 있으면 이를 요약 입력으로 사용
  - MeetingSummarizationJob에 notes 기반 요약 모드 추가 (type: "from_notes" 등)
  - Sidecar에 회의록 텍스트를 입력으로 받아 요약을 생성하는 엔드포인트 추가 또는 기존 `/summarize` 확장
  - notes_markdown이 비어있으면 기존 트랜스크립트 기반 요약으로 폴백
- acceptance:
  - 오타 수정 후 회의록 재생성 시 수정된 내용이 요약에 반영
  - notes 없는 회의는 기존처럼 트랜스크립트 기반 요약

---

### TSK-06-05: Mermaid 다이어그램 최소 높이 확대
- category: enhancement
- domain: frontend
- status: [xx]
- priority: medium
- assignee: -
- tags: ui, mermaid, layout
- depends: -
- note: Mermaid 블록이 작은 다이어그램일 때 너무 조그맣게 보이는 문제

#### 요구사항
- requirements:
  - mermaidBlock.tsx 렌더링 컨테이너에 최소 높이 설정 (현재 없음 → 추가)
  - textarea 편집 영역 min-h-[120px] → min-h-[240px]로 2배 확대
  - 렌더링된 다이어그램 영역에도 min-h-[240px] 적용
- acceptance:
  - 작은 Mermaid 다이어그램도 충분한 높이로 표시
  - 편집 textarea도 넉넉한 높이 확보

---

### TSK-06-06: 회의 목록 뷰 모드 전환 (카드/리스트/컬럼)
- category: enhancement
- domain: frontend
- status: [xx]
- priority: medium
- assignee: -
- tags: ui, meetings, view-mode
- depends: -
- note: macOS Finder처럼 뷰 모드를 전환할 수 있게 변경

#### 요구사항
- requirements:
  - MeetingsPage 상단에 뷰 모드 토글 버튼 추가 (아이콘: 그리드/리스트/컬럼)
  - 카드 뷰 (기존): 그리드 레이아웃 유지
  - 리스트 뷰: 한 줄에 제목, 날짜, 상태, 유형을 테이블 형태로 표시
  - 컬럼 뷰 (선택): Finder 컬럼 뷰처럼 폴더→회의 계층 탐색
  - 선택한 뷰 모드를 localStorage에 저장하여 다음 접속 시 유지
  - 폴더 카드도 각 뷰 모드에 맞게 표시
- acceptance:
  - 카드 뷰 ↔ 리스트 뷰 전환 동작
  - 뷰 모드 선택이 새로고침 후에도 유지
  - 리스트 뷰에서 정렬(날짜, 제목) 가능

---

## WP-07: 관리자 사용자 관리
- status: done
- priority: high
- progress: 100%
- note: 서버 모드에서 관리자가 사용자를 생성/관리할 수 있는 기능

### TSK-07-01: User 모델에 role 필드 추가
- category: feature
- domain: backend
- status: [xx]
- priority: critical
- assignee: -
- tags: database, user, admin
- depends: TSK-01-01
- note: admin/member 역할 구분, 첫 번째 사용자를 admin으로 설정

#### 요구사항
- requirements:
  - 마이그레이션: users 테이블에 role 필드 추가 (string, default: "member")
  - role 값: "admin", "member"
  - 기존 사용자 중 첫 번째(또는 지정된) 사용자를 admin으로 설정하는 seed/migration
  - admin 권한 체크 헬퍼 메서드 (User#admin?)
- acceptance:
  - User.first.admin? → true
  - 새 사용자 생성 시 기본 role은 "member"

---

### TSK-07-02: 관리자 사용자 관리 API
- category: feature
- domain: backend
- status: [xx]
- priority: critical
- assignee: -
- tags: api, admin, user
- depends: TSK-07-01
- note: 관리자만 접근 가능한 사용자 CRUD API

#### 요구사항
- requirements:
  - `GET /api/v1/admin/users` — 사용자 목록 조회 (이름, 이메일, role, 생성일, 최근 로그인)
  - `POST /api/v1/admin/users` — 사용자 생성 (이메일 초대 방식 또는 직접 생성)
  - `PUT /api/v1/admin/users/:id` — 사용자 정보 수정 (이름, role 변경)
  - `DELETE /api/v1/admin/users/:id` — 사용자 비활성화/삭제
  - admin이 아닌 사용자가 접근 시 403 응답
  - admin은 자기 자신을 삭제할 수 없음
- acceptance:
  - admin 계정으로 사용자 목록 조회 성공
  - member 계정으로 접근 시 403
  - 사용자 생성/수정/삭제 동작

---

### TSK-07-03: 관리자 사용자 관리 UI
- category: feature
- domain: frontend
- status: [xx]
- priority: high
- assignee: -
- tags: ui, admin, user
- depends: TSK-07-02
- note: 설정 페이지에 관리자 전용 사용자 관리 탭

#### 요구사항
- requirements:
  - 설정 모달에 "사용자 관리" 탭 추가 (admin role인 경우에만 표시)
  - 사용자 목록 테이블: 이름, 이메일, role, 생성일, 최근 로그인
  - 사용자 추가 버튼 → 이메일/이름/비밀번호/role 입력 다이얼로그
  - 사용자별 role 변경 (admin ↔ member)
  - 사용자 삭제 버튼 + 확인 다이얼로그
  - authStore에 현재 사용자 role 정보 포함
- acceptance:
  - admin으로 로그인 시 사용자 관리 탭 표시
  - member로 로그인 시 탭 미표시
  - 사용자 추가/수정/삭제 UI 동작

---

## WP-08: 검색 & 분석
- status: in-progress
- priority: high
- progress: 66%
- note: 회의 데이터의 검색성과 의사결정 추적 강화

### TSK-08-01: 전문 검색 (Full-Text Search)
- category: feature
- domain: frontend, backend
- status: [xx]
- priority: high
- assignee: -
- tags: search, fts, sqlite
- depends: -
- note: 회의록/트랜스크립트를 빠르게 검색하는 전문 검색 기능

#### 요구사항
- requirements:
  - SQLite FTS5 가상 테이블 생성 (transcripts, summaries 인덱싱)
  - `GET /api/v1/search?q=키워드` — 검색 API (회의록+트랜스크립트 통합)
  - 필터: 화자, 날짜 범위, 폴더, 회의 상태
  - 검색 결과에 키워드 하이라이트 (snippet)
  - 회의 생성/수정/삭제 시 FTS 인덱스 자동 갱신
  - 프론트엔드 검색 UI: 사이드바 또는 상단 검색바, 결과 목록에서 클릭 시 해당 회의로 이동
- acceptance:
  - 키워드 검색 시 관련 회의 목록 표시
  - 화자/날짜 필터 적용 가능
  - 검색 결과에서 키워드가 하이라이트됨
  - 한국어 검색 정상 동작

---

### TSK-08-02: 의사결정 추적 (Decision Log)
- category: feature
- domain: backend, frontend, sidecar
- status: [xx]
- priority: high
- assignee: -
- tags: decision, ai, tracking
- depends: -
- note: AI가 회의 중 결정사항을 자동 추출하여 별도 추적

#### 요구사항
- requirements:
  - Decision 모델 생성 (meeting_id, content, context, decided_at, participants)
  - 요약 생성 시 LLM 프롬프트에 결정사항 추출 지시 추가
  - `GET /api/v1/meetings/:id/decisions` — 회의별 결정사항 목록
  - `GET /api/v1/decisions?folder_id=N` — 폴더/프로젝트 단위 결정사항 타임라인
  - 회의 미리보기(MeetingPage)에 Decision Log 섹션 표시
  - 결정사항 수동 추가/편집/삭제 가능
- acceptance:
  - 회의 요약 생성 시 결정사항이 자동 추출됨
  - 회의별/폴더별 결정사항 목록 조회 가능
  - 수동으로 결정사항 추가/수정 가능

---

### TSK-08-03: 검색 결과 회의별 그룹핑
- category: enhancement
- domain: frontend
- status: [ ]
- priority: high
- assignee: -
- tags: search, ux, grouping
- depends: TSK-08-01
- note: 동일 회의의 검색 결과를 하나의 그룹으로 묶어 표시

#### 요구사항
- requirements:
  - 검색 결과를 meeting_id 기준으로 그룹핑하여 렌더링
  - 회의 헤더: 제목 + 날짜 + 매칭 건수 요약 (요약 N건, 전사 N건)
  - 하위 결과: 헤더 아래에 개별 snippet 카드 (TypeBadge + 화자 + snippet)
  - 기본 펼침 상태, 접기/펼치기 토글 가능 (ChevronDown/ChevronUp)
  - 회의 헤더 클릭 시 해당 회의 페이지로 이동
  - 백엔드 변경 없이 프론트엔드에서 그룹핑 처리
- acceptance:
  - 같은 회의의 결과가 하나의 카드로 묶여서 표시됨
  - 각 그룹의 접기/펼치기 동작 정상
  - 그룹 헤더에 매칭 건수(요약/전사 구분) 표시됨
  - 기존 필터, 페이지네이션 정상 동작

---

## WP-09: 회의 진행 기능 확장
- status: done
- priority: medium
- progress: 100%
- note: 녹음 중 편의 기능과 반복 회의 지원

### TSK-09-01: 시간별 주제 마크/북마크
- category: feature
- domain: frontend, backend
- status: [xx]
- priority: high
- assignee: -
- tags: bookmark, timestamp, meeting
- depends: -
- note: 녹음 중 중요 구간에 타임스탬프 라벨을 추가하여 나중에 빠르게 탐색

#### 요구사항
- requirements:
  - MeetingBookmark 모델 생성 (meeting_id, timestamp_ms, label, created_at)
  - `POST /api/v1/meetings/:id/bookmarks` — 북마크 생성
  - `GET /api/v1/meetings/:id/bookmarks` — 북마크 목록
  - `DELETE /api/v1/meetings/:id/bookmarks/:bid` — 북마크 삭제
  - MeetingLivePage에 북마크 추가 버튼 (또는 단축키 Ctrl+B)
  - 클릭 시 현재 경과시간 + 라벨 입력 팝오버
  - 회의 미리보기(MeetingPage)에서 북마크 목록 표시, 클릭 시 해당 트랜스크립트 구간으로 스크롤
- acceptance:
  - 녹음 중 북마크 추가 가능
  - 회의 미리보기에서 북마크 목록 표시
  - 북마크 클릭 시 해당 시간의 트랜스크립트로 이동

---

### TSK-09-02: 회의 템플릿
- category: feature
- domain: frontend, backend
- status: [xx]
- priority: medium
- assignee: -
- tags: template, meeting, preset
- depends: -
- note: 반복 회의(스탠드업, 주간회의 등) 설정을 템플릿으로 저장/재사용

#### 요구사항
- requirements:
  - MeetingTemplate 모델 생성 (user_id, name, meeting_type, folder_id, settings_json)
  - settings_json에 저장: 회의 유형, 언어, 화자 분리 설정, 적용주기 등
  - `GET /api/v1/meeting_templates` — 템플릿 목록
  - `POST /api/v1/meeting_templates` — 템플릿 생성
  - `PUT /api/v1/meeting_templates/:id` — 템플릿 수정
  - `DELETE /api/v1/meeting_templates/:id` — 템플릿 삭제
  - 새 회의 생성 시 템플릿 선택 드롭다운 → 설정 자동 적용
  - 기존 회의에서 "현재 설정을 템플릿으로 저장" 기능
- acceptance:
  - 템플릿 저장 후 새 회의에서 선택하면 설정 자동 적용
  - 템플릿 목록 조회/수정/삭제 가능

---

# Phase B: Linux 서버 작업 (GTX 1080 필요)

---

## WP-10: 서버 환경 구축
- status: blocked
- priority: critical
- progress: 0%
- note: GTX 1080 장착 후 진행

### TSK-10-01: Linux 서버 OS/GPU 환경 설치
- category: infrastructure
- domain: server
- status: [ ]
- priority: critical
- assignee: -
- tags: server, gpu, cuda
- depends: -
- note: Ubuntu + NVIDIA 드라이버 + CUDA 설치

#### PRD 요구사항
- prd-ref: PRD 2.2 서버 하드웨어 사양
- requirements:
  - Ubuntu 22.04+ 설치
  - NVIDIA 드라이버 535+ 설치
  - GTX 1080 CUDA 동작 확인
- acceptance:
  - `nvidia-smi`에서 GTX 1080, VRAM 8GB 표시
  - `torch.cuda.is_available()` → True

---

### TSK-10-02: Rails + Sidecar 서버 배포
- category: infrastructure
- domain: server
- status: [ ]
- priority: critical
- assignee: -
- tags: server, rails, python
- depends: TSK-10-01
- note: Ruby/Python 환경 설치, 프로젝트 클론, 서비스 기동 확인

#### PRD 요구사항
- prd-ref: PRD 4.1, server-client-migration Phase 1
- requirements:
  - rbenv + Ruby 4.0.2 설치
  - uv + Python 3.11+ 설치, `uv sync --extra=cuda`
  - ffmpeg 설치
  - Rails `db:migrate` 성공
  - Sidecar STT 엔진 로드 확인 (CUDA)
- acceptance:
  - `curl http://localhost:13323/up` → 200 OK
  - `curl http://localhost:13324/health` → STT 엔진 상태 표시

---

### TSK-10-03: systemd 서비스 등록
- category: infrastructure
- domain: server
- status: [ ]
- priority: high
- assignee: -
- tags: server, systemd
- depends: TSK-10-02
- note: Rails + Sidecar를 systemd 서비스로 등록, 자동 시작/재시작

#### PRD 요구사항
- prd-ref: PRD 5.3 가용성, server-client-migration Phase 2
- requirements:
  - ddobak-rails.service 작성 및 등록
  - ddobak-sidecar.service 작성 및 등록
  - 재부팅 시 자동 시작
  - 크래시 시 자동 재시작 (RestartSec=5)
- acceptance:
  - `sudo reboot` 후 양 서비스 자동 기동 확인
  - `sudo systemctl status ddobak-rails` → active

---

### TSK-10-04: Cloudflare Tunnel 설정
- category: infrastructure
- domain: server
- status: [ ]
- priority: high
- assignee: -
- tags: server, cloudflare, https
- depends: TSK-10-02
- note: Cloudflare Tunnel로 외부 HTTPS 접근 제공

#### PRD 요구사항
- prd-ref: PRD 4.1, server-client-migration Phase 3
- requirements:
  - cloudflared 설치 및 터널 생성
  - 도메인 DNS 레코드 등록
  - HTTPS 자동 SSL 확인
  - systemd 서비스로 등록
- acceptance:
  - 외부 네트워크에서 `curl https://api.도메인.com/up` → 200 OK

---

## WP-11: 통합 테스트 및 운영
- status: blocked
- priority: high
- progress: 0%
- note: Phase A 완료 + GTX 1080 장착 후 진행

### TSK-11-01: 실시간 녹음 E2E 테스트 (서버 모드)
- category: test
- domain: e2e
- status: [ ]
- priority: high
- assignee: -
- tags: test, e2e, stt
- depends: WP-01, WP-02, WP-04, WP-10
- note: 서버 모드에서 전체 녹음→전사→요약 파이프라인 검증

#### 요구사항
- requirements:
  - Tauri 앱에서 서버 모드로 로그인
  - 회의 생성 → 녹음 시작 → 10초 발화 → 녹음 종료
  - 실시간 전사 텍스트 표시 확인
  - 화자 라벨 표시 확인
  - AI 요약 생성 확인 (사용자별 LLM)
  - 서버 로그에서 CUDA 사용 확인
- acceptance:
  - 전체 플로우 에러 없이 동작

---

### TSK-11-02: 다중 사용자 동시 접속 테스트
- category: test
- domain: e2e
- status: [ ]
- priority: high
- assignee: -
- tags: test, concurrent, gpu
- depends: TSK-11-01
- note: 2~3명 동시 녹음 시 GPU 리소스 및 성능 검증

#### 요구사항
- requirements:
  - 서로 다른 PC에서 2~3명 동시 로그인
  - 각자 다른 회의를 동시 녹음
  - 각자의 회의만 보이는지 확인 (데이터 격리)
  - 동시 STT 처리 확인
  - 각자의 LLM 설정으로 요약 생성 확인
  - GPU 모니터링: VRAM 8GB 이내, STT 지연 5초 이내
- acceptance:
  - 동시 3세션 안정 동작
  - VRAM 오버플로우 없음

---

### TSK-11-03: 백업 스크립트 작성
- category: infrastructure
- domain: server
- status: [ ]
- priority: medium
- assignee: -
- tags: backup, cron
- depends: TSK-10-03
- note: SQLite DB + 오디오 파일 주기적 백업

#### 요구사항
- requirements:
  - SQLite DB 백업 스크립트 (daily cron)
  - 오디오 파일 백업 (rsync)
  - 백업 보관 정책 (30일)
- acceptance:
  - cron 등록 확인
  - 백업 파일 생성 확인

---

# Backlog (향후 검토)

> 브레인스토밍에서 도출된 기능 중 우선순위가 낮거나 추후 검토할 항목들

## 외부 연동 (Integration)
- **Google Calendar 연동**: 캘린더 이벤트 감지 → 회의 자동 생성, 종료 후 회의록 링크
- **Slack 연동**: 회의 종료 후 요약/액션아이템 자동 포스팅
- **Notion 연동**: AI 요약을 Notion Database에 자동 저장

## 회의 진행 개선
- **실시간 키워드 추출**: 진행 중 중요 키워드를 사이드바에 실시간 표시
- **이전 회의 미해결 아젠다 자동 생성**: 미완료 액션아이템 → 새 회의 아젠다로 제안

## 액션아이템 강화
- **액션아이템 담당자 지정 + 알림**: AI 추출 후 담당자 배정, 이메일/앱 알림
- **액션아이템 자동 완료 감지**: 다음 회의에서 "완료했습니다" 감지 → 자동 완료 제안

## 다국어 지원
- **다국어 회의 자동 분리**: 한국어/영어 혼용 회의에서 언어별 자동 분리
- **실시간 번역**: STT 결과를 선택 언어로 즉시 번역

## 기술적 기능
- **회의록 버전 관리 + Diff**: 편집/재생성 시 이전 버전과 비교
- **오프라인 모드 (로컬 LLM)**: Ollama로 인터넷 없이 요약 생성
- **Mermaid 다이어그램 자동 생성 강화**: LLM이 회의 구조/의사결정 플로우를 자동 다이어그램화
- **회의 간 주제 군집화**: 요약 벡터화 → 유사 회의 자동 발견, 주제별 히스토리
- **녹음 품질 분석**: 배경 잡음, 음성 명확도 자동 측정 → 개선 가이드
- **화자 감정/톤 분석**: 화자별 감정(긍/부/중) 시각화

## 기타
- **공유 회의 권한 세분화**: 뷰어에게 댓글/편집 권한 부여 옵션
- **회의 분석 대시보드**: 월별 회의 통계, 화자별 발언 비율, 참여도 분석
