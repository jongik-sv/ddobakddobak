import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MeetingsPage from './MeetingsPage'
import { useMeetingStore } from '../stores/meetingStore'

const {
  mockGetTeams,
  mockGetMeetings,
  mockCreateMeeting,
} = vi.hoisted(() => ({
  mockGetTeams: vi.fn(),
  mockGetMeetings: vi.fn(),
  mockCreateMeeting: vi.fn(),
}))

vi.mock('../api/teams', () => ({
  getTeams: mockGetTeams,
}))

vi.mock('../api/meetings', () => ({
  getMeetings: mockGetMeetings,
  createMeeting: mockCreateMeeting,
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const teams = [
  { id: 1, name: '팀A', role: 'admin' as const },
  { id: 2, name: '팀B', role: 'member' as const },
]

const meetings = [
  {
    id: 1,
    title: '첫 번째 회의',
    status: 'pending' as const,
    team: { id: 1, name: '팀A' },
    created_by: { id: 1, name: '사용자1' },
    started_at: null,
    ended_at: null,
    created_at: '2024-01-15T10:00:00Z',
  },
  {
    id: 2,
    title: '두 번째 회의',
    status: 'recording' as const,
    team: { id: 1, name: '팀A' },
    created_by: { id: 1, name: '사용자1' },
    started_at: '2024-01-15T11:00:00Z',
    ended_at: null,
    created_at: '2024-01-15T11:00:00Z',
  },
  {
    id: 3,
    title: '세 번째 회의',
    status: 'completed' as const,
    team: { id: 1, name: '팀A' },
    created_by: { id: 1, name: '사용자1' },
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
    useMeetingStore.getState().reset()
    mockGetTeams.mockResolvedValue(teams)
    mockGetMeetings.mockResolvedValue({
      meetings,
      meta: { total: 3, page: 1, per: 20 },
    })
  })

  it('회의 목록 페이지가 렌더링됨', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /회의 목록/i })).toBeInTheDocument()
    })
  })

  it('팀 목록이 드롭다운에 표시됨', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('팀A')).toBeInTheDocument()
      expect(screen.getByText('팀B')).toBeInTheDocument()
    })
  })

  it('회의 목록이 표시됨', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('첫 번째 회의')).toBeInTheDocument()
      expect(screen.getByText('두 번째 회의')).toBeInTheDocument()
      expect(screen.getByText('세 번째 회의')).toBeInTheDocument()
    })
  })

  it('회의 상태 배지가 올바르게 표시됨', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('대기중')).toBeInTheDocument()
      expect(screen.getByText('녹음중')).toBeInTheDocument()
      expect(screen.getByText('완료')).toBeInTheDocument()
    })
  })

  it('검색 입력창이 존재함', async () => {
    renderPage()
    await waitFor(() => expect(mockGetTeams).toHaveBeenCalled())
    expect(screen.getByPlaceholderText(/검색/i)).toBeInTheDocument()
  })

  it('새 회의 버튼이 존재함', async () => {
    renderPage()
    await waitFor(() => expect(mockGetTeams).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /새 회의/i })).toBeInTheDocument()
  })

  it('새 회의 버튼 클릭 시 모달이 열림', async () => {
    renderPage()
    await waitFor(() => expect(mockGetTeams).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /새 회의/i }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('회의 카드 클릭 시 상세 페이지로 이동', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('첫 번째 회의')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('첫 번째 회의'))

    expect(mockNavigate).toHaveBeenCalledWith('/meetings/1')
  })

  it('회의 없을 때 빈 상태 메시지 표시', async () => {
    mockGetMeetings.mockResolvedValue({
      meetings: [],
      meta: { total: 0, page: 1, per: 20 },
    })

    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/회의가 없습니다/i)).toBeInTheDocument()
    })
  })

  it('회의 생성 모달에서 회의 생성 성공', async () => {
    const newMeeting = {
      id: 4,
      title: '새 회의',
      status: 'pending' as const,
      team: { id: 1, name: '팀A' },
      created_by: { id: 1, name: '사용자1' },
      started_at: null,
      ended_at: null,
      created_at: '2024-01-15T12:00:00Z',
    }
    mockCreateMeeting.mockResolvedValue(newMeeting)

    renderPage()
    await waitFor(() => expect(mockGetTeams).toHaveBeenCalled())

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
    await waitFor(() => expect(mockGetTeams).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /새 회의/i }))
    await waitFor(() => screen.getByRole('dialog'))

    await userEvent.click(screen.getByRole('button', { name: /취소/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
