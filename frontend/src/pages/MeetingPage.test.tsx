import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingPage from './MeetingPage'

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const mockMeetingBase = {
  id: 1,
  title: '테스트 회의',
  status: 'completed' as const,
  team: { id: 1, name: '테스트 팀' },
  created_by: { id: 1, name: '테스터' },
  started_at: '2026-03-25T10:00:00Z',
  ended_at: '2026-03-25T11:00:00Z',
  created_at: '2026-03-25T10:00:00Z',
}

vi.mock('../api/meetings', () => ({
  getMeetingDetail: vi.fn().mockResolvedValue({
    meeting: {
      id: 1,
      title: '테스트 회의',
      status: 'completed',
      team: { id: 1, name: '테스트 팀' },
      created_by: { id: 1, name: '테스터' },
      started_at: '2026-03-25T10:00:00Z',
      ended_at: '2026-03-25T11:00:00Z',
      created_at: '2026-03-25T10:00:00Z',
    },
    error: null,
  }),
  getMeeting: vi.fn().mockResolvedValue({
    id: 1,
    title: '테스트 회의',
    status: 'completed',
    team: { id: 1, name: '테스트 팀' },
    created_by: { id: 1, name: '테스터' },
    started_at: '2026-03-25T10:00:00Z',
    ended_at: '2026-03-25T11:00:00Z',
    created_at: '2026-03-25T10:00:00Z',
  }),
  getSummary: vi.fn().mockResolvedValue({
    id: 1,
    meeting_id: 1,
    key_points: '핵심 요약 내용',
    decisions: '결정 사항',
    discussion_details: '논의 세부 사항',
    summary_type: 'final',
    generated_at: '2026-03-25T10:30:00Z',
  }),
  updateMeeting: vi.fn().mockResolvedValue({
    id: 1,
    title: '수정된 회의 제목',
    status: 'completed',
    team: { id: 1, name: '테스트 팀' },
    created_by: { id: 1, name: '테스터' },
    started_at: '2026-03-25T10:00:00Z',
    ended_at: '2026-03-25T11:00:00Z',
    created_at: '2026-03-25T10:00:00Z',
  }),
  deleteMeeting: vi.fn().mockResolvedValue(undefined),
  getTranscripts: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/actionItems', () => ({
  getActionItems: vi.fn().mockResolvedValue([]),
  updateActionItem: vi.fn(),
  deleteActionItem: vi.fn(),
  createActionItem: vi.fn(),
}))

vi.mock('../hooks/useBlockSync', () => ({
  useBlockSync: vi.fn().mockReturnValue({
    isLoading: false,
    isSaving: false,
    error: null,
    initialContent: null,
    onEditorChange: vi.fn(),
  }),
}))

vi.mock('../components/editor/MeetingEditor', () => ({
  MeetingEditor: () => <div data-testid="meeting-editor">에디터 영역</div>,
  customSchema: { blockSpecs: {} },
}))

vi.mock('../components/meeting/AudioPlayer', () => ({
  AudioPlayer: () => <div data-testid="audio-player" />,
}))

vi.mock('../components/meeting/TranscriptPanel', () => ({
  TranscriptPanel: () => <div data-testid="transcript-panel" />,
}))

vi.mock('../components/meeting/ShareLinkButton', () => ({
  ShareLinkButton: () => <button data-testid="share-button">공유</button>,
}))

vi.mock('../components/meeting/ExportButton', () => ({
  ExportButton: () => <button data-testid="export-button">내보내기</button>,
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// ──────────────────────────────────────────────

import * as meetingsApi from '../api/meetings'

function renderPage(meetingId = '1') {
  return render(
    <MemoryRouter initialEntries={[`/meetings/${meetingId}`]}>
      <Routes>
        <Route path="/meetings/:id" element={<MeetingPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MeetingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue(mockMeetingBase)
    vi.mocked(meetingsApi.getSummary).mockResolvedValue({
      id: 1,
      meeting_id: 1,
      key_points: '핵심 요약 내용',
      decisions: '결정 사항',
      discussion_details: '논의 세부 사항',
      summary_type: 'final',
      generated_at: '2026-03-25T10:30:00Z',
    })
    vi.mocked(meetingsApi.updateMeeting).mockResolvedValue({
      ...mockMeetingBase,
      title: '수정된 회의 제목',
    })
    vi.mocked(meetingsApi.deleteMeeting).mockResolvedValue(undefined)
    vi.mocked(meetingsApi.getTranscripts).mockResolvedValue([])
  })

  it('회의 제목이 표시된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
  })

  it('에디터 영역이 렌더링된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('meeting-editor')).toBeInTheDocument()
    })
  })

  it('AI 요약 섹션이 표시된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('핵심 요약 내용')).toBeInTheDocument()
    })
  })

  it('요약이 없을 때 빈 상태 메시지를 표시한다', async () => {
    vi.mocked(meetingsApi.getSummary).mockResolvedValue(null)
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('회의 요약이 아직 생성되지 않았습니다')).toBeInTheDocument()
    })
  })

  it('제목 클릭 시 인라인 편집 input이 표시된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('테스트 회의'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('제목 편집 후 Enter 키 입력 시 updateMeeting API가 호출된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('테스트 회의'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '수정된 회의 제목' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(meetingsApi.updateMeeting).toHaveBeenCalledWith(1, { title: '수정된 회의 제목' })
    })
  })

  it('삭제 버튼 클릭 시 deleteMeeting API가 호출된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    const deleteButton = screen.getByRole('button', { name: /삭제/i })
    await act(async () => {
      fireEvent.click(deleteButton)
    })
    await waitFor(() => {
      expect(meetingsApi.deleteMeeting).toHaveBeenCalledWith(1)
    })
  })

  it('삭제 후 /dashboard로 이동한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    const deleteButton = screen.getByRole('button', { name: /삭제/i })
    await act(async () => {
      fireEvent.click(deleteButton)
    })
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('getMeeting과 getSummary가 병렬 호출된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(meetingsApi.getMeeting).toHaveBeenCalledWith(1)
      expect(meetingsApi.getSummary).toHaveBeenCalledWith(1)
    })
  })
})
