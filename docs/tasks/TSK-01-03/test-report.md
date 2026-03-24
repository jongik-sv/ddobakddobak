# TSK-01-03: 테스트 리포트

## 실행 결과

```
39 examples, 0 failures, 1 pending
```

## 테스트 목록 (authorization_spec.rb)

| 테스트 | 결과 |
|--------|------|
| 미인증 사용자 팀 목록 접근 → 401 | ✅ |
| 미인증 사용자 팀 초대 → 401 | ✅ |
| outsider 팀 초대 → 403 | ✅ |
| outsider 팀원 제거 → 403 | ✅ |
| 비-admin 팀원 초대 → 403 | ✅ |
| 비-admin 팀원 제거 → 403 | ✅ |
| admin 팀원 초대 성공 → 201 | ✅ |
| admin 팀원 제거 성공 → 204 | ✅ |
| require_team_membership!: 팀 멤버 허용 | ✅ |
| require_team_admin!: admin만 팀 관리 가능 | ✅ |
