import apiClient from './client'

export interface Bookmark {
  id: number
  meeting_id: number
  timestamp_ms: number
  label: string | null
  created_at: string
}

export async function getBookmarks(meetingId: number): Promise<Bookmark[]> {
  return apiClient.get(`meetings/${meetingId}/bookmarks`).json()
}

export async function createBookmark(
  meetingId: number,
  data: { timestamp_ms: number; label?: string },
): Promise<Bookmark> {
  return apiClient.post(`meetings/${meetingId}/bookmarks`, { json: data }).json()
}

export async function deleteBookmark(meetingId: number, bookmarkId: number): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/bookmarks/${bookmarkId}`)
}
