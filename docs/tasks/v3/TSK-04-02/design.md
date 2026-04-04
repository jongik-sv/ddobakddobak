# TSK-04-02: Playwright 모바일 뷰포트 E2E 테스트 - 설계

> status: design-done
> updated: 2026-04-04

---

## 구현 방향

- 기존 `e2e/playwright.config.ts`에 모바일/태블릿 뷰포트 프로젝트(Pixel 7, iPhone 14, iPad)를 추가하여, 반응형 UI가 각 디바이스에서 정상 동작하는지 E2E 테스트로 검증한다.
- 기존 데스크톱 프로젝트(`chromium`, 1280x800)는 그대로 유지하여 회귀를 방지한다.
- 모바일 전용 테스트는 `e2e/tests/mobile/` 디렉토리에 분리하여, 데스크톱 테스트(`e2e/tests/`)와 독립적으로 관리한다.
- 모바일 테스트는 기존 fixture/helper 인프라(`auth.fixture`, `data.fixture`, `helpers/`)를 그대로 재사용한다.

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `e2e/playwright.config.ts` | 모바일/태블릿 프로젝트 3개 추가, testDir을 프로젝트별로 분기 | 수정 |
| `e2e/tests/mobile/meeting-list-detail.spec.ts` | 회의 목록 -> 상세 이동 (모바일) 시나리오 | 신규 |
| `e2e/tests/mobile/meeting-tabs.spec.ts` | 회의 상세 탭 전환 (모바일) 시나리오 | 신규 |
| `e2e/tests/mobile/sidebar-overlay.spec.ts` | 사이드바 오버레이 (모바일) 시나리오 | 신규 |
| `e2e/tests/mobile/settings-modal.spec.ts` | 설정 모달 풀스크린 (모바일) 시나리오 | 신규 |
| `e2e/helpers/selectors.ts` | 모바일 UI 요소 selector 추가 (바텀 내비, 탭 바, 오버레이 등) | 수정 |

---

## 주요 구조

### 1. `playwright.config.ts` 프로젝트 구성

```typescript
// 기존 데스크톱 프로젝트 유지 + 모바일/태블릿 3개 추가
projects: [
  // --- 데스크톱 (기존) ---
  {
    name: 'desktop-chromium',
    use: { ...devices['Desktop Chrome'] },
    testDir: './tests',           // 기존 tests/ 전체
    testIgnore: ['**/mobile/**'], // mobile/ 디렉토리 제외
  },

  // --- 모바일: Android ---
  {
    name: 'mobile-chrome',
    use: { ...devices['Pixel 7'] },
    testDir: './tests/mobile',    // mobile/ 전용
  },

  // --- 모바일: iOS ---
  {
    name: 'mobile-safari',
    use: { ...devices['iPhone 14'] },
    testDir: './tests/mobile',
  },

  // --- 태블릿: iPad ---
  {
    name: 'tablet-safari',
    use: { ...devices['iPad (gen 7)'] },
    testDir: './tests/mobile',
  },
]
```

**핵심 결정:**
- 기존 프로젝트 이름을 `chromium` -> `desktop-chromium`으로 변경하여 의도를 명확히 한다.
- 데스크톱 프로젝트에 `testIgnore: ['**/mobile/**']`를 추가하여 모바일 전용 테스트가 데스크톱에서 실행되지 않도록 한다.
- 모바일/태블릿 프로젝트는 `testDir: './tests/mobile'`로 모바일 테스트만 실행한다.

### 2. `Selectors` 확장 (`e2e/helpers/selectors.ts`)

```typescript
export const Selectors = {
  // ... 기존 selector 유지 ...

  /** 모바일 내비게이션 */
  mobile: {
    /** 바텀 내비게이션 바 */
    bottomNav: '[data-testid="bottom-navigation"]',
    /** 바텀 내비 항목 (role="link") */
    bottomNavItem: (label: string) => `[data-testid="bottom-navigation"] a:has-text("${label}")`,
    /** 사이드바 오버레이 백드롭 */
    sidebarOverlayBackdrop: '[data-testid="sidebar-overlay-backdrop"]',
    /** 사이드바 오버레이 컨테이너 */
    sidebarOverlay: '[data-testid="sidebar-overlay"]',
    /** 모바일 메뉴 열기 버튼 (햄버거) */
    menuButton: 'button[aria-label="메뉴"]',
  },

  /** 모바일 탭 레이아웃 (MobileTabLayout) */
  mobileTabs: {
    /** 탭 바 컨테이너 */
    tabBar: '[data-testid="mobile-tab-bar"]',
    /** 개별 탭 버튼 */
    tab: (label: string) => `[data-testid="mobile-tab-bar"] button:has-text("${label}")`,
    /** 활성 탭 (aria-selected="true") */
    activeTab: '[data-testid="mobile-tab-bar"] button[aria-selected="true"]',
    /** 탭 콘텐츠 영역 */
    tabContent: '[data-testid="mobile-tab-content"]',
  },

  /** 설정 모달 */
  settings: {
    modal: '[role="dialog"]',
    /** 설정 모달 풀스크린 확인 (모바일) */
    fullscreenModal: '[role="dialog"][data-fullscreen="true"]',
  },
} as const;
```

### 3. 모바일 테스트 시나리오 파일

#### 3-1. `meeting-list-detail.spec.ts` — 회의 목록 -> 상세 이동

