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
  // 백엔드 timestamp_ms 는 정수만 허용(numericality only_integer) — 모든 호출부 보호 위해 floor
  const payload = { ...data, timestamp_ms: Math.floor(data.timestamp_ms) }
  return apiClient.post(`meetings/${meetingId}/bookmarks`, { json: payload }).json()
}

export async function updateBookmark(
  meetingId: number,
  bookmarkId: number,
  data: { label: string },
): Promise<Bookmark> {
  return apiClient.patch(`meetings/${meetingId}/bookmarks/${bookmarkId}`, { json: data }).json()
}

export async function deleteBookmark(meetingId: number, bookmarkId: number): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/bookmarks/${bookmarkId}`)
}
