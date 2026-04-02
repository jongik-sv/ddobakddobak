# WBS - 또박또박 v2 (서버 배포 + 사용자 인증)

> version: 2.1
> depth: 3
> updated: 2026-04-02

---

# Phase A: Mac에서 개발 (GPU 불필요)

---

## WP-01: 사용자 인증 (서버 측)
- status: planned
- priority: critical
- progress: 0%
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
- status: [im]
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
- status: planned
- priority: critical
- progress: 0%
- note: Mac에서 Tauri dev 모드로 개발/테스트 가능

### TSK-02-01: Tauri 딥링크 설정
- category: feature
- domain: frontend
- status: [ ]
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
- status: [ ]
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
- status: [ ]
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
- status: [ ]
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
- status: planned
- priority: critical
- progress: 0%
- note: Mac에서 SERVER_MODE=true + 로컬 Sidecar로 개발/테스트 가능

### TSK-03-01: User 모델 LLM 필드 추가
- category: feature
- domain: backend
- status: [ ]
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
- status: [ ]
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
- status: [ ]
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
- status: planned
- priority: high
- progress: 0%
- note: Mac에서 Tauri dev 모드로 개발/테스트 가능

### TSK-04-01: config.ts 모드 분기
- category: feature
- domain: frontend
- status: [ ]
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
- status: [ ]
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
