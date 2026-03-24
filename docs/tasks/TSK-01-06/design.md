# TSK-01-06: 앱 레이아웃 및 네비게이션 - 설계

## 구현 방향

- AppLayout.tsx를 수정하여 Sidebar + Header + main 영역을 포함하는 실제 레이아웃으로 완성
- Sidebar.tsx: /dashboard (대시보드), /teams (팀 목록) 링크 제공
- Header.tsx: useAuthStore에서 user.name 표시, logout() 버튼
- DashboardPage는 기존 자체 레이아웃 제거, AppLayout이 감쌈
- App.tsx에서 /dashboard 라우트를 AppLayout으로 감싸도록 최소 수정

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| `src/components/layout/AppLayout.tsx` | Sidebar + Header + children 레이아웃 | 수정 |
| `src/components/layout/Sidebar.tsx` | 사이드바 네비게이션 (NavLink 기반) | 신규 |
| `src/components/layout/Header.tsx` | 사용자 이름 표시 + 로그아웃 버튼 | 신규 |
| `src/App.tsx` | /dashboard 라우트를 AppLayout으로 감싸기 | 수정 |
| `src/pages/DashboardPage.tsx` | 자체 전체화면 레이아웃 제거 | 수정 |

**테스트 파일:**

| 파일 경로 | 신규/수정 |
|---|---|
| `src/components/layout/AppLayout.test.tsx` | 신규 |
| `src/components/layout/Sidebar.test.tsx` | 신규 |
| `src/components/layout/Header.test.tsx` | 신규 |

## 주요 구조

```
App.tsx
  └─ PrivateRoute
       └─ AppLayout          ← 레이아웃 wrapper
            ├─ Sidebar       ← 좌측: NavLink /dashboard, /teams
            ├─ Header        ← 상단: user.name + 로그아웃 버튼
            └─ <main>
                 └─ DashboardPage (children)
```

## 반응형 전략

- 사이드바: `hidden md:flex` → 모바일에서 숨김, md 이상에서 표시
- 전체 레이아웃: `flex flex-col md:flex-row` 방향 전환
- 헤더: 모바일/데스크톱 공통 표시

## 의존성

- useAuthStore: user (name, email), logout()
- React Router: NavLink (active 스타일링), useNavigate
- lucide-react: LayoutDashboard, Users, LogOut 아이콘

## 데이터 흐름

```
Header 로그아웃 버튼 클릭
  → useAuthStore.logout()
  → isAuthenticated = false
  → PrivateRoute가 /login으로 리다이렉트

Sidebar NavLink 클릭
  → React Router navigate
  → active 링크에 시각적 강조 (NavLink className)
```

## 선행 조건

- TSK-01-04: 인증(authStore, PrivateRoute) 완료
