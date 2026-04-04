# TRD: 또박또박 v3 — 모바일 반응형 웹

> Technical Requirements Document — PRD v3 기반 기술 설계 상세

**문서 버전:** v3.0
**작성일:** 2026-04-04
**상태:** Draft
**참조:** [PRD v3](./PRD.md), [PRD v2](../v2/PRD.md), [TRD v2](../v2/TRD.md)

---

## 1. 기술 스택 변경

### 1.1 추가 없음 (신규 의존성 0)

V3는 기존 기술 스택만으로 구현한다. 새 라이브러리를 추가하지 않는다.

| 항목 | 기존 | V3 활용 방식 |
|------|------|------------|
| Tailwind CSS v4 | ✅ 설치됨 | 반응형 유틸리티 클래스 (`sm:`, `md:`, `lg:`) 적극 활용 |
| lucide-react | ✅ 설치됨 | 바텀 내비 아이콘 |
| tailwind-merge | ✅ 설치됨 | 조건부 클래스 병합 |
| clsx | ✅ 설치됨 | 조건부 클래스 |
| react-resizable-panels | ✅ 설치됨 | 데스크톱(≥ lg)에서만 사용, 모바일에서는 렌더링하지 않음 |
| react-router-dom | ✅ 설치됨 | 라우팅 변경 없음 |
| zustand | ✅ 설치됨 | UI 상태 (활성 탭, 사이드바 오버레이 등) |

### 1.2 Tailwind v4 유틸리티 활용

Tailwind v4에서 새로 사용할 유틸리티:

```css
/* index.css에 추가 */
@utility h-dvh {
  height: 100dvh;
}
@utility pb-safe {
  padding-bottom: env(safe-area-inset-bottom);
}
@utility pt-safe {
  padding-top: env(safe-area-inset-top);
}
```

---

## 2. 컴포넌트 변경 상세

### 2.1 AppLayout 변경

**현재 구조:**
```tsx
// frontend/src/components/layout/AppLayout.tsx (현재)
<div className="flex h-screen bg-background overflow-hidden">
  {sidebarOpen ? <Sidebar /> : <CollapsedSidebar />}
  <main className="flex-1 overflow-auto flex flex-col min-h-0 min-w-0">
    {children}
  </main>
</div>
```

**변경 후:**
```tsx
// frontend/src/components/layout/AppLayout.tsx (V3)
<div className="flex flex-col lg:flex-row h-dvh bg-background overflow-hidden">
  {/* 데스크톱: 기존 사이드바 */}
  <div className="hidden lg:block">
    {sidebarOpen ? <Sidebar /> : <CollapsedSidebar />}
  </div>

  {/* 모바일: 사이드바 오버레이 */}
  {mobileMenuOpen && (
    <MobileSidebarOverlay onClose={() => setMobileMenuOpen(false)} />
  )}

  {/* 메인 콘텐츠 */}
  <main className="flex-1 overflow-auto flex flex-col min-h-0 min-w-0 pb-14 lg:pb-0">
    {children}
  </main>

  {/* 모바일: 바텀 내비게이션 */}
  <BottomNavigation className="lg:hidden" />
</div>
```

**핵심 변경 사항:**

| 변경 | 이유 |
|------|------|
| `h-screen` → `h-dvh` | iOS Safari 동적 뷰포트 대응 |
| `flex` → `flex flex-col lg:flex-row` | 모바일: 수직 (콘텐츠 + 바텀 내비), 데스크톱: 수평 (사이드바 + 메인) |
| 사이드바 `hidden lg:block` | 모바일에서 사이드바 숨김 |
| `pb-14 lg:pb-0` | 바텀 내비 높이만큼 하단 패딩 |

### 2.2 BottomNavigation (신규)

```
frontend/src/components/layout/BottomNavigation.tsx
```

```tsx
interface NavItem {
  icon: LucideIcon
  label: string
  path: string
}

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: '홈', path: '/dashboard' },
  { icon: FileText, label: '회의', path: '/meetings' },
  { icon: Search, label: '검색', path: '/search' },
  { icon: Settings, label: '설정', path: '/settings' },
]
```

**스펙:**

