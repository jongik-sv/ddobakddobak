# TSK-07-04 E2E 테스트 검증 리포트

## 1. 테스트 파일 목록 및 커버리지

### `e2e/tests/auth.spec.ts`
- 회원가입: 유효한 정보로 가입 후 `/dashboard` 이동 확인
- 회원가입: 중복 이메일 시 `[role="alert"]` 에러 표시 확인
- 로그인: 유효한 자격증명으로 `/dashboard` 이동 확인
- 로그인: 헤더의 `span.font-medium`에 사용자 이름 표시 확인
- 로그인: 잘못된 비밀번호 시 에러 메시지 확인
- 로그인: 존재하지 않는 이메일 시 에러 메시지 확인
- 로그아웃: 로그아웃 후 보호 라우트 접근 시 `/login` 리디렉션 확인

### `e2e/tests/team.spec.ts`
- 팀 생성 후 `ul li button`에 팀 이름 표시 확인
- 빈 팀 이름으로 생성 시도 시 아무 일도 없음 확인
- 팀 선택 후 `h2`(팀 이름)와 `table` 표시 확인
- 팀원 초대 후 `table td`에 초대 이메일 표시 확인

### `e2e/tests/meeting.spec.ts`
- API로 회의 생성 후 `/meetings/:id/live` 진입 및 `h1("회의 진행")` 표시 확인
- 회의 라이브 페이지에서 시작/종료 버튼 상태 확인 (시작: enabled, 종료: disabled)
- 3영역 레이아웃 (`h2("라이브 기록")`, `[data-testid="ai-summary"]`, `[data-testid="memo-editor"]`) 확인

### `e2e/tests/minutes.spec.ts`
- 완료된 회의 페이지에서 `[data-testid="ai-summary"]` 및 `h2("AI 요약")` 표시 확인
- 라이브 기록 영역 `h2("라이브 기록")` 표시 확인
- 메모 에디터 `[data-testid="memo-editor"]` 및 `h2("메모")` 표시 확인
- 요약 API mock(null 응답) 시 "회의가 시작되면 AI가 요약을 생성합니다." 안내 메시지 확인

### `e2e/tests/export.spec.ts`
- 내보내기 API mock + 동적 버튼 삽입으로 파일 다운로드 검증 (`.md` 확장자 확인)
- 내보내기 API 직접 fetch 호출로 상태 코드 및 content-type 검증 (200/404/501 허용)

### `e2e/tests/pipeline.spec.ts`
- `setupCableMock` + `mockSidecarRoutes` 사용한 AI 요약 초기 안내 메시지 확인
- `navigator.mediaDevices.getUserMedia` mock 후 회의 시작 클릭 → `[data-testid="recording-indicator"]` 표시 확인
- Zustand store에 CustomEvent로 transcript 주입 후 `h2("라이브 기록")` 섹션 존재 확인
- AI 요약 mock 주입 흐름 확인 (초기 안내 메시지 상태 검증)

---

## 2. 타입 체크 결과

### 환경
- TypeScript: `~5.9.3` (frontend/node_modules/.bin/tsc 사용)
- @playwright/test: `^1.50.0` (frontend/node_modules에서 참조)
- tsconfig 위치: `e2e/tsconfig.json` (신규 생성)

### 결과: **통과 (exit code 0, 오류 없음)**

tsconfig.json의 `typeRoots`를 `../frontend/node_modules/@types`와 `../frontend/node_modules`로 설정하여 `@playwright/test`와 Node.js 내장 타입(`node`, `child_process`, `path`, `fs` 등)을 모두 해소하였다.

---

## 3. Selector 일치 확인

