import apiClient from './client'

export interface Tag {
  id: number
  name: string
  color: string
  team_id: number
}

export async function getTags(): Promise<Tag[]> {
  const res = await apiClient.get('tags').json<{ tags: Tag[] }>()
  return res.tags
}

export async function createTag(data: {
  name: string
  color?: string
  team_id: number
}): Promise<Tag> {
  const res = await apiClient.post('tags', { json: data }).json<{ tag: Tag }>()
  return res.tag
}

export async function updateTag(
  id: number,
  data: { name?: string; color?: string },
): Promise<Tag> {
  const res = await apiClient.patch(`tags/${id}`, { json: data }).json<{ tag: Tag }>()
  return res.tag
}

export async function deleteTag(id: number): Promise<void> {
  await apiClient.delete(`tags/${id}`)
}
