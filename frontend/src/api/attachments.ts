import apiClient, { getAuthHeaders } from './client'
import { getApiBaseUrl } from '../config'

export type AttachmentCategory = 'agenda' | 'reference' | 'minutes'
export type AttachmentKind = 'file' | 'link'

export interface MeetingAttachment {
  id: number
  kind: AttachmentKind
  category: AttachmentCategory
  display_name: string
  original_filename: string | null
  content_type: string | null
  file_size: number | null
  url: string | null
  position: number
  uploaded_by: { id: number; name: string }
  created_at: string
  updated_at: string
}

export async function getAttachments(
  meetingId: number,
  category?: AttachmentCategory,
): Promise<MeetingAttachment[]> {
  const searchParams: Record<string, string> = {}
  if (category) searchParams.category = category
  const res = await apiClient
    .get(`meetings/${meetingId}/attachments`, { searchParams })
    .json<{ attachments: MeetingAttachment[] }>()
  return res.attachments
}

export async function createFileAttachment(
  meetingId: number,
  category: AttachmentCategory,
  file: File,
  displayName?: string,
): Promise<MeetingAttachment> {
  const formData = new FormData()
  formData.append('category', category)
  formData.append('file', file)
  if (displayName) formData.append('display_name', displayName)

  const res = await fetch(`${getApiBaseUrl()}/meetings/${meetingId}/attachments`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || '파일 업로드에 실패했습니다.')
  }
  const json = await res.json()
  return json.attachment
}

export async function createLinkAttachment(
  meetingId: number,
  category: AttachmentCategory,
  url: string,
  displayName?: string,
): Promise<MeetingAttachment> {
  const res = await apiClient
    .post(`meetings/${meetingId}/attachments`, {
      json: { kind: 'link', category, url, display_name: displayName || url },
    })
    .json<{ attachment: MeetingAttachment }>()
  return res.attachment
}

export async function updateAttachment(
  meetingId: number,
  attachmentId: number,
  data: { display_name?: string; category?: AttachmentCategory },
): Promise<MeetingAttachment> {
  const res = await apiClient
    .patch(`meetings/${meetingId}/attachments/${attachmentId}`, { json: data })
    .json<{ attachment: MeetingAttachment }>()
  return res.attachment
}

export async function deleteAttachment(
  meetingId: number,
  attachmentId: number,
): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/attachments/${attachmentId}`)
}

export function getAttachmentDownloadUrl(
  meetingId: number,
  attachmentId: number,
): string {
  return `${getApiBaseUrl()}/meetings/${meetingId}/attachments/${attachmentId}/download`
}

export async function reorderAttachment(
  meetingId: number,
  attachmentId: number,
  prevId: number | null,
  nextId: number | null,
): Promise<MeetingAttachment> {
  const res = await apiClient
    .patch(`meetings/${meetingId}/attachments/${attachmentId}/reorder`, {
      json: { prev_id: prevId, next_id: nextId },
    })
    .json<{ attachment: MeetingAttachment }>()
  return res.attachment
}
