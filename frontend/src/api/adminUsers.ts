import apiClient from './client'

export interface AdminUser {
  id: number
  email: string
  name: string
  role: 'admin' | 'member'
  created_at: string
  updated_at: string
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  const res = await apiClient.get('admin/users').json<{ users: AdminUser[] }>()
  return res.users
}

export async function createAdminUser(params: {
  email: string
  name: string
  password: string
  role: string
}): Promise<AdminUser> {
  const res = await apiClient
    .post('admin/users', { json: params })
    .json<{ user: AdminUser }>()
  return res.user
}

export async function updateAdminUser(
  id: number,
  params: { name?: string; role?: string },
): Promise<AdminUser> {
  const res = await apiClient
    .put(`admin/users/${id}`, { json: params })
    .json<{ user: AdminUser }>()
  return res.user
}

export async function deleteAdminUser(id: number): Promise<void> {
  await apiClient.delete(`admin/users/${id}`)
}
