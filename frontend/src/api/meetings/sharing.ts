import apiClient from '../client'
import type { ShareResponse, JoinResponse, Participant } from './types'

export async function shareMeeting(meetingId: number): Promise<ShareResponse> {
  return apiClient.post(`meetings/${meetingId}/share`).json()
}

export async function stopSharing(meetingId: number): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/share`)
}

export async function joinMeeting(shareCode: string): Promise<JoinResponse> {
  return apiClient.post('meetings/join', { json: { share_code: shareCode } }).json()
}

export async function getParticipants(meetingId: number): Promise<Participant[]> {
  const res = await apiClient.get(`meetings/${meetingId}/participants`).json<{ participants: Participant[] }>()
  return res.participants
}

export async function transferHost(meetingId: number, targetUserId: number): Promise<Participant[]> {
  const res = await apiClient.post(`meetings/${meetingId}/transfer_host`, {
    json: { target_user_id: targetUserId },
  }).json<{ participants: Participant[] }>()
  return res.participants
}

export async function claimHost(meetingId: number): Promise<Participant[]> {
  const res = await apiClient.post(`meetings/${meetingId}/claim_host`).json<{ participants: Participant[] }>()
  return res.participants
}
