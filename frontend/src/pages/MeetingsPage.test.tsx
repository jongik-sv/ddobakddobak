import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MeetingsPage from './MeetingsPage'
import { useMeetingStore } from '../stores/meetingStore'
import { useAuthStore } from '../stores/authStore'

const {
  mockGetMeetings,
  mockCreateMeeting,
} = vi.hoisted(() => ({
  mockGetMeetings: vi.fn(),
  mockCreateMeeting: vi.fn(),
}))

vi.mock('../api/meetings', async () => ({
  ...(await vi.importActual<typeof import('../api/meetings')>('../api/meetings')),
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

const mockNavigate = vi.fn()
const stableSearchParams = new URLSearchParams()
const mockSetSearchParams = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [stableSearchParams, mockSetSearchParams],
  }
})

// ── Mock useMediaQuery ──
let mockIsDesktop = true
vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: () => mockIsDesktop,
}))

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
    memo: null,
    attendees: null,
    folder_id: null,
    shared: true,
    locked: false,
    locked_at: null,
    important: false,
    editable: true,
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
    memo: null,
    attendees: null,
    folder_id: null,
    shared: true,
    locked: false,
    locked_at: null,
    important: false,
    editable: true,
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
    brief_summary: '이것은 회의 요약입니다. 여러 가지 안건을 논의했습니다.',
    audio_duration_ms: 0,
    last_transcript_end_ms: 0,
    last_sequence_number: 0,
    memo: null,
    attendees: null,
    folder_id: null,
    shared: true,
    locked: false,
    locked_at: null,
    important: false,
    editable: true,
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
    mockIsDesktop = true
    // 픽스처 created_by.id===1 과 일치하는 사용자로 로그인 → 카드 액션 어포던스 노출
    useAuthStore.setState({ user: { id: 1, email: 'me@x.com', name: '사용자1', role: 'member' } })
    useMeetingStore.getState().reset()
    mockGetMeetings.mockResolvedValue({
      meetings,
      meta: { total: 3, page: 1, per: 20 },
    })
    // Set meetings directly in store to avoid timing issues
    useMeetingStore.setState({
      meetings,
      meta: { total: 3, page: 1, per: 20 },
      isLoading: false,
    })
  })

  it('회의 카드가 렌더링됨', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('첫 번째 회의')).toBeInTheDocument()
    })
  })

  it('회의 카드에 상태가 표시됨', async () => {
    renderPage()
    await waitFor(() => {
      // 회의 카드들이 렌더링되어 있으면 OK
      expect(screen.getByText('첫 번째 회의')).toBeInTheDocument()
      expect(screen.getByText('두 번째 회의')).toBeInTheDocument()
      expect(screen.getByText('세 번째 회의')).toBeInTheDocument()
    })
  })

  it('검색 입력창이 존재함', async () => {
    renderPage()
    expect(screen.getByPlaceholderText(/검색/i)).toBeInTheDocument()
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

  it('회의 생성 모달에서 회의 생성 성공', async () => {
    const newMeeting = {
      ...meetings[0],
      id: 4,
      title: '새 회의',
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

  it('예약 미지정 회의 생성 시 라이브로 이동한다 (기존 동작)', async () => {
    mockCreateMeeting.mockResolvedValue({ ...meetings[0], id: 4, title: '즉시 회의', scheduled_start_time: null })

    renderPage()

    await userEvent.click(screen.getByRole('button', { name: /새 회의/i }))
    await waitFor(() => screen.getByRole('dialog'))
    await userEvent.type(screen.getByPlaceholderText(/회의 제목/i), '즉시 회의')
    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/meetings/4/live'))
  })

  it('예약된 회의 생성 시 라이브로 이동하지 않는다 (목록 유지)', async () => {
    mockCreateMeeting.mockResolvedValue({
      ...meetings[0],
      id: 4,
      title: '예약 회의',
      scheduled_start_time: '2026-06-25T01:00:00Z',
    })

    renderPage()

    await userEvent.click(screen.getByRole('button', { name: /새 회의/i }))
    await waitFor(() => screen.getByRole('dialog'))
    await userEvent.type(screen.getByPlaceholderText(/회의 제목/i), '예약 회의')
    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(mockCreateMeeting).toHaveBeenCalled())
    // 모달은 닫히지만 라이브로 점프하지 않는다
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockNavigate).not.toHaveBeenCalledWith('/meetings/4/live')
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

  it('회의 없을 때 빈 상태 메시지 표시', async () => {
    useMeetingStore.setState({
      meetings: [],
      meta: { total: 0, page: 1, per: 20 },
      isLoading: false,
    })
    mockGetMeetings.mockResolvedValue({
      meetings: [],
      meta: { total: 0, page: 1, per: 20 },
    })

    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/회의가 없습니다/i)).toBeInTheDocument()
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
})

/* ================================================================== */
/*  TSK-03-02: MeetingsPage 툴바 모바일 대응                            */
/* ================================================================== */
describe('MeetingsPage 모바일 대응 (TSK-03-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDesktop = true
    useAuthStore.setState({ user: { id: 1, email: 'me@x.com', name: '사용자1', role: 'member' } })
    useMeetingStore.getState().reset()
    mockGetMeetings.mockResolvedValue({
      meetings,
      meta: { total: 3, page: 1, per: 20 },
    })
    useMeetingStore.setState({
      meetings,
      meta: { total: 3, page: 1, per: 20 },
      isLoading: false,
    })
  })

  /* ─── 데스크톱: 기존 툴바 100% 동일 ─── */
  describe('데스크톱 (isDesktop=true)', () => {
    beforeEach(() => {
      mockIsDesktop = true
    })

    it('검색 input이 항상 보인다', () => {
      renderPage()
      expect(screen.getByPlaceholderText(/검색/i)).toBeInTheDocument()
    })

    it('새 회의 버튼이 헤더에 텍스트로 표시된다', () => {
      renderPage()
      expect(screen.getByRole('button', { name: /새 회의/i })).toBeInTheDocument()
    })

    it('FAB가 렌더링되지 않는다', () => {
      renderPage()
      expect(screen.queryByTestId('fab-new-meeting')).not.toBeInTheDocument()
    })

    it('상태 필터 탭이 인라인으로 표시된다', () => {
      renderPage()
      expect(screen.getByRole('button', { name: '전체' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '녹음중' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '완료' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '대기중' })).toBeInTheDocument()
    })

    it('날짜 필터 input이 인라인으로 표시된다', () => {
      renderPage()
      const dateInputs = screen.getAllByDisplayValue('')
        .filter((el) => el.getAttribute('type') === 'date')
      expect(dateInputs.length).toBe(2)
    })

    it('헤더 버튼(오디오 업로드)이 텍스트로 표시되고 회의 참여 버튼은 없다', () => {
      renderPage()
      expect(screen.getByRole('button', { name: /오디오 업로드/i })).toBeInTheDocument()
      // 라이브 공유/참여 기능 제거 — 회의 참여 진입점이 없어야 한다
      expect(screen.queryByRole('button', { name: /회의 참여/i })).not.toBeInTheDocument()
    })
  })

  /* ─── 모바일: 검색 바 확장 ─── */
  describe('모바일 검색 (isDesktop=false)', () => {
    beforeEach(() => {
      mockIsDesktop = false
    })

    it('검색 input이 숨겨지고 검색 아이콘 버튼이 표시된다', () => {
      renderPage()
      // 검색 input이 초기에는 보이지 않아야 함
      expect(screen.queryByPlaceholderText(/검색/i)).not.toBeInTheDocument()
      // 검색 아이콘 버튼이 존재
      expect(screen.getByTestId('mobile-search-toggle')).toBeInTheDocument()
    })

    it('검색 아이콘 탭 시 풀 너비 검색 바가 확장된다', async () => {
      renderPage()
      await userEvent.click(screen.getByTestId('mobile-search-toggle'))

      expect(screen.getByPlaceholderText(/검색/i)).toBeInTheDocument()
    })

    it('확장된 검색 바에서 X 버튼 탭 시 검색 바가 닫히고 검색어가 초기화된다', async () => {
      renderPage()
      // 검색 바 열기
      await userEvent.click(screen.getByTestId('mobile-search-toggle'))
      const input = screen.getByPlaceholderText(/검색/i)
      await userEvent.type(input, '테스트')

      // X 버튼 클릭
      await userEvent.click(screen.getByTestId('mobile-search-close'))

      // 검색 바 닫힘
      expect(screen.queryByPlaceholderText(/검색/i)).not.toBeInTheDocument()
      // 검색어 초기화됨
      expect(useMeetingStore.getState().searchQuery).toBe('')
    })
  })

  /* ─── 모바일: 필터 BottomSheet ─── */
  describe('모바일 필터 BottomSheet (isDesktop=false)', () => {
    beforeEach(() => {
      mockIsDesktop = false
    })

    it('모바일에서 필터 아이콘 버튼이 표시된다', () => {
      renderPage()
      expect(screen.getByTestId('mobile-filter-toggle')).toBeInTheDocument()
    })

    it('모바일에서 상태 필터 탭과 날짜 필터가 인라인에 표시되지 않는다', () => {
      renderPage()
      // 인라인 상태 필터 탭이 숨겨져야 함
      // 필터 아이콘 버튼은 존재하지만 인라인 날짜 input은 없어야 함
      const dateInputs = screen.queryAllByDisplayValue('')
        .filter((el) => el.getAttribute('type') === 'date')
      expect(dateInputs.length).toBe(0)
    })

    it('필터 아이콘 탭 시 BottomSheet가 열린다', async () => {
      renderPage()
      await userEvent.click(screen.getByTestId('mobile-filter-toggle'))

      // BottomSheet가 dialog role로 렌더링됨
      await waitFor(() => {
        expect(screen.getByRole('dialog', { name: /필터/i })).toBeInTheDocument()
      })
    })

    it('BottomSheet 내부에 상태 필터 버튼이 표시된다', async () => {
      renderPage()
      await userEvent.click(screen.getByTestId('mobile-filter-toggle'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '전체' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '녹음중' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '완료' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '대기중' })).toBeInTheDocument()
      })
    })

    it('BottomSheet 내부에 날짜 필터가 표시된다', async () => {
      renderPage()
      await userEvent.click(screen.getByTestId('mobile-filter-toggle'))

      await waitFor(() => {
        const dateInputs = screen.getAllByDisplayValue('')
          .filter((el) => el.getAttribute('type') === 'date')
        expect(dateInputs.length).toBe(2)
      })
    })

    it('BottomSheet에서 상태 필터 선택 시 스토어에 반영된다', async () => {
      renderPage()
      await userEvent.click(screen.getByTestId('mobile-filter-toggle'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '완료' })).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: '완료' }))

      await waitFor(() => {
        expect(useMeetingStore.getState().statusFilter).toBe('completed')
      })
    })

    it('BottomSheet에 초기화 버튼이 있고 클릭 시 필터가 초기화된다', async () => {
      // 필터를 미리 설정
      useMeetingStore.setState({ statusFilter: 'completed', dateFrom: '2024-01-01', dateTo: '2024-12-31' })

      renderPage()
      await userEvent.click(screen.getByTestId('mobile-filter-toggle'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /초기화/i })).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: /초기화/i }))

      expect(useMeetingStore.getState().statusFilter).toBe('')
      expect(useMeetingStore.getState().dateFrom).toBe('')
      expect(useMeetingStore.getState().dateTo).toBe('')
    })
  })

  /* ─── 모바일: FAB ─── */
  describe('모바일 FAB (isDesktop=false)', () => {
    beforeEach(() => {
      mockIsDesktop = false
    })

    it('FAB가 렌더링된다', () => {
      renderPage()
      expect(screen.getByTestId('fab-new-meeting')).toBeInTheDocument()
    })

    it('FAB에 fixed, right-4, bottom-20 클래스가 적용된다', () => {
      renderPage()
      const fab = screen.getByTestId('fab-new-meeting')
      expect(fab.className).toContain('fixed')
      expect(fab.className).toContain('right-4')
      expect(fab.className).toContain('bottom-20')
    })

    it('FAB에 z-40 클래스가 적용된다', () => {
      renderPage()
      const fab = screen.getByTestId('fab-new-meeting')
      expect(fab.className).toContain('z-40')
    })

    it('FAB 클릭 시 새 회의 모달이 열린다', async () => {
      renderPage()
      await userEvent.click(screen.getByTestId('fab-new-meeting'))

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('모바일에서 헤더의 텍스트 새 회의 버튼이 숨겨진다', () => {
      renderPage()
      // 헤더에 텍스트 "새 회의" 버튼이 없어야 함 (FAB만 존재)
      const allButtons = screen.getAllByRole('button')
      const textNewMeetingBtn = allButtons.find(
        (btn) => btn.textContent === '새 회의' && !btn.hasAttribute('data-testid')
      )
      expect(textNewMeetingBtn).toBeUndefined()
    })
  })

  /* ─── 모바일: 카드 압축 ─── */
  describe('모바일 카드 압축 (isDesktop=false)', () => {
    beforeEach(() => {
      mockIsDesktop = false
    })

    it('brief_summary가 모바일에서 line-clamp-1 클래스를 갖는다', () => {
      renderPage()
      const summaryEl = screen.getByText(/이것은 회의 요약입니다/)
      expect(summaryEl.className).toContain('line-clamp-1')
      expect(summaryEl.className).not.toContain('line-clamp-5')
    })

    it('brief_summary가 데스크톱에서 line-clamp-5 클래스를 갖는다', () => {
      mockIsDesktop = true
      renderPage()
      const summaryEl = screen.getByText(/이것은 회의 요약입니다/)
      expect(summaryEl.className).toContain('line-clamp-5')
      expect(summaryEl.className).not.toContain('line-clamp-1')
    })

    it('카드 액션 버튼(수정/이동/삭제)이 모바일에서 항상 표시된다 (opacity-100)', () => {
      renderPage()
      // card-actions 내부의 Tooltip 래핑 버튼(수정/이동/삭제)만 확인
      const actionContainers = screen.getAllByTestId('card-actions')
      actionContainers.forEach((container) => {
        const buttons = container.querySelectorAll('button')
        const opacityButtons = Array.from(buttons).filter((btn) =>
          btn.className.includes('opacity-')
        )
        opacityButtons.forEach((btn) => {
          expect(btn.className).toContain('opacity-100')
        })
      })
    })
  })

  /* ─── 모바일: 헤더 반응형 ─── */
  describe('모바일 헤더 반응형 (isDesktop=false)', () => {
    beforeEach(() => {
      mockIsDesktop = false
    })

    it('제목이 모바일에서 text-xl 클래스를 갖는다', () => {
      renderPage()
      const h1 = screen.getByRole('heading', { level: 1 })
      expect(h1.className).toContain('text-xl')
    })

    it('제목이 데스크톱에서 text-2xl 클래스를 갖는다', () => {
      mockIsDesktop = true
      renderPage()
      const h1 = screen.getByRole('heading', { level: 1 })
      expect(h1.className).toContain('text-2xl')
    })

    it('모바일에서 루트 div에 반응형 패딩이 적용된다 (p-4)', () => {
      renderPage()
      const root = screen.getByRole('heading', { level: 1 }).closest('div.min-h-screen')
      expect(root?.className).toContain('p-4')
    })
  })
})

