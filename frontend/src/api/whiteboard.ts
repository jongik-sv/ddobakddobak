import { apiClient } from './client'

// 서버 모드 화이트보드 API (설계 §11.3). 클라이언트는 본문을 보내지 않는다.

export type ServerWhiteboardStatus = 'none' | 'running' | 'done' | 'error'

export interface WhiteboardPostResult {
  status: 'running' | 'done'
  digest: string
  /** done 일 때만. 서버 응답이므로 쓰기 전에 validateBoard 로 재검증한다. */
  board?: unknown
}

export interface WhiteboardGetResult {
  status: ServerWhiteboardStatus
  digest?: string
  board?: unknown
  error_kind?: string
  error_message?: string
  stale: boolean
}

/** 서버 모드가 꺼져 있거나 서버에 claude 가 없을 때(403 whiteboard_server_disabled). */
export class WhiteboardServerDisabledError extends Error {
  constructor() {
    super('whiteboard_server_disabled')
    this.name = 'WhiteboardServerDisabledError'
  }
}

/** 요약이 없을 때(422 no_summary). */
export class WhiteboardNoSummaryError extends Error {
  constructor() {
    super('no_summary')
    this.name = 'WhiteboardNoSummaryError'
  }
}

/** 200 done / 202 running. 403·422 는 전용 오류, 그 밖은 그대로 throw. */
export async function postWhiteboard(meetingId: number): Promise<WhiteboardPostResult> {
  const res = await apiClient.post(`meetings/${meetingId}/whiteboard`, { throwHttpErrors: false })
  if (res.status === 200 || res.status === 202) return (await res.json()) as WhiteboardPostResult
  let code = ''
  try {
    code = ((await res.json()) as { error?: string }).error ?? ''
  } catch {
    // 본문 없음
  }
  if (res.status === 403 && code === 'whiteboard_server_disabled') throw new WhiteboardServerDisabledError()
  if (res.status === 422 && code === 'no_summary') throw new WhiteboardNoSummaryError()
  throw new Error(`whiteboard POST failed: ${res.status}`)
}

export async function getWhiteboard(meetingId: number): Promise<WhiteboardGetResult> {
  return apiClient.get(`meetings/${meetingId}/whiteboard`).json()
}
