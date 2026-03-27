import { HTTPError } from 'ky'
import apiClient from './client'
import { useAuthStore } from '../stores/authStore'
import { API_BASE_URL } from '../config'

export interface MeetingDetail {
  id: number
  title: string
  status: 'pending' | 'recording' | 'transcribing' | 'completed'
  started_at: string | null
  ended_at: string | null
  team_id: number
  created_by_id: number
  created_at: string
  updated_at: string
}

export type MeetingAccessError = 'forbidden' | 'not_found' | 'unknown'

export interface MeetingAccessResult {
  meeting: MeetingDetail | null
  error: MeetingAccessError | null
}

export async function getMeetingDetail(id: number): Promise<MeetingAccessResult> {
  try {
    const res = await apiClient.get(`meetings/${id}`).json<{ meeting: MeetingDetail }>()
    return { meeting: res.meeting, error: null }
  } catch (err: unknown) {
    if (err instanceof HTTPError) {
      if (err.response.status === 403) return { meeting: null, error: 'forbidden' }
      if (err.response.status === 404) return { meeting: null, error: 'not_found' }
    }
    return { meeting: null, error: 'unknown' }
  }
}

export interface Meeting {
  id: number
  title: string
  status: 'pending' | 'recording' | 'transcribing' | 'completed'
  meeting_type: string
  created_by: { id: number; name: string }
  brief_summary: string | null
  source?: 'live' | 'upload'
  transcription_progress?: number
  audio_duration_ms: number
  last_sequence_number: number
  started_at: string | null
  ended_at: string | null
  created_at: string
}

export interface MeetingListMeta {
  total: number
  page: number
  per: number
}

export interface MeetingListResponse {
  meetings: Meeting[]
  meta: MeetingListMeta
}

export interface GetMeetingsParams {
  page?: number
  per?: number
  q?: string
  team_id?: number
  date_from?: string
  date_to?: string
}

export async function getMeetings(params: GetMeetingsParams): Promise<MeetingListResponse> {
  const searchParams: Record<string, string | number> = {}
  if (params.page) searchParams.page = params.page
  if (params.per) searchParams.per = params.per
  if (params.q) searchParams.q = params.q
  if (params.team_id) searchParams.team_id = params.team_id
  if (params.date_from) searchParams.date_from = params.date_from
  if (params.date_to) searchParams.date_to = params.date_to
  return apiClient.get('meetings', { searchParams }).json()
}

export async function createMeeting(data: { title: string; team_id: number; meeting_type?: string }): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post('meetings', { json: data }).json()
  return res.meeting
}

export async function getMeeting(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.get(`meetings/${id}`).json()
  return res.meeting
}

export async function startMeeting(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/start`).json()
  return res.meeting
}

export async function stopMeeting(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/stop`).json()
  return res.meeting
}

export async function reopenMeeting(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/reopen`).json()
  return res.meeting
}

export async function resetMeetingContent(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/reset_content`).json()
  return res.meeting
}

export async function triggerRealtimeSummary(id: number): Promise<void> {
  await apiClient.post(`meetings/${id}/summarize`)
}

export async function deleteTranscripts(meetingId: number, ids: number[]): Promise<{ deleted: number }> {
  return apiClient.delete(`meetings/${meetingId}/transcripts/destroy_batch`, { json: { ids } }).json()
}

export async function uploadAudio(id: number, blob: Blob): Promise<void> {
  const formData = new FormData()
  formData.append('audio', blob, 'recording.webm')

  // FormData 전송 시 브라우저가 Content-Type(multipart boundary 포함)을 자동 설정하도록
  // ky 대신 fetch를 직접 사용
  const token = useAuthStore.getState().token
  await fetch(`${API_BASE_URL}/meetings/${id}/audio`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  })
}

export async function uploadAudioFile(data: {
  title: string
  team_id: number
  meeting_type?: string
  audio: File
}): Promise<Meeting> {
  const formData = new FormData()
  formData.append('title', data.title)
  formData.append('team_id', String(data.team_id))
  if (data.meeting_type) formData.append('meeting_type', data.meeting_type)
  formData.append('audio', data.audio)

  const token = useAuthStore.getState().token
  const res = await fetch(`${API_BASE_URL}/meetings/upload_audio`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || '업로드에 실패했습니다.')
  }
  const json = await res.json()
  return json.meeting
}

export interface SummaryResponse {
  id: number
  meeting_id: number
  key_points: string[]
  decisions: string[]
  discussion_details: string[]
  notes_markdown?: string
  summary_type: 'realtime' | 'final'
  generated_at: string
}

export async function getSummary(meetingId: number): Promise<SummaryResponse | null> {
  try {
    return await apiClient.get(`meetings/${meetingId}/summary`).json()
  } catch {
    return null
  }
}

export interface UpdateMeetingParams {
  title?: string
}

export async function updateMeeting(id: number, params: UpdateMeetingParams): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.patch(`meetings/${id}`, { json: params }).json()
  return res.meeting
}

export async function deleteMeeting(id: number): Promise<void> {
  await apiClient.delete(`meetings/${id}`)
}

export async function feedbackNotes(meetingId: number, feedback: string): Promise<string> {
  const res = await apiClient.post(`meetings/${meetingId}/feedback`, { json: { feedback }, timeout: 60000 }).json<{ notes_markdown: string }>()
  return res.notes_markdown
}

export async function updateNotes(meetingId: number, notesMarkdown: string): Promise<void> {
  await apiClient.patch(`meetings/${meetingId}/update_notes`, { json: { notes_markdown: notesMarkdown } })
}

export interface Transcript {
  id: number
  speaker_label: string
  content: string
  started_at_ms: number
  ended_at_ms: number
  sequence_number: number
  applied_to_minutes?: boolean
}

export async function getTranscripts(meetingId: number, perPage = 5000): Promise<Transcript[]> {
  try {
    const response = await apiClient
      .get(`meetings/${meetingId}/transcripts`, { searchParams: { per_page: perPage } })
      .json<{ transcripts: Transcript[] }>()
    return response.transcripts
  } catch {
    return []
  }
}

export interface ExportOptions {
  include_summary: boolean
  include_transcript: boolean
}

/**
 * 회의록을 Markdown 텍스트로 내보낸다.
 * GET /api/v1/meetings/:id/export
 * Response: text/markdown
 */
export async function exportMeeting(
  meetingId: number,
  options: ExportOptions,
): Promise<string> {
  const searchParams = new URLSearchParams({
    include_summary: String(options.include_summary),
    include_transcript: String(options.include_transcript),
  })
  return apiClient
    .get(`meetings/${meetingId}/export`, { searchParams })
    .text()
}
