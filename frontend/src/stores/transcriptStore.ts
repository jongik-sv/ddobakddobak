import { create } from 'zustand'
import type {
  TranscriptPartialData,
  TranscriptFinalData,
  SpeakerChangeData,
} from '../channels/transcription'

interface TranscriptState {
  partial: TranscriptPartialData | null
  finals: TranscriptFinalData[]
  appliedIds: Set<number>
  meetingNotes: string | null
  currentSpeaker: string | null
  isSummarizing: boolean
  summarizationKind: 'realtime' | 'final' | null
  lastUserEditAt: number
  lastResetAt: number
  clientId: string

  setPartial: (data: TranscriptPartialData) => void
  addFinal: (data: TranscriptFinalData) => void
  loadFinals: (data: TranscriptFinalData[]) => void
  setSpeaker: (data: SpeakerChangeData) => void
  setMeetingNotes: (markdown: string | null) => void
  markApplied: (ids: number[]) => void
  removeFinals: (ids: number[]) => void
  updateFinal: (id: number, content: string) => void
  setSpeakerName: (speakerLabel: string, name: string | null) => void
  clearSpeakerNames: () => void
  setSummarizing: (kind: 'realtime' | 'final' | null) => void
  markUserEdit: () => void
  markReset: () => void
  reset: () => void
}

const generateClientId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
  } catch { /* ignore */ }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const initialState = {
  partial: null,
  finals: [] as TranscriptFinalData[],
  appliedIds: new Set<number>(),
  meetingNotes: null,
  currentSpeaker: null,
  isSummarizing: false,
  summarizationKind: null as 'realtime' | 'final' | null,
  lastUserEditAt: 0,
  lastResetAt: 0,
}

export const useTranscriptStore = create<TranscriptState>()((set) => ({
  ...initialState,
  clientId: generateClientId(),

  setPartial: (data) =>
    set((state) =>
      state.partial?.content === data.content &&
      state.partial?.speaker_label === data.speaker_label
        ? state
        : { partial: data },
    ),

  loadFinals: (data) => {
    const appliedIds = new Set<number>()
    data.forEach((f) => { if (f.applied) appliedIds.add(f.id) })
    const sorted = [...data].sort(
      (a, b) => a.started_at_ms - b.started_at_ms
    )
    set({ finals: sorted, appliedIds })
  },

  addFinal: (data) =>
    set((state) => {
      const finalData = state.appliedIds.has(data.id)
        ? { ...data, applied: true }
        : data
      const finals = state.finals
      // Insert at correct position (transcripts arrive mostly in order)
      let i = finals.length
      while (i > 0 && finals[i - 1].started_at_ms > finalData.started_at_ms) i--
      const updated = [...finals.slice(0, i), finalData, ...finals.slice(i)]
      return { finals: updated, partial: null }
    }),

  setSpeaker: (data) => set({ currentSpeaker: data.speaker_label }),

  setMeetingNotes: (markdown) =>
    set((state) => state.meetingNotes === markdown ? state : { meetingNotes: markdown }),

  markApplied: (ids) =>
    set((state) => {
      if (ids.every((id) => state.appliedIds.has(id))) return state
      const newAppliedIds = new Set(state.appliedIds)
      const idSet = new Set(ids)
      ids.forEach((id) => newAppliedIds.add(id))
      return {
        appliedIds: newAppliedIds,
        finals: state.finals.map((f) =>
          idSet.has(f.id) ? { ...f, applied: true } : f
        ),
      }
    }),

  removeFinals: (ids) =>
    set((state) => {
      const idSet = new Set(ids)
      return { finals: state.finals.filter((f) => !idSet.has(f.id)) }
    }),

  updateFinal: (id, content) =>
    set((state) => {
      const idx = state.finals.findIndex((f) => f.id === id)
      if (idx === -1) return state
      if (state.finals[idx].content === content) return state
      const updated = [...state.finals]
      updated[idx] = { ...updated[idx], content }
      return { finals: updated }
    }),

  setSpeakerName: (speakerLabel, name) =>
    set((state) => {
      const changed = state.finals.some(
        (f) => f.speaker_label === speakerLabel && (f.speaker_name ?? null) !== name
      )
      if (!changed) return state
      return {
        finals: state.finals.map((f) =>
          f.speaker_label === speakerLabel ? { ...f, speaker_name: name } : f
        ),
      }
    }),

  clearSpeakerNames: () =>
    set((state) => {
      if (!state.finals.some((f) => f.speaker_name != null)) return state
      return {
        finals: state.finals.map((f) =>
          f.speaker_name != null ? { ...f, speaker_name: null } : f
        ),
      }
    }),

  setSummarizing: (kind) =>
    set({ isSummarizing: kind !== null, summarizationKind: kind }),

  markUserEdit: () => set({ lastUserEditAt: Date.now() }),

  markReset: () => set({ lastResetAt: Date.now() }),

  reset: () =>
    set((state) => ({
      ...initialState,
      clientId: state.clientId,
      lastResetAt: state.lastResetAt,
    })),
}))
