# 또박또박 V2 — 서버/클라이언트 구조 전환 계획

> 작성일: 2026-04-02
> 상태: Draft
> 참조: [PRD.md](./PRD.md)

---

## 1. 배경

### 1.1 현재 구조 (V1: 데스크톱 올인원)

```
┌──────────────────────────────────────┐
│ Tauri 앱 (1대의 Mac에서 전부 실행)     │
│                                      │
│  React ──→ Rails(:13323) ──→ Sidecar(:13324)
│  WebView    SQLite + Jobs    Python ML
│                                      │
│  프로세스 3개: Tauri + Rails + Sidecar │
│  인증 없음: desktop@local 고정        │
└──────────────────────────────────────┘
```

### 1.2 문제점

- 각 PC에 Python venv (~1.2GB) + ML 모델 (~2.3GB) 설치 필요
- GPU 없는 PC에서 STT 성능 저하
- 다중 사용자 미지원 (단일 사용자 고정)
- 회의 데이터가 개인 PC에 분산 저장
- 앱 시작/종료 시 프로세스 관리 불안정

### 1.3 전환 목표 (V2)

```
┌──────────────┐           ┌───────────────────────────────┐
│ Tauri 클라이언트│  HTTPS    │ Linux 서버 (GTX 1080, 8GB)     │
│              │ ────────→ │                               │
│  React UI   │           │  Cloudflare Tunnel             │
│  (ML 없음)   │ ←──WSS──  │    │                           │
│              │           │    ├→ Rails (:13323)            │
│  JWT 토큰    │           │    │   ├─ REST API              │
│  localStorage│           │    │   ├─ ActionCable (WS)      │
│              │           │    │   └─ Solid Queue (Jobs)    │
└──────────────┘           │    │                           │
                           │    └→ Sidecar (:13324)         │
                           │        ├─ Qwen3-ASR (CUDA)     │
                           │        ├─ faster-whisper (CUDA) │
                           │        ├─ PyAnnote (CUDA)       │
                           │        └─ LLM API (사용자별)     │
                           │                               │
                           │  SQLite (WAL 모드)              │
                           │  오디오 파일 저장소                │
                           └───────────────────────────────┘
```

**핵심 변경:**

- 클라이언트에서 ML 제거 → 서버 전담
- 단일 사용자 → JWT 기반 다중 사용자 인증
- 서버 공용 LLM → 사용자별 LLM 설정
- Cloudflare Tunnel로 외부 접근 (nginx 불필요)

**변경하지 않는 것:**

- React 프론트엔드 코드 (API 호출 구조)
- Rails 컨트롤러/모델/서비스 코드
- Sidecar Python 코드 (STT 어댑터)
- DB: SQLite 유지

---

## 2. 서버 하드웨어

### 2.1 사양

| 항목 | 사양 |
|------|------|
| 본체 | HP EliteDesk 800 G2 Tower |
| CPU | Intel i5/i7 Skylake (4코어) |
| RAM | 16GB |
| GPU | GTX 1080 (8GB VRAM) |
| PSU | 400W |
| 저장소 | 500GB SSD |
| OS | Ubuntu 22.04+ |

### 2.2 GPU 처리 능력

| 항목 | 수치 |
|------|------|
| 동시 STT 세션 | 3세션 (GPU 큐잉, 모델 공유) |
| 동시 사용자 | 20명 |
| VRAM 사용량 | 모델 ~5GB + 추론 ~1.5GB = ~6.5GB |
| 30초 오디오 청크 처리 | ~2~3초 |
| 1시간 회의 파일 전사 | ~4~6분 |

### 2.3 GPU별 STT 엔진 호환

| 엔진 | GTX 1080 (8GB) | 비고 |
|------|----------------|------|
| Qwen3-ASR 1.7B (transformers, FP16) | 가능 (~3.5GB) | 권장 |
| faster-whisper large-v3 (int8) | 가능 (~5GB) | 대안 |
| faster-whisper large-v3-turbo (int8) | 가능 (~3GB) | 경량 대안 |
| Whisper large-v3 (FP16) | 불가 (10GB 필요) | — |

---

## 3. 전환 작업

### Phase 1. 서버 환경 구축

#### 1-1. NVIDIA 드라이버 + CUDA 설치

```bash
sudo apt update
sudo apt install -y nvidia-driver-535
sudo reboot

# 확인
nvidia-smi
# → GTX 1080, VRAM 8GB 표시되면 성공
```

#### 1-2. Ruby + Rails 환경

