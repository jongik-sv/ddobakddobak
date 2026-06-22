import { describe, it, expect, beforeEach } from 'vitest'
import { getCloseAction, setCloseAction } from './closeAction'

describe('closeAction', () => {
  beforeEach(() => localStorage.clear())
  it('기본값은 null(미설정)', () => {
    expect(getCloseAction()).toBeNull()
  })
  it('set 후 get으로 복원', () => {
    setCloseAction('hide')
    expect(getCloseAction()).toBe('hide')
    setCloseAction('quit')
    expect(getCloseAction()).toBe('quit')
  })
  it('잘못된 값은 null로 취급', () => {
    localStorage.setItem('closeAction', 'garbage')
    expect(getCloseAction()).toBeNull()
  })
})
