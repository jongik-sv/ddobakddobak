import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingPage from '../MeetingPage'

// ── useMediaQuery mock ──
const { mockUseMediaQuery } = vi.hoisted(() => ({
  mockUseMediaQuery: vi.fn(() => true), // 기본: 데스크톱
}))

vi.mock('../../hooks/useMediaQuery', () => ({
  useMediaQuery: mockUseMediaQuery,
  BREAKPOINTS: {
    sm: '(min-width: 640px)',
    md: '(min-width: 768px)',
    lg: '(min-width: 1024px)',
    xl: '(min-width: 1280px)',
  },
}))

// ── 기존 의존성 mock (MeetingPage.test.tsx 패턴) ──
const { mockMeetingBase } = vi.hoisted(() => ({
  mockMeetingBase: {
    id: 1,
    title: '반응형 테스트 회의',
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

vi.mock('../../api/meetings', () => ({
  getMeetingDetail: vi.fn().mockResolvedValue({
    meeting: {
      id: 1,
      title: '반응형 테스트 회의',
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
    key_points: [],
    decisions: [],
    discussion_details: [],
    notes_markdown: '# 회의 노트',
    summary_type: 'final',
    generated_at: '2026-03-25T10:30:00Z',
  }),
  updateMeeting: vi.fn(),
  deleteMeeting: vi.fn(),
  getTranscripts: vi.fn().mockResolvedValue([]),
  reopenMeeting: vi.fn(),
  regenerateStt: vi.fn(),
  regenerateNotes: vi.fn(),
  updateNotes: vi.fn(),
  correctTerms: vi.fn(),
}))

vi.mock('../../api/actionItems', () => ({
  getActionItems: vi.fn().mockResolvedValue([]),
  updateActionItem: vi.fn(),
  deleteActionItem: vi.fn(),
  createActionItem: vi.fn(),
}))

vi.mock('../../hooks/useBlockSync', () => ({
  useBlockSync: vi.fn().mockReturnValue({
    isLoading: false,
    isSaving: false,
    error: null,
    initialContent: null,
    onEditorChange: vi.fn(),
  }),
}))

vi.mock('../../components/editor/MeetingEditor', () => ({
  MeetingEditor: () => <div data-testid="meeting-editor">에디터</div>,
  customSchema: { blockSpecs: {} },
}))

vi.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: vi.fn(() => ({
    isReady: false,
    isPlaying: false,
    hasAudio: false,
    audioLoaded: false,
    currentTimeMs: 0,
    durationMs: 0,
    playbackRate: 1,
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    setPlaybackRate: vi.fn(),
    download: vi.fn(),
  })),
}))

vi.mock('../../components/meeting/AudioPlayer', () => ({
  AudioPlayer: () => <div data-testid="audio-player" />,
}))

vi.mock('../../components/meeting/MiniAudioPlayer', () => ({
  MiniAudioPlayer: () => <div data-testid="mini-audio-player" />,
}))

vi.mock('../../components/meeting/TranscriptPanel', () => ({
  TranscriptPanel: () => <div data-testid="transcript-panel">전사 내용</div>,
}))

vi.mock('../../components/decision/DecisionList', () => ({
  DecisionList: () => <div data-testid="decision-list" />,
}))

vi.mock('../../api/bookmarks', () => ({
  getBookmarks: vi.fn().mockResolvedValue([]),
  deleteBookmark: vi.fn(),
}))

vi.mock('../../components/meeting/ShareLinkButton', () => ({
  ShareLinkButton: () => null,
}))

vi.mock('../../components/meeting/ExportButton', () => ({
  ExportButton: () => <button data-testid="export-button">내보내기</button>,
}))

vi.mock('../../components/meeting/AiSummaryPanel', () => ({
  AiSummaryPanel: () => <div data-testid="ai-summary">AI 요약</div>,
}))

vi.mock('../../components/meeting/AttachmentSection', () => ({
  AttachmentSection: () => <div data-testid="attachment-section" />,
}))

vi.mock('../../components/meeting/EditMeetingDialog', () => ({
  default: () => null,
}))

vi.mock('../../hooks/useFileTranscriptionProgress', () => ({
  useFileTranscriptionProgress: vi.fn().mockReturnValue({
    progress: 0,
    status: 'idle',
    message: '',
    error: null,
  }),
}))

vi.mock('../../hooks/useMemoEditor', () => ({
  useMemoEditor: vi.fn().mockReturnValue({
    memoEditorRef: { current: null },
    isSavingMemo: false,
    handleSaveMemo: vi.fn(),
  }),
}))

vi.mock('@rails/actioncable', () => ({
  createConsumer: vi.fn(() => ({
    subscriptions: { create: vi.fn(() => ({ unsubscribe: vi.fn() })) },
    disconnect: vi.fn(),
  })),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

// ── helpers ──

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/meetings/1']}>
      <Routes>
        <Route path="/meetings/:id" element={<MeetingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── tests ──

describe('MeetingPage 반응형 분기', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('데스크톱 (>= lg)', () => {
    beforeEach(() => {
      mockUseMediaQuery.mockReturnValue(true)
    })

    it('데스크톱 레이아웃이 렌더링됨 (탭 없음, 패널 콘텐츠 표시)', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('반응형 테스트 회의')).toBeInTheDocument()
      })
      // 데스크톱: 탭이 없고 TranscriptPanel과 AiSummaryPanel이 직접 표시
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
      expect(screen.getByTestId('transcript-panel')).toBeInTheDocument()
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
    })

    it('MobileTabLayout 탭 바가 렌더링되지 않음', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('반응형 테스트 회의')).toBeInTheDocument()
      })
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    })

    it('헤더 제목이 text-xl 클래스를 가짐', async () => {
      renderPage()
      await waitFor(() => {
        const heading = screen.getByText('회의 미리보기')
        expect(heading.className).toContain('text-xl')
      })
    })
  })

  describe('모바일 (< lg)', () => {
    beforeEach(() => {
      mockUseMediaQuery.mockReturnValue(false)
    })

    it('MobileTabLayout 탭 바가 렌더링됨', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('반응형 테스트 회의')).toBeInTheDocument()
      })
      expect(screen.getByRole('tablist')).toBeInTheDocument()
    })

    it('3개 탭 (전사/요약/메모)이 표시됨', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('반응형 테스트 회의')).toBeInTheDocument()
      })
      expect(screen.getByRole('tab', { name: /전사/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /요약/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /메모/ })).toBeInTheDocument()
    })

    it('MobileTabLayout이 사용됨 (tablist 존재)', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('반응형 테스트 회의')).toBeInTheDocument()
      })
      expect(screen.getByRole('tablist')).toBeInTheDocument()
    })

    it('TranscriptPanel이 탭 내에 렌더링됨', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('transcript-panel')).toBeInTheDocument()
      })
    })

    it('AiSummaryPanel이 탭 내에 렌더링됨', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
      })
    })

    it('MeetingEditor가 탭 내에 렌더링됨', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('meeting-editor')).toBeInTheDocument()
      })
    })

    it('헤더 제목이 text-lg 클래스를 가짐', async () => {
      renderPage()
      await waitFor(() => {
        const heading = screen.getByText('회의 미리보기')
        expect(heading.className).toContain('text-lg')
        expect(heading.className).not.toContain('text-xl')
      })
    })
  })
})
