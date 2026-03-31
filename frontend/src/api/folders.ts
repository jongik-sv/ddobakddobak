import apiClient from './client'

export interface FolderNode {
  id: number
  name: string
  parent_id: number | null
  position: number
  meeting_count: number
  tags: { id: number; name: string; color: string }[]
  children: FolderNode[]
}

export interface Folder {
  id: number
  name: string
  parent_id: number | null
  position: number
  meeting_count: number
  children_count: number
  ancestors: { id: number; name: string }[]
  created_at: string
  updated_at: string
}

export async function getFolderTree(): Promise<FolderNode[]> {
  const res = await apiClient.get('folders').json<{ folders: FolderNode[] }>()
  return res.folders
}

export async function getFoldersFlat(): Promise<Folder[]> {
  const res = await apiClient
    .get('folders', { searchParams: { flat: 'true' } })
    .json<{ folders: Folder[] }>()
  return res.folders
}

export async function createFolder(data: {
  name: string
  parent_id?: number | null
}): Promise<Folder> {
  const res = await apiClient.post('folders', { json: data }).json<{ folder: Folder }>()
  return res.folder
}

export async function updateFolder(
  id: number,
  data: { name?: string; position?: number; parent_id?: number | null; tag_ids?: number[] },
): Promise<Folder> {
  const res = await apiClient.patch(`folders/${id}`, { json: data }).json<{ folder: Folder }>()
  return res.folder
}

export async function deleteFolder(id: number): Promise<void> {
  await apiClient.delete(`folders/${id}`)
}

export async function moveMeetingsToFolder(
  meetingIds: number[],
  folderId: number | null,
): Promise<{ updated: number }> {
  return apiClient
    .post('meetings/move_to_folder', { json: { meeting_ids: meetingIds, folder_id: folderId } })
    .json()
}
