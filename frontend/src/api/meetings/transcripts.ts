import apiClient from '../client'
import type {
  Transcript,
  BulkTranscriptItem,
  SplitTranscriptParams,
  SplitTranscriptResponse,
  RedactTranscriptsParams,
  RedactTranscriptsResponse,
} from './types'

export async function deleteTranscripts(meetingId: number, ids: number[]): Promise<{ deleted: number }> {
  return apiClient.delete(`meetings/${meetingId}/transcripts/destroy_batch`, { json: { ids } }).json()
}

/** 전사 한 행을 지정 지점(오디오 ms + 문자 인덱스)에서 두 행으로 분할한다.
 *  409(expected_content 불일치)·422(검증 실패)·409(진행 중 회의)는 호출부가 HTTPError로 받는다. */
export async function splitTranscript(
  meetingId: number,
  transcriptId: number,
  params: SplitTranscriptParams,
): Promise<SplitTranscriptResponse> {
  return apiClient
    .post(`meetings/${meetingId}/transcripts/${transcriptId}/split`, { json: params })
    .json<SplitTranscriptResponse>()
}

/** 선택한 전사 행과 그 구간의 오디오를 실제로 파기한다. 마스킹이 아니라 절단이며 되돌릴 수 없다.
 *  403(비 owner/admin·잠금)·409(녹음·전사·요약 중, 오디오 변환 중, 겹침 완전성 실패)·
 *  422(검증·오디오 절단 실패)는 호출부가 HTTPError 로 받는다. */
export async function redactTranscripts(
  meetingId: number,
  params: RedactTranscriptsParams,
): Promise<RedactTranscriptsResponse> {
  return apiClient
    .post(`meetings/${meetingId}/transcripts/redact`, { json: params })
    .json<RedactTranscriptsResponse>()
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
