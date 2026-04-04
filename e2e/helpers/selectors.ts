/**
 * E2E 테스트에서 공통으로 사용되는 CSS selector 상수
 *
 * 실제 컴포넌트 구현과 selector가 한 곳에서 관리되어
 * UI 변경 시 일괄 수정이 가능하다.
 */

export const Selectors = {
  /** 인증 관련 (SignupPage / LoginPage) */
  auth: {
    nameInput: '#name',
    emailInput: '#email',
    passwordInput: '#password',
    submitButton: 'button[type="submit"]',
    /** 에러 메시지 컨테이너 (role="alert") */
    errorAlert: '[role="alert"]',
  },

  /** 네비게이션 / 헤더 */
  nav: {
    logoutButton: 'button[aria-label="로그아웃"]',
    /** Header 컴포넌트: 사용자 이름 표시 영역 */
    userNameDisplay: 'header span.font-medium',
  },

  /** 팀 관리 페이지 (TeamPage) */
  team: {
    nameInput: 'input[placeholder="팀 이름"]',
    createButton: 'button:has-text("팀 생성")',
    teamListItem: 'ul li button',
    inviteEmailInput: 'input[placeholder="초대할 이메일"]',
    inviteButton: 'button:has-text("초대")',
    memberTable: 'table',
  },

  /** 회의 라이브 페이지 (MeetingLivePage) */
  meeting: {
    pageHeader: 'h1',
    startButton: 'button:has-text("회의 시작")',
    stopButton: 'button:has-text("회의 종료")',
    /** 실시간 녹음 중 인디케이터 */
    recordingIndicator: '[data-testid="recording-indicator"]',
    /** 회의 카드 (목록 페이지) */
    card: '[data-testid="meeting-card"]',
  },

  /** AI 요약 패널 (AiSummaryPanel) */
  aiSummary: {
    panel: '[data-testid="ai-summary"]',
    header: 'h2:has-text("AI 요약")',
    /** 요약이 없을 때 안내 메시지 */
    emptyMessage: 'text=회의가 시작되면 AI가 요약을 생성합니다.',
  },

  /** 라이브 기록 영역 (LiveRecord) */
  transcript: {
    header: 'h2:has-text("라이브 기록")',
  },

  /** 메모 에디터 (MeetingEditor) */
  memo: {
    editor: '[data-testid="memo-editor"]',
    header: 'h2:has-text("메모")',
  },

  /** 내보내기 버튼 (export UI 구현 후 사용) */
  export: {
    markdownButton: '[data-testid="export-markdown-btn"]',
  },

  /** 모바일 내비게이션 */
  mobile: {
    /** 바텀 내비게이션 바 */
    bottomNav: '[data-testid="bottom-navigation"]',
    /** 바텀 내비 항목 (role="link") */
    bottomNavItem: (label: string) =>
      `[data-testid="bottom-navigation"] a:has-text("${label}")`,
    /** 사이드바 오버레이 백드롭 */
    sidebarOverlayBackdrop: '[data-testid="sidebar-overlay-backdrop"]',
    /** 사이드바 오버레이 컨테이너 */
    sidebarOverlay: '[data-testid="sidebar-overlay"]',
    /** 모바일 메뉴 열기 버튼 (햄버거) */
    menuButton: 'button[aria-label="메뉴"]',
  },

  /** 모바일 탭 레이아웃 (MobileTabLayout) */
  mobileTabs: {
    /** 탭 바 컨테이너 */
    tabBar: '[data-testid="mobile-tab-bar"]',
    /** 개별 탭 버튼 */
    tab: (label: string) =>
      `[data-testid="mobile-tab-bar"] button:has-text("${label}")`,
    /** 활성 탭 (aria-selected="true") */
    activeTab: '[data-testid="mobile-tab-bar"] button[aria-selected="true"]',
    /** 탭 콘텐츠 영역 */
    tabContent: '[data-testid="mobile-tab-content"]',
  },

  /** 설정 모달 */
  settings: {
    modal: '[role="dialog"]',
    /** 설정 모달 풀스크린 확인 (모바일) */
    fullscreenModal: '[role="dialog"][data-fullscreen="true"]',
  },
} as const;

/**
 * WebSocket(ActionCable) route 패턴 상수
 * page.route() 에서 반복 사용되는 URL 패턴을 통합 관리한다.
 */
export const RoutePatterns = {
  /** ActionCable WebSocket 엔드포인트 */
  cable: '**/cable',
  /** 회의 시작 API */
  meetingStart: '**/api/v1/meetings/*/start',
  /** 회의 종료 API */
  meetingStop: '**/api/v1/meetings/*/stop',
  /** 오디오 업로드 API */
  meetingAudio: '**/api/v1/meetings/*/audio',
  /** 회의 요약 API */
  meetingSummary: (meetingId: number) => `**/api/v1/meetings/${meetingId}/summary`,
  /** 회의 내보내기 API */
  meetingExport: (meetingId: number) => `**/api/v1/meetings/${meetingId}/export*`,
} as const;
