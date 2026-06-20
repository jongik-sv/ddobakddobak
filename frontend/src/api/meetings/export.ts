import apiClient from '../client'
import type { ExportOptions, MeetingExportData } from './types'

/**
 * 회의 프롬프트를 텍스트로 다운로드한다.
 * GET /api/v1/meetings/:id/export_prompt
 */
export async function exportPrompt(meetingId: number): Promise<string> {
  return apiClient.get(`meetings/${meetingId}/export_prompt`).text()
}

/**
 * 회의록을 Markdown 텍스트로 내보낸다.
 * GET /api/v1/meetings/:id/export
 * Response: text/markdown
 */
export async function exportMeeting(
  meetingId: number,
  options: ExportOptions,
): Promise<string> {
  const searchParams = new URLSearchParams({
    include_summary: String(options.include_summary),
    include_memo: String(options.include_memo),
    include_transcript: String(options.include_transcript),
  })
  return apiClient
    .get(`meetings/${meetingId}/export`, { searchParams })
    .text()
}

export async function exportMeetingData(
  meetingId: number,
  options: ExportOptions,
): Promise<MeetingExportData> {
  const searchParams = new URLSearchParams({
    include_summary: String(options.include_summary),
    include_memo: String(options.include_memo),
    include_transcript: String(options.include_transcript),
    export_format: 'json',
  })
  return apiClient
    .get(`meetings/${meetingId}/export`, { searchParams })
    .json()
}
