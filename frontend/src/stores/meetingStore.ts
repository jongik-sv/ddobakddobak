import { create } from 'zustand'
import {
  getMeetings,
  updateMeeting,
  lockMeeting as apiLockMeeting,
  unlockMeeting as apiUnlockMeeting,
} from '../api/meetings'
import type { Meeting, MeetingListMeta, GetMeetingsParams } from '../api/meetings'
import type { SelectedFolder } from './folderStore'

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
  isLoading: false,
  isRefreshing: false,
  error: null as string | null,
}

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
    const hasData = get().meetings.length > 0
    set({ isLoading: !hasData, isRefreshing: true, error: null })
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
      if (showAll) params.show_all = true
      const data = await getMeetings(params)
      set({ meetings: data.meetings, meta: data.meta, isLoading: false, isRefreshing: false })
    } catch {
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