- 바텀 내비게이션이 화면에 표시되는지 확인
- "회의" 바텀 내비 탭으로 회의 목록 페이지 이동
- 회의 카드가 1컬럼으로 렌더링되는지 확인 (카드 너비 == 뷰포트 너비 근사)
- 회의 카드 클릭 -> 회의 상세 페이지 진입 확인
- 상세 페이지에서 모바일 탭 바(전사/요약/메모)가 표시되는지 확인

#### 3-2. `meeting-tabs.spec.ts` — 회의 상세 탭 전환

- 회의 상세 페이지에서 기본 탭(전사) 콘텐츠가 보이는지 확인
- "요약" 탭 클릭 -> AI 요약 패널 콘텐츠 표시, 전사 패널 숨김 확인
- "메모" 탭 클릭 -> 메모 에디터 표시, 다른 패널 숨김 확인
- 탭 전환 후 다시 원래 탭으로 돌아왔을 때 콘텐츠가 유지되는지 확인
- `aria-selected` 속성으로 활성 탭 상태 검증

#### 3-3. `sidebar-overlay.spec.ts` — 사이드바 오버레이

- 데스크톱 사이드바(`[data-testid="sidebar"]`)가 모바일에서 숨겨져 있는지 확인
- 메뉴 버튼(햄버거) 클릭 -> 사이드바 오버레이 열림 확인
- 오버레이 내 사이드바 콘텐츠(폴더, 태그) 표시 확인
- 백드롭(오버레이 외부) 클릭 -> 오버레이 닫힘 확인
- 오버레이가 닫힌 후 메인 콘텐츠가 정상 노출되는지 확인

#### 3-4. `settings-modal.spec.ts` — 설정 모달 풀스크린

- 설정 버튼(바텀 내비의 "설정" 또는 메뉴 내 설정) 클릭
- 모달이 풀스크린으로 표시되는지 확인 (뷰포트 전체를 차지)
- 모달 내 설정 탭들이 정상 표시되는지 확인
- 모달 닫기 동작 확인

### 4. 테스트 기반 인프라 재사용

모든 모바일 테스트는 기존 fixture를 그대로 import하여 사용한다:

```typescript
import { test } from '../../fixtures/data.fixture';
import { refreshAuthForPage } from '../../helpers/auth';
import { createMeetingViaApi } from '../../helpers/api';
import { Selectors } from '../../helpers/selectors';
```

- `authenticatedPage`: 인증된 Page 객체 (Playwright가 프로젝트 설정에 따라 모바일 뷰포트 자동 적용)
- `testUser`, `testTeam`: API를 통한 테스트 데이터 생성 (뷰포트와 무관)
- `createMeetingViaApi`, `createCompletedMeetingViaApi`: 회의 데이터 사전 생성

---

## 데이터 흐름

Playwright 프로젝트 설정(devices) -> 모바일 뷰포트/UA로 브라우저 실행 -> 기존 API fixture로 테스트 데이터 생성 -> 모바일 뷰포트에서 반응형 UI 요소 렌더링 검증 -> 테스트 결과 리포트

---

## 선행 조건

| 항목 | 설명 |
|------|------|
| **TSK-01-03** | AppLayout 반응형 재구성 완료 (바텀 내비, 사이드바 오버레이가 구현되어야 테스트 가능) |
| **TSK-02-02** | MeetingPage 패널/탭 분기 완료 (모바일에서 탭 UI가 렌더링되어야 테스트 가능) |
| **TSK-02-04** | MeetingLivePage 패널/탭 분기 완료 (라이브 페이지의 모바일 탭 전환 테스트) |
| **data-testid 속성** | 선행 Task에서 모바일 UI 컴포넌트에 `data-testid` 속성이 추가되어야 selector가 동작함 |
| **Playwright** | 기존 설치됨 (`@playwright/test`), 추가 설치 불필요 |

---

## 실행 전략

### CLI 실행 방법

```bash
# 전체 테스트 (데스크톱 + 모바일 + 태블릿)
npx playwright test

# 데스크톱만 실행
npx playwright test --project=desktop-chromium

# 모바일만 실행
npx playwright test --project=mobile-chrome --project=mobile-safari

# 태블릿만 실행
npx playwright test --project=tablet-safari

# 특정 시나리오만 실행
npx playwright test --project=mobile-chrome tests/mobile/meeting-tabs.spec.ts
```

### CI 파이프라인 고려

- CI에서 전체 프로젝트를 실행하면 4배 시간 증가 (데스크톱 1 + 모바일 2 + 태블릿 1)
- 권장: `workers: process.env.CI ? 2 : 1`로 CI에서 병렬 실행
- 또는 `--shard` 옵션으로 프로젝트별 분산

### 디바이스별 뷰포트 참고

| 프로젝트 | 디바이스 | 뷰포트 | DPR | 모바일 UA |
|---------|---------|--------|-----|----------|
| `desktop-chromium` | Desktop Chrome | 1280x720 | 1 | No |
| `mobile-chrome` | Pixel 7 | 393x851 | 2.75 | Yes |
| `mobile-safari` | iPhone 14 | 390x844 | 3 | Yes |
| `tablet-safari` | iPad (gen 7) | 810x1080 | 2 | Yes |

- Pixel 7 / iPhone 14: < 640px -> 모바일 breakpoint (1컬럼, 바텀 내비)
- iPad (gen 7): 810px -> sm~md 범위 (2컬럼, 사이드바 오버레이 가능)
- Desktop Chrome: 1280px -> >= lg breakpoint (기존 데스크톱 레이아웃)
