# PRD: 또박또박 v2 — 팀 서버 배포 + 사용자 인증

> Rails + Sidecar를 Linux GPU 서버로 이전하고, 팀 단위 다중 사용자 인증 및 개인별 LLM 설정을 지원한다.

**문서 버전:** v2.0
**작성일:** 2026-04-02
**상태:** Draft
**이전 버전:** [v1.0 PRD](../V1/PRD.md)

---

## 1. 개요

### 1.1 배경

V1은 데스크톱 올인원 구조(Tauri 앱 내에서 Rails + Sidecar + ML 모델 전부 실행)로 개발되었다.
이 구조는 단일 사용자 개발/검증에는 적합하지만, 팀(~20명)이 함께 사용하기에는 다음과 같은 한계가 있다:

- 각 PC에 Python venv + ML 모델을 설치해야 함
- GPU 없는 PC에서는 STT 성능이 크게 떨어짐
- 다중 사용자 인증 없이 단일 사용자(`desktop@local`) 고정
- 회의 데이터가 개인 PC에 분산 저장

### 1.2 V2 목표

| 목표 | 설명 |
|------|------|
| **서버 집중화** | Rails + Sidecar(STT/화자분리)를 Linux GPU 서버에서 실행 |
| **클라이언트 경량화** | Tauri 앱은 UI만 담당, ML 모델 설치 불필요 |
| **다중 사용자** | 팀원별 계정, 브라우저 기반 로그인, 영구 세션 |
| **개인별 LLM** | 각 사용자가 자신의 LLM API 키/모델을 설정하여 사용 |

### 1.3 대상 사용자

- 팀 규모: ~20명
- 동시 회의: 최대 3개
- 클라이언트: macOS / Windows (Tauri 앱)

---

## 2. 아키텍처

### 2.1 V1 → V2 구조 변경

```
V1 (데스크톱 올인원)
┌──────────────────────────────────────┐
│ Tauri 앱 (1대의 Mac에서 전부 실행)     │
│  React ─→ Rails ─→ Sidecar          │
│  WebView   SQLite   Python ML       │
└──────────────────────────────────────┘

V2 (서버/클라이언트 분리)
┌──────────────┐           ┌───────────────────────────────┐
│ Tauri 클라이언트│  HTTPS    │ Linux x86 서버 (GTX 1080)      │
│              │ ────────→ │                               │
│  React UI   │           │  Rails (:13323)               │
│  (ML 없음)   │ ←──WSS──  │   ├─ REST API                 │
│              │           │   ├─ ActionCable (WebSocket)   │
│  JWT 토큰    │           │   └─ Solid Queue (Jobs)        │
│  localStorage│           │        │                       │
└──────────────┘           │  Sidecar (:13324)              │
                           │   ├─ Qwen3-ASR (CUDA)         │
                           │   ├─ faster-whisper (CUDA)     │
                           │   ├─ PyAnnote (CUDA)           │
                           │   └─ LLM API 호출 (사용자별)    │
                           │                               │
                           │  SQLite (WAL 모드)             │
                           │  오디오 파일 저장소               │
                           └───────────────────────────────┘
```

### 2.2 서버 하드웨어 사양

| 항목 | 최소 사양 | 권장 사양 |
|------|----------|----------|
| CPU | Intel i5 6세대 (4코어) | Intel i7 이상 |
| RAM | 16GB | 32GB |
| GPU | GTX 1080 (8GB VRAM) | RTX 3060 (12GB VRAM) |
| 저장소 | 500GB SSD | 500GB SSD + 보조 HDD |
| PSU | 400W | 500W |
| OS | Ubuntu 22.04+ | Ubuntu 24.04 LTS |

### 2.3 GPU별 STT 엔진 지원

| 엔진 | GTX 1080 (8GB) | RTX 3060 (12GB) |
|------|----------------|-----------------|
| Qwen3-ASR 1.7B (transformers, FP16) | 가능 (~3.5GB) | 가능 |
| faster-whisper large-v3 (int8) | 가능 (~5GB) | 가능 |
| faster-whisper large-v3-turbo (int8) | 가능 (~3GB) | 가능 |
| Whisper large-v3 (FP16) | **불가** (10GB 필요) | 가능 |
| Qwen3.5-27B LLM (로컬) | **불가** | **불가** (API 사용) |

### 2.4 동시 처리 능력 (GTX 1080 기준)

| 항목 | 수치 |
|------|------|
| 동시 STT 세션 | 3세션 (GPU 큐잉, 모델 1회 로드 공유) |
| 동시 사용자 | 20명 |
| VRAM 사용량 | 모델 ~5GB + 추론 ~1.5GB = ~6.5GB |
| RAM 사용량 | Rails ~500MB + Sidecar ~2GB + 버퍼 ~300MB = ~4GB |

