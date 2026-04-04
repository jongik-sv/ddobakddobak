# TSK-02-01: MobileTabLayout 공용 컴포넌트 - 설계

## 구현 방향
- 회의 상세(MeetingPage)와 실시간 녹음(MeetingLivePage)에서 공용으로 사용하는 모바일 탭 레이아웃 컴포넌트를 신규 생성한다.
- `tabs` prop으로 탭 목록(id, label, icon, content)을 받고, `defaultTab`으로 초기 활성 탭을 지정한다.
- 탭 전환 시 DOM을 유지하여 스크롤/입력 상태를 보존한다 (비활성 탭: `visibility: hidden` + `position: absolute`).
- lucide-react 아이콘, Tailwind CSS 클래스 기반으로 구현하며 외부 라이브러리 추가 없이 처리한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/layout/MobileTabLayout.tsx` | 모바일 탭 레이아웃 공용 컴포넌트 | 신규 |
| `frontend/src/components/layout/MobileTabLayout.test.tsx` | 컴포넌트 유닛 테스트 | 신규 |

## 주요 구조

### MobileTabLayout 컴포넌트

```tsx
interface Tab {
  id: string
  label: string
  icon: LucideIcon
  content: ReactNode
}

interface MobileTabLayoutProps {
  tabs: Tab[]
  defaultTab?: string   // 미지정 시 tabs[0].id
}
```

**내부 구조:**

- **`MobileTabLayout`** -- 전체 레이아웃 컨테이너 (`flex flex-col h-full`)
  - **탭 바** (`h-10 sticky top-0 z-10`) -- 상단 고정, 탭 버튼 균등 배치 (`flex`)
    - 각 탭 버튼: `flex-1` 균등 너비, 아이콘(16px) + 라벨(text-xs), 세로 중앙 정렬
    - 활성 탭: `border-b-2 border-primary text-primary` 하단 인디케이터
    - 비활성 탭: `text-muted-foreground` 기본 색상
  - **콘텐츠 영역** (`flex-1 overflow-auto relative`) -- 탭 콘텐츠 렌더링 영역
    - 모든 탭 콘텐츠를 동시 마운트 (DOM 유지)
    - 활성 탭: `relative`, `visibility: visible`, 일반 레이아웃 참여
    - 비활성 탭: `absolute inset-0`, `visibility: hidden`, 레이아웃에서 제외하되 DOM/상태 유지

**상태 관리:**
- 활성 탭 ID는 컴포넌트 내부 `useState`로 관리 (`defaultTab` 또는 `tabs[0].id`로 초기화)
- 향후 TSK-01-04에서 `uiStore.meetingActiveTab`과 연동 가능하도록, `activeTab` / `onTabChange` prop을 선택적으로 받는 제어/비제어 패턴 지원

### 핵심 함수/책임

| 이름 | 책임 |
|------|------|
| `MobileTabLayout` | 탭 바 렌더링, 활성 탭 전환, 콘텐츠 영역 DOM 유지 |
| 탭 바 렌더링 로직 | `tabs.map()` -- 균등 너비 버튼, 아이콘+라벨, 활성 인디케이터 |
| 콘텐츠 패널 렌더링 | `tabs.map()` -- 모든 탭 동시 마운트, visibility/position으로 활성/비활성 전환 |

## 데이터 흐름

부모 컴포넌트가 `tabs[]` (id, label, icon, content)와 `defaultTab`을 전달 --> MobileTabLayout이 내부 상태로 활성 탭 관리 --> 탭 클릭 시 활성 탭 ID 변경 --> CSS visibility/position으로 콘텐츠 전환 (DOM 재마운트 없음)

## 선행 조건
- TSK-01-04 (uiStore 모바일 상태 확장) -- `meetingActiveTab` 상태가 추가되면 제어 모드로 연동 가능. 단, MobileTabLayout 자체는 비제어 모드로도 독립 동작하므로 TSK-01-04 완료 전에도 구현 가능.
- lucide-react -- 이미 프로젝트에 설치됨 (`FileText`, `Bot`, `StickyNote` 등 사용 중)
