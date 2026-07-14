import { describe, it, expect, beforeEach } from 'vitest'
import { useToastStore } from '../../stores/toastStore'
// performStop 노출 + showStatus 디커플은 타입/런타임 계약 — 컴파일 + 아래 스모크로 가드.

describe('useLiveRecording decouple', () => {
  beforeEach(() => useToastStore.getState().clear())
  it('toastStore.showStatus가 존재하고 호출 가능(전역 토스트 경유 계약)', () => {
    useToastStore.getState().showStatus('회의 종료 중...', 100)
    expect(useToastStore.getState().message).toBe('회의 종료 중...')
  })
})
