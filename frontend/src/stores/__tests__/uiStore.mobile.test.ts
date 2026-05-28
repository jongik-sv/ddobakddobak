import { describe, it, expect, beforeEach, vi } from 'vitest'

// 모바일 환경 강제
vi.mock('../../config', () => ({
  IS_MOBILE: true,
}))

import { useUiStore } from '../uiStore'

describe('uiStore - 모바일에서 설정 진입 허용', () => {
  beforeEach(() => {
    useUiStore.setState({ settingsOpen: false })
  })

  it('모바일에서도 openSettings가 설정 모달을 연다', () => {
    useUiStore.getState().openSettings()
    expect(useUiStore.getState().settingsOpen).toBe(true)
  })
})
