import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MeetingsPage from './MeetingsPage'
import { useMeetingStore } from '../stores/meetingStore'
import { useFolderStore } from '../stores/folderStore'

const { mockGetMeetings, mockCreateMeeting } = vi.hoisted(() => ({
  mockGetMeetings: vi.fn(),
  mockCreateMeeting: vi.fn(),
}))

vi.mock('../api/meetings', () => ({
  getMeetings: mockGetMeetings,
  createMeeting: mockCreateMeeting,
  deleteMeeting: vi.fn(),
  stopMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  uploadAudioFile: vi.fn(),
}))

vi.mock('../api/folders', () => ({
  getFolders: vi.fn().mockResolvedValue([]),
}))

vi.mock('../components/folder/FolderBreadcrumb', () => ({
  default: () => <div data-testid="folder-breadcrumb" />,
}))

vi.mock('../components/folder/MoveMeetingDialog', () => ({
  default: () => null,
}))

vi.mock('../components/meeting/EditMeetingDialog', () => ({
  default: () => null,
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const meetings = [
  {
    id: 1,
    title: '첫 번째 회의',
    status: 'pending' as const,
    meeting_type: 'general',
    created_by: { id: 1, name: '사용자1' },
    brief_summary: null,
    audio_duration_ms: 0,
    last_transcript_end_ms: 0,
    last_sequence_number: 0,
    folder_id: null,
    memo: null,
    started_at: null,
    ended_at: null,
    created_at: '2024-01-15T10:00:00Z',
  },
  {
    id: 2,
    title: '두 번째 회의',
    status: 'recording' as const,
    meeting_type: 'general',
    created_by: { id: 1, name: '사용자1' },
    brief_summary: null,
    audio_duration_ms: 0,
    last_transcript_end_ms: 0,
    last_sequence_number: 0,
    folder_id: null,
    memo: null,
    started_at: '2024-01-15T11:00:00Z',
    ended_at: null,
    created_at: '2024-01-15T11:00:00Z',
  },
  {
    id: 3,
    title: '세 번째 회의',
    status: 'completed' as const,
    meeting_type: 'general',
    created_by: { id: 1, name: '사용자1' },
    brief_summary: null,
    audio_duration_ms: 0,
    last_transcript_end_ms: 0,
    last_sequence_number: 0,
    folder_id: null,
    memo: null,
    started_at: '2024-01-15T09:00:00Z',
    ended_at: '2024-01-15T10:00:00Z',
    created_at: '2024-01-15T09:00:00Z',
  },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <MeetingsPage />
    </MemoryRouter>
  )
}

describe('MeetingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    useMeetingStore.getState().reset()
    useFolderStore.setState({ folders: [], selectedFolderId: 'all' })
    mockGetMeetings.mockResolvedValue({
      meetings,
      meta: { total: 3, page: 1, per: 20 },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('회의 목록 페이지가 렌더링됨', async () => {
    renderPage()
    // 디바운스 300ms를 진행시킴
    await act(async () => { vi.advanceTimersByTime(400) })
    await waitFor(() => {
      // 페이지 제목 (폴더 'all' → '전체 회의')
      expect(screen.getByRole('heading', { name: /전체 회의/i })).toBeInTheDocument()
    })
  })

  it('회의 목록이 표시됨', async () => {
    renderPage()
    await act(async () => { vi.advanceTimersByTime(400) })
    await waitFor(() => {
      expect(screen.getByText('첫 번째 회의')).toBeInTheDocument()
      expect(screen.getByText('두 번째 회의')).toBeInTheDocument()
      expect(screen.getByText('세 번째 회의')).toBeInTheDocument()
    })
  })

  it('회의 상태 배지가 올바르게 표시됨', async () => {
    renderPage()
    await act(async () => { vi.advanceTimersByTime(400) })
    await waitFor(() => {
      // 상태 필터 탭 + 회의 카드의 상태 배지로 '대기중', '녹음중', '완료'가 표시됨
      expect(screen.getAllByText('대기중').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('녹음중').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('완료').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('검색 입력창이 존재함', async () => {
    renderPage()
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(screen.getByPlaceholderText(/제목 검색/i)).toBeInTheDocument()
  })

  it('새 회의 버튼이 존재함', async () => {
    renderPage()
    expect(screen.getByRole('button', { name: /새 회의/i })).toBeInTheDocument()
  })

  it('새 회의 버튼 클릭 시 모달이 열림', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /새 회의/i }))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('회의 없을 때 빈 상태 메시지 표시', async () => {
    mockGetMeetings.mockResolvedValue({
      meetings: [],
      meta: { total: 0, page: 1, per: 20 },
    })

    renderPage()
    await act(async () => { vi.advanceTimersByTime(400) })
    await waitFor(() => {
      expect(screen.getByText(/회의가 없습니다/i)).toBeInTheDocument()
    })
  })

  it('회의 생성 모달에서 회의 생성 성공', async () => {
    const newMeeting = {
      id: 4,
      title: '새 회의',
      status: 'pending' as const,
      meeting_type: 'general',
      created_by: { id: 1, name: '사용자1' },
      brief_summary: null,
      audio_duration_ms: 0,
      last_transcript_end_ms: 0,
      last_sequence_number: 0,
      folder_id: null,
      memo: null,
      started_at: null,
      ended_at: null,
      created_at: '2024-01-15T12:00:00Z',
    }
    mockCreateMeeting.mockResolvedValue(newMeeting)

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /새 회의/i }))
    await waitFor(() => screen.getByRole('dialog'))

    await userEvent.type(screen.getByPlaceholderText(/회의 제목/i), '새 회의')
    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => {
      expect(mockCreateMeeting).toHaveBeenCalled()
    })
  })

  it('모달 취소 버튼 클릭 시 모달이 닫힘', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /새 회의/i }))
    await waitFor(() => screen.getByRole('dialog'))

    await userEvent.click(screen.getByRole('button', { name: /취소/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

// Required import for act
import { act } from '@testing-library/react'
