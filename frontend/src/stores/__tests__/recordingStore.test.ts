import { describe, it, expect, beforeEach } from 'vitest'
import { useRecordingStore } from '../recordingStore'
import { useTranscriptStore } from '../transcriptStore'

const reset = () => useRecordingStore.getState().endSession()

describe('recordingStore', () => {
  beforeEach(() => { reset(); useTranscriptStore.getState().reset() })

  it('start(id)로 activeMeetingId+pendingStart 설정', () => {
    useRecordingStore.getState().start(42)
    const s = useRecordingStore.getState()
    expect(s.activeMeetingId).toBe(42)
    expect(s.pendingStart).toBe(true)
  })

  it('이미 같은 meeting active면 start 무시(pendingStart 재설정 안 함)', () => {
    useRecordingStore.getState().start(42)
    useRecordingStore.getState().consumePendingStart()
    useRecordingStore.getState().start(42)
    expect(useRecordingStore.getState().pendingStart).toBe(false)
  })

  it('녹음 중 다른 meeting start는 무시(activeMeetingId 안 바뀜)', () => {
    useRecordingStore.getState().start(42)
    useRecordingStore.getState().publish({ status: 'recording' })
    useRecordingStore.getState().start(99)
    expect(useRecordingStore.getState().activeMeetingId).toBe(42)
  })

  it('requestStop: finals 0이면 즉시 onStop(true), 다이얼로그 안 띄움', () => {
    const calls: boolean[] = []
    useRecordingStore.getState().registerHandlers({
      onPause(){}, onResume(){}, onStop(skip){ calls.push(skip) },
      onManualSummary(){}, onToggleSystemAudio(){}, onSetSummaryInterval(){}, onReset(){},
    })
    useRecordingStore.getState().requestStop()
    expect(useRecordingStore.getState().showStopConfirm).toBe(false)
    expect(calls).toEqual([true])
  })

  it('requestStop: finals 있으면 showStopConfirm=true, onStop 즉시 호출 안 함', () => {
    useTranscriptStore.setState({ finals: [{ id: 1 } as never] })
    let stopped = false
    useRecordingStore.getState().registerHandlers({
      onPause(){}, onResume(){}, onStop(){ stopped = true },
      onManualSummary(){}, onToggleSystemAudio(){}, onSetSummaryInterval(){}, onReset(){},
    })
    useRecordingStore.getState().requestStop()
    expect(useRecordingStore.getState().showStopConfirm).toBe(true)
    expect(stopped).toBe(false)
  })

  it('confirmStop(false): 다이얼로그 닫고 onStop(false) 호출', () => {
    let arg: boolean | null = null
    useRecordingStore.getState().registerHandlers({
      onPause(){}, onResume(){}, onStop(skip){ arg = skip },
      onManualSummary(){}, onToggleSystemAudio(){}, onSetSummaryInterval(){}, onReset(){},
    })
    useRecordingStore.setState({ showStopConfirm: true })
    useRecordingStore.getState().confirmStop(false)
    expect(useRecordingStore.getState().showStopConfirm).toBe(false)
    expect(arg).toBe(false)
  })

  it('pause/resume/manualSummary 인텐트가 등록 핸들러로 위임', () => {
    const log: string[] = []
    useRecordingStore.getState().registerHandlers({
      onPause(){ log.push('p') }, onResume(){ log.push('r') }, onStop(){},
      onManualSummary(){ log.push('m') }, onToggleSystemAudio(){}, onSetSummaryInterval(){}, onReset(){},
    })
    const g = useRecordingStore.getState()
    g.pause(); g.resume(); g.manualSummary()
    expect(log).toEqual(['p', 'r', 'm'])
  })

  it('endSession: activeMeetingId=null, status=stopped로 정리', () => {
    useRecordingStore.getState().start(7)
    useRecordingStore.getState().publish({ status: 'recording' })
    useRecordingStore.getState().endSession()
    const s = useRecordingStore.getState()
    expect(s.activeMeetingId).toBeNull()
    expect(s._handlers).toBeNull()
  })
})
