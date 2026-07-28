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
  // exists_on_dflow가 true일 때만 포함된다 — 재전송 시 덮어쓸 D'Flow 회의록 미리보기(W17).
  dflow_title?: string | null
  dflow_date?: string | null
  // exists_on_dflow가 true이고 D'Flow가 보관 상태를 실어줄 때만 포함된다(W14/dflow-W24).
  // R1 이전 D'Flow(또는 아직 archived 필드를 안 보내는 구버전) 응답엔 키 자체가 없다 —
  // undefined는 "모름"이지 "보관 아님"이 아니다.
  dflow_archived?: boolean
}

/**
 * 전송(upload) 응답 = 4필드 공통 응답 + D'Flow 편철 결과 에코.
 *
 * `folder_id`/`folder_path`는 D'Flow가 **실제로** 편철한 위치다(깊이 절단·팀 루트
 * 한 칸 내림이 반영된 결과이므로 요청한 경로와 다를 수 있다).
 *
 * ⚠️ 값이 3종이고 **뭉개면 안내가 정반대가 된다**:
 *   - `undefined`(키 부재) — 편철 정보 없음. 백엔드가 아직 에코하지 않는 구간(1차 배치)
 *   - `null`              — **미분류**. 어느 폴더에도 안 들어감(시드 팀 루트 부재)
 *   - `[]`                — 팀 루트에 편철 **성공**. 단 `folder_id != null`일 때만 그렇다
 *                           (미분류를 `null`로 줄지 `[]`로 줄지는 D'Flow 확정 대기)
 *
 * 판정은 `folder_path`가 아니라 `folder_id`로 한다(`folder_id === null` → 미분류).
 * `folder_path`의 미분류 표현값(`null` vs `[]`)은 D'Flow 확정 대기라 판정 기준이 될 수 없다.
 * 미분류 문구는 "미분류로 들어갔습니다(D'Flow에서 편철 필요)" — **"팀 루트"라고 쓰지 말 것**.
 * (문구·표시 구현 위치는 SendToDflowDialog(W8). 여기는 타입만 정의한다.)
 *
 * `folder_path_status`는 folder_id/folder_path와 별개 필드다(계약 v2.4 §4.3/§4c.2) — 값은 4종:
 *   - `exact`        — 정상 편철(요청 경로 그대로)
 *   - `truncated`     — 깊이 5 초과로 상위 폴더로 절단
 *   - `partial`       — 중간 폴더 생성 실패로 조상 폴더까지만 편철
 *   - `unclassified`  — 시드 팀 루트 부재로 미분류
 * 키 부재(`undefined`)는 위 3필드와 동일한 규약이다 — 백엔드가 아직 에코하지 않는 구간(D'Flow 구버전)이니
 * **아무 것도 표시하지 않는다**(`exact`로 간주하지 말 것).
 */
export interface DflowUploadResult extends DflowMeetingStatus {
  folder_id?: string | null
  folder_path?: string[] | null
  folder_path_status?: 'exact' | 'truncated' | 'partial' | 'unclassified'
}

export async function uploadToDflow(
  meetingId: number,
  params: { teamOverride?: string; titleOverride?: string } = {}
): Promise<DflowUploadResult> {
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
