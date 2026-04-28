import { HTTPError } from 'ky'
import apiClient, { getAuthHeaders } from './client'
import { getApiBaseUrl } from '../config'

export interface MeetingDetail {
  id: number
  title: string
  status: 'pending' | 'recording' | 'transcribing' | 'completed'
  started_at: string | null
  ended_at: string | null
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
  has_audio_file?: boolean
  folder_id: number | null
  transcription_progress?: number
  audio_duration_ms: number
  last_transcript_end_ms: number
  last_sequence_number: number
  memo: string | null
  attendees: string | null
  tags?: { id: number; name: string; color: string }[]
  share_code?: string | null
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
  status?: string
  date_from?: string
  date_to?: string
  folder_id?: number | null
}

export async function getMeetings(params: GetMeetingsParams): Promise<MeetingListResponse> {
  const searchParams: Record<string, string | number> = {}
  if (params.page) searchParams.page = params.page
  if (params.per) searchParams.per = params.per
  if (params.q) searchParams.q = params.q
  if (params.status) searchParams.status = params.status
  if (params.date_from) searchParams.date_from = params.date_from
  if (params.date_to) searchParams.date_to = params.date_to
  if (params.folder_id !== undefined) {
    searchParams.folder_id = params.folder_id === null ? 'null' : params.folder_id
  }
  return apiClient.get('meetings', { searchParams }).json()
}

export async function createMeeting(data: { title: string; meeting_type?: string; folder_id?: number | null }): Promise<Meeting> {
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

export async function regenerateStt(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/regenerate_stt`).json()
  return res.meeting
}

export async function regenerateNotes(id: number): Promise<void> {
  await apiClient.post(`meetings/${id}/regenerate_notes`)
}

export async function deleteTranscripts(meetingId: number, ids: number[]): Promise<{ deleted: number }> {
  return apiClient.delete(`meetings/${meetingId}/transcripts/destroy_batch`, { json: { ids } }).json()
}

export async function uploadAudio(id: number, blob: Blob): Promise<void> {
  const formData = new FormData()
  const ext = blob.type.includes('wav') ? 'wav' : 'webm'
  formData.append('audio', blob, `recording.${ext}`)

  // FormData 전송 시 브라우저가 Content-Type(multipart boundary 포함)을 자동 설정하도록
  // ky 대신 fetch를 직접 사용
  await fetch(`${getApiBaseUrl()}/meetings/${id}/audio`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  })
}

export async function uploadAudioFile(data: {
  title: string
  meeting_type?: string
  audio: File
}): Promise<Meeting> {
  const formData = new FormData()
  formData.append('title', data.title)
  if (data.meeting_type) formData.append('meeting_type', data.meeting_type)
  formData.append('audio', data.audio)

  const res = await fetch(`${getApiBaseUrl()}/meetings/upload_audio`, {
    method: 'POST',
    headers: getAuthHeaders(),
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
  folder_id?: number | null
  meeting_type?: string
  tag_ids?: number[]
  brief_summary?: string | null
  attendees?: string | null
}

export async function updateMeeting(id: number, params: UpdateMeetingParams): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.patch(`meetings/${id}`, { json: params }).json()
  return res.meeting
}

export async function deleteMeeting(id: number): Promise<void> {
  await apiClient.delete(`meetings/${id}`)
}

export interface TermCorrection {
  from: string
  to: string
}

export async function correctTerms(meetingId: number, corrections: TermCorrection[]): Promise<{ notes_markdown: string; corrected_transcripts: number }> {
  return apiClient.post(`meetings/${meetingId}/feedback`, { json: { corrections }, timeout: 60000 }).json()
}

export async function updateNotes(meetingId: number, notesMarkdown: string): Promise<void> {
  await apiClient.patch(`meetings/${meetingId}/update_notes`, { json: { notes_markdown: notesMarkdown } })
}

export async function updateMemo(meetingId: number, memo: string): Promise<void> {
  await apiClient.patch(`meetings/${meetingId}`, { json: { memo } })
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

/**
 * 회의 프롬프트를 텍스트로 다운로드한다.
 * GET /api/v1/meetings/:id/export_prompt
 */
export async function exportPrompt(meetingId: number): Promise<string> {
  return apiClient.get(`meetings/${meetingId}/export_prompt`).text()
}

export interface ExportOptions {
  include_summary: boolean
  include_memo: boolean
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
    include_memo: String(options.include_memo),
    include_transcript: String(options.include_transcript),
  })
  return apiClient
    .get(`meetings/${meetingId}/export`, { searchParams })
    .text()
}

export interface MeetingExportData {
  meeting: {
    id: number
    title: string
    date: string
    start_time: string
    end_time: string
    status: string
    creator_name: string
  }
  summary: {
    type: 'notes_markdown' | 'json_fields'
    notes_markdown?: string
    key_points?: string[]
    decisions?: string[]
    discussion_details?: string[]
  } | null
  memo?: string | null
  action_items: Array<{
    content: string
    status: string
    assignee_name: string | null
    due_date: string | null
  }>
  transcripts: Array<{
    speaker_label: string
    timestamp: string
    content: string
  }>
}

// --- 공유 API ---

export interface Participant {
  id: number
  user_id: number
  user_name: string
  role: 'host' | 'viewer'
  joined_at: string
}

export interface ShareResponse {
  share_code: string
  participants: Participant[]
}

export interface JoinResponse {
  meeting: Meeting
  participant: Participant
}

export async function shareMeeting(meetingId: number): Promise<ShareResponse> {
  return apiClient.post(`meetings/${meetingId}/share`).json()
}

export async function stopSharing(meetingId: number): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/share`)
}

export async function joinMeeting(shareCode: string): Promise<JoinResponse> {
  return apiClient.post('meetings/join', { json: { share_code: shareCode } }).json()
}

export async function getParticipants(meetingId: number): Promise<Participant[]> {
  const res = await apiClient.get(`meetings/${meetingId}/participants`).json<{ participants: Participant[] }>()
  return res.participants
}

export async function transferHost(meetingId: number, targetUserId: number): Promise<Participant[]> {
  const res = await apiClient.post(`meetings/${meetingId}/transfer_host`, {
    json: { target_user_id: targetUserId },
  }).json<{ participants: Participant[] }>()
  return res.participants
}

export async function claimHost(meetingId: number): Promise<Participant[]> {
  const res = await apiClient.post(`meetings/${meetingId}/claim_host`).json<{ participants: Participant[] }>()
  return res.participants
}

export async function exportMeetingData(
  meetingId: number,
  options: ExportOptions,
): Promise<MeetingExportData> {
  const searchParams = new URLSearchParams({
    include_summary: String(options.include_summary),
    include_memo: String(options.include_memo),
    include_transcript: String(options.include_transcript),
    export_format: 'json',
  })
  return apiClient
    .get(`meetings/${meetingId}/export`, { searchParams })
    .json()
}
