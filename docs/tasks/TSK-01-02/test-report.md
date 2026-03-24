# TSK-01-02: 테스트 리포트

## 실행 결과

```
29 examples, 0 failures, 1 pending
```

## 테스트 목록

| 테스트 | 결과 |
|--------|------|
| GET /api/v1/teams - authenticated: 팀 목록 반환 | ✅ |
| GET /api/v1/teams - authenticated: 빈 목록 반환 | ✅ |
| GET /api/v1/teams - unauthenticated: 401 | ✅ |
| POST /api/v1/teams - 팀 생성 + admin 추가 | ✅ |
| POST /api/v1/teams - name 없음: 422 | ✅ |
| POST /api/v1/teams - unauthenticated: 401 | ✅ |
| POST /api/v1/teams/:id/invite - admin: 팀원 추가 | ✅ |
| POST /api/v1/teams/:id/invite - 이메일 없음: 404 | ✅ |
| POST /api/v1/teams/:id/invite - 이미 멤버: 422 | ✅ |
| POST /api/v1/teams/:id/invite - 비-admin: 403 | ✅ |
| POST /api/v1/teams/:id/invite - 비-멤버: 403 | ✅ |
| DELETE /api/v1/teams/:id/members/:user_id - admin: 멤버 제거 | ✅ |
| DELETE /api/v1/teams/:id/members/:user_id - 없는 멤버: 404 | ✅ |
| DELETE /api/v1/teams/:id/members/:user_id - 비-admin: 403 | ✅ |

## 수정 이력

1. User 모델에 `has_many :team_memberships` 추가
2. `set_team`에서 `find_by!` → `find_by`로 변경 (비-멤버 접근 시 404→403 반환)
