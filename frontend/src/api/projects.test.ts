import { describe, it, expect } from 'vitest'
import { projectDisplayName, isHiddenClutterProject } from './projects'

describe('projectDisplayName', () => {
  it('personal + owner → "{owner}의 회의"', () => {
    expect(projectDisplayName({ name: '내 회의', personal: true, owner: '윤민정' })).toBe('윤민정의 회의')
  })

  it('personal + null owner → "알 수 없음의 회의"', () => {
    expect(projectDisplayName({ name: '내 회의', personal: true, owner: null })).toBe('알 수 없음의 회의')
  })

  it('non-personal → returns name', () => {
    expect(projectDisplayName({ name: '개발팀', personal: false, owner: '윤민정' })).toBe('개발팀')
  })
})

describe('isHiddenClutterProject', () => {
  it('personal + role null + meeting_count 0 → true (hidden)', () => {
    expect(isHiddenClutterProject({ personal: true, role: null, meeting_count: 0 })).toBe(true)
  })

  it('personal + role admin (mine) + meeting_count 0 → false (shown — my own)', () => {
    expect(isHiddenClutterProject({ personal: true, role: 'admin', meeting_count: 0 })).toBe(false)
  })

  it('personal + role null + meeting_count 3 → false (shown — has content)', () => {
    expect(isHiddenClutterProject({ personal: true, role: null, meeting_count: 3 })).toBe(false)
  })

  it('non-personal + role null + meeting_count 0 → false (shown — team/dummy)', () => {
    expect(isHiddenClutterProject({ personal: false, role: null, meeting_count: 0 })).toBe(false)
  })
})
