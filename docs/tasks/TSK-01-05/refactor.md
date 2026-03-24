# TSK-01-05 리팩토링 리포트

## 개선 사항

### 1. act() 경고 해소

**문제:** TeamPage 마운트 직후 `useEffect` 내부의 `getTeams()` 비동기 호출이 상태 업데이트를 일으키면서, 일부 테스트에서 `act(...)` 경고가 발생.

**원인:** 두 테스트에서 `renderPage()` 직후 동기적으로 assertion을 수행하여 비동기 상태 업데이트가 act 래핑 없이 처리됨.

**해결:** `waitFor(() => expect(mockGetTeams).toHaveBeenCalled())`를 추가하여 useEffect가 완전히 실행된 후 assertion 수행.

```ts
// Before
it('팀 관리 페이지가 렌더링됨', async () => {
  renderPage()
  expect(screen.getByRole('heading', { name: /팀 관리/i })).toBeInTheDocument()
})

// After
it('팀 관리 페이지가 렌더링됨', async () => {
  renderPage()
  await waitFor(() => expect(mockGetTeams).toHaveBeenCalled())
  expect(screen.getByRole('heading', { name: /팀 관리/i })).toBeInTheDocument()
})
```

### 2. 코드 품질 검토 (변경 없음으로 확인)

- `TeamPage.tsx`: 상태 분리 적절, 단일 컴포넌트 내 관리로 이 규모에서 Zustand 불필요
- `api/teams.ts`: auth.ts 패턴 일관성 유지, ky apiClient 사용
- 에러 처리: 각 API 호출에 try/catch + 에러 메시지 상태 관리

## 최종 테스트 결과

- 테스트 파일: 11개
- 테스트 케이스: 50개 전체 통과
- act() 경고: 0건
