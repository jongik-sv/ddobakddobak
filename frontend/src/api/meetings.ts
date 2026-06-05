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
  /** 모든 사용자에게 공유 여부 (기본 true) */
  shared: boolean
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
  /** 이 회의가 속한 폴더의 공유 여부(상세 응답에만 포함). false면 폴더가 비공개라 회의도 숨겨진다. */
  folder_shared?: boolean | null
  transcription_progress?: number
  audio_duration_ms: number
  last_transcript_end_ms: number
  last_sequence_number: number
  memo: string | null
  attendees: string | null
  tags?: { id: number; name: string; color: string }[]
  share_code?: string | null
  /** 모든 사용자에게 공유 여부 (기본 true). 비공유면 소유자/admin만 조회 가능. */
  shared: boolean
  /** 현재 사용자가 이 회의를 수정/삭제할 수 있는지 (소유자 ∨ admin). 서버가 계산해 내려준다. */
  editable?: boolean
  started_at: string | null
  ended_at: string | null
  created_at: string
}

/**
 * 회의 수정/삭제 등 소유권이 필요한 어포던스를 노출할지 판단하는 순수 헬퍼.
 *
 * 서버가 meeting_json에 계산해 내려주는 `editable`을 1순위로 신뢰하고,
 * (구버전 응답 등으로) 없을 때만 클라이언트에서 소유자(created_by.id === user.id)
 * 또는 admin 여부로 추론한다. UX 어포던스 게이팅 용도이며, 권한 자체는 서버가 403으로 강제한다.
 */
export function canEditMeeting(
  meeting: Pick<Meeting, 'editable' | 'created_by'> | null | undefined,
  user: { id: number; role: 'admin' | 'member' } | null | undefined,
): boolean {
  if (!meeting) return false
  if (typeof meeting.editable === 'boolean') return meeting.editable
  if (!user) return false
  return meeting.created_by?.id === user.id || user.role === 'admin'
}

export interface MeetingListMeta {
  total: number
  page: number
  per: number
  status_counts?: Partial<Record<Meeting['status'], number>>
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

export async function createMeeting(data: { title: string; meeting_type?: string; folder_id?: number | null; shared?: boolean }): Promise<Meeting> {
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

export async function updateTranscript(
  meetingId: number,
  transcriptId: number,
  content: string,
  clientId?: string,
): Promise<Transcript> {
  const res = await apiClient
    .patch(`meetings/${meetingId}/transcripts/${transcriptId}/update_content`, {
      json: { content, client_id: clientId },
    })
    .json<{ transcript: Transcript }>()
  return res.transcript
}

/** 온디바이스(로컬) STT 결과를 서버에 일괄 영속화한다 (멱등: sequence_number 기준 upsert). */
export interface BulkTranscriptItem {
  content: string
  speaker_label: string
  started_at_ms: number
  ended_at_ms: number
  sequence_number: number
  audio_source?: 'mic' | 'system'
}

export async function bulkCreateTranscripts(
  meetingId: number,
  items: BulkTranscriptItem[],
): Promise<void> {
  await apiClient.post(`meetings/${meetingId}/transcripts/bulk`, {
    json: { transcripts: items },
  })
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

/**
 * 오프라인(로컬) 회의 프로모트용 단발 오디오 업로드.
 *
 * uploadAudio와 달리 res.ok를 검사해 실패 시 throw 한다 — syncQueue.flush가 실패를
 * 감지해 pendingSync를 유지하고 재시도하도록(성공 경로에서만 has_audio_file이 켜진다).
 * 엔드포인트는 온라인 경로와 동일한 POST /meetings/:id/audio (서버가 AudioUploadJob으로 mp3 변환).
 */
export async function promoteAudio(id: number, blob: Blob): Promise<void> {
  const formData = new FormData()
  const ext = blob.type.includes('wav') ? 'wav' : 'webm'
  formData.append('audio', blob, `promote.${ext}`)

  const res = await fetch(`${getApiBaseUrl()}/meetings/${id}/audio`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `오디오 업로드 실패 (${res.status})`)
  }
}

/** 녹음 중 압축 오디오 청크를 seq 순서대로 연속 업로드 (모바일) */
export async function uploadAudioChunk(id: number, blob: Blob, sequence: number): Promise<void> {
  const formData = new FormData()
  formData.append('chunk', blob, `chunk-${sequence}.webm`)
  formData.append('sequence', String(sequence))

  await fetch(`${getApiBaseUrl()}/meetings/${id}/audio_chunk`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  })
}

/** 녹음 종료: 업로드된 청크들을 서버에서 이어붙여 mp3로 변환 */
export async function finalizeAudio(id: number): Promise<void> {
  await fetch(`${getApiBaseUrl()}/meetings/${id}/audio_finalize`, {
    method: 'POST',
    headers: getAuthHeaders(),
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
  /** 공유 여부. 소유자/admin만 반영된다(서버 강제). */
  shared?: boolean
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

export async function updateNotes(meetingId: number, notesMarkdown: string, clientId?: string): Promise<void> {
  await apiClient.patch(`meetings/${meetingId}/update_notes`, {
    json: { notes_markdown: notesMarkdown, client_id: clientId },
  })
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
