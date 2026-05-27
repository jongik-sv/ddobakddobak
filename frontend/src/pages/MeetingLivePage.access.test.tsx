import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import * as meetingsApi from '../api/meetings'
import MeetingLivePage from './MeetingLivePage'

vi.mock('../hooks/useMeetingAccess', () => ({
  useMeetingAccess: vi.fn().mockReturnValue({ meeting: null, isLoading: false, error: 'forbidden' }),
}))

vi.mock('../api/meetings', async (orig) => ({
  ...(await orig<typeof meetingsApi>()),
  getMeetingDetail: vi.fn().mockResolvedValue({ meeting: null, error: 'forbidden' }),
  getMeeting: vi.fn().mockRejectedValue(new Error('forbidden')),
  getTranscripts: vi.fn().mockResolvedValue([]),
  getSummary: vi.fn().mockResolvedValue(null),
  getParticipants: vi.fn().mockResolvedValue([]),
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
    feedSystemAudio: vi.fn(),
  }),
}))

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: vi.fn().mockReturnValue({
    sendChunk: vi.fn(),
    sendSystemChunk: vi.fn(),
  }),
}))

vi.mock('../hooks/useSystemAudioCapture', () => ({
  useSystemAudioCapture: vi.fn().mockReturnValue({
    isCapturing: false,
    error: null,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }),
}))

vi.mock('../hooks/useMicCapture', () => ({
  useMicCapture: vi.fn().mockReturnValue({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    feedSystemAudio: vi.fn(),
  }),
}))

vi.mock('../hooks/useMemoEditor', () => ({
  useMemoEditor: vi.fn().mockReturnValue({
    memoEditorRef: { current: null },
    isSavingMemo: false,
    handleSaveMemo: vi.fn(),
  }),
}))

vi.mock('../api/settings', () => ({
  getSttSettings: vi.fn().mockResolvedValue({ stt_engine: 'whisper' }),
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

vi.mock('../components/meeting/AttachmentSection', () => ({
  AttachmentSection: () => <div data-testid="attachment-section" />,
}))

describe('MeetingLivePage 접근 제어', () => {
  it('forbidden이면 접근 권한 없음 안내를 보여준다', async () => {
    render(
      <MemoryRouter initialEntries={['/meetings/99/live']}>
        <MeetingLivePage />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText(/접근 권한이 없습니다/)).toBeInTheDocument()
    })
  })
})
