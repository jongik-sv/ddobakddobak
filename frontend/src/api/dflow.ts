import apiClient from './client'

// ── D'Flow 연동 설정 (admin, server mode) ──

export interface DflowSettings {
  enabled: boolean
  base_url: string | null
  api_secret_masked: string
}

export interface UpdateDflowSettingsParams {
  enabled?: boolean
  base_url?: string
  api_secret?: string
}

export async function getDflowSettings(): Promise<DflowSettings> {
  return apiClient.get('settings/dflow').json()
}

export async function updateDflowSettings(
  params: UpdateDflowSettingsParams
): Promise<DflowSettings> {
  return apiClient.put('settings/dflow', { json: params }).json()
}

// ── 회의별 D'Flow 전송·연결 상태 (4필드 공통 응답) ──

export interface DflowMeetingStatus {
  public_uid: string | null
  dflow_synced_at: string | null
  dflow_url: string | null
  needs_resync: boolean
}

export interface DflowMeetingStatusWithExists extends DflowMeetingStatus {
  // public_uid가 있을 때만 status 응답에 포함된다.
  exists_on_dflow?: boolean
}

export async function uploadToDflow(
  meetingId: number,
  params: { teamOverride?: string; titleOverride?: string } = {}
): Promise<DflowMeetingStatus> {
  const body: { team?: string; title?: string } = {}
  if (params.teamOverride) body.team = params.teamOverride
  if (params.titleOverride) body.title = params.titleOverride
  return apiClient.post(`meetings/${meetingId}/dflow/upload`, { json: body }).json()
}

export async function getDflowStatus(meetingId: number): Promise<DflowMeetingStatusWithExists> {
  return apiClient.get(`meetings/${meetingId}/dflow/status`).json()
}

export async function setDflowLink(
  meetingId: number,
  publicUid: string | null
): Promise<DflowMeetingStatus> {
  return apiClient
    .put(`meetings/${meetingId}/dflow/link`, { json: { public_uid: publicUid } })
    .json()
}

export async function claimDflowMinute(
  meetingId: number,
  dflowMinuteId: string
): Promise<DflowMeetingStatus> {
  return apiClient
    .post(`meetings/${meetingId}/dflow/claim`, { json: { minute_id: dflowMinuteId } })
    .json()
}

// ── D'Flow 조회 프록시 ──

export interface DflowMinuteItem {
  id: string
  title: string
  date: string
  team: string
  external_id: string | null
  created_by_name: string
  created_at: string
  updated_at: string
  url: string
}

export interface ListDflowMinutesResponse {
  items: DflowMinuteItem[]
  total: number
  page: number
  per_page: number
}

export interface ListDflowMinutesParams {
  date_from?: string
  date_to?: string
  team?: string
  linked?: boolean
  page?: number
}

export async function listDflowMinutes(
  params: ListDflowMinutesParams = {}
): Promise<ListDflowMinutesResponse> {
  const searchParams: Record<string, string | number | boolean> = {}
  if (params.date_from) searchParams.date_from = params.date_from
  if (params.date_to) searchParams.date_to = params.date_to
  if (params.team) searchParams.team = params.team
  if (params.linked !== undefined) searchParams.linked = params.linked
  if (params.page) searchParams.page = params.page
  return apiClient.get('dflow/minutes', { searchParams }).json()
}

export interface DflowProject {
  id: string
  name: string
}

export interface DflowLimits {
  max_body_chars: number
  max_request_bytes: number
  max_attachments: number
  max_attachment_bytes: number
}

export interface DflowMeta {
  teams: string[]
  projects: DflowProject[]
  limits: DflowLimits
}

export async function getDflowMeta(projectId?: string): Promise<DflowMeta> {
  const searchParams: Record<string, string> = {}
  if (projectId) searchParams.project_id = projectId
  return apiClient.get('dflow/meta', { searchParams }).json()
}
