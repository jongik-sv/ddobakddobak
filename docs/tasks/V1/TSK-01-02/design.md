# TSK-01-02: 팀 CRUD 및 초대 API - 설계

## 구현 방향

Team, TeamMembership 모델과 Teams API 구현.
- 팀 생성 시 생성자를 자동으로 admin으로 추가
- 팀원 초대: 이메일로 기존 사용자를 팀에 추가
- 팀원 제거: admin만 가능
- 내 팀 목록: 현재 사용자가 속한 팀 반환

## 파일 계획

| 파일 | 작업 | 설명 |
|------|------|------|
| `app/models/team.rb` | 신규 생성 | Team 모델 (has_many, validations) |
| `app/models/team_membership.rb` | 신규 생성 | TeamMembership (role: admin/member) |
| `app/controllers/api/v1/teams_controller.rb` | 신규 생성 | 팀 CRUD API |
| `config/routes.rb` | 수정 | teams, invite, members 라우트 |
| `spec/requests/api/v1/teams_spec.rb` | 신규 생성 | Teams API 통합 테스트 |
| `spec/models/team_spec.rb` | 신규 생성 | Team 모델 단위 테스트 |
| `spec/factories/teams.rb` | 신규 생성 | Team factory |
| `spec/factories/team_memberships.rb` | 신규 생성 | TeamMembership factory |

## 주요 구조

```ruby
class Team < ApplicationRecord
  belongs_to :creator, class_name: "User", foreign_key: :created_by_id
  has_many :team_memberships, dependent: :destroy
  has_many :members, through: :team_memberships, source: :user
  validates :name, presence: true
end

class TeamMembership < ApplicationRecord
  belongs_to :user
  belongs_to :team
  validates :role, inclusion: { in: %w[admin member] }
  validates :user_id, uniqueness: { scope: :team_id }
end
```

## 데이터 흐름

**팀 생성 (POST /api/v1/teams):**
1. authenticate_user!
2. Team.create!(name:, created_by: current_user)
3. TeamMembership.create!(user: current_user, team:, role: "admin")
4. 201 응답 { team: { id, name, role: "admin", member_count: 1 } }

**팀원 초대 (POST /api/v1/teams/:id/invite):**
1. authenticate_user!
2. require_team_admin! (current_user가 해당 팀의 admin인지 확인)
3. User.find_by!(email:) (없으면 404)
4. TeamMembership.create!(user:, team:, role: "member")
5. 201 응답 { membership: { user_id, team_id, role } }

**팀원 제거 (DELETE /api/v1/teams/:id/members/:user_id):**
1. authenticate_user!
2. require_team_admin!
3. TeamMembership.find_by!(team:, user_id:).destroy
4. 204 응답

**내 팀 목록 (GET /api/v1/teams):**
1. authenticate_user!
2. current_user.team_memberships.includes(:team)
3. [{ id, name, role, member_count }]

## 선행 조건

- TSK-01-01 완료 (authenticate_user! 메서드 사용)
- DB 마이그레이션: teams, team_memberships 테이블 존재 (TSK-00-04에서 생성됨)
