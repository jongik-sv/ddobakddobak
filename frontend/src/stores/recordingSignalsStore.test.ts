import { describe, it, expect, beforeEach } from 'vitest'
import { useRecordingSignalsStore } from './recordingSignalsStore'

describe('recordingSignalsStore', () => {
  beforeEach(() => {
    useRecordingSignalsStore.getState().reset()
  })

  it('초기 상태 확인', () => {
    const state = useRecordingSignalsStore.getState()
    expect(state.recordingDenied).toBe(false)
    expect(state.recordingStopped).toBe(false)
    // 일시정지 신호 미수신은 null — REST 스냅샷 폴백을 위해 false와 구분한다
    expect(state.recordingPaused).toBeNull()
  })

  describe('recordingDenied', () => {
    it('setRecordingDenied가 플래그를 설정한다', () => {
      useRecordingSignalsStore.getState().setRecordingDenied(true)
      expect(useRecordingSignalsStore.getState().recordingDenied).toBe(true)
    })

    it('reset이 recordingDenied를 초기화한다', () => {
      useRecordingSignalsStore.getState().setRecordingDenied(true)
      useRecordingSignalsStore.getState().reset()
      expect(useRecordingSignalsStore.getState().recordingDenied).toBe(false)
    })
  })

  describe('recordingStopped', () => {
    it('setRecordingStopped가 플래그를 설정한다', () => {
      useRecordingSignalsStore.getState().setRecordingStopped(true)
      expect(useRecordingSignalsStore.getState().recordingStopped).toBe(true)
    })

    it('reset이 recordingStopped를 초기화한다', () => {
      useRecordingSignalsStore.getState().setRecordingStopped(true)
      useRecordingSignalsStore.getState().reset()
      expect(useRecordingSignalsStore.getState().recordingStopped).toBe(false)
    })
  })

  describe('recordingPaused', () => {
    it('setRecordingPaused가 meetingId와 paused를 함께 담아 설정한다', () => {
      useRecordingSignalsStore.getState().setRecordingPaused(7, true)
      expect(useRecordingSignalsStore.getState().recordingPaused).toEqual({ meetingId: 7, paused: true })
      useRecordingSignalsStore.getState().setRecordingPaused(7, false)
      expect(useRecordingSignalsStore.getState().recordingPaused).toEqual({ meetingId: 7, paused: false })
    })

    it('다른 회의의 신호는 최근 것으로 덮어쓴다(회의별 스코프)', () => {
      useRecordingSignalsStore.getState().setRecordingPaused(1, true)
      useRecordingSignalsStore.getState().setRecordingPaused(2, false)
      // 소비처가 meetingId 일치 여부로 자기 회의 신호만 취사선택할 수 있게 최신 신호를 보존
      expect(useRecordingSignalsStore.getState().recordingPaused).toEqual({ meetingId: 2, paused: false })
    })

    it('reset이 recordingPaused를 null(신호 미수신)로 되돌린다', () => {
      useRecordingSignalsStore.getState().setRecordingPaused(1, true)
      useRecordingSignalsStore.getState().reset()
      expect(useRecordingSignalsStore.getState().recordingPaused).toBeNull()
    })
  })
})
