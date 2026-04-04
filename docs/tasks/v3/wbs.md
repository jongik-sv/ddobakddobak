# WBS - 또박또박 v3 (모바일 반응형 웹)

> version: 3.0
> depth: 3
> updated: 2026-04-04

---

## WP-00: 프로젝트 기반 설정
- status: planned
- priority: critical
- schedule: 2026-04-07 ~ 2026-04-08
- progress: 0%
- note: viewport, CSS 유틸리티, 미디어 쿼리 훅 등 반응형 인프라

### TSK-00-01: viewport meta 및 CSS 유틸리티 추가
- category: infrastructure
- domain: frontend
- status: [ ]
- priority: critical
- assignee: -
- schedule: 2026-04-07 ~ 2026-04-07
- tags: css, viewport, safe-area
- depends: -
- note: 모바일 브라우저 기반 작업의 토대

#### PRD 요구사항
- prd-ref: PRD 3.8 모바일 뷰포트 대응
- requirements:
  - `index.html`의 viewport meta에 `viewport-fit=cover` 추가
  - `index.css`에 `h-dvh`, `pb-safe`, `pt-safe` Tailwind v4 유틸리티 추가
  - `animate-slide-in-left` 키프레임 애니메이션 추가
  - `overscroll-behavior: none` 전역 적용
  - `@media (hover: hover)` 호버 분기 유틸리티 추가
- acceptance:
  - iOS Safari에서 100dvh가 동적 뷰포트에 맞게 동작
  - Safe Area 패딩이 노치 디바이스에서 적용
  - `h-screen` → `h-dvh` 전환 가이드라인 문서화 불필요 (TRD에 정리됨)

#### 기술 스펙 (TRD)
- tech-spec:
  - Tailwind CSS v4 `@utility` 디렉티브 사용
  - `env(safe-area-inset-*)` CSS 환경 변수
  - `100dvh` (dynamic viewport height)
- ui-spec:
  - 파일: `frontend/index.html`, `frontend/src/index.css`

---

### TSK-00-02: useMediaQuery 훅 및 브레이크포인트 상수
- category: development
- domain: frontend
- status: [ ]
- priority: critical
- assignee: -
- schedule: 2026-04-07 ~ 2026-04-08
- tags: hooks, responsive, breakpoint
- depends: -
- note: 모든 반응형 분기의 기반 훅

#### PRD 요구사항
- prd-ref: PRD 2.2 Tailwind Breakpoint 매핑
- requirements:
  - `useMediaQuery(query)` 훅 구현 — CSS 미디어 쿼리를 React 상태로 동기화
  - `BREAKPOINTS` 상수 정의 (`sm`, `md`, `lg`, `xl`)
  - SSR 안전 (초기값 `false`)
  - `matchMedia` `change` 이벤트로 실시간 업데이트
- acceptance:
  - 브라우저 리사이즈 시 `useMediaQuery` 값이 반응적으로 변경
  - `useMediaQuery(BREAKPOINTS.lg)` 호출 시 1024px 기준 분기

#### 기술 스펙 (TRD)
- tech-spec:
  - `window.matchMedia` API
  - `MediaQueryListEvent` 리스너
- ui-spec:
  - 파일: `frontend/src/hooks/useMediaQuery.ts`

---

## WP-01: 반응형 내비게이션
- status: planned
- priority: critical
- schedule: 2026-04-08 ~ 2026-04-11
- progress: 0%
- note: 모바일 바텀 내비 + 사이드바 오버레이 + AppLayout 재구성

### TSK-01-01: BottomNavigation 컴포넌트
- category: development
- domain: frontend
- status: [ ]
- priority: critical
- assignee: -
- schedule: 2026-04-08 ~ 2026-04-09
- tags: navigation, mobile, layout
- depends: TSK-00-01, TSK-00-02