| 항목 | 값 |
|------|---|
| 높이 | `h-14` (56px) + safe area |
| 위치 | `fixed bottom-0` |
| 배경 | `bg-background/95 backdrop-blur-sm border-t` |
| 아이콘 크기 | `w-5 h-5` |
| 라벨 크기 | `text-[10px]` |
| 활성 상태 | `text-primary` (기존 테마 색상) |
| Safe Area | `pb-safe` (iOS 하단 홈 인디케이터) |

### 2.3 MobileSidebarOverlay (신규)

```
frontend/src/components/layout/MobileSidebarOverlay.tsx
```

기존 `Sidebar` 컴포넌트를 오버레이로 감싸는 래퍼.

```tsx
// 기존 Sidebar를 그대로 재사용
<div className="fixed inset-0 z-50 flex">
  {/* 백드롭 */}
  <div className="fixed inset-0 bg-black/50" onClick={onClose} />
  {/* 사이드바 */}
  <div className="relative w-72 max-w-[80vw] bg-sidebar animate-slide-in-left">
    <Sidebar />
  </div>
</div>
```

### 2.4 MeetingPage 탭 레이아웃

**현재 구조 (데스크톱):**
```tsx
// 현재 MeetingPage.tsx (line 495~582)
<PanelGroup orientation="horizontal">
  <Panel defaultSize={25}>  {/* 전사 */}</Panel>
  <PanelResizeHandle />
  <Panel defaultSize={45}>  {/* AI 요약 */}</Panel>
  <PanelResizeHandle />
  <Panel defaultSize={30}>  {/* 메모 */}</Panel>
</PanelGroup>
```

**변경 후:**
```tsx
// V3 — 브레이크포인트별 분기
const isDesktop = useMediaQuery('(min-width: 1024px)')  // lg breakpoint

{isDesktop ? (
  // 데스크톱: 기존 3컬럼 패널 (변경 없음)
  <PanelGroup orientation="horizontal">
    <Panel defaultSize={25}><TranscriptPanel /></Panel>
    <PanelResizeHandle />
    <Panel defaultSize={45}><AiSummaryPanel /></Panel>
    <PanelResizeHandle />
    <Panel defaultSize={30}><MeetingEditor /></Panel>
  </PanelGroup>
) : (
  // 모바일/태블릿: 탭 전환
  <MobileTabLayout
    tabs={[
      { id: 'transcript', label: '전사', icon: FileText, content: <TranscriptPanel /> },
      { id: 'summary', label: '요약', icon: Bot, content: <AiSummaryPanel /> },
      { id: 'memo', label: '메모', icon: StickyNote, content: <MeetingEditor /> },
    ]}
  />
)}
```

### 2.5 MobileTabLayout (신규)

```
frontend/src/components/layout/MobileTabLayout.tsx
```

회의 상세/라이브 페이지에서 공유하는 모바일 탭 컴포넌트.

```tsx
interface Tab {
  id: string
  label: string
  icon: LucideIcon
  content: ReactNode
}

interface MobileTabLayoutProps {
  tabs: Tab[]
  defaultTab?: string
}
```

**스펙:**

| 항목 | 값 |
|------|---|
| 탭 바 높이 | `h-10` (40px) |
| 탭 바 위치 | 상단 고정 (sticky) |
| 탭 활성 표시 | 하단 2px 인디케이터 (`border-b-2 border-primary`) |
| 콘텐츠 영역 | `flex-1 overflow-auto` |
| 스와이프 | 선택사항 — 기본은 탭 클릭 전환만 |
| 상태 유지 | 탭 전환 시 콘텐츠 DOM 유지 (`display: none`으로 숨김) |

### 2.6 useMediaQuery 훅 (신규)

```
frontend/src/hooks/useMediaQuery.ts
```

CSS 미디어 쿼리를 React 상태로 동기화하는 훅.

```typescript
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}
```

**사전정의 브레이크포인트 상수:**

```typescript
export const BREAKPOINTS = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
} as const

// 사용 예시
const isDesktop = useMediaQuery(BREAKPOINTS.lg)
```

### 2.7 MeetingLivePage 탭 레이아웃

