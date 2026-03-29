import { create } from 'zustand'
import { getMeetings } from '../api/meetings'
import type { Meeting, MeetingListMeta, GetMeetingsParams } from '../api/meetings'

interface MeetingState {
  meetings: Meeting[]
  meta: MeetingListMeta | null
  searchQuery: string
  statusFilter: string
  dateFrom: string
  dateTo: string
  isLoading: boolean
  error: string | null

  setSearchQuery: (q: string) => void
  setStatusFilter: (status: string) => void
  setDateFrom: (date: string) => void
  setDateTo: (date: string) => void
  fetchMeetings: (page?: number) => Promise<void>
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
  isLoading: false,
  error: null as string | null,
}

export const useMeetingStore = create<MeetingState>()((set, get) => ({
  ...initialState,

  setSearchQuery: (q) => set({ searchQuery: q }),
  setStatusFilter: (status) => set({ statusFilter: status }),
  setDateFrom: (date) => set({ dateFrom: date }),
  setDateTo: (date) => set({ dateTo: date }),

  fetchMeetings: async (page = 1) => {
    set({ isLoading: true, error: null })
    try {
      const { searchQuery, statusFilter, dateFrom, dateTo } = get()
      const params: GetMeetingsParams = { page, per: 20 }
      if (searchQuery) params.q = searchQuery
      if (statusFilter) params.status = statusFilter
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const data = await getMeetings(params)
      set({ meetings: data.meetings, meta: data.meta, isLoading: false })
    } catch {
      set({ error: '회의 목록을 불러오지 못했습니다.', isLoading: false })
    }
  },

  addMeeting: (meeting) =>
    set((state) => ({ meetings: [meeting, ...state.meetings] })),

  reset: () => set(initialState),
}))