#### PRD 요구사항
- prd-ref: PRD 3.1 반응형 내비게이션
- requirements:
  - 4개 내비 항목: 홈(/dashboard), 회의(/meetings), 검색(/search), 설정(/settings)
  - `lg:` 미만에서만 표시, `lg:` 이상에서 `hidden`
  - 현재 라우트에 따른 활성 상태 표시 (색상 + 라벨)
  - iOS Safe Area 하단 패딩 (`pb-safe`)
  - 높이: 56px + safe area
- acceptance:
  - 모바일 뷰포트에서 바텀 내비 표시
  - 데스크톱 뷰포트에서 바텀 내비 숨김
  - 탭 클릭 시 해당 페이지로 라우팅
  - 현재 페이지에 해당하는 아이콘 활성화

#### 기술 스펙 (TRD)
- tech-spec:
  - lucide-react 아이콘 (LayoutDashboard, FileText, Search, Settings)
  - react-router-dom `useLocation` / `useNavigate`
  - `fixed bottom-0 w-full`, `bg-background/95 backdrop-blur-sm border-t`
- ui-spec:
  - 파일: `frontend/src/components/layout/BottomNavigation.tsx`

---

### TSK-01-02: MobileSidebarOverlay 컴포넌트
- category: development
- domain: frontend
- status: [ ]
- priority: high
- assignee: -
- schedule: 2026-04-09 ~ 2026-04-10
- tags: sidebar, overlay, mobile
- depends: TSK-00-01

#### PRD 요구사항
- prd-ref: PRD 3.1.3 요구사항
- requirements:
  - 기존 `Sidebar` 컴포넌트를 오버레이로 감싸는 래퍼
  - 반투명 백드롭 (`bg-black/50`)
  - 좌측에서 슬라이드 인 애니메이션 (`animate-slide-in-left`)
  - 백드롭 클릭/터치 시 닫기
  - 너비: `w-72 max-w-[80vw]`
  - z-index: 50
- acceptance:
  - 메뉴 버튼 탭 시 오버레이 열림
  - 백드롭 클릭 시 오버레이 닫힘
  - 폴더/태그 접근 가능
  - 슬라이드 애니메이션 200ms

#### 기술 스펙 (TRD)
- tech-spec:
  - `fixed inset-0 z-50` 포지셔닝
  - 기존 `Sidebar` 컴포넌트 그대로 재사용
  - `animate-slide-in-left` (TSK-00-01에서 정의한 유틸리티)
- ui-spec:
  - 파일: `frontend/src/components/layout/MobileSidebarOverlay.tsx`

---

### TSK-01-03: AppLayout 반응형 재구성
- category: development
- domain: frontend
- status: [ ]
- priority: critical
- assignee: -
- schedule: 2026-04-10 ~ 2026-04-11
- tags: layout, responsive, appshell
- depends: TSK-01-01, TSK-01-02

#### PRD 요구사항
- prd-ref: PRD 3.1, PRD 4 페이지별 레이아웃 매핑
- requirements:
  - `h-screen` → `h-dvh` 변경
  - 데스크톱(≥ lg): 기존 사이드바 (`hidden lg:block`)
  - 모바일(< lg): 사이드바 숨김, 바텀 내비 표시
  - 모바일에서 메인 콘텐츠에 `pb-14 lg:pb-0` (바텀 내비 높이만큼 패딩)
  - 사이드바 오버레이 토글용 버튼 (모바일 헤더 영역)
- acceptance:
  - 데스크톱: 기존과 100% 동일한 레이아웃
  - 모바일: 사이드바 숨김, 바텀 내비 표시, 콘텐츠 전체 너비 사용
  - 모바일에서 폴더/태그 접근 시 오버레이 열림

#### 기술 스펙 (TRD)
- tech-spec:
  - `flex flex-col lg:flex-row h-dvh`
  - `useMediaQuery(BREAKPOINTS.lg)` 또는 순수 CSS 분기
- ui-spec:
  - 파일: `frontend/src/components/layout/AppLayout.tsx` (수정)

---

