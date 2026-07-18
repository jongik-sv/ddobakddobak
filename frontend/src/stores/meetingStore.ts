import { create } from 'zustand'
import {
  getMeetings,
  updateMeeting,
  lockMeeting as apiLockMeeting,
  unlockMeeting as apiUnlockMeeting,
} from '../api/meetings'
import type { Meeting, MeetingListMeta, GetMeetingsParams } from '../api/meetings'
import type { SelectedFolder } from './folderStore'
import { useProjectStore } from './projectStore'

interface MeetingState {
  meetings: Meeting[]
  meta: MeetingListMeta | null
  searchQuery: string
  statusFilter: string
  dateFrom: string
  dateTo: string
  folderId: SelectedFolder
  /** true면 중요 필터를 해제하고 전체 회의를 가져온다(show_all=1). 기본 false. */
  showAll: boolean
  /** true면 최초 성공 로드를 1회 이상 마쳤음(스켈레톤은 이 시점 이전에만 노출). */
  hasLoadedOnce: boolean
  isLoading: boolean
  isRefreshing: boolean
  error: string | null

  setSearchQuery: (q: string) => void
  setStatusFilter: (status: string) => void
  setDateFrom: (date: string) => void
  setDateTo: (date: string) => void
  setFolderId: (id: SelectedFolder) => void
  setShowAll: (v: boolean) => void
  toggleShowAll: () => void
  fetchMeetings: (page?: number) => Promise<void>
  moveMeetingToFolder: (meetingId: number, folderId: number | null) => Promise<void>
  lockMeeting: (meetingId: number) => Promise<Meeting>
  unlockMeeting: (meetingId: number) => Promise<Meeting>
  addMeeting: (meeting: Meeting) => void
  reset: () => void
}

const initialState = {
  meetings: [] as Meeting[],
  meta: null as MeetingListMeta | null,
  searchQuery: '',
  statusFilter: '',
  dateFrom: '',
  dateTo: '',
  folderId: 'all' as SelectedFolder,
  showAll: false,
  hasLoadedOnce: false,
  isLoading: false,
  isRefreshing: false,
  error: null as string | null,
}

// fetchMeetings 요청 시퀀스 번호 — 응답 도착 시 최신 요청이 아니면 무시(경쟁 가드).
// 스토어 상태가 아니라 모듈 클로저 변수로 둔다(re-render/구독과 무관하게 단조 증가만 하면 됨).
let fetchSeq = 0

export const useMeetingStore = create<MeetingState>()((set, get) => ({
  ...initialState,

  setSearchQuery: (q) => set({ searchQuery: q }),
  setStatusFilter: (status) => set({ statusFilter: status }),
  setDateFrom: (date) => set({ dateFrom: date }),
  setDateTo: (date) => set({ dateTo: date }),
  setFolderId: (id) => set({ folderId: id }),
  setShowAll: (v) => set({ showAll: v }),
  toggleShowAll: () => set((state) => ({ showAll: !state.showAll })),

  fetchMeetings: async (page = 1) => {
    const seq = ++fetchSeq
    const { hasLoadedOnce } = get()
    // 최초 로드 이전에만 isLoading(스켈레톤). 이후 재조회는 isRefreshing(지연 dim)만 토글.
    set({ isLoading: !hasLoadedOnce, isRefreshing: hasLoadedOnce, error: null })
    try {
      const { searchQuery, statusFilter, dateFrom, dateTo, folderId, showAll } = get()
      const params: GetMeetingsParams = { page, per: 20 }
      if (searchQuery) params.q = searchQuery
      if (statusFilter) params.status = statusFilter
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      if (folderId !== 'all') {
        params.folder_id = folderId
      }
      // 특정 폴더 안에서는 중요하지 않은 회의도 보여준다. 전체(all) 뷰에서만 important 필터 유지(showAll로 해제).
      if (showAll || folderId !== 'all') params.show_all = true
      const projectId = useProjectStore.getState().currentProjectId
      if (projectId != null) params.project_id = projectId
      const data = await getMeetings(params)
      if (seq !== fetchSeq) return // 더 최신 요청이 이미 시작됨 — stale 응답 무시
      set({ meetings: data.meetings, meta: data.meta, isLoading: false, isRefreshing: false, hasLoadedOnce: true })
    } catch {
      if (seq !== fetchSeq) return // stale 에러도 최신 상태를 덮지 않는다
      set({ error: '회의 목록을 불러오지 못했습니다.', isLoading: false, isRefreshing: false })
    }
  },

  moveMeetingToFolder: async (meetingId, folderId) => {
    await updateMeeting(meetingId, { folder_id: folderId })
    await get().fetchMeetings()
  },

  lockMeeting: async (meetingId) => {
    const updated = await apiLockMeeting(meetingId)
    set((state) => ({
      meetings: state.meetings.map((m) => (m.id === meetingId ? { ...m, ...updated } : m)),
    }))
    return updated
  },

  unlockMeeting: async (meetingId) => {
    const updated = await apiUnlockMeeting(meetingId)
    set((state) => ({
      meetings: state.meetings.map((m) => (m.id === meetingId ? { ...m, ...updated } : m)),
    }))
    return updated
  },

  addMeeting: (meeting) =>
    set((state) => ({ meetings: [meeting, ...state.meetings] })),

  reset: () => set(initialState),
}))
