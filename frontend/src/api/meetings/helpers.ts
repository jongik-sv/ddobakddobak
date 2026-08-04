import apiClient from '../client'
import type { Meeting } from './types'

/**
 * 회의 수정/삭제 등 소유권이 필요한 어포던스를 노출할지 판단하는 순수 헬퍼.
 *
 * 서버가 meeting_json에 계산해 내려주는 `editable`을 1순위로 신뢰하고,
 * (구버전 응답 등으로) 없을 때만 클라이언트에서 소유자(created_by.id === user.id)
 * 또는 admin 여부로 추론한다. UX 어포던스 게이팅 용도이며, 권한 자체는 서버가 403으로 강제한다.
 */
export function canEditMeeting(
  meeting: Pick<Meeting, 'editable' | 'created_by'> | null | undefined,
  user: { id: number; role: 'admin' | 'manager' | 'member' } | null | undefined,
): boolean {
  if (!meeting) return false
  if (typeof meeting.editable === 'boolean') return meeting.editable
  if (!user) return false
  return meeting.created_by?.id === user.id || user.role === 'admin'
}

/**
 * 기밀 구간 절단처럼 되돌릴 수 없는 관리 액션의 어포던스를 노출할지 판단하는 순수 헬퍼.
 *
 * canEditMeeting 과 다르다: 서버가 내려주는 `editable` 은 협업자까지 true 라서 여기에 쓸 수 없다
 * (절단은 owner/admin 전용 — MeetingLookup#authorize_meeting_admin!). 소유자 또는 전역 admin 만 true.
 * 서버의 admin override 는 남의 개인 프로젝트 회의를 제외하지만 클라이언트는 그 정보를 갖고 있지
 * 않다 — UX 어포던스 게이팅일 뿐이고 권한 자체는 서버가 403 으로 강제한다.
 */
export function canRedactMeeting(
  meeting: Pick<Meeting, 'created_by'> | null | undefined,
  user: { id: number; role: 'admin' | 'manager' | 'member' } | null | undefined,
): boolean {
  if (!meeting || !user) return false
  return meeting.created_by?.id === user.id || user.role === 'admin'
}

export async function moveMeetingsToProject(
  meetingIds: number[],
  targetProjectId: number,
): Promise<{ moved: number }> {
  return apiClient
    .post('meetings/move_to_project', { json: { meeting_ids: meetingIds, target_project_id: targetProjectId } })
    .json()
}
