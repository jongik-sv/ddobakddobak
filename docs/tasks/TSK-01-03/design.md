# TSK-01-03: 권한 제어 미들웨어 - 설계

## 구현 방향

ApplicationController에 재사용 가능한 권한 제어 헬퍼 메서드를 추가한다.
- `authenticate_user!`: JWT 검증 (TSK-01-01에서 구현)
- `require_team_membership!`: 현재 사용자가 팀 멤버인지 확인 (팀 기반 리소스 접근)
- `require_team_admin!`: 현재 사용자가 팀 admin인지 확인
- `require_resource_owner_or_admin!`: 리소스 생성자 또는 팀 admin만 접근

별도 미들웨어가 아닌 ApplicationController concern 방식으로 구현.

## 파일 계획

| 파일 | 작업 | 설명 |
|------|------|------|
| `app/controllers/application_controller.rb` | 수정 | 권한 제어 메서드 추가 |
| `app/controllers/concerns/team_authorizable.rb` | 신규 생성 | 팀 권한 제어 Concern |
| `spec/requests/api/v1/authorization_spec.rb` | 신규 생성 | 권한 제어 통합 테스트 |

## 주요 구조

```ruby
# app/controllers/concerns/team_authorizable.rb
module TeamAuthorizable
  extend ActiveSupport::Concern

  def require_team_membership!(team)
    membership = team.team_memberships.find_by(user: current_user)
    render json: { error: "Forbidden" }, status: :forbidden unless membership
  end

  def require_team_admin!(team)
    membership = team.team_memberships.find_by(user: current_user)
    render json: { error: "Forbidden" }, status: :forbidden unless membership&.role == "admin"
  end

  def require_resource_owner_or_admin!(resource, team)
    membership = team.team_memberships.find_by(user: current_user)
    is_owner = resource.respond_to?(:created_by_id) && resource.created_by_id == current_user.id
    is_admin = membership&.role == "admin"
    render json: { error: "Forbidden" }, status: :forbidden unless is_owner || is_admin
  end
end
```

## 데이터 흐름

**팀 리소스 접근 (예: 회의):**
1. `before_action :authenticate_user!`
2. `@team = Team.find(team_id)`
3. `before_action { require_team_membership!(@team) }`
4. → 403 if 다른 팀 소속

**팀 관리 (초대/제거):**
1. `before_action :authenticate_user!`
2. `before_action { require_team_admin!(@team) }`
3. → 403 if non-admin

**회의 삭제:**
1. `before_action :authenticate_user!`
2. `before_action { require_resource_owner_or_admin!(@meeting, @team) }`
3. → 403 if 생성자 아님 AND admin 아님

## 선행 조건

- TSK-01-01: `authenticate_user!`, `current_user` 구현 완료
- TSK-01-02: Team, TeamMembership 모델 완료
