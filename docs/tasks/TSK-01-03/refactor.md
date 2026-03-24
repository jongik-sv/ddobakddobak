# TSK-01-03: 리팩토링 리포트

## 변경 사항

- TeamsController의 인라인 권한 체크를 `TeamAuthorizable` concern 메서드로 통합
  - `require_team_admin!(@team)` 재사용으로 중복 제거
- ApplicationController에 `TeamAuthorizable` include로 모든 컨트롤러에서 사용 가능

## 최종 구조

- `app/controllers/concerns/team_authorizable.rb`: 권한 제어 concern
  - `require_team_membership!(team)`: 팀 멤버 여부
  - `require_team_admin!(team)`: 팀 admin 여부
  - `require_resource_owner_or_admin!(resource, team)`: 생성자/admin 여부

## 최종 테스트 결과

```
39 examples, 0 failures, 1 pending
```
