# TSK-07-04: E2E 테스트 작성 - 설계

## 테스트 전략

Playwright를 사용하여 사용자 관점의 핵심 플로우를 E2E 테스트로 검증한다. 테스트는 `e2e/` 디렉토리에 위치하며, 실제 Rails 백엔드 + React 프론트엔드를 모두 기동한 상태에서 실행한다. 실시간 STT 파이프라인처럼 외부 의존성이 큰 항목은 MSW(Mock Service Worker) 또는 Playwright `route()` intercept를 통해 mock 처리한다.

---

## 디렉토리 구조

```
e2e/
├── playwright.config.ts          # Playwright 전역 설정
├── fixtures/
│   ├── index.ts                  # 커스텀 fixture 엔트리
│   ├── auth.fixture.ts           # 인증된 사용자 fixture
│   └── data.fixture.ts           # 테스트 데이터(팀/회의) fixture
├── helpers/
│   ├── api.ts                    # 백엔드 API 직접 호출 헬퍼 (테스트 setup용)
│   ├── auth.ts                   # 로그인/로그아웃 헬퍼
│   └── mock.ts                   # WebSocket / STT mock 헬퍼
├── tests/
│   ├── auth.spec.ts              # 회원가입 / 로그인 플로우
│   ├── team.spec.ts              # 팀 생성 플로우
│   ├── meeting.spec.ts           # 회의 생성 플로우
│   ├── minutes.spec.ts           # 회의록 확인 플로우
│   ├── export.spec.ts            # Markdown 내보내기 플로우
│   └── pipeline.spec.ts          # 실시간 파이프라인 (mocking)
└── global-setup.ts               # DB 초기화 / 서버 기동 대기
```

---