### TSK-01-04: uiStore 모바일 상태 확장
- category: development
- domain: frontend
- status: [ ]
- priority: high
- assignee: -
- schedule: 2026-04-10 ~ 2026-04-10
- tags: state, zustand, mobile
- depends: -

#### PRD 요구사항
- prd-ref: PRD 3.1~3.3 (내비게이션, 탭 상태)
- requirements:
  - `mobileMenuOpen` (boolean) — 모바일 사이드바 오버레이 상태
  - `setMobileMenuOpen(open)` — setter
  - `meetingActiveTab` (string) — 회의 상세 활성 탭 (`transcript` | `summary` | `memo`)
  - `setMeetingActiveTab(tab)` — setter
  - `liveActiveTab` (string) — 라이브 활성 탭
  - `setLiveActiveTab(tab)` — setter
- acceptance:
  - 상태 변경 시 구독 컴포넌트 리렌더링
  - 페이지 이동 시 탭 상태 유지

#### 기술 스펙 (TRD)
- tech-spec:
  - Zustand store 확장
- ui-spec:
  - 파일: `frontend/src/stores/uiStore.ts` (수정)

---

## WP-02: 회의 페이지 모바일 레이아웃
- status: planned
- priority: critical
- schedule: 2026-04-11 ~ 2026-04-18
- progress: 0%
- note: 3컬럼 패널 → 모바일 탭 전환, 미니 오디오 플레이어, 녹음 컨트롤 축소

### TSK-02-01: MobileTabLayout 공용 컴포넌트
- category: development
- domain: frontend
- status: [ ]
- priority: critical
- assignee: -
- schedule: 2026-04-11 ~ 2026-04-14
- tags: tabs, layout, mobile, shared
- depends: TSK-01-04

#### PRD 요구사항
- prd-ref: PRD 3.2.2 모바일 탭 UI, PRD 3.3.1
- requirements:
  - 탭 바: 아이콘 + 라벨, 활성 탭 하단 인디케이터 (`border-b-2 border-primary`)
  - 탭 바 높이: 40px, sticky 상단 고정
  - 콘텐츠 영역: `flex-1 overflow-auto`
  - 탭 전환 시 DOM 유지 (`display: none`으로 비활성 탭 숨김) — 스크롤/입력 상태 보존
  - `tabs` prop: `{ id, label, icon, content }[]`
  - `defaultTab` prop: 초기 활성 탭
  - MeetingPage와 MeetingLivePage에서 공용 사용
- acceptance:
  - 탭 클릭 시 콘텐츠 전환
  - 탭 전환 후 이전 탭 스크롤 위치 유지
  - 3개 탭 균등 너비 배분

#### 기술 스펙 (TRD)
- tech-spec:
  - 비활성 탭: `visibility: hidden` + `position: absolute` (레이아웃 영향 최소화)
  - lucide-react 아이콘
- ui-spec:
  - 파일: `frontend/src/components/layout/MobileTabLayout.tsx`

---

### TSK-02-02: MeetingPage 패널/탭 분기
- category: development
- domain: frontend
- status: [ ]
- priority: critical
- assignee: -
- schedule: 2026-04-14 ~ 2026-04-15
- tags: meeting, responsive, panels, tabs
- depends: TSK-02-01, TSK-00-02

#### PRD 요구사항
- prd-ref: PRD 3.2 회의 상세 페이지 모바일 레이아웃
- requirements:
  - `useMediaQuery(BREAKPOINTS.lg)`로 분기
  - 데스크톱(≥ lg): 기존 `PanelGroup` 3컬럼 (전사 25% | AI 요약 45% | 메모 30%) — 변경 없음
  - 모바일(< lg): `MobileTabLayout`으로 전사/요약/메모 탭 전환
  - 헤더 영역: 모바일에서 `text-xl` → `text-lg`, 버튼 간격 축소
  - 기존 TranscriptPanel, AiSummaryPanel, MeetingEditor 컴포넌트 그대로 재사용
