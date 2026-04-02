import { create } from 'zustand'
import type { Participant } from '../api/meetings'

interface SharingState {
  // 상태
  shareCode: string | null
  participants: Participant[]
  isSharing: boolean
  isLoading: boolean
  recordingStopped: boolean

  // 액션
  setShareCode: (code: string | null) => void
  setParticipants: (participants: Participant[]) => void
  addParticipant: (participant: Participant) => void
  removeParticipant: (userId: number) => void
  updateParticipantRole: (userId: number, role: 'host' | 'viewer') => void
  transferHost: (newHostUserId: number) => void
  startSharing: (code: string, participants: Participant[]) => void
  stopSharing: () => void
  setLoading: (loading: boolean) => void
  setRecordingStopped: (stopped: boolean) => void
  reset: () => void
}

/** host를 먼저 정렬 */
function sortParticipants(participants: Participant[]): Participant[] {
  return [...participants].sort((a, b) => {
    if (a.role === 'host' && b.role !== 'host') return -1
    if (a.role !== 'host' && b.role === 'host') return 1
    return 0
  })
}

const initialState = {
  shareCode: null as string | null,
  participants: [] as Participant[],
  isSharing: false,
  isLoading: false,
  recordingStopped: false,
}

export const useSharingStore = create<SharingState>()((set) => ({
  ...initialState,

  setShareCode: (code) => set({ shareCode: code }),

  setParticipants: (participants) =>
    set({ participants: sortParticipants(participants) }),

  addParticipant: (participant) =>
    set((state) => {
      // 중복 userId는 덮어쓰기
      const filtered = state.participants.filter(
        (p) => p.user_id !== participant.user_id,
      )
      return { participants: sortParticipants([...filtered, participant]) }
    }),

  removeParticipant: (userId) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.user_id !== userId),
    })),

  updateParticipantRole: (userId, role) =>
    set((state) => {
      const updated = state.participants.map((p) =>
        p.user_id === userId ? { ...p, role } : p,
      )
      return { participants: sortParticipants(updated) }
    }),

  transferHost: (newHostUserId) =>
    set((state) => {
      const updated = state.participants.map((p) => {
        if (p.user_id === newHostUserId) return { ...p, role: 'host' as const }
        if (p.role === 'host') return { ...p, role: 'viewer' as const }
        return p
      })
      return { participants: sortParticipants(updated) }
    }),

  startSharing: (code, participants) =>
    set({
      shareCode: code,
      isSharing: true,
      participants: sortParticipants(participants),
    }),

  stopSharing: () =>
    set({
      shareCode: null,
      isSharing: false,
      participants: [],
      recordingStopped: false,
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  setRecordingStopped: (stopped) => set({ recordingStopped: stopped }),

  reset: () => set(initialState),
}))
