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

  setPartial: (data: TranscriptPartialData) => void
  addFinal: (data: TranscriptFinalData) => void
  loadFinals: (data: TranscriptFinalData[]) => void
  setSpeaker: (data: SpeakerChangeData) => void
  setMeetingNotes: (markdown: string) => void
  markApplied: (ids: number[]) => void
  removeFinals: (ids: number[]) => void
  reset: () => void
}

const initialState = {
  partial: null,
  finals: [] as TranscriptFinalData[],
  appliedIds: new Set<number>(),
  meetingNotes: null,
  currentSpeaker: null,
}

export const useTranscriptStore = create<TranscriptState>()((set) => ({
  ...initialState,

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

  reset: () => set(initialState),
}))