- acceptance:
  - 데스크톱: 기존과 100% 동일
  - 모바일: 3개 탭 전환, 각 탭 콘텐츠 정상 렌더링
  - 전사 텍스트 선택/복사 가능
  - AI 요약의 Mermaid 다이어그램 모바일 렌더링 (가로 스크롤)

#### 기술 스펙 (TRD)
- tech-spec:
  - `react-resizable-panels`는 데스크톱에서만 렌더링
  - `useMediaQuery` 훅으로 조건부 분기
  - 기존 패널 내부 컴포넌트 재사용 (prop 변경 없음)
- ui-spec:
  - 파일: `frontend/src/pages/MeetingPage.tsx` (수정, line 495~582 영역)

---

### TSK-02-03: MiniAudioPlayer 컴포넌트
- category: development
- domain: frontend
- status: [ ]
- priority: high
- assignee: -
- schedule: 2026-04-15 ~ 2026-04-16
- tags: audio, player, mobile, mini
- depends: TSK-00-02

#### PRD 요구사항
- prd-ref: PRD 3.2.2 오디오 플레이어
- requirements:
  - 모바일 MeetingPage 하단에 고정되는 미니 플레이어 (48px)
  - 재생/일시정지 버튼 + 프로그레스 바 + 현재시간/총시간
  - wavesurfer.js 미사용 — 경량 `<input type="range">` 프로그레스 바
  - 탭 시 기존 `AudioPlayer` 풀사이즈로 확장 (바텀 시트)
  - 바텀 내비 위에 위치 (`bottom-14`)
- acceptance:
  - 미니 플레이어에서 재생/일시정지 가능
  - 프로그레스 바 드래그로 구간 이동
  - 미니 플레이어 탭 시 풀 플레이어 확장
  - 데스크톱에서는 기존 AudioPlayer 표시 (미니 플레이어 숨김)

#### 기술 스펙 (TRD)
- tech-spec:
  - 기존 `useAudioPlayer` 훅 재사용 (재생 상태 공유)
  - wavesurfer.js 인스턴스는 풀 플레이어에서만 초기화
  - `h-12 fixed bottom-14 lg:hidden`
- ui-spec:
  - 파일: `frontend/src/components/meeting/MiniAudioPlayer.tsx`

---

### TSK-02-04: MeetingLivePage 패널/탭 분기
- category: development
- domain: frontend
- status: [ ]
- priority: critical
- assignee: -
- schedule: 2026-04-16 ~ 2026-04-17
- tags: live, responsive, panels, tabs
- depends: TSK-02-01, TSK-00-02

#### PRD 요구사항
- prd-ref: PRD 3.3 실시간 녹음 페이지 모바일 레이아웃
- requirements:
  - MeetingPage와 동일한 패널/탭 분기 패턴 적용
  - 데스크톱(≥ lg): 기존 `PanelGroup` 3컬럼 (화자+전사 20% | AI 요약 50% | 메모 30%) — 변경 없음
  - 모바일(< lg): `MobileTabLayout` (전사/요약/메모 탭)
  - 화자 패널(SpeakerPanel): 모바일에서는 전사 탭 상단에 접이식(accordion)으로 포함
  - 기존 RecordTabPanel, AiSummaryPanel, MeetingEditor 재사용
- acceptance:
  - 데스크톱: 기존과 100% 동일
  - 모바일: 탭 전환, 실시간 전사 스트리밍 정상 수신
  - ActionCable WebSocket 연결 모바일에서 안정적 동작

#### 기술 스펙 (TRD)
- tech-spec:
  - `react-resizable-panels`는 데스크톱에서만 렌더링
  - `useMediaQuery` 훅으로 조건부 분기
  - ActionCable 연결은 변경 없음 (모바일 브라우저에서도 WebSocket 지원)
- ui-spec:
  - 파일: `frontend/src/pages/MeetingLivePage.tsx` (수정, line 740~860 영역)

---

