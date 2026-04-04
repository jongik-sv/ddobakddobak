# TSK-00-02 리팩토링 리포트

## 대상 파일
- 구현: `frontend/src/hooks/useMediaQuery.ts`
- 테스트: `frontend/src/hooks/useMediaQuery.test.ts`

## 점검 항목 및 결과

| 점검 항목 | 결과 | 비고 |
|-----------|------|------|
| 불필요한 코드 | OK | 불필요한 import, 미사용 변수 없음 |
| 타입 안전성 | OK | `as const` 적용, 반환 타입 `boolean` 명시적 |
| React 훅 규칙 | OK | 의존성 배열 `[query]` 정확 |
| matchMedia 리스너 정리 | OK | cleanup 함수에서 `removeEventListener` 호출 |
| useEffect 초기 동기화 | **수정** | `setMatches(mql.matches)` 추가 (아래 상세) |
| 코드 가독성 | OK | 단순하고 명확한 구조 |

## 변경 사항

### useEffect 초기 동기화 추가

**문제**: `useState` lazy init과 `useEffect` 실행 사이에 시간 간격이 존재한다. 이 사이에 미디어 쿼리 상태가 변할 수 있으며(예: 브라우저 리사이즈, concurrent rendering 지연), `query` prop이 변경될 때도 새로운 matchMedia 결과로 즉시 동기화가 필요하다.

**수정**: useEffect 진입 시 `setMatches(mql.matches)` 호출을 추가하여 현재 matchMedia 상태를 즉시 반영하도록 했다.

```typescript
// Before
useEffect(() => {
  const mql = window.matchMedia(query)
  const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
}, [query])

// After
useEffect(() => {
  const mql = window.matchMedia(query)
  setMatches(mql.matches)  // 초기 동기화 추가
  const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
}, [query])
```

이 변경으로 인해:
1. 초기 렌더링 시 useState와 useEffect 사이의 상태 불일치 방지
2. `query` prop 변경 시 새로운 미디어 쿼리 결과 즉시 반영 (change 이벤트를 기다릴 필요 없음)

## 최종 테스트 결과

```
 Test Files  1 passed (1)
      Tests  11 passed (11)
   Duration  373ms
```

모든 11개 테스트 통과 확인.
