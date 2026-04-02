# TSK-01-04 리팩토링 보고서

## 개선 사항

### api/client.ts
- `localStorage.getItem` 직접 파싱 방식 → `useAuthStore.getState().token` 직접 참조로 단순화
- `afterResponse` 인터셉터 추가: 401 응답 시 자동 로그아웃

### stores/authStore.ts
- `login(token, user)` 원자적 액션 추가: setToken + setUser 두 번 호출 불필요

### api/auth.ts
- `User` 타입을 authStore에서 import하여 중복 타입 정의 제거

## 테스트 재실행

- 26개 테스트 모두 통과 확인
