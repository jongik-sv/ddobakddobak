# TSK-02-02: MeetingPage 패널/탭 분기 - 설계

## 구현 방향
- `useMediaQuery(BREAKPOINTS.lg)`로 데스크톱/모바일을 분기한다.
- 데스크톱(>= 1024px): 기존 `PanelGroup` 3컬럼 레이아웃 유지 (변경 없음)
- 모바일(< 1024px): `MobileTabLayout`으로 전사/요약/메모 탭 전환
- 헤더 영역: 모바일에서 `text-xl` -> `text-lg`, 버튼 간격 축소
- 기존 TranscriptPanel, AiSummaryPanel, MeetingEditor 컴포넌트 그대로 재사용

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/hooks/useMediaQuery.ts` | useMediaQuery 훅 + BREAKPOINTS 상수 (TSK-00-02 선행 의존) | 신규 |
| `frontend/src/hooks/__tests__/useMediaQuery.test.ts` | useMediaQuery 유닛 테스트 | 신규 |
| `frontend/src/pages/MeetingPage.tsx` | 데스크톱/모바일 조건부 렌더링 | 수정 |
| `frontend/src/pages/__tests__/MeetingPage.responsive.test.tsx` | MeetingPage 반응형 분기 테스트 | 신규 |

## 주요 구조

### useMediaQuery 훅 (TSK-00-02 의존성 해소)

```ts
export const BREAKPOINTS = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
} as const

export function useMediaQuery(query: string): boolean
```

- SSR 안전 (초기값 `false`)
- `matchMedia` `change` 이벤트로 실시간 업데이트
- `useSyncExternalStore` 사용하여 React 18 호환

### MeetingPage 분기 로직

```
isDesktop = useMediaQuery(BREAKPOINTS.lg)

if (isDesktop) {
  // 기존 PanelGroup 3컬럼 (전사 25% | AI 요약 45% | 메모 30%)
} else {
  // MobileTabLayout (전사 | 요약 | 메모) 탭 전환
}
```

### 모바일 탭 구성

| 탭 ID | 라벨 | 아이콘 | 콘텐츠 |
|--------|------|--------|--------|
| `transcript` | 전사 | FileText | TranscriptPanel + 북마크 섹션 |
| `summary` | 요약 | Bot | AiSummaryPanel + DecisionList |
| `memo` | 메모 | StickyNote | MeetingEditor + 저장 버튼 |

### 헤더 반응형

- 페이지 제목: `text-xl` -> 모바일에서 `text-lg`
- 액션 버튼 영역: 모바일에서 `gap-2` -> `gap-1`, 텍스트 숨김 처리
- 오타 수정 섹션: 모바일에서 `flex-col` 레이아웃

## 데이터 흐름

`useMediaQuery(BREAKPOINTS.lg)` -> `isDesktop` boolean -> 조건부 렌더링
- 데스크톱: PanelGroup (react-resizable-panels) 렌더링
- 모바일: MobileTabLayout 렌더링, 기존 패널 컴포넌트를 탭 content로 전달

## 선행 조건
- TSK-02-01 (MobileTabLayout): 완료됨 (`frontend/src/components/layout/MobileTabLayout.tsx`)
- TSK-00-02 (useMediaQuery): 미완료 -> 이 태스크에서 함께 구현
