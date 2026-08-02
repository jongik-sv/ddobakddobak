import { describe, it, expect } from 'vitest'
import { canRedactMeeting } from './helpers'

const owner = { id: 1, role: 'member' as const }
const stranger = { id: 2, role: 'member' as const }
const admin = { id: 3, role: 'admin' as const }
const meeting = { created_by: { id: 1, name: '소유자' } }

describe('canRedactMeeting', () => {
  it('소유자는 true', () => {
    expect(canRedactMeeting(meeting, owner)).toBe(true)
  })

  it('admin 은 true', () => {
    expect(canRedactMeeting(meeting, admin)).toBe(true)
  })

  it('타인(협업자 포함)은 false — canEditMeeting 과 다른 티어다', () => {
    // 서버가 내려주는 editable 은 협업자까지 true 지만 절단은 owner/admin 전용이라
    // (authorize_meeting_admin!) 이 헬퍼는 editable 을 보지 않는다.
    expect(canRedactMeeting({ ...meeting, editable: true } as never, stranger)).toBe(false)
  })

  it('meeting 또는 user 가 없으면 false', () => {
    expect(canRedactMeeting(null, owner)).toBe(false)
    expect(canRedactMeeting(meeting, null)).toBe(false)
  })
})
