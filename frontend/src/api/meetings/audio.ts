import { getAuthHeaders } from '../client'
import { getApiBaseUrl } from '../../config'
import type { Meeting, SummaryVerbosity } from './types'

export async function uploadAudio(id: number, blob: Blob): Promise<void> {
  const formData = new FormData()
  const ext = blob.type.includes('wav') ? 'wav' : 'webm'
  formData.append('audio', blob, `recording.${ext}`)

  // FormData 전송 시 브라우저가 Content-Type(multipart boundary 포함)을 자동 설정하도록
  // ky 대신 fetch를 직접 사용
  await fetch(`${getApiBaseUrl()}/meetings/${id}/audio`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  })
}

/**
 * 오프라인(로컬) 회의 프로모트용 단발 오디오 업로드.
 *
 * uploadAudio와 달리 res.ok를 검사해 실패 시 throw 한다 — syncQueue.flush가 실패를
 * 감지해 pendingSync를 유지하고 재시도하도록(성공 경로에서만 has_audio_file이 켜진다).
 * 엔드포인트는 온라인 경로와 동일한 POST /meetings/:id/audio (서버가 AudioUploadJob으로 mp3 변환).
 */
export async function promoteAudio(id: number, blob: Blob): Promise<void> {
  const formData = new FormData()
  const ext = blob.type.includes('wav') ? 'wav' : 'webm'
  formData.append('audio', blob, `promote.${ext}`)

  const res = await fetch(`${getApiBaseUrl()}/meetings/${id}/audio`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `오디오 업로드 실패 (${res.status})`)
  }
}

/** 녹음 중 압축 오디오 청크를 seq 순서대로 연속 업로드 (모바일) */
export async function uploadAudioChunk(id: number, blob: Blob, sequence: number): Promise<void> {
  const formData = new FormData()
  formData.append('chunk', blob, `chunk-${sequence}.webm`)
  formData.append('sequence', String(sequence))

  await fetch(`${getApiBaseUrl()}/meetings/${id}/audio_chunk`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  })
}

/** 녹음 종료: 업로드된 청크들을 서버에서 이어붙여 mp3로 변환 */
export async function finalizeAudio(id: number): Promise<void> {
  await fetch(`${getApiBaseUrl()}/meetings/${id}/audio_finalize`, {
    method: 'POST',
    headers: getAuthHeaders(),
  })
}

export async function uploadAudioFile(data: {
  title: string
  meeting_type?: string
  audio: File
  /** 프로젝트 스코핑. 업로드로 생성되는 회의가 속할 프로젝트. */
  project_id?: number | null
  /** 생략하면 서버가 직전 회의 설정을 승계한다 */
  summary_verbosity?: SummaryVerbosity
  summary_restructure?: boolean
}): Promise<Meeting> {
  const formData = new FormData()
  formData.append('title', data.title)
  if (data.meeting_type) formData.append('meeting_type', data.meeting_type)
  if (data.project_id != null) formData.append('project_id', String(data.project_id))
  if (data.summary_verbosity) formData.append('summary_verbosity', data.summary_verbosity)
  if (data.summary_restructure !== undefined) formData.append('summary_restructure', String(data.summary_restructure))
  formData.append('audio', data.audio)

  const res = await fetch(`${getApiBaseUrl()}/meetings/upload_audio`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || '업로드에 실패했습니다.')
  }
  const json = await res.json()
  return json.meeting
}
