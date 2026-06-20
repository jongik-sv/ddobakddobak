import apiClient from '../client'
import type { SummaryResponse, TermCorrection } from './types'

export async function triggerRealtimeSummary(id: number): Promise<void> {
  await apiClient.post(`meetings/${id}/summarize`)
}

export async function regenerateNotes(id: number): Promise<void> {
  await apiClient.post(`meetings/${id}/regenerate_notes`)
}

export async function getSummary(meetingId: number): Promise<SummaryResponse | null> {
  try {
    return await apiClient.get(`meetings/${meetingId}/summary`).json()
  } catch {
    return null
  }
}

export async function correctTerms(meetingId: number, corrections: TermCorrection[]): Promise<{ notes_markdown: string; corrected_transcripts: number }> {
  return apiClient.post(`meetings/${meetingId}/feedback`, { json: { corrections }, timeout: 60000 }).json()
}

export async function updateNotes(meetingId: number, notesMarkdown: string, clientId?: string): Promise<void> {
  await apiClient.patch(`meetings/${meetingId}/update_notes`, {
    json: { notes_markdown: notesMarkdown, client_id: clientId },
  })
}

export async function updateMemo(meetingId: number, memo: string): Promise<void> {
  await apiClient.patch(`meetings/${meetingId}`, { json: { memo } })
}
