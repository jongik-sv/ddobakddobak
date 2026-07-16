import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingViewerPage from './MeetingViewerPage'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useRecordingSignalsStore } from '../stores/recordingSignalsStore'

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const mockGetMeeting = vi.hoisted(() => vi.fn())
const mockGetTranscripts = vi.hoisted(() => vi.fn())
const mockGetSummary = vi.hoisted(() => vi.fn())

vi.mock('../api/meetings', () => ({
  getMeeting: mockGetMeeting,
  getTranscripts: mockGetTranscripts,
  getSummary: mockGetSummary,
  getMeetingDetail: vi.fn().mockResolvedValue({ meeting: { id: 1, title: '테스트 회의', status: 'completed', started_at: null, ended_at: null, created_by_id: 1, created_at: '', updated_at: '' }, error: null }),
}))

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: vi.fn().mockReturnValue({
    sendChunk: vi.fn(),
    sendSystemChunk: vi.fn(),
    sendHeartbeat: vi.fn(),
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
    useRecordingSignalsStore.getState().reset()

    mockGetMeeting.mockResolvedValue({
      id: 42,
      title: '테스트 회의',
      status: 'recording',
      created_by: { id: 1, name: '녹음자' },
    })
    mockGetTranscripts.mockResolvedValue([])
    mockGetSummary.mockResolvedValue(null)
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

  it('ViewerHeader를 표시한다 ("다른 기기에서 녹음 중 — 실시간 보기" 라벨)', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('다른 기기에서 녹음 중 — 실시간 보기')).toBeInTheDocument()
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

  it('녹음 컨트롤(시작/정지/일시정지) 버튼이 없다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('다른 기기에서 녹음 중 — 실시간 보기')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /회의 시작/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /회의 종료/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /일시정지/i })).not.toBeInTheDocument()
  })

  it('메모/피드백/내보내기/공유/참여자 요소가 없다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('다른 기기에서 녹음 중 — 실시간 보기')).toBeInTheDocument()
    })
    expect(screen.queryByText('메모')).not.toBeInTheDocument()
    expect(screen.queryByText('오타 수정')).not.toBeInTheDocument()
    expect(screen.queryByText('내보내기')).not.toBeInTheDocument()
    expect(screen.queryByText('공유')).not.toBeInTheDocument()
    expect(screen.queryByText(/참여자/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '나가기' })).not.toBeInTheDocument()
  })

  it('뒤로 버튼 클릭 시 회의 목록으로 이동한다', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('다른 기기에서 녹음 중 — 실시간 보기')).toBeInTheDocument()
    })
    await user.click(screen.getByTitle('뒤로'))
    expect(mockNavigate).toHaveBeenCalledWith('/meetings')
  })

  it('녹음 종료 이벤트 수신 시 종료 안내를 표시한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('다른 기기에서 녹음 중 — 실시간 보기')).toBeInTheDocument()
    })
    // 녹음 종료 시뮬레이션 (recording_stopped broadcast)
    useRecordingSignalsStore.getState().setRecordingStopped(true)
    await waitFor(() => {
      expect(screen.getByText(/회의가 종료되었습니다/)).toBeInTheDocument()
    })
  })

  it('언마운트 시 transcriptStore와 recordingSignalsStore를 초기화한다', async () => {
    useRecordingSignalsStore.getState().setRecordingStopped(true)
    const { unmount } = renderPage()
    await waitFor(() => {
      expect(screen.getByText(/회의가 종료되었습니다/)).toBeInTheDocument()
    })
    unmount()
    expect(useTranscriptStore.getState().finals).toEqual([])
    expect(useRecordingSignalsStore.getState().recordingStopped).toBe(false)
  })

  it('자기 회의(42)의 일시정지 신호를 반영한다', async () => {
    renderPage('42')
    await waitFor(() => {
      expect(screen.getByText('다른 기기에서 녹음 중 — 실시간 보기')).toBeInTheDocument()
    })
    // 회의 42의 recording_paused 신호 시뮬레이션
    useRecordingSignalsStore.getState().setRecordingPaused(42, true)
    await waitFor(() => {
      expect(screen.getByText('일시정지')).toBeInTheDocument()
    })
  })

  it('다른 회의의 일시정지 신호는 무시하고 REST 스냅샷으로 폴백한다', async () => {
    renderPage('42')
    await waitFor(() => {
      expect(screen.getByText('다른 기기에서 녹음 중 — 실시간 보기')).toBeInTheDocument()
    })
    // 백그라운드로 회의 1을 일시정지 중인 기기의 신호가 회의 42 뷰어로 누수되면 안 됨
    useRecordingSignalsStore.getState().setRecordingPaused(1, true)
    await waitFor(() => {
      expect(screen.getByText('녹음중')).toBeInTheDocument()
    })
    expect(screen.queryByText('일시정지')).not.toBeInTheDocument()
  })
})