| 테스트 Selector | 실제 컴포넌트 | 일치 여부 |
|---|---|---|
| `#name`, `#email`, `#password` (signup) | `SignupPage.tsx` - `id="name"`, `id="email"`, `id="password"` | ✓ |
| `#email`, `#password` (login) | `LoginPage.tsx` - `id="email"`, `id="password"` | ✓ |
| `button[type="submit"]` | `SignupPage.tsx`, `LoginPage.tsx` | ✓ |
| `[role="alert"]` | `SignupPage.tsx`, `LoginPage.tsx`, `TeamPage.tsx` | ✓ |
| `header span.font-medium` | `Header.tsx` - `<span className="font-medium ...">` | ✓ |
| `button[aria-label="로그아웃"]` | `Header.tsx` - `aria-label="로그아웃"` | ✓ |
| `input[placeholder="팀 이름"]` | `TeamPage.tsx` - `placeholder="팀 이름"` | ✓ |
| `button:has-text("팀 생성")` | `TeamPage.tsx` - 버튼 텍스트 "팀 생성" | ✓ |
| `ul li button` | `TeamPage.tsx` - `<ul> > <li> > <button>` | ✓ |
| `h2` (팀 이름) | `TeamPage.tsx` - `<h2 className="text-xl font-semibold">` | ✓ |
| `table` | `TeamPage.tsx` - `<table className="w-full text-sm">` | ✓ |
| `input[placeholder="초대할 이메일"]` | `TeamPage.tsx` - `placeholder="초대할 이메일"` | ✓ |
| `button:has-text("초대")` | `TeamPage.tsx` - 버튼 텍스트 "초대" | ✓ |
| `h1("회의 진행")` | `MeetingLivePage.tsx` - `<h1 ...>회의 진행</h1>` | ✓ |
| `button("회의 시작")` | `MeetingLivePage.tsx` - 버튼 텍스트 "회의 시작" | ✓ |
| `button("회의 종료")` | `MeetingLivePage.tsx` - 버튼 텍스트 "회의 종료" | ✓ |
| `h2("라이브 기록")` | `MeetingLivePage.tsx` - `<h2>라이브 기록</h2>` | ✓ |
| `[data-testid="ai-summary"]` | `MeetingLivePage.tsx` - `data-testid="ai-summary"` on `<section>` | ✓ |
| `[data-testid="memo-editor"]` | `MeetingLivePage.tsx` - `data-testid="memo-editor"` on `<section>` | ✓ |
| `h2("AI 요약")` | `MeetingLivePage.tsx` - `<h2>AI 요약</h2>` | ✓ |
| `h2("메모")` | `MeetingLivePage.tsx` - `<h2>메모</h2>` | ✓ |
| `[data-testid="recording-indicator"]` | `MeetingLivePage.tsx` - `data-testid="recording-indicator"` | ✓ |
| `text=회의가 시작되면 AI가 요약을 생성합니다.` | `AiSummaryPanel.tsx` - 그 텍스트 그대로 렌더링 | ✓ |

**전체 selector 일치 — 불일치 없음**

---

## 4. 수정 내용 요약

### 신규 생성
- **`e2e/tsconfig.json`**: e2e 디렉토리에 없던 TypeScript 설정 파일 생성
  - `module: "CommonJS"`, `moduleResolution: "node"` 설정
  - `typeRoots`를 `../frontend/node_modules/@types` 및 `../frontend/node_modules`로 지정하여 `@playwright/test`, `@types/node` 참조 해소

### 수정 없음
- 모든 테스트 파일(`*.spec.ts`)과 fixture/helper 파일은 변경 없이 타입 체크 통과

---

## 5. 알려진 제한 사항

1. **실제 서버 기동 필요**: 모든 E2E 테스트는 `http://localhost:3000`(Rails) 및 `http://localhost:5173`(Vite)가 가동 중인 환경에서만 실행 가능하다. 실제 실행은 CI 환경에서 수행한다.

2. **@playwright/test 설치 위치**: `e2e/` 디렉토리 자체에는 `node_modules`가 없고, `frontend/node_modules`에 설치된 `@playwright/test`를 tsconfig의 `typeRoots`로 참조한다. `playwright test` CLI 실행 시에는 `frontend/` 디렉토리에서 실행하거나, `e2e/`에 별도 `npm install`이 필요하다.

3. **`export.spec.ts` 내보내기 버튼**: 현재 앱에 내보내기 버튼 UI가 없어 동적으로 DOM에 버튼을 삽입하는 방식을 사용한다. 실제 내보내기 UI 구현 시 `data-testid="export-markdown-btn"` selector 사용 예정.

4. **pipeline.spec.ts의 Zustand store 접근**: `transcriptStore`가 `persist` 미적용이므로 CustomEvent를 통한 간접 주입만 가능하며, LiveRecord의 기록 실시간 표시 검증은 실제 ActionCable 연동이 필요하다.

5. **WebServer 타임아웃**: `playwright.config.ts`의 `webServer.timeout`이 60초로 설정되어 있어 DB 초기화가 느린 환경에서는 타임아웃이 발생할 수 있다.
