# TSK-00-02: useMediaQuery 훅 및 BREAKPOINTS 상수 — 설계 문서

> status: design-done
> updated: 2026-04-04

---

## 1. 개요

CSS 미디어 쿼리를 React 상태로 동기화하는 `useMediaQuery` 훅과 Tailwind 브레이크포인트에 매핑되는 `BREAKPOINTS` 상수를 제공한다. v3 모바일 반응형 작업 전반에서 JS 레벨 분기의 기반이 된다.

---

## 2. 파일 위치

| 항목 | 경로 |
|------|------|
| 훅 구현 | `frontend/src/hooks/useMediaQuery.ts` |
| 단위 테스트 | `frontend/src/hooks/useMediaQuery.test.ts` |

기존 hooks 디렉토리의 컨벤션에 따라 테스트 파일을 훅 파일과 동일 디렉토리에 `.test.ts` 확장자로 배치한다 (예: `useAudioPlayer.test.ts`, `useAudioRecorder.test.ts`).

---

## 3. 인터페이스 및 타입 정의

### 3.1 `useMediaQuery` 훅

```typescript
export function useMediaQuery(query: string): boolean
```

- **파라미터**: `query` — CSS 미디어 쿼리 문자열 (예: `"(min-width: 1024px)"`)
- **반환값**: `boolean` — 현재 뷰포트가 쿼리에 매칭되면 `true`, 아니면 `false`

### 3.2 `BREAKPOINTS` 상수

```typescript
export const BREAKPOINTS: {
  readonly sm: '(min-width: 640px)'
  readonly md: '(min-width: 768px)'
  readonly lg: '(min-width: 1024px)'
  readonly xl: '(min-width: 1280px)'
}
```

`as const` assertion을 사용하여 각 값이 리터럴 타입으로 추론되도록 한다. Tailwind CSS v4의 기본 브레이크포인트와 동일한 값을 사용한다.

---

## 4. 구현 로직

### 4.1 초기값 결정 (SSR 안전)

`useState`의 lazy initializer에서 `typeof window !== 'undefined'` 체크를 수행한다.

- **SSR / 테스트 환경 (window 없음)**: 초기값 `false`
- **브라우저 환경**: `window.matchMedia(query).matches`로 현재 매칭 여부를 즉시 반영

이 패턴은 hydration mismatch를 방지한다. 서버에서 `false`로 렌더링한 뒤 클라이언트 마운트 시 `useEffect`에서 올바른 값으로 갱신된다.

### 4.2 실시간 업데이트

`useEffect` 내에서:

1. `window.matchMedia(query)`로 `MediaQueryList` 객체 생성
2. `change` 이벤트 리스너 등록 — `MediaQueryListEvent.matches`로 상태 갱신
3. cleanup 함수에서 `removeEventListener`로 리스너 해제

**의존성 배열**: `[query]` — query 값이 변경될 때 기존 리스너를 해제하고 새 리스너를 등록한다.

### 4.3 query 변경 시 동기화

`useEffect`의 의존성 배열에 `query`가 포함되어 있으므로, 호출 측에서 다른 쿼리를 전달하면 기존 `MediaQueryList` 리스너가 정리되고 새로운 쿼리에 대한 리스너가 등록된다. 단, `useEffect` 실행 전까지는 이전 query의 `matches` 값이 유지될 수 있다. 이는 일반적인 React 훅 동작과 일치하며, 실질적으로 문제가 되지 않는다.

### 4.4 export 방식

기존 hooks의 패턴에 맞추어 named export를 사용한다:
- `export function useMediaQuery(...)` — 함수 선언 + named export
- `export const BREAKPOINTS = ...` — const 선언 + named export

default export는 사용하지 않는다 (기존 훅 컨벤션과 동일).

---

## 5. 엣지 케이스

