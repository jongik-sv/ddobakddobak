import apiClient from './client'

export interface DomainFile {
  id: number
  name: string
  project_id: number | null
  created_by_id: number
  content_chars: number
  updated_at: string
  /** 현재 유저가 이 파일을 편집·삭제할 수 있는지. index(GET /domain_files) 응답에만 포함됨 */
  editable?: boolean
}

export interface DomainFileDetail extends DomainFile {
  content: string
}

export interface ExtractedTerm {
  term: string
  category: string
  definition: string
}

/** 프로젝트/폴더/회의 도메인 파일 링크 조회에 쓰이는 요약 형태 (§계약서 API). */
export interface DomainFileSummary {
  id: number
  name: string
  project_id: number | null
  updated_at: string
  /** 현재 유저가 이 파일의 내용을 편집·삭제할 수 있는지 */
  editable: boolean
}

/** 회의 실효 적용분 중 회의 자체 링크가 아닌, 폴더/프로젝트에서 상속된 항목 */
export interface InheritedDomainFile extends DomainFileSummary {
  source: 'folder' | 'project'
  owner_name: string
}

export async function listDomainFiles(projectId?: number | null): Promise<{ domain_files: DomainFile[] }> {
  const searchParams: Record<string, string> = {}
  if (projectId != null) searchParams.project_id = String(projectId)
  return apiClient.get('domain_files', { searchParams }).json()
}

export async function createDomainFile(
  data: { name: string; content: string; project_id?: number | null },
): Promise<{ domain_file: DomainFileDetail }> {
  return apiClient.post('domain_files', { json: data }).json()
}

export async function uploadDomainFile(
  file: File,
  o?: { name?: string; project_id?: number | null },
): Promise<{ domain_file: DomainFileDetail }> {
  const formData = new FormData()
  formData.append('file', file)
  if (o?.name) formData.append('name', o.name)
  if (o?.project_id != null) formData.append('project_id', String(o.project_id))
  return apiClient.post('domain_files', { body: formData }).json()
}

export async function getDomainFile(id: number): Promise<{ domain_file: DomainFileDetail }> {
  return apiClient.get(`domain_files/${id}`).json()
}

export async function updateDomainFile(
  id: number,
  data: { name?: string; content?: string },
): Promise<{ domain_file: DomainFileDetail }> {
  return apiClient.patch(`domain_files/${id}`, { json: data }).json()
}

export async function deleteDomainFile(id: number): Promise<void> {
  await apiClient.delete(`domain_files/${id}`)
}

export async function mergeDomainTerms(
  id: number,
  terms: ExtractedTerm[],
): Promise<{ domain_file: DomainFileDetail; added: number; replaced: number }> {
  return apiClient.post(`domain_files/${id}/merge_terms`, { json: { terms } }).json()
}

export interface MeetingDomainFilesResponse {
  selected: DomainFileSummary[]
  inherited: InheritedDomainFile[]
  /** 상속분(폴더/프로젝트) 중 이 회의에서 명시적으로 제외된 파일 */
  excluded: DomainFileSummary[]
}

export async function getMeetingDomainFiles(meetingId: number): Promise<MeetingDomainFilesResponse> {
  return apiClient.get(`meetings/${meetingId}/domain_files`).json()
}

export async function setMeetingDomainFiles(
  meetingId: number,
  ids: number[],
  /** 생략하면 서버가 기존 exclude 상태를 유지(하위호환) */
  excludedIds?: number[],
): Promise<MeetingDomainFilesResponse> {
  const json: { domain_file_ids: number[]; excluded_domain_file_ids?: number[] } = { domain_file_ids: ids }
  if (excludedIds !== undefined) json.excluded_domain_file_ids = excludedIds
  return apiClient.put(`meetings/${meetingId}/domain_files`, { json }).json()
}

export async function getProjectDomainFiles(projectId: number): Promise<{ domain_files: DomainFileSummary[] }> {
  return apiClient.get(`projects/${projectId}/domain_files`).json()
}

export async function setProjectDomainFiles(
  projectId: number,
  ids: number[],
): Promise<{ domain_files: DomainFileSummary[] }> {
  return apiClient.put(`projects/${projectId}/domain_files`, { json: { domain_file_ids: ids } }).json()
}

export interface FolderDomainFilesResponse {
  domain_files: DomainFileSummary[]
  /** 상위(프로젝트 + 조상 폴더)에서 상속된 파일 — 선택 모달에서 중복 선택 방지에 사용 */
  inherited: InheritedDomainFile[]
}

export async function getFolderDomainFiles(folderId: number): Promise<FolderDomainFilesResponse> {
  return apiClient.get(`folders/${folderId}/domain_files`).json()
}

export async function setFolderDomainFiles(
  folderId: number,
  ids: number[],
): Promise<{ domain_files: DomainFileSummary[] }> {
  return apiClient.put(`folders/${folderId}/domain_files`, { json: { domain_file_ids: ids } }).json()
}

export async function extractDomainTerms(meetingId: number): Promise<{ terms: ExtractedTerm[] }> {
  return apiClient.post(`meetings/${meetingId}/extract_terms`, { timeout: 60000 }).json()
}
