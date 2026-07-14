import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RecordingLayer } from '../RecordingLayer'
import { useRecordingStore } from '../../../stores/recordingStore'

describe('RecordingLayer 전역 종료확인', () => {
  beforeEach(() => useRecordingStore.getState().endSession())

  it('showStopConfirm=true면 StopMeetingDialog 렌더', () => {
    useRecordingStore.setState({ showStopConfirm: true })
    render(<MemoryRouter><RecordingLayer /></MemoryRouter>)
    // StopMeetingDialog heading "회의 종료" 존재 확인
    expect(screen.getByRole('heading', { name: '회의 종료' })).toBeInTheDocument()
  })

  it('showStopConfirm=false면 StopMeetingDialog 미렌더', () => {
    render(<MemoryRouter><RecordingLayer /></MemoryRouter>)
    expect(screen.queryByText('회의 종료')).not.toBeInTheDocument()
  })

  it('요약하고 종료 클릭 시 confirmStop(false) 호출', () => {
    useRecordingStore.setState({ showStopConfirm: true })
    const calls: boolean[] = []
    useRecordingStore.getState().registerHandlers({
      onPause() {}, onResume() {}, onStop(skip) { calls.push(skip) },
      onManualSummary() {}, onToggleSystemAudio() {}, onSetSummaryInterval() {}, onReset() {},
    })
    render(<MemoryRouter><RecordingLayer /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '요약하고 종료' }))
    expect(useRecordingStore.getState().showStopConfirm).toBe(false)
    expect(calls).toEqual([false])
  })

  it('요약 없이 종료 클릭 시 confirmStop(true) 호출', () => {
    useRecordingStore.setState({ showStopConfirm: true })
    const calls: boolean[] = []
    useRecordingStore.getState().registerHandlers({
      onPause() {}, onResume() {}, onStop(skip) { calls.push(skip) },
      onManualSummary() {}, onToggleSystemAudio() {}, onSetSummaryInterval() {}, onReset() {},
    })
    render(<MemoryRouter><RecordingLayer /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '요약 없이 종료' }))
    expect(useRecordingStore.getState().showStopConfirm).toBe(false)
    expect(calls).toEqual([true])
  })

  it('취소 클릭 시 cancelStop 호출 → showStopConfirm=false', () => {
    useRecordingStore.setState({ showStopConfirm: true })
    render(<MemoryRouter><RecordingLayer /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(useRecordingStore.getState().showStopConfirm).toBe(false)
  })
})
