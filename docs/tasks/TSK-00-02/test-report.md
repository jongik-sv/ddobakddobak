# TSK-00-02 테스트 리포트

> 작성일: 2026-03-24
> 테스트 도구: Vitest v4.1.1 + @testing-library/react v16.3.2

---

## 테스트 실행 결과

### 최종 결과: PASS

```
Test Files  4 passed (4)
      Tests  11 passed (11)
   Start at  22:32:07
   Duration  532ms
```

---

## 테스트 파일별 결과

### 1. `src/stores/authStore.test.ts` - PASS (4 tests)

| # | 테스트명 | 결과 |
|---|---------|------|
| 1 | 초기 상태: user는 null이고 isAuthenticated는 false | PASS |
| 2 | setUser 호출 시 user가 설정되고 isAuthenticated가 true | PASS |
| 3 | setToken 호출 시 token이 설정됨 | PASS |
| 4 | logout 호출 시 상태가 초기화됨 | PASS |

### 2. `src/pages/HomePage.test.tsx` - PASS (2 tests)

| # | 테스트명 | 결과 |
|---|---------|------|
| 1 | 홈 페이지가 렌더링됨 | PASS |
| 2 | 로그인 링크가 존재함 | PASS |

### 3. `src/pages/LoginPage.test.tsx` - PASS (3 tests)

| # | 테스트명 | 결과 |
|---|---------|------|
| 1 | 로그인 페이지가 렌더링됨 | PASS |
| 2 | 이메일 입력 필드가 존재함 | PASS |
| 3 | 비밀번호 입력 필드가 존재함 | PASS |

### 4. `src/App.test.tsx` - PASS (2 tests)

| # | 테스트명 | 결과 |
|---|---------|------|
| 1 | / 경로에서 HomePage가 렌더링됨 | PASS |
| 2 | /login 경로에서 LoginPage가 렌더링됨 | PASS |

---

## 발견된 이슈 및 수정 이력

### 이슈 1: Zustand `persist` middleware - localStorage not a function

- **원인**: jsdom 환경에서 `localStorage.setItem`이 함수로 인식되지 않음
- **해결**: `src/test/setup.ts`에 localStorage mock 추가
- **시도 횟수**: 1회

### 이슈 2: `LoginPage.test.tsx` - getByText 중복 요소 에러

- **원인**: "로그인" 텍스트가 `<h1>` 제목과 `<button>` 텍스트에 동시 존재
- **해결**: `getByText(/로그인/i)` → `getByRole('heading', { name: /로그인/i })`로 변경
- **시도 횟수**: 1회 (App.test.tsx도 동일하게 수정)

---

## Acceptance Criteria 검증

| 항목 | 상태 |
|------|------|
| `npm run dev` 정상 기동 | PASS (Vite dev server 정상 구동 확인) |
| `/` 라우트 → `HomePage` 렌더링 | PASS (테스트 통과) |
| `/login` 라우트 → `LoginPage` 렌더링 | PASS (테스트 통과) |
| `npm run test` 전체 테스트 통과 | PASS (11/11 통과) |
