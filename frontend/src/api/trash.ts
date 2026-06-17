import apiClient from './client'

/**
 * 휴지통(soft-delete) API 클라이언트.
 * 백엔드: Api::V1::TrashController.
 * - GET    trash               → { items: TrashItem[] } (deleted_at desc)
 * - POST   trash/:type/:id/restore → 204 (복구)
 * - DELETE trash/:type/:id     → 204 (영구삭제; 403 if not owner/admin)
 * - DELETE trash               → 204 (내 휴지통 비우기)
 */

export type TrashItemType = 'meeting' | 'folder' | 'project'

export interface TrashItem {
  type: TrashItemType
  id: number
  title: string | null
  deleted_at: string
  deleted_by_id: number | null
  trash_group_id: string
}

export async function listTrash(): Promise<TrashItem[]> {
  const data = await apiClient.get('trash').json<{ items?: TrashItem[] } | TrashItem[]>()
  if (Array.isArray(data)) return data
  return data.items ?? []
}

export async function restoreTrashItem(type: TrashItemType, id: number): Promise<void> {
  await apiClient.post(`trash/${type}/${id}/restore`)
}

export async function purgeTrashItem(type: TrashItemType, id: number): Promise<void> {
  await apiClient.delete(`trash/${type}/${id}`)
}

export async function emptyTrash(): Promise<void> {
  await apiClient.delete('trash')
}
