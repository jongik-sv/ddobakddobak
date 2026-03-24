# TSK-00-02 리팩토링 리포트

> 작성일: 2026-03-24

---

## 리팩토링 항목

### 1. 테스트 코드 개선

**변경 사항:**
- `LoginPage.test.tsx`: `getByText(/로그인/i)` → `getByRole('heading', { name: /로그인/i })`
  - "로그인" 텍스트가 h1과 button 양쪽에 존재하여 발생하는 모호성 제거
  - 시맨틱 역할(role) 기반 쿼리가 더 견고하고 접근성 친화적
- `App.test.tsx`: 동일한 이유로 동일 수정 적용

**이유:** Testing Library 권장 방식인 접근성 역할 기반 쿼리 사용

---

### 2. localStorage mock 분리 (`src/test/setup.ts`)

**변경 사항:**
- Zustand `persist` 미들웨어가 테스트 환경(jsdom)에서 localStorage에 접근 시 발생하는 오류 수정
- `setup.ts`에서 localStorage mock을 전역으로 설정

**이유:** jsdom의 localStorage 구현이 완전하지 않아 `setItem` 호출 시 오류 발생

---

### 3. 디렉토리 구조 보강

**추가된 파일:**

| 파일 | 역할 |
|------|------|
| `src/components/layout/AppLayout.tsx` | 앱 레이아웃 wrapper, Sidebar/Header 추가 준비 |
| `src/channels/transcription.ts` | ActionCable STT 채널 타입 정의 (향후 구현 준비) |
| `src/hooks/useAuth.ts` | authStore 접근 훅 (컴포넌트에서 직접 store 접근 대신 훅 사용 권장) |

**이유:** TRD 디렉토리 구조 요구사항 준수 및 향후 개발을 위한 구조 준비

---

### 4. 코드 품질

- TypeScript `strict` 모드 적용 확인 (`tsconfig.app.json`)
- 모든 컴포넌트에 타입 정의 완비
- `@/` 경로 alias 설정으로 상대 경로 복잡도 감소

---

## 리팩토링 후 테스트 결과

```
Test Files  4 passed (4)
      Tests  11 passed (11)
   Duration  476ms
```

모든 테스트 통과 확인.

---

## 최종 구조

```
frontend/src/
├── api/
│   └── client.ts              # ky 기반 API 클라이언트
├── channels/
│   └── transcription.ts       # ActionCable 채널 타입
├── components/
│   ├── layout/
│   │   └── AppLayout.tsx      # 앱 레이아웃
│   └── ui/                    # shadcn/ui 컴포넌트 (향후 추가)
├── hooks/
│   └── useAuth.ts             # 인증 훅
├── lib/
│   └── utils.ts               # cn() 유틸리티 (shadcn/ui)
├── pages/
│   ├── HomePage.tsx           # / 라우트
│   └── LoginPage.tsx          # /login 라우트
├── stores/
│   └── authStore.ts           # Zustand 인증 스토어
├── test/
│   └── setup.ts               # 테스트 설정
├── App.tsx                    # 라우터
└── main.tsx                   # 진입점
```
