import { describe, it, expect } from 'vitest'
import { projectDisplayName } from './projects'

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