### 2.5 DB

- **SQLite (WAL 모드)** — 20명/동시 3세션 규모에서 충분
- `PRAGMA journal_mode=WAL` 활성화로 읽기/쓰기 동시 처리

---

## 3. 기능 명세

### 3.1 사용자 인증 (P0)

팀 내부용 자체 계정 인증. 소셜 로그인은 사용하지 않는다.

#### 3.1.1 인증 흐름 (브라우저 기반)

```
[Tauri 앱 시작]
     │
     ├─ localStorage에 JWT 토큰 있음?
     │    ├─ Yes → 토큰 유효성 검증 → 자동 로그인 (로그인 화면 스킵)
     │    └─ No  → 로그인 화면 표시
     │
[로그인 버튼 클릭]
     │
     ▼
[기본 브라우저 열림] → https://서버/auth/login?callback=ddobak://
     │
     ▼
[웹에서 이메일 + 비밀번호 입력]
     │
     ▼
[서버 인증 성공 → JWT 발급 → 리다이렉트] → ddobak://callback?token=xxx
     │
     ▼
[Tauri 앱이 딥링크로 토큰 수신] → localStorage 저장 → 메인 화면

[로그아웃]
     └─ 토큰 삭제 → 로그인 화면
```

#### 3.1.2 요구사항

| 항목 | 설명 |
|------|------|
| 계정 생성 | 관리자가 생성 또는 초대 링크 |
| 인증 방식 | 이메일 + 비밀번호 (Devise) |
| 토큰 | JWT (Access Token + Refresh Token) |
| 세션 유지 | 로그아웃 전까지 영구 유지 (Refresh Token 자동 갱신) |
| 딥링크 | Tauri v2 deep-link 플러그인 (`ddobak://` 스킴) |
| 소셜 로그인 | 사용하지 않음 |

#### 3.1.3 기존 코드 활용

| 코드 | 상태 | V2 작업 |
|------|------|---------|
| `User` 모델 (email, name, encrypted_password, jti) | 존재 | 필드 추가 (LLM 설정) |
| Devise 마이그레이션 | 존재 | JWT 전략 추가 |
| `authenticate_user!` | 컨트롤러 적용됨 | JWT 검증으로 변경 |
| `DefaultUserLookup` (`desktop@local`) | 존재 | 서버 모드에서 비활성화 |
| `Team` / `TeamMembership` | 존재 | 그대로 활용 |

### 3.2 사용자별 LLM 설정 (P0)

각 사용자가 자신의 LLM API 키/모델을 설정하여 사용한다.

#### 3.2.1 현재 → 변경 후

```
현재: settings.yaml → llm.active_preset (서버 전체 공유)

변경: User별 LLM 설정 저장
├─ user_1: provider=anthropic, key=sk-xxx, model=claude-sonnet
├─ user_2: provider=openai, key=sk-yyy, model=gpt-4o
└─ user_3: provider=openai, base_url=http://...:11434/v1, model=qwen3.5
```

#### 3.2.2 요구사항

| 항목 | 설명 |
|------|------|
| 저장 위치 | User 모델에 `llm_provider`, `llm_api_key`, `llm_model`, `llm_base_url` 추가 |
| API 키 보안 | 서버에 암호화 저장 (Rails encrypted attributes) |
| 요약 호출 | `current_user`의 LLM 설정으로 클라이언트 동적 생성 |
| 미설정 시 | 서버 기본값 (settings.yaml) 사용 |
| 프론트엔드 | 설정 화면에 개인 LLM 설정 UI 추가 |
| 연결 테스트 | LLM 연결 테스트 기능 (기존 기능 활용) |

### 3.3 서버 배포 구성 (P0)

#### 3.3.1 프로세스 구성

| 프로세스 | 설명 |
|----------|------|
| Rails (Puma) | API 서버 + WebSocket |
| Sidecar (Uvicorn) | Python ML 서비스 (STT, 화자분리) |
| Solid Queue | 비동기 Job 처리 (전사, 요약) |

#### 3.3.2 외부 접근

| 방법 | 비용 | 비고 |
|------|------|------|
| **Cloudflare Tunnel (권장)** | 무료 (도메인 비용만) | 고정 IP 불필요, HTTPS 자동 |
| 포트포워딩 | 고정 IP ~5,000원/월 | 공유기 설정 필요 |
| Tailscale | 무료 (개인용) | VPN 메시, 팀원 설치 필요 |

#### 3.3.3 Python 의존성

