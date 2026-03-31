# 또박또박 서버/클라이언트 구조 전환 계획

> 작성일: 2026-03-31
> 상태: Draft
> 참조: [TRD.md](./TRD.md), [tauri-desktop-app-plan.md](./tauri-desktop-app-plan.md)

## 1. 배경

### 1.1 현재 구조 (데스크톱 올인원)

```
┌─────────────────────────────────────────────┐
│ Tauri 앱 (1대의 Mac에서 전부 실행)            │
│                                             │
│  React ──→ Rails(:13323) ──→ Sidecar(:13324)│
│  WebView    SQLite + Jobs     Python ML     │
│                                             │
│  프로세스 3개: Tauri + Rails + Sidecar        │
└─────────────────────────────────────────────┘
```

### 1.2 문제점

- **앱 시작 불안정**: Tauri → WebView 로드 → JS invoke → 서비스 시작 체인이 끊기면 서버가 안 뜸
- **앱 종료 불완전**: 자식 프로세스(puma, uvicorn) 정리 실패 시 좀비 프로세스 발생
- **첫 설치 무거움**: Python venv 1.2GB + ML 모델 2.3GB를 사용자 머신에 설치
- **디버깅 어려움**: 앱 창은 뜨는데 백엔드가 안 뜨면 원인 파악 곤란
- **확장 불가**: 웹 브라우저에서 접근 불가, 다중 사용자 미지원

### 1.3 전환 목표

```
┌──────────────┐         ┌──────────────────────────────┐
│ 클라이언트     │  HTTPS  │ Linux 서버 (RTX 1080, 8GB)    │
│              │ ──────→ │                              │
│ - 웹 브라우저  │         │  nginx (:443)                │
│ - Tauri 앱   │ ←────── │    │                          │
│              │   WSS   │    ├→ Rails (:13323)          │
│ (ML 없음)    │         │    │    ├─ REST API            │
└──────────────┘         │    │    ├─ ActionCable (WS)    │
                         │    │    └─ Solid Queue (Jobs)  │
                         │    │         │                  │
                         │    │         ▼                  │
                         │    └→ Sidecar (:13324)         │
                         │         ├─ faster-whisper (CUDA)│
                         │         ├─ PyAnnote (CUDA)     │
                         │         └─ LLM API 호출        │
                         │                              │
                         │  PostgreSQL (:5432)           │
                         │  오디오 파일 저장소              │
                         └──────────────────────────────┘
```

**핵심 변경:**
- 클라이언트에서 ML 제거 → 서버가 전담
- SQLite → PostgreSQL (다중 접속)
- 로컬 파일 → 서버 저장소
- HTTP → HTTPS + WSS (nginx 리버스 프록시)

**변경하지 않는 것:**
- React 프론트엔드 코드 전체
- Rails 컨트롤러/모델/서비스 코드
- Sidecar Python 코드
- 프론트엔드 ↔ 백엔드 ↔ Sidecar 통신 구조

---

## 2. 서버 하드웨어

| 항목 | 최소 사양 | 권장 사양 |
|------|----------|----------|
| GPU | GTX 1080 (VRAM 8GB) | RTX 3060 (VRAM 12GB) |
| CPU | 4코어 | 8코어 |
| RAM | 16GB | 32GB |
| 디스크 | SSD 100GB | SSD 500GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |

**RTX 1080 기준 성능:**
- STT (faster-whisper large-v3-turbo, int8): 실시간 대비 ~10-15배 속도
- 화자분리 (PyAnnote): 실시간 대비 ~50배 속도
- STT + 화자분리 동시: VRAM ~5-6GB (8GB 내 충분)
- 30초 오디오 청크 처리: ~2-3초
- 1시간 회의 파일 전사: ~4-6분

---

## 3. 전환 작업 순서

### Phase 1. 서버 환경 구축

#### 1-1. NVIDIA 드라이버 설치

```bash
# Ubuntu 서버에서 실행
sudo apt update
sudo apt install -y nvidia-driver-535
sudo reboot

# 확인
nvidia-smi
# → GPU 이름, VRAM, 드라이버 버전이 표시되면 성공
```

