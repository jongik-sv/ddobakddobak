import { create } from 'zustand'
import { IS_MOBILE } from '../config'

export type MeetingTab = 'transcript' | 'summary' | 'memo'
export type LiveTab = 'transcript' | 'summary' | 'memo'

interface UiState {
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  userMgmtOpen: boolean
  openUserMgmt: () => void
  closeUserMgmt: () => void
  sidebarOpen: boolean
  toggleSidebar: () => void
  memoVisible: boolean
  toggleMemo: () => void
  attachmentsVisible: boolean
  toggleAttachments: () => void
  bookmarksVisible: boolean
  toggleBookmarks: () => void
  isRecordingActive: boolean
  setRecordingActive: (active: boolean) => void
  mobileMenuOpen: boolean
  setMobileMenuOpen: (open: boolean) => void
  meetingActiveTab: MeetingTab
  setMeetingActiveTab: (tab: MeetingTab) => void
  liveActiveTab: LiveTab
  setLiveActiveTab: (tab: LiveTab) => void
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  // 모바일 포함 전 클라이언트에서 설정 진입 허용 (개인 LLM·회의 언어 등 사용자별 설정).
  // 관리자 전용 섹션은 SettingsContent 내부에서 별도 게이팅된다.
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  userMgmtOpen: false,
  // 모바일 차단 — 설정 모달과 동일 정책
  openUserMgmt: () => { if (IS_MOBILE) return; set({ userMgmtOpen: true }) },
  closeUserMgmt: () => set({ userMgmtOpen: false }),
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  memoVisible: true,
  toggleMemo: () => set((s) => ({ memoVisible: !s.memoVisible })),
  attachmentsVisible: false,
  toggleAttachments: () => set((s) => ({ attachmentsVisible: !s.attachmentsVisible })),
  bookmarksVisible: true,
  toggleBookmarks: () => set((s) => ({ bookmarksVisible: !s.bookmarksVisible })),
  isRecordingActive: false,
  setRecordingActive: (active) => set({ isRecordingActive: active }),
  mobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
  meetingActiveTab: 'transcript',
  setMeetingActiveTab: (tab) => set({ meetingActiveTab: tab }),
  liveActiveTab: 'transcript',
  setLiveActiveTab: (tab) => set({ liveActiveTab: tab }),
}))