MeetingPage와 동일한 패턴 적용. 추가로 녹음 컨트롤 영역이 모바일에서 축소됨.

**현재 녹음 컨트롤 (데스크톱):**
```
[← 뒤로] [제목] [STT엔진▾] [시스템오디오🔊] [마이크🎤] [⏸일시정지] [⏹종료] [공유] [타이머] [설정⚙]
```

**모바일 녹음 컨트롤:**
```
[← 뒤로] [제목 (truncate)]         [🔴 01:23:45]
                          [⏸] [⏹] [⋯ 더보기]
```

- 핵심 버튼만 표시: 일시정지, 종료
- 나머지(STT 엔진, 시스템 오디오, 마이크 선택, 공유, 설정)는 `⋯` 더보기 → 바텀 시트
- 녹음 시간은 항상 표시

### 2.8 미니 오디오 플레이어 (신규)

```
frontend/src/components/meeting/MiniAudioPlayer.tsx
```

MeetingPage 모바일에서 하단에 고정되는 미니 플레이어.

```
┌─────────────────────────────────────┐
│  ▶ 01:23 ════════════════── 45:00  │
└─────────────────────────────────────┘
```

| 항목 | 값 |
|------|---|
| 높이 | `h-12` (48px) |
| 위치 | 콘텐츠 하단 고정 (바텀 내비 위) |
| 컨트롤 | 재생/일시정지 + 프로그레스 바 + 현재시간/총시간 |
| 확장 | 탭 시 기존 `AudioPlayer` 풀 사이즈로 확장 (모달/시트) |
| wavesurfer.js | 미니 모드에서는 사용하지 않음 (경량 프로그레스 바만) |

### 2.9 MeetingsPage 모바일 툴바

**현재 툴바:**
```
[검색 입력]  [상태 필터▾] [날짜 필터▾] [폴더 필터▾] [정렬▾] [보기 전환] [+ 새 회의 ▾]
```

**모바일 변경:**
```tsx
// 모바일 (< lg)
<div className="flex items-center gap-2 px-4 py-2">
  <SearchToggle />           {/* 아이콘 → 탭 시 풀 너비 검색 */}
  <FilterButton />           {/* 필터 아이콘 → 탭 시 바텀 시트 */}
  <SortDropdown />           {/* 드롭다운 유지 */}
</div>

// FAB (Floating Action Button)
<button className="fixed right-4 bottom-20 lg:hidden ...">
  <Plus />
</button>
```

### 2.10 설정 모달 → 풀스크린 시트

```tsx
// 모바일: 풀스크린
// 데스크톱: 기존 중앙 모달
const isDesktop = useMediaQuery(BREAKPOINTS.lg)

<Dialog>
  <DialogContent className={isDesktop
    ? "max-w-3xl"                                           // 데스크톱: 기존
    : "fixed inset-0 max-w-none rounded-none h-dvh"        // 모바일: 풀스크린
  }>
    ...
  </DialogContent>
</Dialog>
```

---

## 3. 신규 파일 목록

| 파일 | 유형 | 설명 |
|------|------|------|
| `components/layout/BottomNavigation.tsx` | 신규 | 모바일 바텀 내비게이션 |
| `components/layout/MobileSidebarOverlay.tsx` | 신규 | 사이드바 오버레이 래퍼 |
| `components/layout/MobileTabLayout.tsx` | 신규 | 탭 전환 레이아웃 (회의 상세/라이브 공용) |
| `components/meeting/MiniAudioPlayer.tsx` | 신규 | 모바일 미니 오디오 플레이어 |
| `components/meeting/MobileRecordControls.tsx` | 신규 | 모바일 녹음 컨트롤 축소 버전 |
| `components/ui/BottomSheet.tsx` | 신규 | 바텀 시트 (필터, 설정 등) |
| `hooks/useMediaQuery.ts` | 신규 | 미디어 쿼리 훅 |

## 4. 수정 파일 목록