#### 1-2. Docker + NVIDIA Container Toolkit 설치

```bash
# Docker 설치
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# NVIDIA Container Toolkit 설치
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# 확인
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
# → 컨테이너 안에서 GPU가 보이면 성공
```

#### 1-3. 테스트

```bash
# GPU가 Docker에서 인식되는지 확인
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
```

**성공 기준:** `nvidia-smi` 출력에 GTX 1080, VRAM 8GB가 표시됨

---

### Phase 2. 데이터베이스 전환 (SQLite → PostgreSQL)

#### 2-1. Rails Gemfile 수정

```ruby
# backend/Gemfile
# 변경 전
gem "sqlite3", ">= 2.4"

# 변경 후
gem "pg"                          # 서버 배포용
gem "sqlite3", ">= 2.4"          # 로컬 개발/데스크톱용 (유지)
```

```bash
cd backend && bundle install
```

#### 2-2. database.yml에 production 환경 추가

```yaml
# backend/config/database.yml

# 기존 default/development/test 블록은 그대로 유지

# 서버 배포용 production 환경 추가
production:
  primary:
    adapter: postgresql
    url: <%= ENV['DATABASE_URL'] %>
    pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 10 } %>
  queue:
    adapter: postgresql
    url: <%= ENV['DATABASE_URL'] %>
    migrations_paths: db/queue_migrate
  cable:
    adapter: postgresql
    url: <%= ENV['DATABASE_URL'] %>
    migrations_paths: db/cable_migrate
```

> 주의: 기존 SQLite 기반 production 설정(Tauri 데스크톱용)은 `production_desktop` 등으로 이름을 바꾸거나, `RAILS_ENV=desktop`을 사용하여 분리한다.

#### 2-3. DB 마이그레이션 실행

```bash
RAILS_ENV=production DATABASE_URL=postgresql://user:pass@localhost:5432/ddobak \
  bin/rails db:create db:migrate db:seed
```

#### 2-4. 테스트

```bash
# Rails 콘솔에서 연결 확인
RAILS_ENV=production DATABASE_URL=postgresql://... bin/rails console
> ActiveRecord::Base.connection.adapter_name
# → "PostgreSQL" 이면 성공
> Meeting.count
# → 에러 없이 숫자 반환되면 성공
```

**성공 기준:** Rails가 PostgreSQL에 연결되어 CRUD 동작 확인

---

### Phase 3. CORS 및 API URL 설정

#### 3-1. Rails CORS 확장

```ruby
# backend/config/initializers/cors.rb
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(
      "http://localhost:13325",              # 로컬 개발
      "tauri://localhost",                   # Tauri macOS
      "https://tauri.localhost",             # Tauri Windows/Linux
      ENV.fetch("CORS_ORIGIN", "")           # 서버 배포 시 도메인 (예: "https://app.ddobak.com")
    )

    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      expose: ["Authorization"]
  end
end
```

#### 3-2. 프론트엔드 환경변수 분기 확인

`frontend/src/config.ts`는 이미 환경변수를 지원한다:

```typescript
// 현재 코드 (수정 불필요)
export const API_BASE_URL = IS_TAURI
  ? 'http://127.0.0.1:13323/api/v1'
  : import.meta.env.VITE_API_BASE_URL || cfg.api.base_url
```

서버 배포 시 빌드할 때 환경변수만 넘기면 된다:

```bash
# 웹 빌드 시
VITE_API_BASE_URL=https://api.ddobak.com/api/v1 \
VITE_WS_URL=wss://api.ddobak.com/cable \
  npm run build
```

#### 3-3. 오디오 업로드 경로 확인

현재 Rails는 `AUDIO_DIR` 환경변수로 오디오 저장 경로를 결정한다. 서버에서는 Docker 볼륨으로 매핑:

```yaml
# docker-compose.yml 내 backend 서비스
volumes:
  - audio_data:/app/storage/audio
environment:
  - AUDIO_DIR=/app/storage/audio
```

#### 3-4. 테스트

