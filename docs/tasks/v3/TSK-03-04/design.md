# TSK-03-04: 설정 모달 모바일 풀스크린 - 설계

## 구현 방향
- 기존 `SettingsModal.tsx`에 `useMediaQuery(BREAKPOINTS.lg)` 분기를 추가하여 모바일(<lg)에서는 풀스크린 시트, 데스크톱(>=lg)에서는 기존 중앙 모달 유지
- 선행 TSK-00-02에서 제공될 `useMediaQuery` 훅과 `BREAKPOINTS` 상수를 활용
- 탭 내비게이션에 `overflow-x-auto`를 적용하여 모바일에서 수평 스크롤 지원
- 폼 요소에 `min-h-[44px]` 클래스를 추가하여 터치 접근성 확보
- 모바일에서 닫기 버튼을 좌상단 X로 배치, 헤더 레이아웃 조건부 변경

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/hooks/useMediaQuery.ts` | CSS 미디어 쿼리를 React 상태로 동기화하는 훅 (TSK-00-02에서 생성, 선행 완료 전이면 본 Task에서 생성) | 신규 |
| `frontend/src/config.ts` (또는 별도 `constants/breakpoints.ts`) | `BREAKPOINTS` 상수 정의 (`sm`, `md`, `lg`, `xl`) | 수정 |
| `frontend/src/components/settings/SettingsModal.tsx` | 모달 컨테이너에 반응형 분기 적용 (풀스크린 vs 중앙 모달) | 수정 |
| `frontend/src/components/settings/SettingsContent.tsx` | 폼 요소에 `min-h-[44px]` 클래스 추가 | 수정 |
| `frontend/src/components/settings/UserLlmSettings.tsx` | 폼 요소에 `min-h-[44px]` 클래스 추가 | 수정 |
| `frontend/src/components/settings/UserManagementPanel.tsx` | 폼 요소에 `min-h-[44px]` 클래스 추가 | 수정 |

## 주요 구조

### 1. `useMediaQuery(query: string): boolean`
- `window.matchMedia(query)`로 미디어 쿼리 매칭
- `change` 이벤트 리스너로 실시간 업데이트
- SSR 안전 (초기값 `false`)
- 참고: TSK-00-02가 선행 완료되면 해당 구현 재사용, 아니면 본 Task에서 직접 구현

### 2. `BREAKPOINTS` 상수
```typescript
export const BREAKPOINTS = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
} as const
```

### 3. `SettingsModal` 반응형 분기 (핵심 변경)
```tsx
const isDesktop = useMediaQuery(BREAKPOINTS.lg)

// 오버레이
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
  {/* 모달 컨테이너 */}
  <div className={
    isDesktop
      ? "relative w-full max-w-3xl max-h-[90vh] rounded-xl bg-white shadow-2xl border border-gray-100 flex flex-col mx-4"
      : "fixed inset-0 w-full h-dvh bg-white flex flex-col"
  }>
    {/* 헤더: 모바일에서 좌상단 X */}
    <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
      {!isDesktop && (
        <button onClick={closeSettings}>
          <X className="w-5 h-5" />
        </button>
      )}
      <h2 className="text-lg font-semibold text-gray-900">설정</h2>
      {isDesktop && (
        <button onClick={closeSettings}>
          <X className="w-5 h-5" />
        </button>
      )}
    </div>

    {/* 탭 바: 모바일에서 수평 스크롤 */}
    <div className={`flex border-b px-6 shrink-0 ${!isDesktop ? 'overflow-x-auto' : ''}`}>
      ...
    </div>

    {/* 본문: 모바일에서 flex-1 + overflow-y-auto */}
    <div className="flex-1 overflow-y-auto p-6">
      ...
    </div>
  </div>
</div>
```

### 4. 폼 요소 터치 최적화
- `input`, `select`, `button` 요소에 `min-h-[44px]` 클래스 추가
- SettingsContent, UserLlmSettings, UserManagementPanel 내 폼 요소 대상
- Tailwind 클래스 방식으로 기존 className에 추가

### 5. 모바일 오버레이 클릭 처리
- 데스크톱: 백드롭 클릭 시 모달 닫기 (기존 동작 유지)
- 모바일: 풀스크린이므로 백드롭 클릭 불필요, X 버튼으로만 닫기

## 데이터 흐름
`useMediaQuery(BREAKPOINTS.lg)` 호출 → `matchMedia` 결과로 `isDesktop` boolean 반환 → SettingsModal의 className 및 레이아웃 조건부 렌더링 → 모바일/데스크톱 UI 분기

## 선행 조건
- **TSK-00-02**: `useMediaQuery` 훅 및 `BREAKPOINTS` 상수 (미완료 시 본 Task에서 직접 구현 후 TSK-00-02 완료 시 통합)
