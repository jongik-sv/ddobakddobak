import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RecordingBar } from '../RecordingBar'
import { useRecordingStore } from '../../../stores/recordingStore'
import { useTranscriptStore } from '../../../stores/transcriptStore'

const renderAt = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><RecordingBar /></MemoryRouter>)

describe('RecordingBar', () => {
  beforeEach(() => { useRecordingStore.getState().endSession(); useTranscriptStore.getState().reset() })

  it('녹음 중 + 다른 라우트면 표시', () => {
    useRecordingStore.getState().start(5)
    useRecordingStore.getState().publish({ status: 'recording', elapsedSeconds: 754 })
    renderAt('/meetings')
    expect(screen.getByText('12:34')).toBeInTheDocument()
  })

  it('녹음 중이지만 해당 회의 라이브 라우트면 숨김', () => {
    useRecordingStore.getState().start(5)
    useRecordingStore.getState().publish({ status: 'recording' })
    const { container } = renderAt('/meetings/5/live')
    expect(container).toBeEmptyDOMElement()
  })

  it('idle이면 숨김', () => {
    const { container } = renderAt('/meetings')
    expect(container).toBeEmptyDOMElement()
  })
})
