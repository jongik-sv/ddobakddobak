import apiClient from '../client'
import type { Transcript, BulkTranscriptItem } from './types'

export async function deleteTranscripts(meetingId: number, ids: number[]): Promise<{ deleted: number }> {
  return apiClient.delete(`meetings/${meetingId}/transcripts/destroy_batch`, { json: { ids } }).json()
}

export async function updateTranscript(
  meetingId: number,
  transcriptId: number,
  content: string,
  clientId?: string,
): Promise<Transcript> {
  const res = await apiClient
    .patch(`meetings/${meetingId}/transcripts/${transcriptId}/update_content`, {
      json: { content, client_id: clientId },
    })
    .json<{ transcript: Transcript }>()
  return res.transcript
}

export async function bulkCreateTranscripts(
  meetingId: number,
  items: BulkTranscriptItem[],
): Promise<void> {
  await apiClient.post(`meetings/${meetingId}/transcripts/bulk`, {
    json: { transcripts: items },
  })
}

export async function getTranscripts(meetingId: number, perPage = 5000): Promise<Transcript[]> {
  try {
    const response = await apiClient
      .get(`meetings/${meetingId}/transcripts`, { searchParams: { per_page: perPage } })
      .json<{ transcripts: Transcript[] }>()
    return response.transcripts
  } catch {
    return []
  }
}
