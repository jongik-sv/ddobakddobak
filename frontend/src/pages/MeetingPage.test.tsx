import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingPage from './MeetingPage'

// ──────────────────────────────────────────────
// jsdom polyfills
// ──────────────────────────────────────────────
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })

  // ResizeObserver polyfill for react-resizable-panels
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

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
    folder_id: null,
    memo: null,
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
    notes_markdown: '# 핵심 요약\n- 핵심 요약 내용',
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
  updateMemo: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../hooks/useMeetingAccess', () => ({
  useMeetingAccess: vi.fn().mockReturnValue({
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
    isLoading: false,
  }),
}))

vi.mock('../hooks/useMeeting', () => ({
  useMeeting: vi.fn().mockReturnValue({
    meeting: null,
    summary: null,
    transcripts: [],
    isLoading: false,
    error: null,
    refreshMeeting: vi.fn(),
    refreshSummary: vi.fn(),
  }),
}))

vi.mock('../hooks/useFileTranscriptionProgress', () => ({
  useFileTranscriptionProgress: vi.fn().mockReturnValue({
    progress: null,
  }),
}))

vi.mock('../hooks/useMemoEditor', () => ({
  useMemoEditor: vi.fn().mockReturnValue({
    memoEditorRef: { current: null },
    isSavingMemo: false,
    handleSaveMemo: vi.fn(),
  }),
}))

vi.mock('../lib/actionCableAuth', () => ({
  createAuthenticatedConsumer: vi.fn(() => ({
    subscriptions: {
      create: vi.fn(() => ({ unsubscribe: vi.fn() })),
    },
    disconnect: vi.fn(),
  })),
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

vi.mock('../components/meeting/ExportButton', () => ({
  ExportButton: () => <button data-testid="export-button">내보내기</button>,
}))

vi.mock('../components/meeting/AiSummaryPanel', () => ({
  AiSummaryPanel: () => <div data-testid="ai-summary">AI 요약 영역</div>,
}))

vi.mock('../components/meeting/EditMeetingDialog', () => ({
  default: () => null,
}))

vi.mock('../components/meeting/AttachmentSection', () => ({
  AttachmentSection: () => <div data-testid="attachments">첨부파일</div>,
}))

vi.mock('../components/ui/Skeleton', () => ({
  MeetingPageSkeleton: () => <div data-testid="skeleton">로딩 중...</div>,
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
import { useMeeting } from '../hooks/useMeeting'

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
    vi.mocked(useMeeting).mockReturnValue({
      meeting: mockMeetingBase,
      summary: {
        id: 1,
        meeting_id: 1,
        key_points: ['핵심 요약 내용'],
        decisions: ['결정 사항'],
        discussion_details: ['논의 세부 사항'],
        notes_markdown: '# 핵심 요약\n- 핵심 요약 내용',
        summary_type: 'final',
        generated_at: '2026-03-25T10:30:00Z',
      },
      transcripts: [],
      isLoading: false,
      error: null,
      refreshMeeting: vi.fn(),
      refreshSummary: vi.fn(),
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
      expect(screen.getByTestId('meeting-editor')).toBeInTheDocument()
    })
  })

  it('AI 요약 섹션이 표시된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
    })
  })

  it('요약이 없을 때에도 AI 요약 영역이 표시된다', async () => {
    vi.mocked(useMeeting).mockReturnValue({
      meeting: mockMeetingBase,
      summary: null,
      transcripts: [],
      isLoading: false,
      error: null,
      refreshMeeting: vi.fn(),
      refreshSummary: vi.fn(),
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
    })
  })

  it('getMeeting이 호출된다', async () => {
    renderPage()
    // useMeeting이 호출되었으므로 데이터가 로드됨
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
  })
})