```bash
# CORS 헤더 확인
curl -I -X OPTIONS https://api.ddobak.com/api/v1/meetings \
  -H "Origin: https://app.ddobak.com" \
  -H "Access-Control-Request-Method: GET"
# → Access-Control-Allow-Origin: https://app.ddobak.com 이 있으면 성공

# API 응답 확인
curl https://api.ddobak.com/api/v1/health
# → {"status":"ok"} 이면 성공
```

**성공 기준:** 웹 브라우저에서 서버 API 호출 시 CORS 에러 없음

---

### Phase 4. Docker 이미지 작성

#### 4-1. Sidecar Dockerfile

```dockerfile
# sidecar/Dockerfile
FROM nvidia/cuda:12.4.0-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y python3.11 python3-pip ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# uv 설치
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --extra cuda

COPY . .

EXPOSE 13324
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "13324"]
```

#### 4-2. Backend Dockerfile

```dockerfile
# backend/Dockerfile
FROM ruby:4.0.2-slim

RUN apt-get update && apt-get install -y \
    build-essential libpq-dev ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN bundle install --without development test

COPY . .

EXPOSE 13323
CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "13323"]
```

#### 4-3. docker-compose.yml

```yaml
# docker-compose.yml (프로젝트 루트)
services:
  db:
    image: postgres:16
    restart: always
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: ddobak_production
      POSTGRES_USER: ddobak
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ddobak"]
      interval: 5s
      retries: 5

  backend:
    build: ./backend
    restart: always
    ports: ["13323:13323"]
    depends_on:
      db:
        condition: service_healthy
      sidecar:
        condition: service_healthy
    environment:
      RAILS_ENV: production
      DATABASE_URL: postgresql://ddobak:${DB_PASSWORD}@db:5432/ddobak_production
      SIDECAR_HOST: sidecar
      SIDECAR_PORT: "13324"
      AUDIO_DIR: /app/storage/audio
      SECRET_KEY_BASE: ${SECRET_KEY_BASE}
      RAILS_LOG_TO_STDOUT: "1"
    volumes:
      - audio_data:/app/storage/audio

  sidecar:
    build: ./sidecar
    restart: always
    environment:
      STT_ENGINE: faster_whisper
      HOST: "0.0.0.0"
      PORT: "13324"
      MODELS_DIR: /app/models
      SPEAKER_DBS_DIR: /app/speaker_dbs
      LLM_PROVIDER: ${LLM_PROVIDER:-anthropic}
      ANTHROPIC_AUTH_TOKEN: ${ANTHROPIC_AUTH_TOKEN}
      HF_TOKEN: ${HF_TOKEN}
    volumes:
      - model_data:/app/models
      - speaker_data:/app/speaker_dbs
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:13324/health"]
      interval: 10s
      retries: 5

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    depends_on: [backend]
    volumes:
      - ./deploy/nginx.conf:/etc/nginx/conf.d/default.conf
      - ./deploy/certs:/etc/nginx/certs
      - frontend_build:/usr/share/nginx/html

volumes:
  pgdata:
  audio_data:
  model_data:
  speaker_data:
  frontend_build:
```

#### 4-4. nginx 설정

```nginx
# deploy/nginx.conf
upstream rails {
    server backend:13323;
}

server {
    listen 80;
    server_name app.ddobak.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name app.ddobak.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    client_max_body_size 100M;   # 오디오 파일 업로드

    # React SPA 정적 파일
    root /usr/share/nginx/html;
    index index.html;

    # API 요청 → Rails
    location /api/ {
        proxy_pass http://rails;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket (ActionCable) → Rails
    location /cable {
        proxy_pass http://rails;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;   # WebSocket 장시간 연결
    }

    # 오디오 파일 다운로드 → Rails
    location /api/v1/meetings/ {
        proxy_pass http://rails;
        proxy_set_header Host $host;
        proxy_buffering off;        # 스트리밍 응답
    }

    # SPA 폴백
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

#### 4-5. 환경변수 파일

```bash
# .env (서버, git에 커밋하지 않음)
DB_PASSWORD=강력한비밀번호
SECRET_KEY_BASE=rails-secret-key-base-여기에-생성된-값
ANTHROPIC_AUTH_TOKEN=sk-ant-xxxxx
HF_TOKEN=hf_xxxxx
LLM_PROVIDER=anthropic
CORS_ORIGIN=https://app.ddobak.com
```

#### 4-6. 테스트

```bash
# 빌드
docker compose build

