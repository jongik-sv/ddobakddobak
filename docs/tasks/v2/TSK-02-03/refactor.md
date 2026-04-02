# TSK-02-03 리팩토링 결과

> date: 2026-04-02

## 변경 요약

### 1. authStore.ts — 타입 분리 및 markAuthenticated 액션 추가
- `AuthState` 인터페이스를 `AuthStateData` (상태)와 `AuthActions` (액션)으로 분리하여 관심사 구분 명확화
- `markAuthenticated()` 액션 추가: `useAuthStore.setState({ isAuthenticated: true })` 직접 호출을 제거하고 공식 액션으로 대체하여 상태 변경 경로를 일관되게 유지

### 2. auth.ts — 헬퍼 함수 추출 및 네이밍 개선
- `authBaseUrl()` → `getServerRootUrl()`으로 이름 변경하여 의미를 명확히 함
- `bearerHeader()` 헬퍼 함수 추출: 3개 함수에서 반복되던 `{ Authorization: \`Bearer ${token}\` }` 패턴 제거
- 인터페이스 정의를 상단 Types 섹션으로 그룹화

### 3. useAuth.ts — 매직 문자열 상수화 및 일관성 개선
- `DEEP_LINK_SCHEME`, `LOGIN_PATH` 상수 추출
- 로그인 URL의 callback 파라미터를 `encodeURIComponent()`로 인코딩하여 안전성 향상
- `useAuthStore.setState({ isAuthenticated: true })` → `markAuthenticated()` 액션 사용으로 변경: store 외부에서 직접 상태 조작하던 패턴을 공식 액션을 통한 변경으로 통일
- `setTokens`를 useAuthStore에서 destructure하여 `useAuthStore.getState().setTokens()` 직접 호출 제거

### 4. LoginPage.tsx — 중복 CSS 클래스 추출
- 로딩/로그인 두 상태에서 반복되던 배경 스타일을 `PAGE_BG` 상수로 추출

## 테스트 결과

```
Test Files  8 passed (8)
     Tests  71 passed (71)
```

신규 테스트 2건 추가 (markAuthenticated 액션 검증)

## 변경 파일
- `frontend/src/stores/authStore.ts`
- `frontend/src/stores/__tests__/authStore.test.ts`
- `frontend/src/api/auth.ts`
- `frontend/src/hooks/useAuth.ts`
- `frontend/src/hooks/__tests__/useAuth.test.ts`
- `frontend/src/components/auth/LoginPage.tsx`
