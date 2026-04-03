import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SearchPage from './SearchPage'

const { mockSearchMeetings } = vi.hoisted(() => ({
  mockSearchMeetings: vi.fn(),
}))

vi.mock('../api/search', () => ({
  searchMeetings: mockSearchMeetings,
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderPage(initialEntries = ['/search']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <SearchPage />
    </MemoryRouter>,
  )
}

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('검색 입력란이 렌더링된다', () => {
    renderPage()
    expect(screen.getByPlaceholderText(/검색/)).toBeInTheDocument()
  })

  it('초기 상태에서 안내 문구를 표시한다', () => {
    renderPage()
    expect(screen.getByText('검색어를 입력하세요.')).toBeInTheDocument()
  })

  it('검색 버튼 클릭 시 API를 호출한다', async () => {
    mockSearchMeetings.mockResolvedValue({
      results: [],
      total: 0,
      page: 1,
      per_page: 20,
    })

    renderPage()
    const user = userEvent.setup()
    const input = screen.getByPlaceholderText(/검색/)
    await user.type(input, '프로젝트')
    await user.click(screen.getByRole('button', { name: '검색' }))

    await waitFor(() => {
      expect(mockSearchMeetings).toHaveBeenCalledWith(
        expect.objectContaining({ q: '프로젝트' }),
      )
    })
  })

  it('검색 결과를 표시한다', async () => {
    mockSearchMeetings.mockResolvedValue({
      results: [
        {
          meeting_id: 1,
          meeting_title: '주간 회의',
          type: 'transcript',
          snippet: '<mark>프로젝트</mark> 진행 상황',
          speaker: 'SPEAKER_00',
          created_at: '2024-01-15T10:00:00Z',
        },
        {
          meeting_id: 2,
          meeting_title: '월간 리뷰',
          type: 'summary',
          snippet: '<mark>프로젝트</mark> 요약',
          speaker: null,
          created_at: '2024-01-16T10:00:00Z',
        },
      ],
      total: 2,
      page: 1,
      per_page: 20,
    })

    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/검색/), '프로젝트')
    await user.click(screen.getByRole('button', { name: '검색' }))

    await waitFor(() => {
      expect(screen.getByText('주간 회의')).toBeInTheDocument()
      expect(screen.getByText('월간 리뷰')).toBeInTheDocument()
      expect(screen.getByText('전사')).toBeInTheDocument()
      // '요약' 배지가 존재하는지 확인 (snippet에도 '요약'이 포함되므로 getAllByText 사용)
      expect(screen.getAllByText(/요약/).length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('총 2건의 결과')).toBeInTheDocument()
    })
  })

  it('결과 클릭 시 회의 페이지로 이동한다', async () => {
    mockSearchMeetings.mockResolvedValue({
      results: [
        {
          meeting_id: 42,
          meeting_title: '회의',
          type: 'transcript',
          snippet: '내용',
          speaker: null,
          created_at: '2024-01-15T10:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      per_page: 20,
    })

    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/검색/), '테스트')
    await user.click(screen.getByRole('button', { name: '검색' }))

    await waitFor(() => {
      expect(screen.getByText('회의')).toBeInTheDocument()
    })

    await user.click(screen.getByText('회의'))
    expect(mockNavigate).toHaveBeenCalledWith('/meetings/42')
  })

  it('검색 결과가 없으면 안내 문구를 표시한다', async () => {
    mockSearchMeetings.mockResolvedValue({
      results: [],
      total: 0,
      page: 1,
      per_page: 20,
    })

    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/검색/), '없는키워드')
    await user.click(screen.getByRole('button', { name: '검색' }))

    await waitFor(() => {
      expect(screen.getByText('검색 결과가 없습니다.')).toBeInTheDocument()
    })
  })
})
