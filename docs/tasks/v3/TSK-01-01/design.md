# TSK-01-01: BottomNavigation 컴포넌트 - 설계 문서

> 모바일(< lg) 환경에서 화면 하단에 고정되는 4개 항목 내비게이션 바를 구현한다.

**작성일:** 2026-04-04
**상태:** Design
**참조:** PRD 3.1 반응형 내비게이션 / TRD 2.2 BottomNavigation / WBS TSK-01-01

---

## 1. 현재 상태

### 1.1 내비게이션 구조

현재 앱은 데스크톱 전용 사이드바(`Sidebar.tsx`)만 존재한다. 사이드바에는 대시보드, 회의 목록, 검색, 설정의 4개 주요 내비게이션과 폴더 트리가 포함되어 있다.

| 항목 | 현재 (데스크톱) | 문제점 |
|------|----------------|--------|
| 내비게이션 | 좌측 사이드바 `w-60` 고정 | 모바일에서 콘텐츠 영역 부족 |
| 모바일 대안 | 없음 | 모바일에서 페이지 이동 수단 없음 |

### 1.2 라우팅 특이사항

`/settings` 경로는 독립 페이지가 아니라 `SettingsRedirect` 컴포넌트를 통해 `/meetings`로 리다이렉트하면서 `openSettings()` 를 호출하여 설정 모달을 여는 방식이다. BottomNavigation의 설정 탭은 이 패턴을 따라야 한다.

---

## 2. 설계

### 2.1 컴포넌트 개요

| 항목 | 값 |
|------|---|
| 파일 | `frontend/src/components/layout/BottomNavigation.tsx` |
| 유형 | 신규 컴포넌트 |
| 표시 조건 | `lg:` 미만에서만 표시, `lg:` 이상에서 `hidden` (CSS 클래스) |
| 위치 | `fixed bottom-0 w-full` |
| 높이 | `h-14` (56px) + safe area (`pb-safe`) |
| z-index | `z-40` (MobileSidebarOverlay의 `z-50`보다 낮아야 함) |

### 2.2 내비게이션 항목

```typescript
import { LayoutDashboard, FileText, Search, Settings } from 'lucide-react'

interface NavItem {
  icon: LucideIcon
  label: string
  path: string
}

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: '홈',   path: '/dashboard' },
  { icon: FileText,        label: '회의', path: '/meetings' },
  { icon: Search,          label: '검색', path: '/search' },
  { icon: Settings,        label: '설정', path: '/settings' },
]
```

### 2.3 활성 상태 판별

`react-router-dom`의 `useLocation()`으로 현재 경로를 읽어, 각 항목의 `path`와 비교한다.

```typescript
function isActive(itemPath: string, currentPath: string): boolean {
  if (itemPath === '/dashboard') {
    return currentPath === '/dashboard'
  }
  // /meetings, /meetings/:id, /meetings/:id/live 등 모두 매칭
  return currentPath.startsWith(itemPath)
}
```

| 경로 예시 | 활성 항목 |
|-----------|----------|
| `/dashboard` | 홈 |
| `/meetings` | 회의 |
| `/meetings/123` | 회의 |
| `/meetings/123/live` | 회의 |
| `/search` | 검색 |
| `/settings` | 설정 (리다이렉트 발생하므로 실제로는 도달하지 않음) |

### 2.4 설정 탭 특수 처리

`/settings` 경로는 `SettingsRedirect`가 즉시 `/meetings`로 리다이렉트하며 설정 모달을 연다. BottomNavigation의 설정 탭은 `useNavigate`로 `/settings`에 navigate하는 대신, 직접 `uiStore.openSettings()`를 호출하여 모달을 여는 방식으로 구현한다. 이렇게 하면 불필요한 리다이렉트와 URL 변경 없이 현재 페이지에서 설정 모달이 열린다.

```typescript
const handleNavClick = (item: NavItem) => {
  if (item.path === '/settings') {
    openSettings()
    return
  }
  navigate(item.path)
}
```

### 2.5 Props 인터페이스

```typescript
interface BottomNavigationProps {
  className?: string
}
```

`className`을 받아 외부에서 `lg:hidden` 등을 주입할 수 있도록 한다. AppLayout에서 `<BottomNavigation className="lg:hidden" />`으로 사용한다.

### 2.6 DOM 구조

```tsx
<nav
  className={cn(
    'fixed bottom-0 w-full h-14 bg-background/95 backdrop-blur-sm border-t z-40 pb-safe',
    className
  )}
  aria-label="모바일 내비게이션"
>
  <div className="flex items-center justify-around h-full max-w-lg mx-auto">
    {NAV_ITEMS.map((item) => {
      const active = isActive(item.path, location.pathname)
      return (
        <button
          key={item.path}
          onClick={() => handleNavClick(item)}
          className={cn(
            'flex flex-col items-center justify-center gap-0.5 flex-1 h-full',
            'text-muted-foreground transition-colors',
            active && 'text-primary'
          )}
          aria-current={active ? 'page' : undefined}
        >
          <item.icon className="w-5 h-5" />
          <span className="text-[10px] font-medium">{item.label}</span>
        </button>
      )
    })}
  </div>
</nav>
```

### 2.7 스타일 상세

