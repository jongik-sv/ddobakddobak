import { create } from 'zustand'
import type { Participant } from '../api/meetings'

interface SharingState {
  shareCode: string | null
  participants: Participant[]
  isLoading: boolean
  recordingStopped: boolean

  setParticipants: (participants: Participant[]) => void
  addParticipant: (participant: Participant) => void
  removeParticipant: (userId: number) => void
  transferHost: (newHostUserId: number) => void
  startSharing: (code: string, participants: Participant[]) => void
  stopSharing: () => void
  setLoading: (loading: boolean) => void
  setRecordingStopped: (stopped: boolean) => void
  reset: () => void
}

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
  isLoading: false,
  recordingStopped: false,
}

export const useSharingStore = create<SharingState>()((set) => ({
  ...initialState,

  setParticipants: (participants) =>
    set({ participants: sortParticipants(participants) }),

  addParticipant: (participant) =>
    set((state) => {
      const filtered = state.participants.filter(
        (p) => p.user_id !== participant.user_id,
      )
      return { participants: sortParticipants([...filtered, participant]) }
    }),

  removeParticipant: (userId) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.user_id !== userId),
    })),

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
      participants: sortParticipants(participants),
    }),

  stopSharing: () =>
    set({
      shareCode: null,
      participants: [],
      recordingStopped: false,
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  setRecordingStopped: (stopped) => set({ recordingStopped: stopped }),

  reset: () => set(initialState),
}))