### TSK-02-05: MobileRecordControls 컴포넌트
- category: development
- domain: frontend
- status: [ ]
- priority: high
- assignee: -
- schedule: 2026-04-17 ~ 2026-04-18
- tags: recording, controls, mobile
- depends: TSK-02-04

#### PRD 요구사항
- prd-ref: PRD 3.3.2 모바일 녹음 컨트롤
- requirements:
  - 모바일에서 녹음 컨트롤 축소 표시
  - 상단 고정: 뒤로가기 + 제목(truncate) + 녹음 상태 표시(🔴 + 타이머)
  - 핵심 버튼만 표시: 일시정지, 종료
  - 나머지 옵션(STT 엔진, 시스템 오디오, 마이크 선택, 공유, 설정)은 `⋯` 더보기 → 바텀 시트
  - 녹음 시간 항상 표시
- acceptance:
  - 모바일에서 녹음 시작/일시정지/종료 가능
  - 더보기 버튼 탭 시 추가 옵션 바텀 시트 표시
  - 데스크톱에서는 기존 컨트롤 바 표시 (변경 없음)

#### 기술 스펙 (TRD)
- tech-spec:
  - 기존 녹음 상태/핸들러 재사용 (useAudioRecorder 등)
  - BottomSheet 컴포넌트 활용 (TSK-03-01)
- ui-spec:
  - 파일: `frontend/src/components/meeting/MobileRecordControls.tsx`

---

## WP-03: 목록 · 대시보드 · 설정 모바일
- status: planned
- priority: high
- schedule: 2026-04-18 ~ 2026-04-23
- progress: 0%
- note: 이미 부분적으로 반응형이 적용된 페이지들의 모바일 완성

### TSK-03-01: BottomSheet 공용 UI 컴포넌트
- category: development
- domain: frontend
- status: [ ]
- priority: high
- assignee: -
- schedule: 2026-04-18 ~ 2026-04-21
- tags: ui, bottomsheet, mobile, shared
- depends: TSK-00-01

#### PRD 요구사항
- prd-ref: PRD 3.4.1 (필터 바텀 시트), PRD 3.6.1 (설정 풀스크린), PRD 3.3.2 (녹음 더보기)
- requirements:
  - 바텀에서 슬라이드 업되는 시트 컴포넌트
  - 백드롭 (`bg-black/50`) 클릭으로 닫기
  - 핸들 바 표시 (드래그 닫기 선택사항)
  - 최대 높이: `max-h-[80vh]`
  - 내부 콘텐츠 스크롤 가능
  - 필터, 설정, 녹음 옵션 등 다양한 용도로 재사용
- acceptance:
  - 열기/닫기 애니메이션 동작
  - 백드롭 클릭 시 닫힘
  - 내부 콘텐츠 스크롤 가능
  - 여러 페이지에서 재사용 가능

#### 기술 스펙 (TRD)
- tech-spec:
  - `fixed inset-x-0 bottom-0 z-50`
  - `animate-slide-in-bottom` 키프레임
  - React Portal 사용
- ui-spec:
  - 파일: `frontend/src/components/ui/BottomSheet.tsx`

---

### TSK-03-02: MeetingsPage 툴바 모바일 대응
- category: development
- domain: frontend
- status: [ ]
- priority: high
- assignee: -
- schedule: 2026-04-21 ~ 2026-04-22
- tags: meetings, toolbar, filter, mobile
- depends: TSK-03-01, TSK-00-02

#### PRD 요구사항
- prd-ref: PRD 3.4 회의 목록 페이지
- requirements:
  - 검색: 모바일에서 아이콘 탭 시 풀 너비 검색 바 확장
  - 필터: 모바일에서 필터 아이콘 → BottomSheet에서 필터 옵션(상태, 날짜, 폴더) 표시
  - 정렬: 드롭다운 유지
  - 새 회의 버튼: 모바일에서 FAB (우하단 `fixed right-4 bottom-20`) 으로 전환
  - 카드: 모바일 1컬럼에서 정보 압축 (날짜 상대 표시, 요약 미리보기 1줄)
