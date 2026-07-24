import apiClient from '../client'

export interface Collaborator {
  user_id: number
  name: string
  email: string
}

export interface InheritedCollaborator extends Collaborator {
  folder_id: number
  folder_name: string
}

export interface CollaboratorsResponse {
  direct: Collaborator[]
  inherited: InheritedCollaborator[]
}

/** 회의 협업자 목록(직접 지정분 + 폴더 상속분, 구분되어 응답). */
export async function getMeetingCollaborators(meetingId: number): Promise<CollaboratorsResponse> {
  return apiClient.get(`meetings/${meetingId}/collaborators`).json<CollaboratorsResponse>()
}

/** 회의 협업자 추가(소유자/admin만 호출 가능, 대상은 같은 프로젝트 멤버만). */
export async function addMeetingCollaborator(meetingId: number, userId: number): Promise<Collaborator> {
  const res = await apiClient
    .post(`meetings/${meetingId}/collaborators`, { json: { user_id: userId } })
    .json<{ collaborator: Collaborator }>()
  return res.collaborator
}

/** 회의 협업자 제거(소유자/admin만 호출 가능). */
export async function removeMeetingCollaborator(meetingId: number, userId: number): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/collaborators/${userId}`)
}
