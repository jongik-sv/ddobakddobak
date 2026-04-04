# TSK-01-03: AppLayout 반응형 재구성 - 설계

## 구현 방향
- 기존 `AppLayout.tsx`를 수정하여 데스크톱/모바일 반응형 레이아웃을 구현한다.
- 데스크톱(>= lg)에서는 기존 사이드바 레이아웃을 유지하고, 모바일(< lg)에서는 사이드바를 숨기고 BottomNavigation을 표시한다.
- 루트 컨테이너의 `h-screen`을 `h-dvh`로 변경하여 모바일 동적 뷰포트에 대응한다.
- 순수 CSS(Tailwind 반응형 클래스)로 데스크톱/모바일 분기를 처리하고, 사이드바 오버레이 토글만 `mobileMenuOpen` 상태(uiStore)를 사용한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/layout/AppLayout.tsx` | 반응형 레이아웃 셸 (사이드바/바텀내비 분기) | 수정 |

## 주요 구조

### AppLayout 컴포넌트 (수정)

**레이아웃 구조 변경:**

```
// Before
<div className="flex h-screen bg-background overflow-hidden">
  {sidebarOpen ? <Sidebar /> : <CollapsedBar />}
  <main>...</main>
</div>

// After
<div className="flex flex-col lg:flex-row h-dvh bg-background overflow-hidden">
  {/* 데스크톱 사이드바 영역 - 모바일에서 hidden */}
  <div className="hidden lg:block">
    {sidebarOpen ? <Sidebar /> : <CollapsedSidebarButton />}
  </div>

  {/* 모바일 헤더 - 데스크톱에서 hidden */}
  <header className="flex lg:hidden items-center h-12 px-4 border-b ...">
    <button onClick={toggleMobileMenu}><Menu /></button>
    <span>또박또박</span>
  </header>

  {/* 메인 콘텐츠 */}
  <main className="flex-1 overflow-auto ... pb-14 lg:pb-0">
    {children}
  </main>

  {/* 모바일 사이드바 오버레이 */}
  {mobileMenuOpen && <MobileSidebarOverlay onClose={closeMobileMenu} />}

  {/* 모바일 바텀 내비 - 데스크톱에서 hidden */}
  <BottomNavigation className="lg:hidden" />
</div>
```

**추가되는 import:**
- `Menu` (lucide-react) - 모바일 헤더의 햄버거 메뉴 아이콘
- `BottomNavigation` - TSK-01-01에서 구현 완료
- `MobileSidebarOverlay` - TSK-01-02에서 구현 완료

**사용하는 상태:**
- `sidebarOpen` / `toggleSidebar` - 기존 데스크톱 사이드바 토글 (변경 없음)
- `mobileMenuOpen` / `setMobileMenuOpen` - 모바일 사이드바 오버레이 토글 (TSK-01-04에서 추가 완료)

**핵심 CSS 분기 전략:**

| 영역 | 모바일 (< lg) | 데스크톱 (>= lg) |
|------|--------------|----------------|
| 루트 컨테이너 | `flex flex-col h-dvh` | `lg:flex-row` 추가 |
| 데스크톱 사이드바 | `hidden` | `lg:block` |
| 모바일 헤더 | 표시 (h-12) | `lg:hidden` |
| 메인 콘텐츠 | `pb-14` (바텀내비 높이) | `lg:pb-0` |
| BottomNavigation | 표시 (fixed bottom-0) | `lg:hidden` |
| MobileSidebarOverlay | 조건부 렌더링 (mobileMenuOpen) | 렌더링 안 됨 (상태가 항상 false) |

## 데이터 흐름
1. 사용자 뷰포트 크기 -> Tailwind CSS 반응형 클래스가 `hidden`/`block` 분기 처리
2. 모바일 메뉴 버튼 클릭 -> `uiStore.setMobileMenuOpen(true)` -> `MobileSidebarOverlay` 렌더링 -> 백드롭 클릭/Escape -> `setMobileMenuOpen(false)` -> 오버레이 언마운트

## 선행 조건
- TSK-01-01: BottomNavigation 컴포넌트 (완료, status: [xx])
- TSK-01-02: MobileSidebarOverlay 컴포넌트 (완료, status: [xx])
- TSK-01-04: uiStore 모바일 상태 확장 (`mobileMenuOpen`) (완료, status: [x])
- TSK-00-01: CSS 유틸리티 (`h-dvh`, `pb-safe`) (WP-00, 선행 필요하나 Tailwind v4 내장 유틸리티로 대체 가능)
