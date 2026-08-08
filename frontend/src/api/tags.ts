import apiClient from './client'

export interface Tag {
  id: number
  name: string
  color: string
}

export async function getTags(): Promise<Tag[]> {
  const res = await apiClient.get('tags').json<{ tags: Tag[] }>()
  return res.tags
}

export async function createTag(data: {
  name: string
  color?: string
}): Promise<Tag> {
  const res = await apiClient.post('tags', { json: data }).json<{ tag: Tag }>()
  return res.tag
}