| 케이스 | 동작 |
|--------|------|
| SSR 환경 (window 미정의) | 초기값 `false`, useEffect 미실행 |
| 빈 문자열 query | `matchMedia("")`는 브라우저에서 항상 `true` 반환 — 호출 측 책임 |
| query 동적 변경 | useEffect cleanup → 새 리스너 등록, 새 query의 matches로 갱신 |
| 컴포넌트 언마운트 | cleanup에서 리스너 해제, 메모리 누수 없음 |
| 동일 query로 여러 컴포넌트 사용 | 각 컴포넌트가 독립적 MediaQueryList 인스턴스 생성 (브라우저가 내부적으로 공유) |
| matchMedia 미지원 브라우저 | 현대 브라우저 모두 지원, 별도 폴백 불필요 (caniuse: 98%+) |

---

## 6. 테스트 전략

테스트 프레임워크: **Vitest** + **@testing-library/react** (`renderHook`)
기존 프로젝트 테스트 패턴을 따른다 (`describe`, `it`, `expect`, `vi`).

### 6.1 단위 테스트 항목

| # | 테스트 케이스 | 검증 내용 |
|---|---------------|-----------|
| 1 | 초기 렌더링 시 matchMedia.matches 값 반영 | query가 매칭되면 `true`, 아니면 `false` 반환 |
| 2 | SSR 환경 (window 미정의) 시 `false` 반환 | `typeof window === 'undefined'` 분기 동작 |
| 3 | change 이벤트 발생 시 값 업데이트 | 리스너 콜백이 `setMatches`를 호출하여 상태 갱신 |
| 4 | 언마운트 시 리스너 해제 | `removeEventListener` 호출 확인 |
| 5 | query 변경 시 리스너 재등록 | 이전 리스너 해제 + 새 리스너 등록 |
| 6 | BREAKPOINTS.lg 사용 시 정상 동작 | `useMediaQuery(BREAKPOINTS.lg)` 호출이 `"(min-width: 1024px)"` 전달 |

### 6.2 테스트 구현 방법

`window.matchMedia`를 `vi.fn()`으로 mock하여 `MediaQueryList` 객체를 시뮬레이션한다:

```typescript
// matchMedia mock 패턴
const listeners: Array<(e: MediaQueryListEvent) => void> = []

const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,  // 테스트별 초기값 설정
  media: query,
  addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
    if (event === 'change') listeners.push(handler)
  }),
  removeEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
    if (event === 'change') {
      const idx = listeners.indexOf(handler)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  }),
}))

Object.defineProperty(window, 'matchMedia', { value: mockMatchMedia })
```

change 이벤트 시뮬레이션은 저장된 handler를 직접 호출하여 수행한다:

```typescript
act(() => {
  listeners.forEach(fn => fn({ matches: true } as MediaQueryListEvent))
})
```

### 6.3 BREAKPOINTS 상수 테스트

| # | 테스트 케이스 | 검증 내용 |
|---|---------------|-----------|
| 1 | sm 값 확인 | `BREAKPOINTS.sm === '(min-width: 640px)'` |
| 2 | md 값 확인 | `BREAKPOINTS.md === '(min-width: 768px)'` |
| 3 | lg 값 확인 | `BREAKPOINTS.lg === '(min-width: 1024px)'` |
| 4 | xl 값 확인 | `BREAKPOINTS.xl === '(min-width: 1280px)'` |
| 5 | 4개 키만 존재 | `Object.keys(BREAKPOINTS).length === 4` |

---

## 7. 의존성

- **외부 라이브러리**: 없음 (React 내장 `useState`, `useEffect`만 사용)
- **내부 모듈 의존**: 없음
- **이 모듈에 의존하는 태스크**: TSK-01-03, TSK-02-02, TSK-02-03, TSK-02-04, TSK-03-02, TSK-03-04

---

## 8. 사용 예시

```typescript
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery'

function MeetingPage() {
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)

  return isDesktop ? <DesktopPanelLayout /> : <MobileTabLayout />
}
```

---

## 9. 참조

- TRD v3, 2.6절 — 전체 구현 코드
- PRD v3, 2.2절 — Tailwind Breakpoint 매핑 요구사항
- MDN Web Docs: [Window.matchMedia()](https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia)