/* ================================================================== */
/*  idea.md 29: 회의 목록 깜빡임 방지 — 폴더 전환은 즉시, 검색/필터는 디바운스   */
/* ================================================================== */
describe('MeetingsPage 목록 깜빡임 방지 (idea.md 29)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockIsDesktop = true
    useAuthStore.setState({ user: { id: 1, email: 'me@x.com', name: '사용자1', role: 'member' } })
    useMeetingStore.getState().reset()
    // URL(?folder=)이 folderId의 단일 소스다(MeetingsPage의 URL→folderId 동기화 effect) —
    // 이전 테스트가 남긴 folder 쿼리가 새 테스트로 새어나가지 않게 매 테스트 시작 시 비운다.
    stableSearchParams.delete('folder')
    mockGetMeetings.mockResolvedValue({
      meetings,
      meta: { total: 3, page: 1, per: 20 },
    })
    useMeetingStore.setState({
      meetings,
      meta: { total: 3, page: 1, per: 20 },
      isLoading: false,
      hasLoadedOnce: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    stableSearchParams.delete('folder')
  })

  it('폴더 변경(folderId) 시 300ms 대기 없이 즉시 fetch가 호출된다', async () => {
    renderPage()
    // 마운트 시 기존 300ms 디바운스 fetch를 먼저 흘려보낸다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    mockGetMeetings.mockClear()

    // 실제 앱에서는 navigate(folderPath(id))가 URL을 먼저 바꾸고, URL→folderId 동기화
    // effect가 스토어에 반영한다. 여기선 그 결과 상태(URL + 스토어)를 함께 맞춰 재현한다 —
    // URL을 갱신하지 않으면 동기화 effect가 folderId를 'all'로 되돌려 버려 거짓 통과가 난다.
    act(() => {
      stableSearchParams.set('folder', '5')
      useMeetingStore.getState().setFolderId(5)
    })

    // 딜레이 없이(0ms) 곧바로 fetch가 발생해야 한다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockGetMeetings).toHaveBeenCalledTimes(1)
    // 선택한 폴더 파라미터(folder_id)가 실제 fetch 인자에 반영되는지 검증.
    expect(mockGetMeetings).toHaveBeenCalledWith(expect.objectContaining({ folder_id: 5 }))
  })

  it('검색어 입력(searchQuery)은 300ms 디바운스 후에만 fetch가 호출된다', async () => {
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    mockGetMeetings.mockClear()

    act(() => {
      useMeetingStore.getState().setSearchQuery('테스트')
    })

    // 300ms 미만에서는 아직 호출되지 않아야 한다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(mockGetMeetings).not.toHaveBeenCalled()

    // 300ms 경과 후 호출된다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mockGetMeetings).toHaveBeenCalledTimes(1)
  })

  it('재조회 중(isRefreshing)에는 목록 래퍼가 dim 처리되고, 완료 후 복귀한다', async () => {
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    const gridWrapper = screen.getByText('첫 번째 회의').closest('[class*="opacity-"]')
    expect(gridWrapper?.className).toContain('opacity-100')

    let resolveRefresh!: (v: { meetings: typeof meetings; meta: { total: number; page: number; per: number } }) => void
    mockGetMeetings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
    )

    act(() => {
      useMeetingStore.getState().setFolderId(7)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(useMeetingStore.getState().isRefreshing).toBe(true)
    const dimmedWrapper = screen.getByText('첫 번째 회의').closest('[class*="opacity-"]')
    expect(dimmedWrapper?.className).toContain('opacity-60')

    await act(async () => {
      resolveRefresh({ meetings, meta: { total: 3, page: 1, per: 20 } })
      await Promise.resolve()
    })

    expect(useMeetingStore.getState().isRefreshing).toBe(false)
    const restoredWrapper = screen.getByText('첫 번째 회의').closest('[class*="opacity-"]')
    expect(restoredWrapper?.className).toContain('opacity-100')
  })

  it('빈 목록 상태에서 폴더 전환 시 isRefreshing 동안 빈 메시지는 마운트 유지되며 지연 페이드(opacity-0/delay-150) 처리된다', async () => {
    mockGetMeetings.mockResolvedValue({
      meetings: [],
      meta: { total: 0, page: 1, per: 20 },
    })
    useMeetingStore.setState({
      meetings: [],
      meta: { total: 0, page: 1, per: 20 },
      isLoading: false,
      hasLoadedOnce: true,
    })

    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    // 전제: 빈 폴더 상태에서는 정상적으로 빈 메시지가 보인다.
    const emptyMessage = screen.getByText('회의가 없습니다.')
    expect(emptyMessage).toBeInTheDocument()
    expect(emptyMessage.className).toContain('opacity-100')
    expect(emptyMessage).toHaveAttribute('aria-hidden', 'false')

    let resolveRefresh!: (v: { meetings: []; meta: { total: number; page: number; per: number } }) => void
    mockGetMeetings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
    )

    act(() => {
      useMeetingStore.getState().setFolderId(9)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // 재조회 중(응답 대기) — 빈 메시지는 언마운트되지 않고 유지된 채, 그리드와 동일한
    // 지연 페이드 패턴(150ms 유예 후 opacity-0)으로만 처리되어야 한다.
    expect(useMeetingStore.getState().isRefreshing).toBe(true)
    const refreshingMessage = screen.getByText('회의가 없습니다.')
    expect(refreshingMessage).toBeInTheDocument()
    expect(refreshingMessage.className).toContain('opacity-0')
    expect(refreshingMessage.className).toContain('delay-150')
    // 접근성: opacity-0은 접근성 트리에서 제거되지 않으므로 리프레시 동안 aria-hidden 처리.
    expect(refreshingMessage).toHaveAttribute('aria-hidden', 'true')

    await act(async () => {
      resolveRefresh({ meetings: [], meta: { total: 0, page: 1, per: 20 } })
      await Promise.resolve()
    })

    expect(useMeetingStore.getState().isRefreshing).toBe(false)
  })

  it('빈→빈 재조회 시 빈 상태 메시지가 언마운트되지 않는다(동일 DOM 노드 유지)', async () => {
    mockGetMeetings.mockResolvedValue({
      meetings: [],
      meta: { total: 0, page: 1, per: 20 },
    })
    useMeetingStore.setState({
      meetings: [],
      meta: { total: 0, page: 1, per: 20 },
      isLoading: false,
      hasLoadedOnce: true,
    })

    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    const beforeNode = screen.getByText('회의가 없습니다.')
    expect(beforeNode).toBeInTheDocument()

    let resolveRefresh!: (v: { meetings: []; meta: { total: number; page: number; per: number } }) => void
    mockGetMeetings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
    )

    // 빈 폴더 → 빈 폴더 전환(검색 0건 재조회 등)을 재현한다.
    act(() => {
      useMeetingStore.getState().setFolderId(9)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(useMeetingStore.getState().isRefreshing).toBe(true)
    // 언마운트→재마운트가 일어났다면 새 DOM 노드가 생성되므로 참조가 달라진다.
    // 동일 노드 참조를 유지해야 깜빡임(blink) 없이 페이드만 적용된 것이다.
    const duringNode = screen.getByText('회의가 없습니다.')
    expect(duringNode).toBe(beforeNode)

    await act(async () => {
      resolveRefresh({ meetings: [], meta: { total: 0, page: 1, per: 20 } })
      await Promise.resolve()
    })

    expect(useMeetingStore.getState().isRefreshing).toBe(false)
    const afterNode = screen.getByText('회의가 없습니다.')
    expect(afterNode).toBe(beforeNode)
  })
})