- acceptance:
  - 모바일: FAB으로 새 회의 생성 가능
  - 모바일: 필터 바텀 시트에서 상태/날짜/폴더 필터 적용
  - 데스크톱: 기존 툴바 100% 동일

#### 기술 스펙 (TRD)
- tech-spec:
  - `useMediaQuery(BREAKPOINTS.lg)` 분기
  - 기존 필터 상태/로직 재사용 (meetingStore)
  - FAB: `fixed right-4 bottom-20 lg:hidden z-40`
- ui-spec:
  - 파일: `frontend/src/pages/MeetingsPage.tsx` (수정)

---

### TSK-03-03: DashboardPage 반응형 패딩
- category: development
- domain: frontend
- status: [ ]
- priority: medium
- assignee: -
- schedule: 2026-04-22 ~ 2026-04-22
- tags: dashboard, responsive, padding
- depends: -
- note: 이미 그리드가 반응형. 패딩/폰트만 조정

#### PRD 요구사항
- prd-ref: PRD 3.5 대시보드 페이지
- requirements:
  - 패딩: `p-8` → `p-4 md:p-6 lg:p-8`
  - 제목: `text-2xl` → `text-xl md:text-2xl`
  - 카드 간격: `gap-6` → `gap-3 md:gap-6`
  - 통계 카드: 이미 `sm:grid-cols-2 lg:grid-cols-4` 적용됨 — 변경 없음
  - 차트 영역: 가로 스크롤 허용 (`overflow-x-auto`)
- acceptance:
  - 모바일에서 좌우 여백 적절 (16px)
  - 카드 그리드 2컬럼 이상에서 잘림 없음
  - 데스크톱: 기존과 동일

#### 기술 스펙 (TRD)
- tech-spec:
  - Tailwind 반응형 클래스만 변경
  - 로직 변경 없음
- ui-spec:
  - 파일: `frontend/src/pages/DashboardPage.tsx` (수정)

---

### TSK-03-04: 설정 모달 모바일 풀스크린
- category: development
- domain: frontend
- status: [ ]
- priority: medium
- assignee: -
- schedule: 2026-04-22 ~ 2026-04-23
- tags: settings, modal, fullscreen, mobile
- depends: TSK-00-02

#### PRD 요구사항
- prd-ref: PRD 3.6 설정 페이지
- requirements:
  - 데스크톱(≥ lg): 기존 중앙 모달 (`max-w-3xl`)
  - 모바일(< lg): 풀스크린 시트 (`fixed inset-0 h-dvh`)
  - 탭 내비게이션: 모바일에서 수평 스크롤 (`overflow-x-auto`)
  - 폼 요소(input, select, button): 최소 높이 44px
  - 닫기 버튼: 모바일에서 좌상단 X 또는 뒤로가기
- acceptance:
  - 모바일에서 설정 모달이 풀스크린으로 열림
  - 탭 전환 가능 (수평 스크롤)
  - 모든 폼 요소 터치 가능
  - 데스크톱: 기존과 동일

#### 기술 스펙 (TRD)
- tech-spec:
  - `useMediaQuery(BREAKPOINTS.lg)` 분기
  - 기존 설정 모달 컴포넌트 수정 (className 조건부)
- ui-spec:
  - 파일: 설정 관련 모달 컴포넌트 (수정)

---

## WP-04: 터치 최적화 + E2E 테스트
- status: planned
- priority: high
- schedule: 2026-04-23 ~ 2026-04-25
- progress: 0%
- note: 터치 타겟, 호버 분기, Playwright 모바일 테스트

### TSK-04-01: 터치 타겟 및 호버 미디어 쿼리 적용
- category: development
- domain: frontend
- status: [im]
- priority: high
- assignee: -
- schedule: 2026-04-23 ~ 2026-04-24
- tags: touch, a11y, hover, mobile
- depends: TSK-01-03

