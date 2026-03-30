import { create } from 'zustand'

interface UiState {
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  sidebarOpen: boolean
  toggleSidebar: () => void
  memoVisible: boolean
  toggleMemo: () => void
  isRecordingActive: boolean
  setRecordingActive: (active: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  memoVisible: true,
  toggleMemo: () => set((s) => ({ memoVisible: !s.memoVisible })),
  isRecordingActive: false,
  setRecordingActive: (active) => set({ isRecordingActive: active }),
}))