## playwright.config.ts

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,           // 상태 공유 방지: 순차 실행
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'e2e/reports/html' }],
    ['junit', { outputFile: 'e2e/reports/results.xml' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    locale: 'ko-KR',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: './e2e/global-setup.ts',
  webServer: [
    {
      command: 'cd backend && bundle exec rails server -p 3000 -e test',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'cd frontend && npm run dev -- --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
```

---

## 핵심 시나리오별 테스트 케이스 설계

### 1. 회원가입 → 로그인 플로우 (`auth.spec.ts`)

**목적:** 신규 사용자가 계정을 생성하고 앱에 진입할 수 있음을 검증

| 테스트 케이스 | 기댓값 |
|---|---|
| 유효한 이메일/비밀번호로 회원가입 | `/meetings` 페이지로 리다이렉트 |
| 중복 이메일로 회원가입 시도 | 에러 메시지 표시 |
| 짧은 비밀번호(< 6자)로 회원가입 | 유효성 검사 에러 표시 |
| 가입된 계정으로 로그인 | `/meetings` 페이지 진입, 헤더에 사용자명 표시 |
| 잘못된 비밀번호로 로그인 | 에러 메시지 표시 |
| 로그아웃 후 보호 페이지 접근 | `/login`으로 리다이렉트 |

```typescript
// 핵심 assertions 예시
await page.goto('/signup');
await page.fill('[data-testid="email"]', 'test@example.com');
await page.fill('[data-testid="password"]', 'password123');
await page.click('[data-testid="signup-submit"]');
await expect(page).toHaveURL('/meetings');
```

---

### 2. 팀 생성 플로우 (`team.spec.ts`)

**목적:** 인증된 사용자가 팀을 생성하고 팀원을 초대할 수 있음을 검증

| 테스트 케이스 | 기댓값 |
|---|---|
| 팀 이름 입력 후 팀 생성 | 팀 목록에 신규 팀 표시 |
| 빈 팀 이름으로 생성 시도 | 유효성 검사 에러 표시 |
| 팀 상세 페이지 진입 | 팀명, 팀원 목록 표시 |
| 팀원 초대 (이메일 입력) | 팀원 목록에 추가 표시 |

```typescript
// fixture: 이미 로그인된 상태로 시작
test.use({ storageState: 'e2e/fixtures/auth-state.json' });

await page.click('[data-testid="create-team-btn"]');
await page.fill('[data-testid="team-name"]', 'E2E 테스트팀');
await page.click('[data-testid="team-submit"]');
await expect(page.locator('[data-testid="team-card"]')).toContainText('E2E 테스트팀');
```

---

### 3. 회의 생성 플로우 (`meeting.spec.ts`)

**목적:** 팀 내에서 회의를 생성하고 목록에서 확인할 수 있음을 검증

| 테스트 케이스 | 기댓값 |
|---|---|
| 회의 제목/날짜 입력 후 생성 | 회의 목록 상단에 신규 회의 표시 |
| 빈 제목으로 회의 생성 시도 | 유효성 검사 에러 표시 |
| 회의 목록 페이지네이션 | 페이지 전환 동작 |
| 회의 제목으로 검색 | 해당 회의만 필터링 표시 |
| 회의 상세 페이지 진입 | 제목, 날짜, 상태(pending) 표시 |

```typescript
test('회의 생성', async ({ page }) => {
  await page.click('[data-testid="new-meeting-btn"]');
  await page.fill('[data-testid="meeting-title"]', '분기 리뷰 회의');
  await page.click('[data-testid="meeting-submit"]');
  await expect(page.locator('[data-testid="meeting-list-item"]').first())
    .toContainText('분기 리뷰 회의');
});
```

---

### 4. 회의록 확인 플로우 (`minutes.spec.ts`)

**목적:** 완료된 회의의 블록 에디터, 트랜스크립트, AI 요약, Action Item을 확인하고 편집할 수 있음을 검증

**사전 조건:** `data.fixture.ts`를 통해 DB에 완료 상태 회의 데이터를 직접 삽입 (API 호출)

| 테스트 케이스 | 기댓값 |
|---|---|
| 회의 상세 진입 시 트랜스크립트 표시 | 화자 라벨 + 텍스트 노출 |
| AI 요약 패널 표시 | 핵심 요약, 결정사항, Action Item 섹션 노출 |
| 블록 에디터에서 텍스트 입력 | 입력한 텍스트가 블록으로 저장 (자동 저장 확인) |
| `/` 명령어로 블록 타입 변경 | 헤딩/리스트/체크리스트 변환 동작 |
| Action Item 완료 체크 | 완료 상태로 업데이트 |
| Action Item 담당자/마감일 수정 | 수정 내용 반영 |

```typescript
test('AI 요약 패널 확인', async ({ page, completedMeeting }) => {
  await page.goto(`/meetings/${completedMeeting.id}`);
  await expect(page.locator('[data-testid="ai-summary-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="key-points"]')).not.toBeEmpty();
  await expect(page.locator('[data-testid="decisions"]')).not.toBeEmpty();
  await expect(page.locator('[data-testid="action-items"]')).not.toBeEmpty();
});
```

---

### 5. Markdown 내보내기 플로우 (`export.spec.ts`)

**목적:** 회의록을 Markdown 파일로 다운로드할 수 있음을 검증

| 테스트 케이스 | 기댓값 |
|---|---|
| 내보내기 버튼 클릭 | 파일 다운로드 발생 |
| 다운로드된 파일 내용 검증 | 회의 제목, AI 요약 포함 여부 |
| AI 요약 제외 옵션 선택 후 내보내기 | 다운로드 파일에 요약 섹션 없음 |
| 원본 텍스트 제외 옵션 선택 후 내보내기 | 다운로드 파일에 트랜스크립트 없음 |

```typescript
test('Markdown 내보내기', async ({ page, completedMeeting }) => {
  await page.goto(`/meetings/${completedMeeting.id}`);
  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-testid="export-markdown-btn"]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/);

  // 파일 내용 검증
  const path = await download.path();
  const content = fs.readFileSync(path, 'utf-8');
  expect(content).toContain('## 핵심 요약');
  expect(content).toContain(completedMeeting.title);
});
```

---

### 6. 실시간 파이프라인 (mocking 전략) (`pipeline.spec.ts`)

**목적:** 실제 STT 모델 없이 WebSocket 이벤트를 mock하여 실시간 자막 표시 흐름을 검증

**Mock 전략:**

실제 STT 처리는 Python Sidecar + 로컬 모델이 필요하여 CI 환경에서 실행 불가. 대신 두 단계로 mock한다:

1. **Rails WebSocket mock**: Playwright `page.route()`로 ActionCable 메시지를 intercept하여 직접 WebSocket 이벤트를 주입
2. **Python Sidecar mock**: `backend/spec/support/sidecar_stub_server.rb` 형태로 stub 서버를 기동, `/transcribe` 요청에 대해 고정 STT 결과를 반환

```typescript
// WebSocket 이벤트 mock 주입
test('실시간 자막 표시', async ({ page }) => {
  // ActionCable WebSocket mock
  await page.addInitScript(() => {
    window.__E2E_MOCK_CABLE__ = true;
  });

  await page.route('**/cable', async (route) => {
    // WebSocket upgrade 요청 통과 후 mock 메시지 주입
    await route.continue();
  });

  await page.goto('/meetings/1/live');
  await page.click('[data-testid="start-recording-btn"]');

  // mock WebSocket으로 STT 결과 주입
  await page.evaluate(() => {
    window.__mockCableMessage__({
      type: 'transcript_final',
      data: { speaker_label: '화자1', content: '이번 분기 매출 목표에 대해 논의합니다.' }
    });
  });

  await expect(page.locator('[data-testid="live-transcript"]'))
    .toContainText('이번 분기 매출 목표에 대해 논의합니다.');
});
```

**Sidecar Stub 서버 설계:**

```python
# e2e/stubs/sidecar_stub.py
# FastAPI stub - STT 결과를 고정값으로 반환
@app.websocket("/ws/transcribe")
async def mock_transcribe(websocket: WebSocket):
    await websocket.accept()
    async for data in websocket.iter_bytes():
        # 수신된 오디오 청크마다 고정 결과 반환
        await websocket.send_json({
            "type": "final",
            "speaker_label": "화자1",
            "content": "E2E 테스트 고정 텍스트",
            "started_at_ms": 0,
            "ended_at_ms": 3000
        })

@app.post("/summarize")
async def mock_summarize():
    return {
        "key_points": ["E2E 테스트 핵심 요약"],
        "decisions": ["E2E 테스트 결정사항"],
        "action_items": [{"content": "E2E 테스트 할일", "assignee": null}]
    }
```

---

## 테스트 헬퍼 / Fixtures 설계

### `e2e/fixtures/auth.fixture.ts`

```typescript
import { test as base } from '@playwright/test';
import { setupUser, loginViaApi } from '../helpers/api';

type AuthFixtures = {
  authenticatedPage: Page;
  testUser: { email: string; password: string; token: string };
};

export const test = base.extend<AuthFixtures>({
  testUser: async ({}, use) => {
    const user = await setupUser({
      email: `e2e-${Date.now()}@test.com`,
      password: 'password123',
      name: 'E2E 테스터',
    });
    await use(user);
    await cleanupUser(user.id);
  },
  authenticatedPage: async ({ page, testUser }, use) => {
    // API로 JWT 획득 후 localStorage에 주입
    const token = await loginViaApi(testUser);
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('auth_token', t), token);
    await use(page);
  },
});
```

### `e2e/fixtures/data.fixture.ts`

```typescript
type DataFixtures = {
  testTeam: Team;
  completedMeeting: Meeting;  // 트랜스크립트 + AI 요약 포함
};

export const test = authTest.extend<DataFixtures>({
  testTeam: async ({ testUser }, use) => {
    const team = await createTeamViaApi(testUser.token, { name: 'E2E 테스트팀' });
    await use(team);
    await deleteTeamViaApi(testUser.token, team.id);
  },
  completedMeeting: async ({ testUser, testTeam }, use) => {
    const meeting = await createCompletedMeetingViaApi(testUser.token, testTeam.id);
    await use(meeting);
    // teardown: DB에서 직접 삭제 (Rails API DELETE 호출)
    await deleteMeetingViaApi(testUser.token, meeting.id);
  },
});
```

### `e2e/helpers/api.ts`

```typescript
// 백엔드 API 직접 호출 (테스트 setup/teardown용)
const API_BASE = 'http://localhost:3000/api/v1';

export async function setupUser(params) { ... }
export async function loginViaApi(user) { ... }
export async function createTeamViaApi(token, params) { ... }
export async function createCompletedMeetingViaApi(token, teamId) {
  // 1. 회의 생성
  // 2. 트랜스크립트 직접 삽입 (POST /meetings/:id/transcripts)
  // 3. AI 요약 직접 삽입 (POST /meetings/:id/summaries)
  // 4. 회의 상태 completed로 변경
}
```

---

## 테스트 환경 설정

### 백엔드 테스트 환경 (`backend/config/environments/test.rb` 추가 설정)

- `config.action_cable.disable_request_forgery_protection = true` (E2E 테스트용)
- SQLite in-memory 대신 별도 `test.sqlite3` 파일 사용 (ActionCable 공유 상태 필요)
- Sidecar 연동: `SIDECAR_URL=http://localhost:8001` (stub 서버 포트)

### 프론트엔드 테스트 환경 (`.env.test`)

```
VITE_API_BASE_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000/cable
VITE_E2E=true
```

### `e2e/global-setup.ts`

```typescript
import { chromium } from '@playwright/test';

export default async function globalSetup() {
  // 1. Rails DB 초기화 (test 환경)
  execSync('cd backend && bundle exec rails db:reset RAILS_ENV=test', { stdio: 'inherit' });

  // 2. Python Sidecar stub 서버 기동
  // (webServer 설정으로 대체 가능)
}
```

---

## CI 통합 방안 (GitHub Actions)

### `.github/workflows/e2e.yml`

```yaml
name: E2E Tests

on:
  push:
    branches: [main, dev/**]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    services:
      # SQLite는 embedded이므로 서비스 컨테이너 불필요

    steps:
      - uses: actions/checkout@v4

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
          working-directory: backend

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install frontend dependencies
        run: cd frontend && npm ci

      - name: Install Playwright browsers
        run: cd frontend && npx playwright install --with-deps chromium

      - name: Install Python stub dependencies
        run: pip install fastapi uvicorn websockets

      - name: Setup Rails test DB
        run: cd backend && bundle exec rails db:create db:migrate RAILS_ENV=test

      - name: Run E2E tests
        run: cd frontend && npx playwright test
        env:
          RAILS_ENV: test
          STT_ENGINE: stub          # stub adapter 사용
          SIDECAR_URL: http://localhost:8001

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: frontend/e2e/reports/
          retention-days: 7
```

### CI 실행 전략

| 항목 | 전략 |
|---|---|
| STT 파이프라인 | `STT_ENGINE=stub` — stub adapter가 고정 텍스트 반환 |
| Python Sidecar | `e2e/stubs/sidecar_stub.py`를 `webServer`로 기동 |
| LLM 요약 | stub 서버가 고정 요약 반환 |
| 마이크 권한 | Playwright `--use-fake-ui-for-media-stream` 플래그 |
| 병렬 실행 | `workers: 1` (SQLite 동시 쓰기 방지) |

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| `e2e/playwright.config.ts` | Playwright 전역 설정 | 신규 |
| `e2e/global-setup.ts` | DB 초기화 / 서버 기동 대기 | 신규 |
| `e2e/fixtures/index.ts` | fixture 엔트리 | 신규 |
| `e2e/fixtures/auth.fixture.ts` | 인증 fixture | 신규 |
| `e2e/fixtures/data.fixture.ts` | 테스트 데이터 fixture | 신규 |
| `e2e/helpers/api.ts` | 백엔드 API 직접 호출 헬퍼 | 신규 |
| `e2e/helpers/auth.ts` | 로그인/로그아웃 헬퍼 | 신규 |
| `e2e/helpers/mock.ts` | WebSocket / STT mock 헬퍼 | 신규 |
| `e2e/tests/auth.spec.ts` | 회원가입/로그인 E2E | 신규 |
| `e2e/tests/team.spec.ts` | 팀 생성 E2E | 신규 |
| `e2e/tests/meeting.spec.ts` | 회의 생성 E2E | 신규 |
| `e2e/tests/minutes.spec.ts` | 회의록 확인 E2E | 신규 |
| `e2e/tests/export.spec.ts` | Markdown 내보내기 E2E | 신규 |
| `e2e/tests/pipeline.spec.ts` | 실시간 파이프라인 E2E (mocking) | 신규 |
| `e2e/stubs/sidecar_stub.py` | Python Sidecar stub 서버 | 신규 |
| `frontend/package.json` | `@playwright/test` devDependency 추가 | 수정 |
| `.github/workflows/e2e.yml` | GitHub Actions E2E 워크플로우 | 신규 |
| `frontend/.env.test` | E2E용 환경 변수 | 신규 |