#### PRD 요구사항
- prd-ref: PRD 3.7 터치 최적화
- requirements:
  - 모든 인터랙티브 요소(버튼, 링크, 체크박스): 최소 44×44px 터치 영역
  - 인접 버튼 최소 8px 간격
  - 호버 효과: `@media (hover: hover)`로 호버 가능 디바이스에서만 적용
  - 전사/요약 텍스트: 선택 가능 유지 (`select-text`)
  - `-webkit-overflow-scrolling: touch` 스크롤 (Tailwind에서 기본 적용)
- acceptance:
  - 모바일에서 모든 버튼 터치 영역 44×44px 이상
  - 호버 없는 디바이스에서 호버 스타일 미적용
  - 텍스트 선택/복사 동작

#### 기술 스펙 (TRD)
- tech-spec:
  - `min-h-[44px] min-w-[44px]` 또는 패딩으로 터치 영역 확보
  - `@media (hover: hover)` CSS 미디어 쿼리
  - 공통 UI 컴포넌트(Button 등) 기본 크기 조정
- ui-spec:
  - 파일: 공통 UI 컴포넌트 + 주요 페이지 (다수 파일 소규모 수정)

---

### TSK-04-02: Playwright 모바일 뷰포트 E2E 테스트
- category: development
- domain: test
- status: [im]
- priority: high
- assignee: -
- schedule: 2026-04-24 ~ 2026-04-25
- tags: e2e, playwright, mobile, test
- depends: TSK-02-02, TSK-02-04, TSK-01-03

#### PRD 요구사항
- prd-ref: PRD 5.2 브라우저 지원, PRD 8 성공 지표
- requirements:
  - Playwright 설정에 모바일 프로젝트 추가: Pixel 7, iPhone 14, iPad
  - 테스트 시나리오:
    - 회의 목록 → 상세 이동 (모바일): 바텀 내비 표시, 1컬럼, 탭 전환
    - 회의 상세 탭 전환 (모바일): 전사/요약/메모 탭 클릭 시 콘텐츠 전환
    - 사이드바 오버레이 (모바일): 메뉴 → 오버레이 → 외부 탭 → 닫힘
    - 설정 모달 (모바일): 풀스크린 표시
  - 기존 데스크톱 뷰포트(1280×800) 테스트 유지 (회귀 방지)
- acceptance:
  - 모바일 뷰포트 E2E 테스트 전체 통과
  - 데스크톱 뷰포트 기존 E2E 테스트 전체 통과 (회귀 없음)

#### 기술 스펙 (TRD)
- tech-spec:
  - Playwright `devices['Pixel 7']`, `devices['iPhone 14']`, `devices['iPad (gen 7)']`
  - `playwright.config.ts`에 프로젝트 추가
- ui-spec:
  - 파일: `e2e/playwright.config.ts` (수정), `e2e/tests/mobile/` (신규 디렉토리)

---

### TSK-04-03: 데스크톱 회귀 검증
- category: development
- domain: test
- status: [ ]
- priority: critical
- assignee: -
- schedule: 2026-04-25 ~ 2026-04-25
- tags: regression, desktop, verification
- depends: TSK-04-02

#### PRD 요구사항
- prd-ref: PRD 8 성공 지표
- requirements:
  - 기존 E2E 테스트 스위트 전체 실행 (데스크톱 뷰포트)
  - 주요 페이지 수동 스모크 테스트:
    - MeetingPage 3컬럼 패널 정상 렌더링 + 리사이즈
    - MeetingLivePage 녹음/전사/요약 플로우
    - MeetingsPage 그리드 + 필터
    - DashboardPage 통계 카드
    - 사이드바 열기/닫기
  - 시각적 변경 없음 확인 (스크린샷 비교 선택사항)
- acceptance:
  - 기존 E2E 테스트 100% 통과
  - 데스크톱에서 시각적/기능적 회귀 없음

#### 기술 스펙 (TRD)
- tech-spec:
  - 기존 Playwright 테스트 스위트 실행
  - 뷰포트: 1280×800 (기존 설정)