| 파일 | 수정 내용 |
|------|---------|
| `index.html` | viewport meta에 `viewport-fit=cover` 추가 |
| `src/index.css` | `h-dvh`, `pb-safe`, `pt-safe`, `animate-slide-in-left` 유틸리티 추가 |
| `components/layout/AppLayout.tsx` | `h-dvh`, 사이드바 조건부 렌더링, 바텀 내비 추가 |
| `pages/MeetingPage.tsx` | `useMediaQuery`로 패널/탭 분기 |
| `pages/MeetingLivePage.tsx` | `useMediaQuery`로 패널/탭 분기, 녹음 컨트롤 모바일 축소 |
| `pages/MeetingsPage.tsx` | 툴바 모바일 대응, FAB 추가 |
| `pages/DashboardPage.tsx` | 패딩 반응형 (`p-4 md:p-8`) |
| `stores/uiStore.ts` | `mobileMenuOpen`, `activeTab` 상태 추가 |
| `components/meeting/AudioPlayer.tsx` | 모바일에서 미니 플레이어 분기 |

---

## 5. CSS/스타일 변경

### 5.1 index.html 변경

```html
<!-- 현재 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0" />

<!-- V3 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

### 5.2 index.css 추가

```css
/* Safe Area */
@utility h-dvh {
  height: 100dvh;
}
@utility pb-safe {
  padding-bottom: env(safe-area-inset-bottom);
}
@utility pt-safe {
  padding-top: env(safe-area-inset-top);
}

/* 모바일 사이드바 애니메이션 */
@keyframes slide-in-left {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}
@utility animate-slide-in-left {
  animation: slide-in-left 200ms ease-out;
}

/* 호버 가능 디바이스에서만 호버 스타일 */
@media (hover: hover) {
  .hover-only\:opacity-100:hover {
    opacity: 1;
  }
}

/* 스크롤 바운스 방지 (전체 앱) */
html, body {
  overscroll-behavior: none;
}

/* iOS 소프트 키보드 대응 */
@supports (height: 100dvh) {
  .h-dvh {
    height: 100dvh;
  }
}
```

### 5.3 전역 반응형 패턴

기존 코드에서 자주 사용되는 패턴을 일괄 변환:

| 현재 | V3 |
|------|-----|
| `h-screen` | `h-dvh` |
| `p-8` (페이지 전체 패딩) | `p-4 md:p-6 lg:p-8` |
| `text-2xl` (페이지 제목) | `text-xl md:text-2xl` |
| `gap-6` (카드 그리드) | `gap-3 md:gap-6` |
| `max-w-3xl` (모달) | `max-w-full lg:max-w-3xl` (모바일 풀스크린) |

---

## 6. 상태 관리 변경

### 6.1 uiStore 확장

```typescript
// stores/uiStore.ts 추가 상태

interface UiState {
  // 기존
  sidebarOpen: boolean
  toggleSidebar: () => void

  // V3 추가
  mobileMenuOpen: boolean        // 모바일 사이드바 오버레이
  setMobileMenuOpen: (open: boolean) => void

  meetingActiveTab: string       // 회의 상세 활성 탭 ('transcript' | 'summary' | 'memo')
  setMeetingActiveTab: (tab: string) => void