# 실행
docker compose up -d

# 로그 확인
docker compose logs -f sidecar   # GPU 인식, 모델 로딩 확인
docker compose logs -f backend   # Rails 기동, DB 연결 확인

# GPU 확인
docker compose exec sidecar python3 -c "import torch; print(torch.cuda.is_available())"
# → True 이면 성공

# 헬스체크
curl http://localhost:13323/api/v1/health    # → {"status":"ok"}
curl http://localhost:13324/health            # → STT 엔진, 모델 상태 표시
```

**성공 기준:** 3개 서비스 모두 healthy, sidecar에서 CUDA 사용 가능

---

### Phase 5. 프론트엔드 웹 빌드 및 배포

#### 5-1. 웹용 빌드

```bash
cd frontend

# 서버 주소를 환경변수로 지정하여 빌드
VITE_API_BASE_URL=https://app.ddobak.com/api/v1 \
VITE_WS_URL=wss://app.ddobak.com/cable \
  npm run build

# 결과물: frontend/dist/
```

#### 5-2. 서버에 배포

```bash
# 빌드 결과물을 nginx 컨테이너 볼륨으로 복사
docker cp frontend/dist/. $(docker compose ps -q nginx):/usr/share/nginx/html/
docker compose exec nginx nginx -s reload
```

또는 CI/CD에서 빌드 후 Docker 이미지에 포함:

```dockerfile
# deploy/Dockerfile.frontend
FROM nginx:alpine
COPY frontend/dist/ /usr/share/nginx/html/
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
```

#### 5-3. 테스트

```bash
# 웹 브라우저에서 접속
open https://app.ddobak.com

# 확인 항목:
# 1. 로그인/메인 화면 로드
# 2. 회의 목록 API 호출 성공 (개발자도구 Network 탭)
# 3. WebSocket 연결 성공 (개발자도구 Network → WS 탭)
```

**성공 기준:** 웹 브라우저에서 회의 목록이 표시됨

---

### Phase 6. 전체 파이프라인 통합 테스트

#### 6-1. 실시간 녹음 테스트

```
1. 웹 브라우저에서 https://app.ddobak.com 접속
2. "새 회의" 생성
3. "녹음 시작" 클릭 → 마이크 허용
4. 10초간 한국어로 발화
5. 확인:
   - [ ] 실시간 전사 텍스트가 화면에 표시되는가
   - [ ] 화자 라벨(Speaker 0, 1...)이 표시되는가
   - [ ] 서버 로그에 CUDA 사용 로그가 보이는가
6. "녹음 중지" 클릭
7. 확인:
   - [ ] AI 요약이 생성되는가
   - [ ] 오디오 재생이 가능한가
```

#### 6-2. 파일 업로드 전사 테스트

```
1. 미리 준비한 오디오 파일(1분 이상) 업로드
2. 확인:
   - [ ] 전사 진행률이 표시되는가
   - [ ] 완료 후 전체 트랜스크립트가 보이는가
   - [ ] 화자 구분이 되어 있는가
   - [ ] AI 요약이 자동 생성되는가
```

#### 6-3. Tauri 데스크톱 → 서버 연결 테스트

```
1. Tauri 앱을 서버 모드로 빌드:
   VITE_API_BASE_URL=https://api.ddobak.com/api/v1 \
   VITE_WS_URL=wss://api.ddobak.com/cable \
     npm run tauri build
2. 앱 실행 (로컬 Rails/Sidecar 없이)
3. 확인:
   - [ ] 서버에 연결되어 회의 목록 로드
   - [ ] 녹음/전사/요약 전체 플로우 동작
   - [ ] 앱 시작이 즉시 됨 (Python/Ruby 셋업 없음)
