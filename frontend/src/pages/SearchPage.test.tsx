import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

/** 검색 실행 헬퍼 */
async function performSearch(queryText: string) {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/검색/), queryText)
  await user.click(screen.getByRole('button', { name: '검색' }))
  return user
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
    await performSearch('프로젝트')

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
    await performSearch('프로젝트')

    await waitFor(() => {
      expect(screen.getByText('주간 회의')).toBeInTheDocument()
      expect(screen.getByText('월간 리뷰')).toBeInTheDocument()
      // 각 그룹 내부에 TypeBadge 존재
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
          meeting_title: '테스트 회의',
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
    const user = await performSearch('테스트')

    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })

    // 그룹 헤더의 회의 제목 클릭
    await user.click(screen.getByText('테스트 회의'))
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
    await performSearch('없는키워드')

    await waitFor(() => {
      expect(screen.getByText('검색 결과가 없습니다.')).toBeInTheDocument()
    })
  })

  // ===== TSK-05-01: 그룹핑 관련 테스트 =====

  it('동일 회의 결과가 그룹으로 묶여 표시된다', async () => {
    mockSearchMeetings.mockResolvedValue({
      results: [
        {
          meeting_id: 10,
          meeting_title: '기획 회의',
          type: 'transcript',
          snippet: '<mark>검색어</mark> 첫 번째',
          speaker: 'SPEAKER_00',
          created_at: '2024-03-01T10:00:00Z',
        },
        {
          meeting_id: 10,
          meeting_title: '기획 회의',
          type: 'summary',
          snippet: '<mark>검색어</mark> 두 번째',
          speaker: null,
          created_at: '2024-03-01T10:00:00Z',
        },
      ],
      total: 2,
      page: 1,
      per_page: 20,
    })

    renderPage()
    await performSearch('검색어')

    await waitFor(() => {
      // 회의 제목은 그룹 헤더에 1번만 나타나야 함
      const titleElements = screen.getAllByText('기획 회의')
      expect(titleElements).toHaveLength(1)
      // 하위 snippet 카드는 2개 표시
      expect(screen.getByText('전사')).toBeInTheDocument()
    })
  })

  it('그룹 헤더에 매칭 건수를 표시한다', async () => {
    mockSearchMeetings.mockResolvedValue({
      results: [
        {
          meeting_id: 10,
          meeting_title: '기획 회의',
          type: 'transcript',
          snippet: '<mark>검색</mark> 내용1',
          speaker: 'SPEAKER_00',
          created_at: '2024-03-01T10:00:00Z',
        },
        {
          meeting_id: 10,
          meeting_title: '기획 회의',
          type: 'transcript',
          snippet: '<mark>검색</mark> 내용2',
          speaker: 'SPEAKER_01',
          created_at: '2024-03-01T10:00:00Z',
        },
        {
          meeting_id: 10,
          meeting_title: '기획 회의',
          type: 'summary',
          snippet: '<mark>검색</mark> 요약 내용',
          speaker: null,
          created_at: '2024-03-01T10:00:00Z',
        },
      ],
      total: 3,
      page: 1,
      per_page: 20,
    })

    renderPage()
    await performSearch('검색')

    await waitFor(() => {
      expect(screen.getByText('전사 2건')).toBeInTheDocument()
      expect(screen.getByText('요약 1건')).toBeInTheDocument()
    })
  })

  it('접기/펼치기 토글이 동작한다', async () => {
    mockSearchMeetings.mockResolvedValue({
      results: [
        {
          meeting_id: 10,
          meeting_title: '기획 회의',
          type: 'transcript',
          snippet: '<mark>검색</mark> snippet 내용',
          speaker: 'SPEAKER_00',
          created_at: '2024-03-01T10:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      per_page: 20,
    })

    renderPage()
    const user = await performSearch('검색')

    // 기본 펼침 상태: snippet 보임
    await waitFor(() => {
      expect(screen.getByText('SPEAKER_00')).toBeInTheDocument()
    })

    // 토글 버튼 클릭하여 접기
    const toggleBtn = screen.getByRole('button', { name: '접기' })
    await user.click(toggleBtn)

    // snippet이 숨겨짐
    expect(screen.queryByText('SPEAKER_00')).not.toBeInTheDocument()

    // 다시 펼치기
    const expandBtn = screen.getByRole('button', { name: '펼치기' })
    await user.click(expandBtn)

    expect(screen.getByText('SPEAKER_00')).toBeInTheDocument()
  })

  it('회의 헤더 클릭 시 해당 회의 페이지로 이동한다', async () => {
    mockSearchMeetings.mockResolvedValue({
      results: [
        {
          meeting_id: 77,
          meeting_title: '디자인 리뷰',
          type: 'transcript',
          snippet: '<mark>검색어</mark> 내용',
          speaker: null,
          created_at: '2024-03-01T10:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      per_page: 20,
    })

    renderPage()
    const user = await performSearch('검색어')

    await waitFor(() => {
      expect(screen.getByText('디자인 리뷰')).toBeInTheDocument()
    })

    await user.click(screen.getByText('디자인 리뷰'))
    expect(mockNavigate).toHaveBeenCalledWith('/meetings/77')
  })

  it('서로 다른 회의 결과는 별도 그룹으로 표시된다', async () => {
    mockSearchMeetings.mockResolvedValue({
      results: [
        {
          meeting_id: 1,
          meeting_title: '회의 A',
          type: 'transcript',
          snippet: '<mark>검색</mark> A-1',
          speaker: null,
          created_at: '2024-03-01T10:00:00Z',
        },
        {
          meeting_id: 2,
          meeting_title: '회의 B',
          type: 'summary',
          snippet: '<mark>검색</mark> B-1',
          speaker: null,
          created_at: '2024-03-02T10:00:00Z',
        },
        {
          meeting_id: 1,
          meeting_title: '회의 A',
          type: 'summary',
          snippet: '<mark>검색</mark> A-2',
          speaker: null,
          created_at: '2024-03-01T10:00:00Z',
        },
      ],
      total: 3,
      page: 1,
      per_page: 20,
    })

    renderPage()
    await performSearch('검색')

    await waitFor(() => {
      // 회의 A 그룹 헤더에 표시
      const groupAHeaders = screen.getAllByText('회의 A')
      expect(groupAHeaders).toHaveLength(1)

      // 회의 B 그룹 헤더에 표시
      const groupBHeaders = screen.getAllByText('회의 B')
      expect(groupBHeaders).toHaveLength(1)

      // 총 2개 그룹
      const groups = screen.getAllByTestId('meeting-group')
      expect(groups).toHaveLength(2)

      // 회의 A 그룹 내에 2건 (전사 1건, 요약 1건)
      const groupA = groups[0]
      expect(within(groupA).getByText('전사 1건')).toBeInTheDocument()
      expect(within(groupA).getByText('요약 1건')).toBeInTheDocument()

      // 회의 B 그룹 내에 1건 (요약 1건)
      const groupB = groups[1]
      expect(within(groupB).getByText('요약 1건')).toBeInTheDocument()
    })
  })
})
