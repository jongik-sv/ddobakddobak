import apiClient from '../client'
import type { Meeting, UpdateMeetingParams } from './types'

export async function regenerateStt(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/regenerate_stt`).json()
  return res.meeting
}

/** 회의 잠금 (소유자/admin). 갱신된 meeting 반환. */
export async function lockMeeting(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/lock`).json()
  return res.meeting
}

/** 회의 잠금 해제 (소유자/admin). 갱신된 meeting 반환. */
export async function unlockMeeting(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.delete(`meetings/${id}/lock`).json()
  return res.meeting
}

/** 회의 중요 표시 토글. 기존 update(PATCH)에 important만 보내는 얇은 헬퍼. */
export async function setMeetingImportant(id: number, important: boolean): Promise<Meeting> {
  return updateMeeting(id, { important })
}

export async function reDiarize(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/re_diarize`).json()
  return res.meeting
}

export async function updateMeeting(id: number, params: UpdateMeetingParams): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.patch(`meetings/${id}`, { json: params }).json()
  return res.meeting
}
