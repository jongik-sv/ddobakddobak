import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useToastStore } from '../toastStore'

describe('toastStore', () => {
  beforeEach(() => { vi.useFakeTimers(); useToastStore.getState().clear() })
  afterEach(() => { vi.useRealTimers() })

  it('showStatus로 메시지 설정 후 durationMs 경과 시 자동 clear', () => {
    useToastStore.getState().showStatus('저장됨', 1000)
    expect(useToastStore.getState().message).toBe('저장됨')
    vi.advanceTimersByTime(1000)
    expect(useToastStore.getState().message).toBe('')
  })

  it('새 showStatus가 이전 타이머를 교체(이전 메시지 조기 clear 안 됨)', () => {
    useToastStore.getState().showStatus('A', 1000)
    vi.advanceTimersByTime(500)
    useToastStore.getState().showStatus('B', 1000)
    vi.advanceTimersByTime(600) // A의 원래 만료 시점 지남
    expect(useToastStore.getState().message).toBe('B')
    vi.advanceTimersByTime(400)
    expect(useToastStore.getState().message).toBe('')
  })
})
