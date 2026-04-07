import { create } from 'zustand'
import type { Participant } from '../api/meetings'

interface SharingState {
  shareCode: string | null
  participants: Participant[]
  isLoading: boolean
  recordingStopped: boolean
  hostDisconnected: boolean
  hostDisconnectedUserId: number | null
  hostClaimable: boolean
  gracePeriodEndsAt: number | null

  setParticipants: (participants: Participant[]) => void
  addParticipant: (participant: Participant) => void
  removeParticipant: (userId: number) => void
  transferHost: (newHostUserId: number) => void
  startSharing: (code: string, participants: Participant[]) => void
  stopSharing: () => void
  setLoading: (loading: boolean) => void
  setRecordingStopped: (stopped: boolean) => void
  setHostDisconnected: (userId: number, graceSeconds: number) => void
  clearHostDisconnected: () => void
  setHostClaimable: (claimable: boolean) => void
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
  hostDisconnected: false,
  hostDisconnectedUserId: null as number | null,
  hostClaimable: false,
  gracePeriodEndsAt: null as number | null,
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
    set((state) => {
      if (!state.participants.some((p) => p.user_id === userId)) return state
      return { participants: state.participants.filter((p) => p.user_id !== userId) }
    }),

  transferHost: (newHostUserId) =>
    set((state) => {
      const updated = state.participants.map((p) => {
        if (p.user_id === newHostUserId) return { ...p, role: 'host' as const }
        if (p.role === 'host') return { ...p, role: 'viewer' as const }
        return p
      })
      return {
        participants: sortParticipants(updated),
        hostDisconnected: false,
        hostDisconnectedUserId: null,
        hostClaimable: false,
        gracePeriodEndsAt: null,
      }
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
      hostDisconnected: false,
      hostDisconnectedUserId: null,
      hostClaimable: false,
      gracePeriodEndsAt: null,
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  setRecordingStopped: (stopped) => set({ recordingStopped: stopped }),

  setHostDisconnected: (userId, graceSeconds) =>
    set({
      hostDisconnected: true,
      hostDisconnectedUserId: userId,
      hostClaimable: false,
      gracePeriodEndsAt: Date.now() + graceSeconds * 1000,
    }),

  clearHostDisconnected: () =>
    set({
      hostDisconnected: false,
      hostDisconnectedUserId: null,
      hostClaimable: false,
      gracePeriodEndsAt: null,
    }),

  setHostClaimable: (claimable) => set({ hostClaimable: claimable }),

  reset: () => set(initialState),
}))
