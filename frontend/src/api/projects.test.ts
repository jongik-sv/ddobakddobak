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
  it('personal + role null → true (hidden — 남의 개인 프로젝트)', () => {
    expect(isHiddenClutterProject({ personal: true, role: null })).toBe(true)
  })

  it('personal + role admin (mine) → false (shown — 내 개인 프로젝트)', () => {
    expect(isHiddenClutterProject({ personal: true, role: 'admin' })).toBe(false)
  })

  it('personal + role member (mine) → false (shown — 내가 멤버)', () => {
    expect(isHiddenClutterProject({ personal: true, role: 'member' })).toBe(false)
  })

  it('non-personal + role null → false (shown — 팀 프로젝트)', () => {
    expect(isHiddenClutterProject({ personal: false, role: null })).toBe(false)
  })
})
