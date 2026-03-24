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

  setPartial: (data) => set({ partial: data }),

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
      // 이미 applied로 알려진 ID면 applied: true로 설정 (타이밍 이슈 방지)
      const finalData = state.appliedIds.has(data.id)
        ? { ...data, applied: true }
        : data
      const updated = [...state.finals, finalData]
      updated.sort(
        (a, b) => a.started_at_ms - b.started_at_ms
      )
      console.log('[store] addFinal:', data.id, 'applied:', finalData.applied, 'total:', updated.length, 'unapplied:', updated.filter(f => !f.applied).length)
      return { finals: updated, partial: null }
    }),

  setSpeaker: (data) => set({ currentSpeaker: data.speaker_label }),

  setMeetingNotes: (markdown) => set({ meetingNotes: markdown }),

  markApplied: (ids) =>
    set((state) => {
      const newAppliedIds = new Set(state.appliedIds)
      ids.forEach((id) => newAppliedIds.add(id))
      return {
        appliedIds: newAppliedIds,
        finals: state.finals.map((f) =>
          ids.includes(f.id) ? { ...f, applied: true } : f
        ),
      }
    }),

  removeFinals: (ids) =>
    set((state) => ({
      finals: state.finals.filter((f) => !ids.includes(f.id)),
    })),

  reset: () => set(initialState),
}))
