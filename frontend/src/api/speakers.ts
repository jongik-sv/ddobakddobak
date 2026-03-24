import apiClient from './client'

export interface Speaker {
  id: string
  name: string
}

export async function getSpeakers(meetingId: number): Promise<Speaker[]> {
  const res: { speakers: Speaker[] } = await apiClient
    .get('speakers', { searchParams: { meeting_id: meetingId } })
    .json()
  return res.speakers
}

export async function renameSpeaker(
  meetingId: number,
  id: string,
  name: string
): Promise<Speaker> {
  return apiClient
    .put(`speakers/${encodeURIComponent(id)}`, {
      json: { name },
      searchParams: { meeting_id: meetingId },
    })
    .json()
}

export async function resetSpeakers(meetingId: number): Promise<void> {
  await apiClient
    .delete('speakers/destroy_all', { searchParams: { meeting_id: meetingId } })
    .json()
}
