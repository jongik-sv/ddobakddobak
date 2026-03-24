# TSK-00-02: React SPA 프로젝트 초기화 - 설계 문서

> 작성일: 2026-03-24
> 상태: Design Done

---

## 1. 목표

Vite 6+ + React 19+ + TypeScript 기반의 SPA 프로젝트를 `frontend/` 디렉토리에 초기화하고, 이후 개발을 위한 기반 구조를 마련한다.

---

## 2. 기술 스택 결정

| 항목 | 기술 | 버전 | 선택 근거 |
|------|------|------|----------|
| 프레임워크 | React | 19+ | PRD/TRD 요구사항 |
| 빌드 도구 | Vite | 6+ | HMR, 빠른 빌드, react-ts 템플릿 |
| 언어 | TypeScript | 5+ | 타입 안전성 |
| 상태 관리 | Zustand | 5+ | 경량, 보일러플레이트 최소 |
| 스타일링 | Tailwind CSS | 4+ | 유틸리티 퍼스트 |
| UI 컴포넌트 | shadcn/ui | latest | Tailwind 기반, copy-paste 방식 |
| 라우팅 | React Router | 7+ | SPA 라우팅 표준 |
| HTTP | ky | latest | fetch 기반 경량 클라이언트 |
| WebSocket | @rails/actioncable | latest | Rails ActionCable 클라이언트 |
| 테스트 | Vitest + @testing-library/react | latest | Vite 친화적 테스트 프레임워크 |
| 날짜 | date-fns | latest | 경량 날짜 라이브러리 |

---

## 3. 디렉토리 구조

```
frontend/
├── public/
├── src/
│   ├── api/                    # API 클라이언트 (ky 기반)
│   │   └── client.ts           # ky 인스턴스 기본 구조
│   ├── channels/               # ActionCable 채널
│   │   └── .gitkeep
│   ├── components/
│   │   ├── ui/                 # shadcn/ui 컴포넌트
│   │   └── layout/
│   │       └── AppLayout.tsx   # 앱 레이아웃 wrapper
│   ├── hooks/                  # 커스텀 훅
│   │   └── .gitkeep
│   ├── lib/                    # 유틸리티
│   │   └── utils.ts            # shadcn/ui 기본 유틸 (cn 함수)
│   ├── pages/
│   │   ├── HomePage.tsx        # / 라우트 (placeholder)
│   │   └── LoginPage.tsx       # /login 라우트 (placeholder)
│   ├── stores/
│   │   └── authStore.ts        # Zustand 인증 스토어 기본 구조
│   ├── App.tsx                 # 라우터 설정
│   └── main.tsx                # 진입점
├── index.html
├── tailwind.config.ts
├── tsconfig.json
├── vite.config.ts
└── package.json
```

---

## 4. 라우팅 설계

| 경로 | 컴포넌트 | 설명 |
|------|---------|------|
| `/` | `HomePage` | 홈 (회의 목록 placeholder) |
| `/login` | `LoginPage` | 로그인 페이지 placeholder |

React Router 7+의 `createBrowserRouter` + `RouterProvider` 패턴 사용.

---

## 5. Zustand Store 설계 (authStore)

```typescript
interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  setUser: (user: User) => void
  setToken: (token: string) => void
  logout: () => void
}
```

---

## 6. 테스트 전략

- **Vitest**: 단위 테스트 프레임워크
- **@testing-library/react**: React 컴포넌트 테스트
- **@testing-library/jest-dom**: DOM 매처 확장
- **jsdom**: 브라우저 환경 시뮬레이션

테스트 대상:
1. `authStore` - 상태 변경 로직 단위 테스트
2. `HomePage` - 컴포넌트 렌더링 테스트
3. `LoginPage` - 컴포넌트 렌더링 테스트
4. `App` - 라우팅 동작 테스트

---

## 7. 구현 순서

1. Vite + React + TypeScript 프로젝트 생성
2. 의존성 설치 (Zustand, React Router, ky, @rails/actioncable, date-fns)
3. Tailwind CSS 4+ 설정
4. shadcn/ui 초기화
5. Vitest + Testing Library 설정
6. 디렉토리 구조 생성
7. 기본 컴포넌트 및 페이지 구현
8. 라우팅 설정
9. Zustand authStore 기본 구조 구현
10. 테스트 작성 및 실행

---

## 8. Acceptance Criteria

- [x] `npm run dev` 정상 기동 (Vite dev server)
- [x] `/` 라우트 → `HomePage` 컴포넌트 렌더링
- [x] `/login` 라우트 → `LoginPage` 컴포넌트 렌더링
- [x] `npm run test` 테스트 통과
- [x] TypeScript 타입 에러 없음
