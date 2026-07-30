import { create } from 'zustand'
import type {
  TranscriptPartialData,
  TranscriptFinalData,
  SpeakerChangeData,
} from '../channels/transcription'
import type { Transcript } from '../api/meetings/types'

interface TranscriptState {
  partial: TranscriptPartialData | null
  finals: TranscriptFinalData[]
  appliedIds: Set<number>
  meetingNotes: string | null
  currentSpeaker: string | null
  isSummarizing: boolean
  summarizationKind: 'realtime' | 'final' | null
  /** 최근 요약 실패 상태. 성공 신호(finished ok / notes_update) 수신 시 클리어. */
  summaryError: { kind: string; message: string } | null
  lastUserEditAt: number
  lastResetAt: number
  clientId: string
  /** 원격(다른 클라이언트) transcript_split 수신 횟수. 채널 경로(channels/transcription.ts)에서만
   *  증가한다 — 로컬 split(SplitTranscriptDialog → applySplit 직접 호출)은 증가시키지 않는다.
   *  MeetingPage가 이 값의 변화를 감지해 자신이 들고 있는 transcripts 배열을 재조회하는 트리거로 쓴다
   *  (TranscriptPanel은 prop 구조 기반이라 store.applySplit만으론 삽입된 행이 화면에 안 나타나서). */
  remoteSplitRevision: number

  setPartial: (data: TranscriptPartialData) => void
  addFinal: (data: TranscriptFinalData) => void
  loadFinals: (data: TranscriptFinalData[]) => void
  setSpeaker: (data: SpeakerChangeData) => void
  setMeetingNotes: (markdown: string | null) => void
  markApplied: (ids: number[]) => void
  removeFinals: (ids: number[]) => void
  updateFinal: (id: number, content: string) => void
  /** split 반영: updated.id인 기존 항목을 응답값으로 갱신하고 그 바로 뒤에 inserted를 끼운다.
   *  updated.id를 못 찾으면(아직 로드 전 등) no-op. */
  applySplit: (updated: Transcript, inserted: Transcript) => void
  /** 원격 transcript_split 수신을 표시(카운터 증가). 채널 코드에서만 호출할 것. */
  markRemoteSplit: () => void
  setSpeakerName: (speakerLabel: string, name: string | null) => void
  clearSpeakerNames: () => void
  setSummarizing: (kind: 'realtime' | 'final' | null) => void
  setSummaryError: (error: { kind: string; message: string } | null) => void
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
  summaryError: null as { kind: string; message: string } | null,
  lastUserEditAt: 0,
  lastResetAt: 0,
  remoteSplitRevision: 0,
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

  applySplit: (updated, inserted) =>
    set((state) => {
      const idx = state.finals.findIndex((f) => f.id === updated.id)
      if (idx === -1) return state
      const existing = state.finals[idx]
      // transcript_json은 audio_source를 내려주지 않는다(백엔드 직렬화 범위 밖) — 기존 값을 승계.
      // applied_to_minutes가 없으면(방어적) 기존 항목의 applied를 그대로 유지한다("대기" 배지 오표시 방지).
      const updatedFinal: TranscriptFinalData = {
        ...existing,
        content: updated.content,
        speaker_label: updated.speaker_label,
        speaker_name: updated.speaker_name ?? null,
        started_at_ms: updated.started_at_ms,
        ended_at_ms: updated.ended_at_ms,
        sequence_number: updated.sequence_number,
        applied: updated.applied_to_minutes ?? existing.applied,
      }
      const insertedFinal: TranscriptFinalData = {
        id: inserted.id,
        content: inserted.content,
        speaker_label: inserted.speaker_label,
        speaker_name: inserted.speaker_name ?? null,
        started_at_ms: inserted.started_at_ms,
        ended_at_ms: inserted.ended_at_ms,
        sequence_number: inserted.sequence_number,
        applied: inserted.applied_to_minutes ?? existing.applied,
        audio_source: existing.audio_source,
      }
      // 트레일링 sequence_number 미러링: 백엔드가 분할 대상 뒤의 모든 행을 sequence_number+1로
      // 재번호하지만(transcripts_controller.rb split) 응답 {updated, inserted}엔 그 정보가 없다.
      // 로컬 split(재조회 없음)이면 이걸 흉내내지 않는 한 트레일링 행들의 sequence_number가
      // 서버 실제값보다 1 작게 남는다. 원격 split이면 뒤이어 MeetingPage가 전체 재조회
      // (loadFinals)해 authoritative 값으로 덮어쓰므로 여기서 bump해도 안전하다.
      const bumpTrailingSeq = (f: TranscriptFinalData): TranscriptFinalData =>
        f.sequence_number > updated.sequence_number ? { ...f, sequence_number: f.sequence_number + 1 } : f
      const finals = [
        ...state.finals.slice(0, idx).map(bumpTrailingSeq),
        updatedFinal,
        insertedFinal,
        ...state.finals.slice(idx + 1).map(bumpTrailingSeq),
      ]
      const appliedIds = new Set(state.appliedIds)
      if (updatedFinal.applied) appliedIds.add(updatedFinal.id)
      if (insertedFinal.applied) appliedIds.add(insertedFinal.id)
      return { finals, appliedIds }
    }),

  markRemoteSplit: () => set((state) => ({ remoteSplitRevision: state.remoteSplitRevision + 1 })),

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

  setSummaryError: (error) => set({ summaryError: error }),

  markUserEdit: () => set({ lastUserEditAt: Date.now() }),

  markReset: () => set({ lastResetAt: Date.now() }),

  reset: () =>
    set((state) => ({
      ...initialState,
      clientId: state.clientId,
      lastResetAt: state.lastResetAt,
    })),
}))
