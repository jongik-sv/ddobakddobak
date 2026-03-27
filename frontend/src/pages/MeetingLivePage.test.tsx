import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingLivePage from './MeetingLivePage'

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

vi.mock('../api/meetings', () => ({
  startMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  stopMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'completed', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  getMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'pending', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  uploadAudio: vi.fn().mockResolvedValue(undefined),
  getTranscripts: vi.fn().mockResolvedValue([]),
  getSummary: vi.fn().mockResolvedValue(null),
  reopenMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  triggerRealtimeSummary: vi.fn().mockResolvedValue(undefined),
  resetMeetingContent: vi.fn().mockResolvedValue({ id: 1, status: 'pending', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  feedbackNotes: vi.fn().mockResolvedValue(''),
  updateNotes: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../hooks/useAudioRecorder', () => ({
  useAudioRecorder: vi.fn().mockReturnValue({
    isRecording: false,
    isPaused: false,
    error: null,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}))

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: vi.fn().mockReturnValue({
    sendChunk: vi.fn(),
  }),
}))

vi.mock('../components/meeting/RecordTabPanel', () => ({
  RecordTabPanel: () => <div data-testid="live-transcript">기록 영역</div>,
}))

vi.mock('../components/meeting/AiSummaryPanel', () => ({
  AiSummaryPanel: () => <div data-testid="ai-summary">AI 요약 영역</div>,
}))

vi.mock('../components/meeting/SpeakerPanel', () => ({
  SpeakerPanel: () => <div data-testid="speaker-panel">화자 영역</div>,
}))

vi.mock('../components/editor/MeetingEditor', () => ({
  MeetingEditor: () => <div data-testid="meeting-editor">에디터 영역</div>,
  customSchema: { blockSpecs: {}, blockSchema: {} },
}))

vi.mock('../api/settings', () => ({
  getSttSettings: vi.fn().mockResolvedValue({ stt_engine: 'whisper' }),
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
      isPaused: false,
      error: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    })
    vi.mocked(meetingsApi.startMeeting).mockResolvedValue({ id: 1, status: 'recording', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' })
    vi.mocked(meetingsApi.stopMeeting).mockResolvedValue({ id: 1, status: 'completed', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' })
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
      isPaused: false,
      error: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
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
