import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingLivePage from './MeetingLivePage'

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

vi.mock('../api/meetings', () => ({
  startMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording' }),
  stopMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'stopped' }),
  uploadAudio: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../hooks/useAudioRecorder', () => ({
  useAudioRecorder: vi.fn().mockReturnValue({
    isRecording: false,
    error: null,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }),
}))

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: vi.fn().mockReturnValue({
    sendChunk: vi.fn(),
  }),
}))

vi.mock('../components/meeting/LiveRecord', () => ({
  LiveRecord: () => <div data-testid="live-transcript">기록 영역</div>,
}))

vi.mock('../components/editor/MeetingEditor', () => ({
  MeetingEditor: () => <div data-testid="meeting-editor">에디터 영역</div>,
  customSchema: { blockSpecs: {} },
}))

vi.mock('../hooks/useSttBlockInserter', () => ({
  useSttBlockInserter: vi.fn(),
}))

// ──────────────────────────────────────────────

import * as meetingsApi from '../api/meetings'
import * as useAudioRecorderModule from '../hooks/useAudioRecorder'

function renderPage(meetingId = '1') {
  return render(
    <MemoryRouter initialEntries={[`/meetings/${meetingId}/live`]}>
      <Routes>
        <Route path="/meetings/:id/live" element={<MeetingLivePage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MeetingLivePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAudioRecorderModule.useAudioRecorder).mockReturnValue({
      isRecording: false,
      error: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    })
    vi.mocked(meetingsApi.startMeeting).mockResolvedValue({ id: 1, status: 'recording', title: '테스트 회의', created_at: '' })
    vi.mocked(meetingsApi.stopMeeting).mockResolvedValue({ id: 1, status: 'stopped', title: '테스트 회의', created_at: '' })
    vi.mocked(meetingsApi.uploadAudio).mockResolvedValue(undefined)
  })

  it('"회의 시작" 버튼 렌더', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /회의 시작/i })).toBeInTheDocument()
  })

  it('"회의 종료" 버튼은 회의 시작 전 비활성화', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /회의 종료/i })).toBeDisabled()
  })

  it('3영역 레이아웃 표시 (기록, 요약, 메모)', () => {
    renderPage()
    expect(screen.getByTestId('live-transcript')).toBeInTheDocument()
    expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
    expect(screen.getByTestId('memo-editor')).toBeInTheDocument()
  })

  it('"회의 시작" 클릭 시 startMeeting API 호출', async () => {
    renderPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
    })
    expect(meetingsApi.startMeeting).toHaveBeenCalledWith(1)
  })

  it('회의 시작 후 녹음 표시등 표시', async () => {
    vi.mocked(useAudioRecorderModule.useAudioRecorder).mockReturnValue({
      isRecording: true,
      error: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    })
    renderPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('recording-indicator')).toBeInTheDocument()
    })
  })

  it('"회의 종료" 클릭 시 stopMeeting API 호출', async () => {
    renderPage()
    // 먼저 회의 시작
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
    })
    // 회의 종료
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 종료/i }))
    })
    expect(meetingsApi.stopMeeting).toHaveBeenCalledWith(1)
  })
})
