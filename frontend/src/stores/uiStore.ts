import { create } from 'zustand'
import { IS_MOBILE } from '../config'
import { loadTheme, saveTheme, applyTheme, type Theme } from '../lib/theme'

export type MeetingTab = 'transcript' | 'summary' | 'memo'
export type LiveTab = 'transcript' | 'summary' | 'memo'

/** 사이드바 폭 드래그 조절 범위(px) */
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 560
const SIDEBAR_DEFAULT_WIDTH = 240

export function clampSidebarWidth(w: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(w)))
}

function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem('sidebarWidth')
    if (raw) return clampSidebarWidth(Number(raw))
  } catch {
    // localStorage 접근 불가(SSR/프라이빗 모드) — 기본값
  }
  return SIDEBAR_DEFAULT_WIDTH
}

/** 폴더챗 드로어 폭 드래그 조절 범위(px). 기본 672 = max-w-2xl(42rem) */
export const FOLDER_CHAT_MIN_WIDTH = 360
export const FOLDER_CHAT_MAX_WIDTH = 1000
const FOLDER_CHAT_DEFAULT_WIDTH = 672

export function clampFolderChatWidth(w: number): number {
  return Math.min(FOLDER_CHAT_MAX_WIDTH, Math.max(FOLDER_CHAT_MIN_WIDTH, Math.round(w)))
}

function loadFolderChatWidth(): number {
  try {
    const raw = localStorage.getItem('folderChatWidth')
    if (raw) return clampFolderChatWidth(Number(raw))
  } catch {
    // localStorage 접근 불가(SSR/프라이빗 모드) — 기본값
  }
  return FOLDER_CHAT_DEFAULT_WIDTH
}

/** AI 회의록(BlockNote 본문) 글자크기 조절 범위(px). mdview 패턴과 동일한 값. */
export const SUMMARY_FONT_DEFAULT = 16
export const SUMMARY_FONT_MIN = 11
export const SUMMARY_FONT_MAX = 28
export const SUMMARY_FONT_STEP = 2

export function clampSummaryFontSize(px: number): number {
  return Math.min(SUMMARY_FONT_MAX, Math.max(SUMMARY_FONT_MIN, Math.round(px)))
}

function loadSummaryFontSize(): number {
  try {
    const raw = localStorage.getItem('summaryFontSize')
    if (raw) return clampSummaryFontSize(Number(raw))
  } catch {
    // localStorage 접근 불가(SSR/프라이빗 모드) — 기본값
  }
  return SUMMARY_FONT_DEFAULT
}

interface UiState {
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  userMgmtOpen: boolean
  openUserMgmt: () => void
  closeUserMgmt: () => void
  sidebarOpen: boolean
  toggleSidebar: () => void
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  folderChatWidth: number
  setFolderChatWidth: (width: number) => void
  /** 폴더/프로젝트 챗 드로어(회의 상세로 이동해도 유지). open=false면 드로어 미출력.
   *  folderChatScope는 세션만 유지(localStorage 미영속) — 페이지 새로고침 시 닫힌 상태로 시작. */
  folderChatOpen: boolean
  folderChatScope: { folderId: number | null; projectId: number | null; folderName?: string } | null
  openFolderChat: (scope: { folderId: number | null; projectId: number | null; folderName?: string }) => void
  closeFolderChat: () => void
  summaryFontSize: number
  setSummaryFontSize: (px: number) => void
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
  theme: Theme
  setTheme: (t: Theme) => void
  cycleTheme: () => void
}

export const useUiStore = create<UiState>((set, get) => ({
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
  sidebarWidth: loadSidebarWidth(),
  setSidebarWidth: (width) => {
    const w = clampSidebarWidth(width)
    try { localStorage.setItem('sidebarWidth', String(w)) } catch { /* 무시 */ }
    set({ sidebarWidth: w })
  },
  folderChatWidth: loadFolderChatWidth(),
  setFolderChatWidth: (width) => {
    const w = clampFolderChatWidth(width)
    try { localStorage.setItem('folderChatWidth', String(w)) } catch { /* 무시 */ }
    set({ folderChatWidth: w })
  },
  folderChatOpen: false,
  folderChatScope: null,
  openFolderChat: (scope) => set({ folderChatOpen: true, folderChatScope: scope }),
  closeFolderChat: () => set({ folderChatOpen: false }),
  summaryFontSize: loadSummaryFontSize(),
  setSummaryFontSize: (px) => {
    const v = clampSummaryFontSize(px)
    try { localStorage.setItem('summaryFontSize', String(v)) } catch { /* 무시 */ }
    set({ summaryFontSize: v })
  },
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
  theme: loadTheme(),
  setTheme: (t) => {
    saveTheme(t)
    applyTheme(t)
    set({ theme: t })
  },
  cycleTheme: () => {
    const order: Theme[] = ['light', 'dark', 'system']
    const next = order[(order.indexOf(get().theme) + 1) % order.length]
    get().setTheme(next)
  },
}))
