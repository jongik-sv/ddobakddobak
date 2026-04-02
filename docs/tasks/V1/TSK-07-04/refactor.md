# TSK-07-04 리팩토링 보고서

## 개요

e2e/ 디렉토리 전체를 검토하여 중복 코드 제거, helper 통합, selector 상수화,
playwright.config.ts timeout 설정 보완을 수행했다.

---

## 변경 파일 목록

| 파일 | 변경 유형 |
|------|-----------|
| `e2e/helpers/selectors.ts` | 신규 생성 |
| `e2e/helpers/mock.ts` | `allowCableConnection` 함수 추가 |
| `e2e/helpers/auth.ts` | `refreshAuthForPage` 함수 추가 |
| `e2e/playwright.config.ts` | timeout 설정 보완 |
| `e2e/tests/auth.spec.ts` | Selectors 상수 적용 |
| `e2e/tests/meeting.spec.ts` | Selectors + helper 함수 적용 |
| `e2e/tests/minutes.spec.ts` | Selectors + helper 함수 적용 |
| `e2e/tests/team.spec.ts` | Selectors + helper 함수 적용 |
| `e2e/tests/export.spec.ts` | Selectors + RoutePatterns + helper 적용 |
| `e2e/tests/pipeline.spec.ts` | Selectors + helper 함수 적용 |

---

## 1. `e2e/helpers/selectors.ts` 생성

자주 사용되는 CSS selector와 route URL 패턴을 `Selectors`, `RoutePatterns` 상수로 추출.

### Before
```typescript
// 각 테스트 파일에 하드코딩
await page.locator('[data-testid="ai-summary"]')
await page.locator('[role="alert"]')
await page.route('**/api/v1/meetings/*/start', ...)
await page.route(`**/api/v1/meetings/${id}/summary`, ...)
```

### After
```typescript
// selectors.ts의 상수 참조
await page.locator(Selectors.aiSummary.panel)
await page.locator(Selectors.auth.errorAlert)
await page.route(RoutePatterns.meetingStart, ...)
await page.route(RoutePatterns.meetingSummary(id), ...)
```

**효과**: UI selector 변경 시 `selectors.ts` 한 곳만 수정.

---

## 2. `allowCableConnection` 함수 추가 (mock.ts)

ActionCable route를 pass-through로 허용하는 패턴이 5개 테스트 파일에 중복되었다.

### Before (각 파일에 반복)
```typescript
await authenticatedPage.route('**/cable', async (route) => {
  await route.continue();
});
```

### After
```typescript
import { allowCableConnection } from '../helpers/mock';

await allowCableConnection(authenticatedPage);
```

**제거된 중복**: meeting.spec.ts, minutes.spec.ts(4회), export.spec.ts, pipeline.spec.ts(4회)
→ 총 9개 인라인 패턴을 함수 호출로 대체.

---

## 3. `refreshAuthForPage` 함수 추가 (auth.ts)

`beforeEach`에서 `loginViaApi` + `injectAuthToken` 조합이 4개 파일에 반복되었다.

### Before (각 파일 beforeEach)
```typescript
const authData = await loginViaApi({ email: testUser.email, password: testUser.password });
await injectAuthToken(authenticatedPage, authData.token, authData.user);
```

### After
```typescript
import { refreshAuthForPage } from '../helpers/auth';

await refreshAuthForPage(authenticatedPage, testUser);
```

**적용 파일**: meeting.spec.ts, minutes.spec.ts, export.spec.ts, pipeline.spec.ts

---

## 4. `playwright.config.ts` timeout 보완

기존에 명시적 timeout 설정이 없어 Playwright 기본값에 의존했다.

### Before
```typescript
export default defineConfig({
  testDir: './tests',
  // timeout 미설정
  use: {
    // actionTimeout, navigationTimeout 미설정
  },
```

### After
```typescript
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,          // 단일 테스트 최대 실행 시간
  expect: { timeout: 10_000 },  // assertion 대기 시간
  use: {
    actionTimeout: 15_000,    // click/fill 등 개별 action 대기
    navigationTimeout: 20_000, // 페이지 이동 대기
  },
```

---

## 개선 지표

| 항목 | Before | After |
|------|--------|-------|
| 인라인 cable route 중복 | 9회 | 0회 |
| loginViaApi+injectAuthToken 중복 | 4회 | 0회 |
| 하드코딩 selector 문자열 | 분산 관리 | selectors.ts 단일 관리 |
| 하드코딩 route 패턴 | 분산 관리 | selectors.ts 단일 관리 |
| timeout 명시 설정 | 미설정 | 4개 항목 명시 |

## 변경하지 않은 사항

- 테스트 로직 및 시나리오: 기존 그대로 유지
- fixture 구조 (auth.fixture.ts, data.fixture.ts): 변경 없음
- global-setup.ts: 변경 없음
- stubs/sidecar_stub.py: 변경 없음
