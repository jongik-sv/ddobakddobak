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
