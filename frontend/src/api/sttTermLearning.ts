import apiClient from './client'

const BASE = 'admin/stt_term_learning'

export type LevelRef = { type: 'global' | 'Project' | 'Folder'; id: number | null }
export type LevelInfo = LevelRef & { name: string; path: string[] }

export interface PromoteCandidate {
  term: string
  folder_ids: number[]
}

export interface FolderNode {
  id: number
  name: string
  parent_id: number | null
  term_count: number
  new_count: number
  promote_candidates: PromoteCandidate[]
}

export interface ProjectNode {
  id: number
  name: string
  term_count: number
  new_count: number
  promote_candidates: PromoteCandidate[]
  folders: FolderNode[]
}

export interface TreeResponse {
  global: { term_count: number; new_count: number }
  projects: ProjectNode[]
}

export interface TermRow {
  row_id: string
  term: string
  key: string
  category: string | null
  definition: string | null
  mispronunciations: string[]
  domain_file: { id: number; name: string; auto: boolean }
  level: LevelInfo
  source: 'auto' | 'feedback' | 'human' | 'human_merged'
  meeting_ids: number[]
  is_new: boolean
  applied_meeting_count: number
  duplicate_group: string | null
  merge_target: LevelInfo | null
}

export interface MeetingRef {
  id: number
  title: string
  level: LevelInfo | null
}

export interface RunSummary {
  id: number
  meeting: MeetingRef
  trigger: string
  status: string
  registered_count: number
  skipped_count: number
  no_change: boolean
  error: string | null
  llm_skipped_reason: string | null
  created_at: string
  finished_at: string | null
}

export type DiffOp = { op: 'equal' | 'delete' | 'insert'; text: string }

export interface RunItem {
  id: number
  wrong: string
  correct: string
  source: string
  verdict: string
  reason: string | null
  domain_file: { id: number; name: string } | null
  level: LevelInfo | null
  revert_result: string | null
}

export type RunDetail = RunSummary & {
  ai_generated_at: string | null
  human_edited_at: string | null
  diff: DiffOp[]
  items: RunItem[]
}

export interface PendingRun {
  meeting: MeetingRef
  summary_id: number
  human_edited_at: string
  eta: string
}

export interface Misrecognition {
  id: number
  wrong: string
  correct: string
  status: string
  hit_count: number
  meeting_ids: number[]
  /** auto: 등록 위치가 자동 파일인가(false = 사람 파일) */
  registered: { domain_file_id: number; term_key: string; auto: boolean; level: LevelInfo } | null
  last_seen_at: string | null
}

export interface SttLearningSettings {
  enabled: boolean
  idle_minutes: number
  min_confidence: number
}

export interface MoveRequest {
  domain_file_id: number
  term_keys: string[] | null
  target: LevelRef
  copy?: boolean
  merge_descendants?: boolean
}

export interface ImpactTarget {
  level: LevelRef
  domain_file_id?: number
}

export interface AiOriginal {
  available: boolean
  ai_generated_at: string | null
  human_edited_at: string | null
  diff: DiffOp[]
}

export interface ScopeProject {
  id: number
  name: string
  personal: boolean
}

/** 관리자 화면에 보이는 프로젝트(프로젝트 선택기 옵션). */
export async function getScopeProjects(): Promise<ScopeProject[]> {
  const res = await apiClient.get(`${BASE}/projects`).json<{ projects: ScopeProject[] }>()
  return res.projects
}

/** projectId 를 주면 그 프로젝트(+전역)만. 생략하면 보이는 전체. */
export function getTree(projectId?: number | null): Promise<TreeResponse> {
  if (projectId == null) return apiClient.get(`${BASE}/tree`).json()
  return apiClient.get(`${BASE}/tree`, { searchParams: { project_id: String(projectId) } }).json()
}

export async function getTerms(
  params: { level?: LevelRef; includeDescendants?: boolean; projectId?: number | null } = {},
): Promise<{ terms: TermRow[] }> {
  const searchParams: Record<string, string> = {}
  if (params.level) {
    searchParams.level_type = params.level.type
    if (params.level.id != null) searchParams.level_id = String(params.level.id)
  }
  if (params.includeDescendants) searchParams.include_descendants = '1'
  if (params.projectId != null) searchParams.project_id = String(params.projectId)
  return apiClient.get(`${BASE}/terms`, { searchParams }).json()
}

export async function getImpact(targets: ImpactTarget[]): Promise<number[]> {
  const res = await apiClient.post(`${BASE}/impact`, { json: { targets } }).json<{ counts: number[] }>()
  return res.counts
}

export function applyMoves(moves: MoveRequest[]): Promise<{ moved: number; merged: number }> {
  return apiClient.post(`${BASE}/moves`, { json: { moves } }).json()
}

export function deleteTerms(items: { domain_file_id: number; term_key: string }[]): Promise<{ deleted: number }> {
  return apiClient.post(`${BASE}/terms/delete`, { json: { items } }).json()
}

export function getSettings(): Promise<SttLearningSettings> {
  return apiClient.get(`${BASE}/settings`).json()
}

export function updateSettings(s: SttLearningSettings): Promise<SttLearningSettings> {
  return apiClient.put(`${BASE}/settings`, { json: s }).json()
}

export function getRuns(
  status?: string,
  projectId?: number | null,
): Promise<{ runs: RunSummary[]; pending: PendingRun[] }> {
  const searchParams: Record<string, string> = {}
  if (status) searchParams.status = status
  if (projectId != null) searchParams.project_id = String(projectId)
  return apiClient.get(`${BASE}/runs`, { searchParams }).json()
}

export async function getRun(id: number): Promise<RunDetail> {
  const res = await apiClient.get(`${BASE}/runs/${id}`).json<{ run: RunDetail }>()
  return res.run
}

export function revertRun(id: number): Promise<{ run: RunSummary; reverted: number; skipped_item_ids: number[] }> {
  return apiClient.post(`${BASE}/runs/${id}/revert`).json()
}

export async function rerunRun(id: number): Promise<RunSummary> {
  const res = await apiClient.post(`${BASE}/runs/${id}/rerun`).json<{ run: RunSummary }>()
  return res.run
}

export async function analyzeMeeting(meetingId: number): Promise<RunSummary> {
  const res = await apiClient.post(`${BASE}/meetings/${meetingId}/analyze`).json<{ run: RunSummary }>()
  return res.run
}

export async function registerItem(runId: number, itemId: number): Promise<RunItem> {
  const res = await apiClient.post(`${BASE}/runs/${runId}/items/${itemId}/register`).json<{ item: RunItem }>()
  return res.item
}

export function getMisrecognitions(
  params: { status?: string; q?: string; projectId?: number | null } = {},
): Promise<{ misrecognitions: Misrecognition[]; counts: { total: number; undecided: number } }> {
  const searchParams: Record<string, string> = {}
  if (params.status) searchParams.status = params.status
  if (params.q) searchParams.q = params.q
  if (params.projectId != null) searchParams.project_id = String(params.projectId)
  return apiClient.get(`${BASE}/misrecognitions`, { searchParams }).json()
}

export async function updateMisrecognition(
  id: number,
  body: { status: string; correct?: string },
): Promise<Misrecognition> {
  const res = await apiClient.patch(`${BASE}/misrecognitions/${id}`, { json: body }).json<{ misrecognition: Misrecognition }>()
  return res.misrecognition
}

export function getAiOriginal(meetingId: number): Promise<AiOriginal> {
  return apiClient.get(`meetings/${meetingId}/ai_original`).json()
}
