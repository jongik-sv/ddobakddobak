import { HTTPError } from 'ky'
import apiClient from '../client'
import type {
  Meeting,
  MeetingAccessResult,
  MeetingDetail,
  MeetingListResponse,
  GetMeetingsParams,
} from './types'

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
  if (params.project_id != null) searchParams.project_id = params.project_id
  if (params.show_all) searchParams.show_all = 1
  return apiClient.get('meetings', { searchParams }).json()
}

export async function createMeeting(data: { title: string; meeting_type?: string; folder_id?: number | null; shared?: boolean; previous_meeting_id?: number | null; project_id?: number | null }): Promise<Meeting> {
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

export async function stopMeeting(id: number, opts?: { skipSummary?: boolean }): Promise<Meeting> {
  const searchParams = opts?.skipSummary ? { skip_summary: 'true' } : undefined
  const res: { meeting: Meeting } = await apiClient
    .post(`meetings/${id}/stop`, searchParams ? { searchParams } : undefined)
    .json()
  return res.meeting
}

export async function pauseMeeting(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/pause`).json()
  return res.meeting
}

export async function resumeMeeting(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/resume`).json()
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

export async function deleteMeeting(id: number): Promise<void> {
  await apiClient.delete(`meetings/${id}`)
}