```bash
# rbenv 설치
sudo apt install -y git build-essential libssl-dev libreadline-dev zlib1g-dev libsqlite3-dev
curl -fsSL https://github.com/rbenv/rbenv-installer/raw/HEAD/bin/rbenv-installer | bash

# Ruby 설치
rbenv install 3.4.2
rbenv global 3.4.2

# 프로젝트 클론 및 설정
git clone <repo> /opt/ddobak
cd /opt/ddobak/backend
bundle install
bin/rails db:migrate
```

#### 1-3. Python + Sidecar 환경 (CUDA)

```bash
# uv 설치
curl -LsSf https://astral.sh/uv/install.sh | sh

# Sidecar 의존성 설치 (CUDA 그룹)
cd /opt/ddobak/sidecar
uv sync --extra=cuda

# Hugging Face 토큰 설정 (PyAnnote 모델 다운로드용)
export HF_TOKEN=hf_xxxxx
```

#### 1-4. 확인

```bash
# CUDA 확인
cd /opt/ddobak/sidecar
uv run python -c "import torch; print(torch.cuda.is_available())"
# → True

# Rails 기동 확인
cd /opt/ddobak/backend
bin/rails server -b 0.0.0.0 -p 13323 &
curl http://localhost:13323/up
# → 200 OK

# Sidecar 기동 확인
cd /opt/ddobak/sidecar
STT_ENGINE=qwen3_asr_transformers uv run uvicorn app.main:app --host 0.0.0.0 --port 13324 &
curl http://localhost:13324/health
# → 엔진 상태 표시
```

**성공 기준:** Rails + Sidecar 기동, CUDA 사용 가능

---

### Phase 2. systemd 서비스 등록

재부팅 시 자동 시작, 크래시 시 자동 재시작.

#### 2-1. Rails 서비스

```ini
# /etc/systemd/system/ddobak-rails.service
[Unit]
Description=또박또박 Rails API
After=network.target

[Service]
Type=simple
User=dev
WorkingDirectory=/opt/ddobak/backend
Environment=RAILS_ENV=production
Environment=SECRET_KEY_BASE=생성된-시크릿-키
ExecStart=/home/dev/.rbenv/shims/bundle exec rails server -b 0.0.0.0 -p 13323
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

#### 2-2. Sidecar 서비스

```ini
# /etc/systemd/system/ddobak-sidecar.service
[Unit]
Description=또박또박 Python Sidecar (STT/화자분리)
After=network.target

[Service]
Type=simple
User=dev
WorkingDirectory=/opt/ddobak/sidecar
Environment=STT_ENGINE=qwen3_asr_transformers
Environment=HOST=0.0.0.0
Environment=PORT=13324
Environment=HF_TOKEN=hf_xxxxx
ExecStart=/home/dev/.local/bin/uv run uvicorn app.main:app --host 0.0.0.0 --port 13324
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

#### 2-3. 활성화

```bash
sudo systemctl daemon-reload
sudo systemctl enable ddobak-rails ddobak-sidecar
sudo systemctl start ddobak-rails ddobak-sidecar

# 상태 확인
sudo systemctl status ddobak-rails
sudo systemctl status ddobak-sidecar
```

**성공 기준:** 서버 재부팅 후 자동 시작 확인

---

### Phase 3. 외부 접근 (Cloudflare Tunnel)

nginx 없이 Cloudflare Tunnel로 HTTPS + 외부 접근을 제공한다.

#### 3-1. Cloudflare Tunnel 설치 및 설정

```bash
# cloudflared 설치
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# 로그인 (브라우저에서 도메인 인증)
cloudflared tunnel login

# 터널 생성
cloudflared tunnel create ddobak

# DNS 레코드 등록
cloudflared tunnel route dns ddobak api.도메인.com
```

#### 3-2. 터널 설정 파일

```yaml
# /home/dev/.cloudflared/config.yml
tunnel: <터널-ID>
credentials-file: /home/dev/.cloudflared/<터널-ID>.json

ingress:
  # API + WebSocket → Rails
  - hostname: api.도메인.com
    service: http://localhost:13323
  - service: http_status:404
```

#### 3-3. systemd 서비스 등록

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

#### 3-4. 확인

```bash
# 외부에서 접근 테스트
curl https://api.도메인.com/up
# → 200 OK
```

**성공 기준:** 외부 네트워크에서 HTTPS로 API 접근 가능

---

### Phase 4. CORS 설정

#### 4-1. Rails CORS