```bash
# Linux NVIDIA GPU 환경
uv sync --extra=cuda

# 환경 변수
STT_ENGINE=qwen3_asr_transformers  # 또는 faster_whisper
```

### 3.4 Tauri 클라이언트 변경 (P1)

| 항목 | V1 | V2 |
|------|-----|-----|
| 서버 주소 | `localhost:13323` 고정 | 사용자 설정 (서버 URL 입력) |
| 프로세스 관리 | Rails + Sidecar 직접 시작/종료 | 시작/종료 불필요 (서버에서 실행) |
| Python 설치 | 앱 시작 시 venv + 모델 설치 | 불필요 |
| 인증 | 없음 (desktop@local) | JWT 브라우저 로그인 |
| 오디오 캡처 | 마이크 + 시스템 오디오 (macOS) | 마이크만 (시스템 오디오는 서버 모드 불필요) |

---

## 4. 데이터 모델 변경

### 4.1 User 모델 확장

```
User (기존 필드 유지 + 추가)
├── email, name, encrypted_password, jti  (기존)
├── llm_provider (string)                 (추가) — anthropic, openai 등
├── llm_api_key (encrypted string)        (추가) — 암호화 저장
├── llm_model (string)                    (추가) — claude-sonnet-4-6, gpt-4o 등
├── llm_base_url (string)                 (추가) — 커스텀 엔드포인트 (Ollama 등)
└── refresh_token_jti (string)            (추가) — Refresh Token 식별자
```

### 4.2 기존 모델 변경 없음

Team, Meeting, Transcript, Summary, ActionItem, Block, Folder 등 기존 모델은 변경하지 않는다.

---

## 5. 비기능 요구사항

### 5.1 성능

| 항목 | 목표 |
|------|------|
| STT 지연 시간 | 발화 후 3초 이내 (CUDA ~2초) |
| 동시 STT 세션 | 3세션 (GTX 1080 기준) |
| 동시 사용자 | 20명 |
| 1시간 파일 전사 | CUDA ~4~6분 |

### 5.2 보안

| 항목 | 설명 |
|------|------|
| 통신 | HTTPS (Cloudflare Tunnel 또는 자체 인증서) |
| 비밀번호 | bcrypt 해싱 (Devise 기본) |
| JWT | Access Token (단기) + Refresh Token (장기) |
| LLM API 키 | Rails encrypted attributes로 암호화 저장 |
| 팀 격리 | 팀 간 데이터 접근 차단 (기존 구조 유지) |

### 5.3 가용성

| 항목 | 설명 |
|------|------|
| 서버 무인 운영 | systemd 서비스로 등록, 재부팅 시 자동 시작 |
| 모니터링 | Rails /up 헬스체크 엔드포인트 |
| 백업 | SQLite 파일 + 오디오 디렉토리 주기적 백업 |

---

## 6. 구현 순서

| 단계 | 내용 | 의존성 |
|------|------|--------|
| **M1: 서버 환경 구성** | Linux 서버에 Ruby, Python, CUDA 환경 설치. Rails + Sidecar 구동 확인 | 없음 |
| **M2: 사용자 인증** | Devise JWT 전략, 로그인/로그아웃 API, Refresh Token | M1 |
| **M3: Tauri 로그인 UI** | 브라우저 기반 로그인 흐름, 딥링크 수신, JWT 저장, 서버 URL 설정 | M2 |
| **M4: 사용자별 LLM** | User 모델 LLM 필드 추가, 요약 API에서 사용자별 LLM 클라이언트 생성, 설정 UI | M2 |
| **M5: 클라이언트 모드 분기** | Tauri 앱에서 로컬/서버 모드 자동 감지 또는 선택, 서버 모드 시 프로세스 관리 비활성화 | M3 |
| **M6: 외부 접근 + 배포** | Cloudflare Tunnel 설정, systemd 서비스, 백업 스크립트 | M1 |

---

## 7. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| GTX 1080 VRAM 부족 (8GB) | Whisper large-v3 사용 불가 | Qwen3-ASR 또는 faster-whisper int8 사용 (충분한 성능) |
| 동시 3세션 초과 시 GPU 병목 | STT 지연 증가 | 큐잉으로 순차 처리, RTX 3060 교체 시 여유 확보 |
| 출장 등 서버 물리적 접근 불가 | 장애 시 대응 어려움 | Cloudflare Tunnel + SSH 원격 접근, 자동 재시작(systemd) |
| SQLite 동시 쓰기 lock | 다수 쓰기 시 대기 | WAL 모드 + timeout 10초 |
| LLM API 키 유출 | 사용자 비용 발생 | 암호화 저장, HTTPS 통신 |
