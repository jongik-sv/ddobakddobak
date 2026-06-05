import apiClient from './client'
import { getApiBaseUrl } from '../config'

export type AttachmentCategory = 'agenda' | 'reference' | 'minutes' | 'business_card'
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

  // apiClient(ky)로 보내 401 자동 refresh를 태운다. FormData면 ky가 Content-Type을
  // 건드리지 않아 multipart boundary가 보존된다(raw fetch 때의 토큰 만료 무처리 갭 제거).
  const res = await apiClient
    .post(`meetings/${meetingId}/attachments`, { body: formData })
    .json<{ attachment: MeetingAttachment }>()
  return res.attachment
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
