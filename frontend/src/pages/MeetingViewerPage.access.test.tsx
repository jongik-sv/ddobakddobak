import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMeetingAccess } from '../hooks/useMeetingAccess'
import MeetingViewerPage from './MeetingViewerPage'

vi.mock('../hooks/useMeetingAccess', () => ({ useMeetingAccess: vi.fn() }))
const mockedAccess = vi.mocked(useMeetingAccess)

vi.mock('../hooks/useViewerData', () => ({
  useViewerData: vi.fn().mockReturnValue({
    meetingTitle: '',
    isLoaded: false,
    error: null,
  }),
}))

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: vi.fn().mockReturnValue({
    sendChunk: vi.fn(),
    sendSystemChunk: vi.fn(),
  }),
}))

vi.mock('../components/meeting/RecordTabPanel', () => ({
  RecordTabPanel: () => <div data-testid="record-tab-panel">기록 영역</div>,
}))

vi.mock('../components/meeting/AiSummaryPanel', () => ({
  AiSummaryPanel: () => <div data-testid="ai-summary-panel">AI 요약 영역</div>,
}))

vi.mock('../components/meeting/SpeakerPanel', () => ({
  SpeakerPanel: () => <div data-testid="speaker-panel">화자 영역</div>,
}))

vi.mock('../components/meeting/ParticipantList', () => ({
  ParticipantList: () => <div data-testid="participant-list">참여자 목록</div>,
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/meetings/99/viewer']}>
      <Routes>
        <Route path="/meetings/:id/viewer" element={<MeetingViewerPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MeetingViewerPage 접근 제어', () => {
  beforeEach(() => mockedAccess.mockReset())

  it('forbidden이면 접근 권한 없음 안내', async () => {
    mockedAccess.mockReturnValue({ meeting: null, isLoading: false, error: 'forbidden' })
    renderPage()
    await waitFor(() => expect(screen.getByText(/접근 권한이 없습니다/)).toBeInTheDocument())
  })

  it('not_found이면 회의를 찾을 수 없음 안내', async () => {
    mockedAccess.mockReturnValue({ meeting: null, isLoading: false, error: 'not_found' })
    renderPage()
    await waitFor(() => expect(screen.getByText(/회의를 찾을 수 없습니다/)).toBeInTheDocument())
  })
})