```

#### 6-4. 성능 테스트

```bash
# 서버에서 GPU 사용률 모니터링
watch -n 1 nvidia-smi

# 동시 사용자 시뮬레이션 (2-3명 동시 녹음)
# → GPU 메모리 사용량이 8GB 이내인지 확인
# → STT 응답 지연이 5초 이내인지 확인
```

---

## 4. 개발 워크플로우

### 4-1. 로컬 개발 (기존과 동일)

```bash
# 터미널 1: Rails
cd backend && bin/rails server -p 13323

# 터미널 2: Sidecar
cd sidecar && uv run uvicorn app.main:app --port 13324

# 터미널 3: Frontend (웹 개발 모드)
cd frontend && npm run dev -- --port 13325

# 또는 Tauri 개발 모드 (데스크톱)
cd frontend && npm run tauri dev
```

로컬에서는 SQLite + CPU(또는 MLX) 기반으로 개발한다. 서버 배포와 코드가 동일하며, 차이점은 환경변수뿐이다.

### 4-2. 배포 프로세스

```bash
# 1. 코드 푸시
git push origin main

# 2. 서버에서 풀 + 재빌드
ssh server "cd /opt/ddobak && git pull && docker compose build && docker compose up -d"

# 3. DB 마이그레이션 (필요 시)
ssh server "cd /opt/ddobak && docker compose exec backend bin/rails db:migrate"

# 4. 프론트엔드 재빌드 (필요 시)
cd frontend
VITE_API_BASE_URL=https://app.ddobak.com/api/v1 \
VITE_WS_URL=wss://app.ddobak.com/cable \
  npm run build
scp -r dist/* server:/opt/ddobak/deploy/frontend/
ssh server "docker compose exec nginx nginx -s reload"
```

### 4.3. 환경별 차이점 요약

| 항목 | 로컬 개발 | 서버 배포 | Tauri 데스크톱 |
|------|----------|----------|--------------|
| DB | SQLite | PostgreSQL | SQLite |
| STT | MLX (macOS) / CPU | faster-whisper (CUDA) | MLX (macOS) / CPU |
| 프론트엔드 | Vite dev server | nginx 정적 파일 | Tauri WebView |
| API URL | localhost:13323 | app.ddobak.com | 127.0.0.1:13323 |
| 프로세스 관리 | 수동 (터미널) | Docker Compose | Tauri Rust |
| ML 모델 | 로컬 다운로드 | Docker 볼륨 | Application Support |

---

## 5. 데스크톱 앱 유지 방안

서버/클라이언트 전환 후에도 기존 Tauri 데스크톱 앱은 두 가지 모드로 동작할 수 있다:

### 모드 A: 서버 연결 (씬 클라이언트)

- `config.ts`에서 `IS_TAURI`일 때도 서버 URL을 사용하도록 설정 변경
- 로컬 Rails/Sidecar 스폰 없음
- 앱 시작 즉시 사용 가능
- 오프라인 불가

### 모드 B: 로컬 실행 (기존 방식 유지)

- 현재 Tauri 코드 그대로 사용
- 로컬에서 Rails + Sidecar 스폰
- 오프라인 사용 가능
- 서버 없이 독립 실행

향후 SetupPage에서 "서버 연결" / "로컬 실행" 선택 UI를 추가하면 두 모드를 사용자가 선택할 수 있다.

---

## 6. 향후 고려사항

- **인증/인가**: 다중 사용자 시 JWT 또는 세션 기반 인증 추가 필요
- **SSL 인증서**: Let's Encrypt (certbot) 또는 Cloudflare 활용
- **모니터링**: `docker compose logs` 외에 Prometheus + Grafana 도입 검토
- **백업**: PostgreSQL pg_dump 정기 백업, 오디오 파일 S3 백업
- **스케일링**: GPU 서버 1대로 동시 3-5명 처리 가능. 그 이상은 sidecar 인스턴스 추가
- **CI/CD**: GitHub Actions에서 Docker 빌드 + 서버 배포 자동화