```ruby
# backend/config/initializers/cors.rb
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(
      "http://localhost:13325",              # 로컬 개발
      "tauri://localhost",                   # Tauri macOS
      "https://tauri.localhost",             # Tauri Windows/Linux
      ENV.fetch("CORS_ORIGIN", "")           # 서버 도메인
    )

    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      expose: ["Authorization"]
  end
end
```

#### 4-2. Tauri 클라이언트 API URL 분기

```typescript
// frontend/src/config.ts
// 서버 모드: 사용자가 설정한 서버 URL 사용
// 로컬 모드: localhost:13323 (기존)
```

---

### Phase 5. 사용자 인증 (JWT)

V2 PRD 3.1절 참조. 기존 Devise + User 모델을 활용한다.

#### 5-1. 서버 측

- Devise JWT 전략 추가 (`devise-jwt` gem)
- 로그인 API: `POST /auth/login` → JWT 발급
- 토큰 갱신 API: `POST /auth/refresh` → 새 Access Token 발급
- `DefaultUserLookup`의 `desktop@local` 자동 생성을 서버 모드에서 비활성화
- 로그인 웹 페이지: 서버에서 간단한 로그인 폼 제공

#### 5-2. 클라이언트 측

- Tauri deep-link 플러그인으로 `ddobak://` 스킴 등록
- 로그인 → 기본 브라우저로 서버 로그인 페이지 열기
- 인증 성공 → `ddobak://callback?token=xxx` 딥링크로 토큰 수신
- localStorage에 JWT 저장, 이후 자동 로그인

#### 5-3. 사용자별 LLM 설정

- User 모델에 `llm_provider`, `llm_api_key`, `llm_model`, `llm_base_url` 추가
- 요약 API 호출 시 `current_user`의 설정으로 LLM 클라이언트 생성
- 미설정 시 서버 기본값 (settings.yaml) 사용

---

### Phase 6. Tauri 클라이언트 모드 분기

앱 시작 시 **로컬 모드** / **서버 모드**를 선택한다.

#### 6-1. 모드별 동작

| 항목 | 로컬 모드 (V1 호환) | 서버 모드 (V2) |
|------|-------------------|---------------|
| API URL | `localhost:13323` | 사용자 설정 서버 URL |
| 프로세스 관리 | Rails + Sidecar 시작/종료 | 없음 |
| Python 설치 | 필요 | 불필요 |
| 인증 | 없음 (desktop@local) | JWT 브라우저 로그인 |
| 오디오 캡처 | 마이크 + 시스템 오디오 | 마이크 |
| 오프라인 | 가능 | 불가 |

#### 6-2. 설정 저장

```typescript
// Tauri localStorage
{
  "mode": "server",          // "local" | "server"
  "server_url": "https://api.도메인.com",
  "jwt_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

---

## 4. 배포 워크플로우

### 4-1. 코드 업데이트

```bash
# 서버에서
cd /opt/ddobak
git pull origin main

# Rails
cd backend && bundle install && bin/rails db:migrate
sudo systemctl restart ddobak-rails

# Sidecar
cd ../sidecar && uv sync --extra=cuda
sudo systemctl restart ddobak-sidecar
```

### 4-2. 백업

```bash
# SQLite DB 백업 (cron 등록)
cp /opt/ddobak/backend/db/production.sqlite3 /backup/db/$(date +%Y%m%d).sqlite3

# 오디오 파일 백업
rsync -av /opt/ddobak/backend/storage/audio/ /backup/audio/
```

---

## 5. 통합 테스트

### 5-1. 실시간 녹음

```
1. Tauri 앱에서 서버 모드로 로그인
2. "새 회의" 생성 → "녹음 시작"
3. 10초간 한국어 발화
4. 확인:
   - [ ] 실시간 전사 텍스트 표시
   - [ ] 화자 라벨 표시
   - [ ] 서버 로그에 CUDA 사용
5. "녹음 중지" → AI 요약 생성 확인
```

### 5-2. 다중 사용자

```
1. 서로 다른 PC에서 2명 동시 로그인
2. 각자 다른 회의를 녹음
3. 확인:
   - [ ] 각자의 회의만 보임
   - [ ] 동시 STT 처리됨
   - [ ] 각자의 LLM 설정으로 요약 생성
```

### 5-3. 성능 모니터링

```bash
# GPU 사용률
watch -n 1 nvidia-smi

# 동시 3세션 시 VRAM 8GB 이내 확인
# STT 응답 지연 5초 이내 확인
```