| 속성 | 값 | 설명 |
|------|---|------|
| 배경 | `bg-background/95 backdrop-blur-sm` | 반투명 배경 + 블러로 콘텐츠 위에 부드럽게 표시 |
| 테두리 | `border-t` | 상단 구분선 |
| 아이콘 크기 | `w-5 h-5` (20px) | TRD 스펙 |
| 라벨 크기 | `text-[10px]` | TRD 스펙, 항상 표시 |
| 활성 색상 | `text-primary` | 테마 primary 색상 (라이트/다크 모두 적용) |
| 비활성 색상 | `text-muted-foreground` | 기존 테마 뮤트 색상 |
| Safe Area | `pb-safe` (TSK-00-01) | iOS 노치 디바이스 하단 홈 인디케이터 영역 패딩 |
| 레이아웃 | `flex items-center justify-around` | 4개 항목 균등 배분 |
| 최대 너비 | `max-w-lg mx-auto` | 태블릿에서 내비 항목이 과도하게 넓어지는 것 방지 |

---

## 3. 의존성

### 3.1 선행 태스크

| 태스크 | 필요 항목 | 미구현 시 영향 |
|--------|----------|---------------|
| **TSK-00-01** | `pb-safe` CSS 유틸리티 | Safe Area 패딩이 적용되지 않음. `pb-safe` 클래스가 존재하지 않으면 Tailwind가 무시하므로 빌드/렌더링 오류는 없음 |
| **TSK-00-02** | `useMediaQuery` 훅 | BottomNavigation 자체에서는 직접 사용하지 않음. 표시/숨김은 CSS(`lg:hidden`)로 처리. AppLayout에서 조건부 렌더링 시 사용할 수 있으나 CSS로 충분 |

### 3.2 사용하는 기존 모듈

| 모듈 | 용도 |
|------|------|
| `react-router-dom` | `useLocation` (현재 경로), `useNavigate` (페이지 이동) |
| `lucide-react` | 아이콘 4종 (LayoutDashboard, FileText, Search, Settings) |
| `uiStore` | `openSettings` (설정 모달 열기) |
| `tailwind-merge` (`cn`) | 조건부 클래스 병합 |

---

## 4. 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/layout/BottomNavigation.tsx` | 모바일 바텀 내비게이션 컴포넌트 | 신규 |

---

## 5. 후속 태스크 소비 지점

| 후속 태스크 | 사용 방식 |
|------------|----------|
| **TSK-01-03** (AppLayout 반응형 재구성) | `<BottomNavigation className="lg:hidden" />`을 AppLayout 하단에 배치. 메인 콘텐츠에 `pb-14 lg:pb-0` 추가하여 바텀 내비 높이만큼 여백 확보 |

---

## 6. 테스트 전략

### 6.1 단위 테스트 (`frontend/src/components/layout/BottomNavigation.test.tsx`)

vitest + @testing-library/react + MemoryRouter 환경에서 테스트한다.

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNavigation from './BottomNavigation'
import { useUiStore } from '../../stores/uiStore'

// react-router-dom useNavigate mock
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

describe('BottomNavigation', () => {
  it('4개 내비 항목이 렌더링됨', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    expect(screen.getByText('홈')).toBeInTheDocument()
    expect(screen.getByText('회의')).toBeInTheDocument()
    expect(screen.getByText('검색')).toBeInTheDocument()
    expect(screen.getByText('설정')).toBeInTheDocument()
  })

  it('현재 경로에 해당하는 항목이 활성 상태', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    const homeButton = screen.getByText('홈').closest('button')
    expect(homeButton).toHaveAttribute('aria-current', 'page')
  })

  it('/meetings/:id 경로에서 회의 탭이 활성', () => {
    render(
      <MemoryRouter initialEntries={['/meetings/123']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    const meetingsButton = screen.getByText('회의').closest('button')
    expect(meetingsButton).toHaveAttribute('aria-current', 'page')
  })

  it('홈 클릭 시 /dashboard로 navigate', () => {
    render(
      <MemoryRouter initialEntries={['/meetings']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('홈'))
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
  })

  it('설정 클릭 시 navigate 대신 openSettings 호출', () => {
    render(
      <MemoryRouter initialEntries={['/meetings']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('설정'))
    expect(mockNavigate).not.toHaveBeenCalledWith('/settings')
    expect(useUiStore.getState().settingsOpen).toBe(true)
  })

  it('nav 요소에 aria-label 존재', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    expect(screen.getByRole('navigation', { name: '모바일 내비게이션' })).toBeInTheDocument()
  })

  it('className prop이 적용됨', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation className="lg:hidden" />
      </MemoryRouter>
    )
    const nav = container.querySelector('nav')
    expect(nav?.className).toContain('lg:hidden')
  })
})
```

### 6.2 Acceptance Criteria 검증

| 기준 | 검증 방법 |
|------|----------|
| 모바일 뷰포트에서 바텀 내비 표시 | CSS `lg:hidden` 클래스로 제어. AppLayout에서 `className="lg:hidden"` 전달 (TSK-01-03에서 통합 시 확인) |
| 데스크톱 뷰포트에서 바텀 내비 숨김 | 동일하게 CSS `lg:hidden`으로 처리 |
| 탭 클릭 시 해당 페이지로 라우팅 | 단위 테스트에서 `mockNavigate` 호출 검증 |
| 현재 페이지에 해당하는 아이콘 활성화 | 단위 테스트에서 `aria-current="page"` 검증 |

---

## 7. 체크리스트

- [ ] `NavItem` 인터페이스 및 `NAV_ITEMS` 상수 정의
- [ ] `isActive` 경로 매칭 함수 구현 (`startsWith` 기반)
- [ ] 설정 탭 특수 처리 (`openSettings` 직접 호출)
- [ ] 접근성 속성 (`aria-label`, `aria-current`)
- [ ] `pb-safe` 클래스 적용 (TSK-00-01 구현 후 동작)
- [ ] `className` prop으로 외부 스타일 주입 가능
- [ ] 단위 테스트 작성 및 통과
- [ ] 기존 테스트 깨지지 않음 확인
