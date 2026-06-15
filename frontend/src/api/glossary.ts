import apiClient from './client'

export type GlossaryMatchType = 'literal' | 'regex'

export interface GlossaryEntry {
  id: number
  from_text: string
  to_text: string
  match_type: GlossaryMatchType
  enabled: boolean
  owner_type: 'Meeting' | 'Folder'
  owner_id: number
}

export interface GlossaryLevel {
  folder: { id: number; name: string }
  entries: GlossaryEntry[]
}

export interface GlossaryView {
  meeting: { entries: GlossaryEntry[] }
  folder: GlossaryLevel | null
  ancestors: GlossaryLevel[]
  resolved: { from: string; to: string; match_type: GlossaryMatchType }[]
}

export type GlossaryEntryInput = {
  from_text: string
  to_text: string
  match_type?: GlossaryMatchType
  enabled?: boolean
}

export async function getGlossary(meetingId: number): Promise<GlossaryView> {
  return apiClient.get(`meetings/${meetingId}/glossary`).json()
}

export async function createMeetingGlossaryEntry(meetingId: number, data: GlossaryEntryInput): Promise<{ entry: GlossaryEntry }> {
  return apiClient.post(`meetings/${meetingId}/glossary_entries`, { json: data }).json()
}

export async function createFolderGlossaryEntry(folderId: number, data: GlossaryEntryInput): Promise<{ entry: GlossaryEntry }> {
  return apiClient.post(`folders/${folderId}/glossary_entries`, { json: data }).json()
}

export async function updateGlossaryEntry(id: number, data: Partial<GlossaryEntryInput>): Promise<{ entry: GlossaryEntry }> {
  return apiClient.patch(`glossary_entries/${id}`, { json: data }).json()
}

export async function deleteGlossaryEntry(id: number): Promise<void> {
  await apiClient.delete(`glossary_entries/${id}`)
}

export async function reapplyGlossary(meetingId: number): Promise<{ notes_markdown: string; corrected_transcripts: number }> {
  return apiClient.post(`meetings/${meetingId}/reapply_glossary`, { timeout: 60000 }).json()
}
