import { create } from 'zustand'

export type MeetingTab = 'transcript' | 'summary' | 'memo'
export type LiveTab = 'transcript' | 'summary' | 'memo'

interface UiState {
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
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
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
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
