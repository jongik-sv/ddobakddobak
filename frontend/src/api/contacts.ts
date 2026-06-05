import apiClient from './client'

export interface MeetingContact {
  id: number
  meeting_id: number
  name: string | null
  company: string | null
  department: string | null
  title: string | null
  mobile: string | null
  phone: string | null
  fax: string | null
  email: string | null
  website: string | null
  address: string | null
  extra: Record<string, unknown>
  raw_text: string | null
  source_attachment_id: number | null
  created_at: string
  updated_at: string
}

export interface UpdateContactParams {
  name?: string | null
  company?: string | null
  department?: string | null
  title?: string | null
  mobile?: string | null
  phone?: string | null
  fax?: string | null
  email?: string | null
  website?: string | null
  address?: string | null
}

export async function getContacts(meetingId: number): Promise<MeetingContact[]> {
  const res = await apiClient
    .get(`meetings/${meetingId}/contacts`)
    .json<{ contacts: MeetingContact[] }>()
  return res.contacts
}

export async function updateContact(
  meetingId: number,
  contactId: number,
  data: UpdateContactParams,
): Promise<MeetingContact> {
  const res = await apiClient
    .patch(`meetings/${meetingId}/contacts/${contactId}`, { json: data })
    .json<{ contact: MeetingContact }>()
  return res.contact
}

export async function deleteContact(meetingId: number, contactId: number): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/contacts/${contactId}`)
}