  liveActiveTab: string          // 라이브 활성 탭
  setLiveActiveTab: (tab: string) => void
}
```

---

## 7. 테스트 전략

### 7.1 반응형 E2E 테스트

Playwright에 모바일 뷰포트 테스트 추가:

```typescript
// e2e/playwright.config.ts 에 프로젝트 추가
{
  name: 'mobile-chrome',
  use: {
    ...devices['Pixel 7'],
  },
},
{
  name: 'mobile-safari',
  use: {
    ...devices['iPhone 14'],
  },
},
{
  name: 'tablet',
  use: {
    ...devices['iPad (gen 7)'],
  },
},
```

### 7.2 테스트 시나리오

| 시나리오 | 뷰포트 | 검증 항목 |
|---------|--------|---------|
| 회의 목록 → 상세 이동 | 모바일 | 바텀 내비 표시, 카드 1컬럼, 탭 전환 작동 |
| 회의 상세 탭 전환 | 모바일 | 전사/요약/메모 탭 클릭 시 콘텐츠 전환 |
| 오디오 재생 | 모바일 | 미니 플레이어 표시, 재생 가능 |
| 사이드바 오버레이 | 모바일 | 메뉴 버튼 탭 → 오버레이 열림 → 외부 탭 → 닫힘 |
| 기존 데스크톱 회귀 | 1280×800 | 3컬럼 패널 표시, 사이드바 고정, 바텀 내비 숨김 |
| 설정 모달 | 모바일 | 풀스크린 표시 |

### 7.3 단위 테스트

| 컴포넌트 | 테스트 항목 |
|---------|-----------|
| `useMediaQuery` | SSR 안전성, resize 이벤트 반응 |
| `BottomNavigation` | 현재 경로 활성 표시, 라우팅 |
| `MobileTabLayout` | 탭 전환, 상태 유지 |
| `MobileSidebarOverlay` | 백드롭 클릭 닫기 |

---

## 8. 성능 고려사항

### 8.1 번들 크기

- 신규 의존성 0 → 번들 크기 증가 최소 (CSS 유틸리티 + 작은 컴포넌트)
- `react-resizable-panels`: 모바일에서도 import되지만, 렌더링하지 않으므로 런타임 영향 없음
- 향후 최적화: `React.lazy`로 모바일/데스크톱 레이아웃 코드 스플릿 가능

### 8.2 렌더링

- `useMediaQuery`는 `matchMedia` API 사용 → 리렌더링은 뷰포트 변경 시에만 발생
- 탭 전환 시 콘텐츠 DOM 유지 (`display: none`) → 재마운트 없음
- `MobileTabLayout`의 비활성 탭은 `visibility: hidden` + `position: absolute`로 레이아웃 영향 최소화

### 8.3 모바일 네트워크

- API 변경 없음 → 기존 데이터 요청량 동일
- 이미지/오디오 파일: 기존과 동일 (모바일 전용 압축은 V4에서 검토)

---

## 9. 마이그레이션 전략

### 9.1 점진적 적용

V3는 **기존 코드를 수정**하는 방식으로, 별도 브랜치에서 진행한다.

```
main
  └── dev/v3-responsive
       ├── WP-01: 기반 + 내비게이션
       ├── WP-02: 회의 페이지 모바일
       ├── WP-03: 목록/대시보드/설정
       └── WP-04: 터치 최적화 + E2E
```

### 9.2 롤백 전략

- 각 WP 완료 시 main에 머지 (WP 단위 PR)
- 모바일 레이아웃은 `useMediaQuery`로 분기하므로, 데스크톱에 영향 없음
- 문제 발생 시 `useMediaQuery` 훅의 반환값을 `true`로 고정하면 데스크톱 모드로 폴백

---

## 10. 디렉토리 구조 변경

```
frontend/src/
├── components/
│   ├── layout/
│   │   ├── AppLayout.tsx              ← 수정
│   │   ├── Sidebar.tsx                  (변경 없음)
│   │   ├── BottomNavigation.tsx        ← 신규
│   │   ├── MobileSidebarOverlay.tsx    ← 신규
│   │   └── MobileTabLayout.tsx        ← 신규
│   ├── meeting/
│   │   ├── AudioPlayer.tsx            ← 수정 (미니 모드 분기)
│   │   ├── MiniAudioPlayer.tsx        ← 신규
│   │   ├── MobileRecordControls.tsx   ← 신규
│   │   └── ... (기존 변경 없음)
│   └── ui/
│       ├── BottomSheet.tsx            ← 신규
│       └── ... (기존 변경 없음)
├── hooks/
│   ├── useMediaQuery.ts               ← 신규
│   └── ... (기존 변경 없음)
├── pages/
│   ├── MeetingPage.tsx                ← 수정 (패널/탭 분기)
│   ├── MeetingLivePage.tsx            ← 수정 (패널/탭 분기)
│   ├── MeetingsPage.tsx               ← 수정 (툴바 모바일)
│   ├── DashboardPage.tsx              ← 수정 (패딩)
│   └── ... (기존 변경 없음)
├── stores/
│   └── uiStore.ts                     ← 수정 (모바일 상태 추가)
├── index.css                          ← 수정 (유틸리티 추가)
└── index.html                         ← 수정 (viewport)
```
