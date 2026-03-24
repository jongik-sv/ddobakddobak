import apiClient from './client'

export interface Team {
  id: number
  name: string
  role: 'admin' | 'member'
}

export interface TeamMember {
  id: number
  name: string
  email: string
  role: 'admin' | 'member'
}

export async function getTeams(): Promise<Team[]> {
  return apiClient.get('teams').json()
}

export async function getTeamMembers(teamId: number): Promise<TeamMember[]> {
  return apiClient.get(`teams/${teamId}/members`).json()
}

export async function createTeam(name: string): Promise<Team> {
  const res: { team: Team } = await apiClient.post('teams', { json: { name } }).json()
  return res.team
}

export async function inviteMember(teamId: number, email: string): Promise<TeamMember> {
  return apiClient.post(`teams/${teamId}/members`, { json: { email } }).json()
}

export async function removeMember(teamId: number, userId: number): Promise<void> {
  await apiClient.delete(`teams/${teamId}/members/${userId}`)
}
