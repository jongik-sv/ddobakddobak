import apiClient from './client'

export type IconType = 'lucide' | 'emoji' | 'image'

export interface Project {
  id: number
  name: string
  description: string | null
  icon_type: IconType | null
  icon_value: string | null
  color: string | null
  personal: boolean
  role: 'admin' | 'member' | null
  member_count: number
  meeting_count: number
  owner: string | null
}

export function projectDisplayName(p: Pick<Project, 'name' | 'personal' | 'owner'>): string {
  return p.personal ? `${p.owner ?? '알 수 없음'}의 회의` : p.name
}

/**
 * 남의 개인 프로젝트("XXX의 회의")는 목록에서 숨긴다 — 내가 멤버가 아닌(role==null) 개인 프로젝트.
 * 백엔드가 이미 남의 개인 프로젝트를 주지 않지만(index 필터), 프론트도 이중 방어한다.
 * 내 개인 프로젝트(role!=null)·팀 프로젝트(personal=false)는 표시.
 */
export function isHiddenClutterProject(p: Pick<Project, 'personal' | 'role'>): boolean {
  return p.personal && p.role == null
}

export interface ProjectMember {
  user_id: number
  name: string
  email: string
  role: 'admin' | 'member'
}

export interface ProjectInvite {
  id: number
  code: string
  expires_at: string | null
  max_uses: number | null
  use_count: number
  redeemable: boolean
}

export interface ProjectInput {
  name: string
  description?: string | null
  icon_type?: IconType | null
  icon_value?: string | null
  color?: string | null
}

export async function getProjects(): Promise<Project[]> {
  return (await apiClient.get('projects').json<{ projects: Project[] }>()).projects
}

export async function createProject(data: ProjectInput): Promise<Project> {
  return (await apiClient.post('projects', { json: data }).json<{ project: Project }>()).project
}

export async function updateProject(id: number, data: Partial<ProjectInput>): Promise<Project> {
  return (await apiClient.patch(`projects/${id}`, { json: data }).json<{ project: Project }>()).project
}

export async function deleteProject(id: number): Promise<void> {
  await apiClient.delete(`projects/${id}`)
}

export async function getProjectMembers(id: number): Promise<ProjectMember[]> {
  return (await apiClient.get(`projects/${id}/members`).json<{ members: ProjectMember[] }>()).members
}

export async function removeProjectMember(id: number, userId: number): Promise<void> {
  await apiClient.delete(`projects/${id}/members/${userId}`)
}

export interface MemberCandidate {
  id: number
  name: string
  email: string
}
export type AddMemberResult = { member: ProjectMember } | { candidates: MemberCandidate[] }

export async function addProjectMember(
  id: number,
  query: { name?: string; email?: string; user_id?: number },
): Promise<AddMemberResult> {
  return apiClient.post(`projects/${id}/members`, { json: query }).json<AddMemberResult>()
}

export async function getProjectInvites(id: number): Promise<ProjectInvite[]> {
  return (await apiClient.get(`projects/${id}/invites`).json<{ invites: ProjectInvite[] }>()).invites
}

export async function createProjectInvite(
  id: number,
  data: { expires_at?: string | null; max_uses?: number | null } = {},
): Promise<ProjectInvite> {
  return (await apiClient.post(`projects/${id}/invites`, { json: data }).json<{ invite: ProjectInvite }>()).invite
}

export async function revokeProjectInvite(id: number, inviteId: number): Promise<void> {
  await apiClient.delete(`projects/${id}/invites/${inviteId}`)
}

export async function getInvitePreview(code: string): Promise<{ project: Partial<Project>; valid: boolean }> {
  return apiClient.get(`invite/${code}`).json()
}

export async function redeemInvite(
  code: string,
  signup?: { name: string; email: string; password: string },
): Promise<{
  joined?: boolean
  access_token?: string
  refresh_token?: string
  user?: { id: number; email: string; name: string; role: 'admin' | 'member' }
  project: Partial<Project>
}> {
  return apiClient.post(`invite/${code}/redeem`, signup ? { json: signup } : undefined).json()
}
