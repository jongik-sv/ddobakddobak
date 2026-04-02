# Rails 서버 PC + Tauri 클라이언트 배포 구성

## 개요

사내 워크스테이션에 Rails 서버를 구성하고, Tauri 데스크톱 앱을 클라이언트로 각 사용자 PC에 배포하는 아키텍처.

## 전체 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    사내 네트워크 / 인터넷                   │
│                                                           │
│  ┌─────────────────────┐                                  │
│  │  워크스테이션 (서버)   │                                  │
│  │                     │         ┌──────────────┐         │
│  │  Rails API Server   │◄───────►│ Tauri Client │ (PC A)  │
│  │  (Puma/Passenger)   │   HTTP  └──────────────┘         │
│  │                     │   /WS                            │
│  │  Sidekiq (잡 처리)   │         ┌──────────────┐         │
│  │  PostgreSQL / MySQL │◄───────►│ Tauri Client │ (PC B)  │
│  │  Redis              │         └──────────────┘         │
│  │  Nginx (리버스 프록시)│                                  │
│  │                     │         ┌──────────────┐         │
│  │  파일 스토리지        │◄───────►│ Tauri Client │ (PC C)  │
│  └─────────────────────┘         └──────────────┘         │
└─────────────────────────────────────────────────────────┘
```

## 서버 PC (워크스테이션) 구성

### 하드웨어 권장 사양

| 항목 | 권장 사양 | 비고 |
|------|----------|------|
| CPU | Ryzen 7 / i7 이상 | Sidekiq 워커 병렬 처리 |
| RAM | 32GB+ | Rails + DB + Redis + 잡 처리 |
| 스토리지 | SSD 1TB+ | DB, 업로드 파일, 로그 |
| OS | Ubuntu 22.04 LTS / Rocky Linux | Windows도 가능하나 비추 |
| 네트워크 | 고정 IP (사내) | 클라이언트 접속 주소 고정 |

### 소프트웨어 스택

```
┌─────────────────────────────────┐
│  Nginx          (리버스 프록시)   │
│  ├─ SSL (Let's Encrypt / 사설)  │
│  └─ 정적 파일 서빙                │
│                                  │
│  Rails App      (Puma)           │
│  ├─ API 모드 (--api)             │
│  ├─ JWT / 세션 인증               │
│  └─ ActionCable (WebSocket)     │
│                                  │
│  PostgreSQL     (메인 DB)         │
│  Redis          (캐시 + Sidekiq) │
│  Sidekiq        (백그라운드 잡)    │
└─────────────────────────────────┘
```

### 서버 배포 절차

```bash
# 1. 기본 패키지
sudo apt update && sudo apt install -y \
  nginx postgresql redis-server \
  ruby-full build-essential libpq-dev

# 2. Rails 앱 배포
git clone your-repo /opt/myapp
cd /opt/myapp
bundle install --deployment
rails db:create db:migrate RAILS_ENV=production
rails assets:precompile RAILS_ENV=production

# 3. systemd 서비스 등록
# /etc/systemd/system/myapp-web.service
# /etc/systemd/system/myapp-sidekiq.service

# 4. Nginx 리버스 프록시 설정
# upstream puma { server unix:///opt/myapp/tmp/sockets/puma.sock; }
```

## Tauri 클라이언트 구성

### 클라이언트 구조

```
Tauri Client (각 사용자 PC에 설치)
├── WebView (React/Vue 등 UI)
├── 서버 API 호출 (HTTP/WebSocket)
├── 로컬 캐시 (SQLite, 오프라인 대비)
└── 네이티브 기능 (알림, 파일 저장, 트레이)
```

### API 연결 설정

```typescript
// src/lib/api.ts
const API_BASE = import.meta.env.VITE_API_URL || "http://192.168.1.100:3000";

export async function fetchMeetings() {
  const res = await fetch(`${API_BASE}/api/v1/meetings`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  return res.json();
}
```

### Tauri 보안 설정

```json
// tauri.conf.json - 서버 도메인 허용
{
  "security": {
    "csp": "default-src 'self'; connect-src http://192.168.1.100:3000 ws://192.168.1.100:3000"
  }
}
```

### 자동 업데이트

```json
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "endpoints": ["http://192.168.1.100:3000/api/releases/latest"]
    }
  }
}
```

### 배포 산출물

```
플랫폼별 설치 파일 (각 5~10MB)
├── Windows: myapp_1.0.0_x64-setup.exe
├── macOS:   myapp_1.0.0_aarch64.dmg
└── Linux:   myapp_1.0.0_amd64.AppImage
```

## 장점

| 항목 | 설명 |
|------|------|
| 클라이언트가 가벼움 | Ruby 번들링 불필요, 5~10MB 설치 파일 |
| 중앙 관리 | DB, 비즈니스 로직이 서버 한 곳에 |
| 다중 사용자 | 여러 클라이언트가 동시 접속 |
| 서버만 업데이트 | 백엔드 로직 변경 시 서버만 배포하면 됨 |
| 네이티브 기능 | Tauri 덕분에 파일 저장, 알림, 트레이 등 사용 가능 |

## 고려사항 및 대응

| 항목 | 대응 |
|------|------|
| 서버 PC 꺼지면 서비스 중단 | UPS + 자동 부팅 + systemd 자동 시작 |
| 사내망 한정 | VPN 또는 Tailscale로 외부 접속 해결 |
| 백업 | pg_dump 크론잡 + 외부 스토리지 동기화 |
| 모니터링 | Monit, systemd watchdog 등으로 프로세스 감시 |
| 보안 | JWT 인증, HTTPS, 방화벽 설정 필수 |

## 워크스테이션 vs 클라우드 비교

| | 워크스테이션 | 클라우드 (AWS 등) |
|--|------------|------------------|
| 비용 | 초기 하드웨어 비용만 | 월 과금 (월 200~300만원급이면 고사양) |
| 관리 | 직접 관리 (하드웨어 장애 대응) | 관리형 서비스 사용 가능 |
| 네트워크 | 사내망 빠름, 외부 접속 번거로움 | 어디서든 접속 가능 |
| 보안 | 물리적 접근 통제 필요 | 클라우드 보안 서비스 활용 |
| 확장 | 하드웨어 교체 필요 | 스케일 업/아웃 용이 |

사내 전용이고 사용자 수가 수십 명 이하라면 워크스테이션 서버가 비용 면에서 합리적이다. 월 200~300만원 클라우드 비용이면 동급 워크스테이션을 구매해서 1~2년 운영하는 편이 유리하다.
