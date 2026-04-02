import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingViewerPage from './MeetingViewerPage'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useSharingStore } from '../stores/sharingStore'

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const mockGetMeeting = vi.hoisted(() => vi.fn())
const mockGetTranscripts = vi.hoisted(() => vi.fn())
const mockGetSummary = vi.hoisted(() => vi.fn())
const mockGetParticipants = vi.hoisted(() => vi.fn())

vi.mock('../api/meetings', () => ({
  getMeeting: mockGetMeeting,
  getTranscripts: mockGetTranscripts,
  getSummary: mockGetSummary,
  getParticipants: mockGetParticipants,
}))

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: vi.fn().mockReturnValue({
    sendChunk: vi.fn(),
  }),
}))

vi.mock('../components/meeting/RecordTabPanel', () => ({
  RecordTabPanel: () => <div data-testid="record-tab-panel">기록 영역</div>,
}))

vi.mock('../components/meeting/AiSummaryPanel', () => ({
  AiSummaryPanel: (props: { editable?: boolean; onNotesChange?: unknown }) => (
    <div data-testid="ai-summary-panel" data-editable={String(props.editable ?? true)}>
      AI 요약 영역
    </div>
  ),
}))

vi.mock('../components/meeting/SpeakerPanel', () => ({
  SpeakerPanel: () => <div data-testid="speaker-panel">화자 영역</div>,
}))

vi.mock('../components/meeting/ParticipantList', () => ({
  ParticipantList: () => <div data-testid="participant-list">참여자 목록</div>,
}))

const mockNavigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// ──────────────────────────────────────────────

function renderPage(meetingId = '42') {
  return render(
    <MemoryRouter initialEntries={[`/meetings/${meetingId}/viewer`]}>
      <Routes>
        <Route path="/meetings/:id/viewer" element={<MeetingViewerPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MeetingViewerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTranscriptStore.getState().reset()
    useSharingStore.getState().reset()

    mockGetMeeting.mockResolvedValue({
      id: 42,
      title: '테스트 회의',
      status: 'recording',
      created_by: { id: 1, name: '호스트' },
    })
    mockGetTranscripts.mockResolvedValue([])
    mockGetSummary.mockResolvedValue(null)
    mockGetParticipants.mockResolvedValue([
      { id: 1, user_id: 1, user_name: '호스트', role: 'host', joined_at: '' },
      { id: 2, user_id: 10, user_name: '나', role: 'viewer', joined_at: '' },
    ])
  })

  it('회의 정보를 로드한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(mockGetMeeting).toHaveBeenCalledWith(42)
    })
  })

  it('전사 기록을 로드한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(mockGetTranscripts).toHaveBeenCalledWith(42)
    })
  })

  it('AI 요약을 로드한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(mockGetSummary).toHaveBeenCalledWith(42)
    })
  })

  it('참여자 목록을 로드한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(mockGetParticipants).toHaveBeenCalledWith(42)
    })
  })

  it('ViewerHeader를 표시한다 ("회의 참여 중" 라벨)', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('회의 참여 중')).toBeInTheDocument()
    })
  })

  it('기록 패널을 표시한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('record-tab-panel')).toBeInTheDocument()
    })
  })

  it('AI 요약 패널을 읽기 전용으로 표시한다', async () => {
    renderPage()
    await waitFor(() => {
      const panel = screen.getByTestId('ai-summary-panel')
      expect(panel).toBeInTheDocument()
      expect(panel).toHaveAttribute('data-editable', 'false')
    })
  })

  it('화자 패널을 표시한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('speaker-panel')).toBeInTheDocument()
    })
  })

  it('참여자 목록을 표시한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('participant-list')).toBeInTheDocument()
    })
  })

  it('녹음 컨트롤(시작/정지/일시정지) 버튼이 없다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('회의 참여 중')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /회의 시작/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /회의 종료/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /일시정지/i })).not.toBeInTheDocument()
  })

  it('메모/피드백/내보내기/공유 버튼이 없다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('회의 참여 중')).toBeInTheDocument()
    })
    expect(screen.queryByText('메모')).not.toBeInTheDocument()
    expect(screen.queryByText('AI 피드백')).not.toBeInTheDocument()
    expect(screen.queryByText('내보내기')).not.toBeInTheDocument()
    expect(screen.queryByText('공유')).not.toBeInTheDocument()
  })

  it('나가기 버튼 클릭 시 회의 목록으로 이동한다', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('회의 참여 중')).toBeInTheDocument()
    })
    // 텍스트가 있는 나가기 버튼 (우측)
    const buttons = screen.getAllByRole('button', { name: '나가기' })
    await user.click(buttons[buttons.length - 1])
    expect(mockNavigate).toHaveBeenCalledWith('/meetings')
  })

  it('녹음 종료 이벤트 수신 시 종료 안내를 표시한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('회의 참여 중')).toBeInTheDocument()
    })
    // 녹음 종료 시뮬레이션
    useSharingStore.getState().setRecordingStopped(true)
    await waitFor(() => {
      expect(screen.getByText(/회의가 종료되었습니다/)).toBeInTheDocument()
    })
  })

  it('언마운트 시 transcriptStore와 sharingStore를 초기화한다', async () => {
    const { unmount } = renderPage()
    await waitFor(() => {
      expect(screen.getByText('회의 참여 중')).toBeInTheDocument()
    })
    unmount()
    expect(useTranscriptStore.getState().finals).toEqual([])
    expect(useSharingStore.getState().participants).toEqual([])
  })
})
