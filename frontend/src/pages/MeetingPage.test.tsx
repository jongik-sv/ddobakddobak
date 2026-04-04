import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingPage from './MeetingPage'

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const { mockMeetingBase } = vi.hoisted(() => ({
  mockMeetingBase: {
    id: 1,
    title: '테스트 회의',
    status: 'completed' as const,
    meeting_type: 'general',
    created_by: { id: 1, name: '테스터' },
    brief_summary: null,
    audio_duration_ms: 0,
    last_transcript_end_ms: 0,
    last_sequence_number: 0,
    memo: null,
    folder_id: null,
    started_at: '2026-03-25T10:00:00Z',
    ended_at: '2026-03-25T11:00:00Z',
    created_at: '2026-03-25T10:00:00Z',
  },
}))

vi.mock('../api/meetings', () => ({
  getMeetingDetail: vi.fn().mockResolvedValue({
    meeting: {
      id: 1,
      title: '테스트 회의',
      status: 'completed',
      team_id: 1,
      created_by_id: 1,
      started_at: '2026-03-25T10:00:00Z',
      ended_at: '2026-03-25T11:00:00Z',
      created_at: '2026-03-25T10:00:00Z',
      updated_at: '2026-03-25T11:00:00Z',
    },
    error: null,
  }),
  getMeeting: vi.fn().mockResolvedValue(mockMeetingBase),
  getSummary: vi.fn().mockResolvedValue({
    id: 1,
    meeting_id: 1,
    key_points: ['핵심 요약 내용'],
    decisions: ['결정 사항'],
    discussion_details: ['논의 세부 사항'],
    notes_markdown: '# 회의 노트',
    summary_type: 'final',
    generated_at: '2026-03-25T10:30:00Z',
  }),
  updateMeeting: vi.fn().mockResolvedValue({
    ...mockMeetingBase,
    title: '수정된 회의 제목',
  }),
  deleteMeeting: vi.fn().mockResolvedValue(undefined),
  getTranscripts: vi.fn().mockResolvedValue([]),
  reopenMeeting: vi.fn().mockResolvedValue(mockMeetingBase),
  regenerateStt: vi.fn().mockResolvedValue(mockMeetingBase),
  regenerateNotes: vi.fn().mockResolvedValue(undefined),
  updateNotes: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../hooks/useAudioPlayer', () => ({
  useAudioPlayer: vi.fn(() => ({
    isReady: true,
    isPlaying: false,
    hasAudio: true,
    audioLoaded: true,
    currentTimeMs: 0,
    durationMs: 60000,
    playbackRate: 1,
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    setPlaybackRate: vi.fn(),
    download: vi.fn(),
  })),
}))

vi.mock('../components/meeting/AudioPlayer', () => ({
  AudioPlayer: () => <div data-testid="audio-player" />,
}))

vi.mock('../components/meeting/MiniAudioPlayer', () => ({
  MiniAudioPlayer: () => <div data-testid="mini-audio-player" />,
}))

vi.mock('../components/meeting/TranscriptPanel', () => ({
  TranscriptPanel: () => <div data-testid="transcript-panel" />,
}))

vi.mock('../components/decision/DecisionList', () => ({
  DecisionList: () => <div data-testid="decision-list" />,
}))

vi.mock('../api/bookmarks', () => ({
  getBookmarks: vi.fn().mockResolvedValue([]),
  deleteBookmark: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../components/meeting/ShareLinkButton', () => ({
  ShareLinkButton: () => <button data-testid="share-button">공유</button>,
}))

vi.mock('../components/meeting/ExportButton', () => ({
  ExportButton: () => <button data-testid="export-button">내보내기</button>,
}))

vi.mock('../components/meeting/AiSummaryPanel', () => ({
  AiSummaryPanel: () => <div data-testid="ai-summary">AI 요약 영역</div>,
}))

vi.mock('../components/meeting/AttachmentSection', () => ({
  AttachmentSection: () => <div data-testid="attachment-section" />,
}))

vi.mock('../components/meeting/EditMeetingDialog', () => ({
  default: () => null,
}))

vi.mock('../hooks/useFileTranscriptionProgress', () => ({
  useFileTranscriptionProgress: vi.fn().mockReturnValue({
    progress: 0,
    status: 'idle',
    message: '',
    error: null,
  }),
}))

vi.mock('../hooks/useMemoEditor', () => ({
  useMemoEditor: vi.fn().mockReturnValue({
    memoEditorRef: { current: null },
    isSavingMemo: false,
    handleSaveMemo: vi.fn(),
  }),
}))

vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => true), // 데스크톱 모드 고정
  BREAKPOINTS: {
    sm: '(min-width: 640px)',
    md: '(min-width: 768px)',
    lg: '(min-width: 1024px)',
    xl: '(min-width: 1280px)',
  },
}))

vi.mock('@rails/actioncable', () => ({
  createConsumer: vi.fn(() => ({
    subscriptions: {
      create: vi.fn(() => ({
        unsubscribe: vi.fn(),
      })),
    },
    disconnect: vi.fn(),
  })),
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
      key_points: ['핵심 요약 내용'],
      decisions: ['결정 사항'],
      discussion_details: ['논의 세부 사항'],
      notes_markdown: '# 회의 노트',
      summary_type: 'final',
      generated_at: '2026-03-25T10:30:00Z',
    })
    vi.mocked(meetingsApi.updateMeeting).mockResolvedValue({
      ...mockMeetingBase,
      title: '수정된 회의 제목',
    })
    vi.mocked(meetingsApi.deleteMeeting).mockResolvedValue(undefined)
    vi.mocked(meetingsApi.getTranscripts).mockResolvedValue([])
    vi.mocked(meetingsApi.getMeetingDetail).mockResolvedValue({
      meeting: {
        id: 1,
        title: '테스트 회의',
        status: 'completed',
        created_by_id: 1,
        started_at: '2026-03-25T10:00:00Z',
        ended_at: '2026-03-25T11:00:00Z',
        created_at: '2026-03-25T10:00:00Z',
        updated_at: '2026-03-25T11:00:00Z',
      },
      error: null,
    })
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
      expect(screen.getByTestId('transcript-panel')).toBeInTheDocument()
    })
  })

  it('AI 요약 섹션이 표시된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
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
