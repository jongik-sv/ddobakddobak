# TSK-01-01: Devise + JWT 인증 백엔드 구현 - 설계

## 구현 방향

Devise + devise-jwt를 이용한 JWT 기반 인증 구현.
- 회원가입: POST /api/v1/signup → User 생성 + JWT 반환
- 로그인: POST /api/v1/login → JWT 발급
- 로그아웃: DELETE /api/v1/logout → jti 갱신으로 JWT 무효화 (JTIMatcher 전략)

devise-jwt의 `JTIMatcher` revocation strategy를 사용. jti는 users 테이블에 저장되며, 로그아웃 시 jti를 갱신하여 기존 토큰을 무효화한다.

## 파일 계획

| 파일 | 작업 | 설명 |
|------|------|------|
| `db/migrate/*_devise_create_users.rb` | 신규 생성 | users 테이블 (email, encrypted_password, name, jti) |
| `app/models/user.rb` | 신규 생성 | Devise + JTI mixin |
| `app/controllers/application_controller.rb` | 수정 | current_user, authenticate_user! |
| `app/controllers/api/v1/registrations_controller.rb` | 신규 생성 | 회원가입 (signup) |
| `app/controllers/api/v1/sessions_controller.rb` | 신규 생성 | 로그인/로그아웃 |
| `config/initializers/devise.rb` | 신규 생성 | Devise 설정 |
| `config/routes.rb` | 수정 | signup, login, logout 라우트 |
| `spec/requests/api/v1/auth_spec.rb` | 신규 생성 | 인증 API 통합 테스트 |
| `spec/models/user_spec.rb` | 신규 생성 | User 모델 단위 테스트 |
| `spec/factories/users.rb` | 신규 생성 | FactoryBot user factory |

## 주요 구조

```ruby
# User 모델
class User < ApplicationRecord
  devise :database_authenticatable, :registerable, :jwt_authenticatable,
         jwt_revocation_strategy: self

  include Devise::JWT::RevocationStrategies::JTIMatcher
end

# JWT payload
# { sub: user.id, jti: user.jti, exp: 24.hours.from_now }
```

```ruby
# Registrations (signup)
# POST /api/v1/signup
# params: { email, password, name }
# response: { token, user: { id, email, name } }

# Sessions (login/logout)
# POST /api/v1/login → { token, user }
# DELETE /api/v1/logout → 204
```

## 데이터 흐름

**회원가입:**
1. POST /api/v1/signup { email, password, name }
2. User.create! → jti 자동 생성 (SecureRandom.uuid)
3. JWT 생성 (HS256, exp: 24h)
4. { token, user } 반환

**로그인:**
1. POST /api/v1/login { email, password }
2. Devise authenticate → valid_password?
3. JWT 생성
4. { token, user } 반환

**로그아웃:**
1. DELETE /api/v1/logout (Authorization: Bearer <token>)
2. current_user.jti 갱신 (SecureRandom.uuid)
3. 기존 JWT 무효화
4. 204 반환

**인증 미들웨어:**
1. Authorization: Bearer <token> 헤더 파싱
2. JWT 디코드 → sub, jti 추출
3. User.find(sub) → user.jti == token.jti 확인
4. current_user 설정

## 선행 조건

- TSK-00-04: users 테이블 마이그레이션 (이 Task에서 함께 생성)
  - email, encrypted_password, name, jti 컬럼
- Gemfile: devise, devise-jwt 이미 추가됨
- `bundle install` 완료 확인 필요
