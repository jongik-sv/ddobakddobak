# TSK-00-01: Rails API 프로젝트 초기화 - 설계 문서

## 개요

Ruby on Rails 8+ API 모드 프로젝트를 `backend/` 디렉토리에 생성하고, 필요한 의존성 및 초기 설정을 구성한다.

## 구현 설계

### 1. 프로젝트 구조

```
backend/
├── app/
│   ├── controllers/
│   │   ├── application_controller.rb
│   │   └── api/
│   │       └── v1/
│   │           └── health_controller.rb   # health 엔드포인트
├── config/
│   ├── routes.rb                          # /api/v1/health 라우팅
│   ├── database.yml                       # SQLite3 WAL 모드
│   ├── initializers/
│   │   └── cors.rb                        # CORS 설정
├── Gemfile                                # 의존성 정의
└── spec/                                  # RSpec 테스트
    ├── rails_helper.rb
    ├── spec_helper.rb
    └── requests/
        └── api/
            └── v1/
                └── health_spec.rb
```

### 2. Gemfile 구성

주요 gem:
- `devise` + `devise-jwt`: JWT 기반 인증
- `alba`: 경량 JSON 시리얼라이저
- `rack-cors`: CORS 지원
- `solid_queue`: Rails 8 기본 백그라운드 잡 (이미 포함됨)
- `rspec-rails`: TDD 테스트 프레임워크
- `factory_bot_rails`: 테스트 픽스처

### 3. SQLite3 WAL 모드 설정

`config/database.yml`에 SQLite PRAGMA 설정:
```yaml
default: &default
  adapter: sqlite3
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
  timeout: 5000
  pragmas:
    journal_mode: wal
    busy_timeout: 5000
```

### 4. CORS 설정

`config/initializers/cors.rb`에서 localhost:5173 (React SPA) 허용:
```ruby
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins "http://localhost:5173"
    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      expose: ["Authorization"]
  end
end
```

### 5. Health 엔드포인트

`GET /api/v1/health` → `{ status: "ok" }`

### 6. 라우팅 설계

```ruby
namespace :api do
  namespace :v1 do
    get "health", to: "health#show"
  end
end
```

## 테스트 계획

- `spec/requests/api/v1/health_spec.rb`: health 엔드포인트 응답 200 및 JSON 형식 검증
- `rails server` 기동 확인

## 의존성

- Ruby: 4.0+ (brew 설치)
- Rails: 8.1+
- SQLite3: 시스템 내장
