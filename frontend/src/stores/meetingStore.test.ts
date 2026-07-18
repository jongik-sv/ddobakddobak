import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMeetingStore } from './meetingStore'

const { mockGetMeetings } = vi.hoisted(() => ({
  mockGetMeetings: vi.fn(),
}))

vi.mock('../api/meetings', () => ({
  getMeetings: mockGetMeetings,
}))

vi.mock('./projectStore', () => ({
  useProjectStore: { getState: () => ({ currentProjectId: null }) },
}))

const mockMeeting = {
  id: 1,
  title: '회의1',
  status: 'pending' as const,
  created_by: { id: 1, name: '사용자1' },
  meeting_type: 'general',
  brief_summary: null,
  audio_duration_ms: 0,
  last_transcript_end_ms: 0,
  last_sequence_number: 0,
  started_at: null,
  ended_at: null,
  created_at: '2024-01-01T00:00:00Z',
  folder_id: null,
  memo: null,
  attendees: null,
  shared: true,
  locked: false,
  locked_at: null,
  important: false,
}

describe('meetingStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMeetingStore.getState().reset()
  })

  it('초기 상태 확인', () => {
    const state = useMeetingStore.getState()
    expect(state.meetings).toEqual([])
    expect(state.meta).toBeNull()
    expect(state.searchQuery).toBe('')
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('setSearchQuery로 검색어 설정', () => {
    useMeetingStore.getState().setSearchQuery('테스트')
    expect(useMeetingStore.getState().searchQuery).toBe('테스트')
  })

  it('fetchMeetings 성공 시 meetings와 meta 업데이트', async () => {
    mockGetMeetings.mockResolvedValue({
      meetings: [mockMeeting],
      meta: { total: 1, page: 1, per: 20 },
    })

    await useMeetingStore.getState().fetchMeetings(1)
    const state = useMeetingStore.getState()
    expect(state.meetings).toHaveLength(1)
    expect(state.meetings[0].title).toBe('회의1')
    expect(state.meta?.total).toBe(1)
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('fetchMeetings 시 searchQuery를 파라미터로 사용', async () => {
    mockGetMeetings.mockResolvedValue({
      meetings: [],
      meta: { total: 0, page: 1, per: 20 },
    })

    useMeetingStore.getState().setSearchQuery('검색어')
    await useMeetingStore.getState().fetchMeetings(1)

    expect(mockGetMeetings).toHaveBeenCalledWith({
      page: 1,
      per: 20,
      q: '검색어',
    })
  })

  it('toggleShowAll 후 fetchMeetings는 show_all=true를 전달한다 (기본은 미전달)', async () => {
    mockGetMeetings.mockResolvedValue({
      meetings: [],
      meta: { total: 0, page: 1, per: 20 },
    })

    // 기본(off): show_all 미포함
    await useMeetingStore.getState().fetchMeetings(1)
    expect(mockGetMeetings).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ show_all: expect.anything() }),
    )

    // 토글(on): show_all=true 포함
    useMeetingStore.getState().toggleShowAll()
    expect(useMeetingStore.getState().showAll).toBe(true)
    await useMeetingStore.getState().fetchMeetings(1)
    expect(mockGetMeetings).toHaveBeenLastCalledWith(
      expect.objectContaining({ show_all: true }),
    )
  })

  it('특정 폴더 선택 시 showAll off여도 show_all=true를 전달한다', async () => {
    mockGetMeetings.mockResolvedValue({ meetings: [], meta: { total: 0, page: 1, per: 20 } })
    useMeetingStore.getState().setFolderId(5)
    await useMeetingStore.getState().fetchMeetings(1)
    expect(mockGetMeetings).toHaveBeenLastCalledWith(
      expect.objectContaining({ folder_id: 5, show_all: true }),
    )
  })

  it('fetchMeetings 실패 시 error 설정', async () => {
    mockGetMeetings.mockRejectedValue(new Error('API 오류'))

    await useMeetingStore.getState().fetchMeetings(1)
    const state = useMeetingStore.getState()
    expect(state.error).toBeTruthy()
    expect(state.isLoading).toBe(false)
  })

  /* ── idea.md 29: 목록 깜빡임 방지 — 경쟁 가드 · hasLoadedOnce/isRefreshing ── */

  it('경쟁 가드: 느린 이전 요청이 늦게 도착해도 최신 응답을 덮지 않는다', async () => {
    let resolveFirst!: (v: { meetings: typeof mockMeeting[]; meta: { total: number; page: number; per: number } }) => void
    const firstPromise = new Promise<{ meetings: typeof mockMeeting[]; meta: { total: number; page: number; per: number } }>((resolve) => {
      resolveFirst = resolve
    })
    mockGetMeetings
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() =>
        Promise.resolve({
          meetings: [{ ...mockMeeting, id: 2, title: '두번째 응답' }],
          meta: { total: 1, page: 1, per: 20 },
        }),
      )

    // 첫 요청(느림) 시작 → 두번째 요청(빠름) 시작 → 두번째가 먼저 응답 도착
    const p1 = useMeetingStore.getState().fetchMeetings(1)
    const p2 = useMeetingStore.getState().fetchMeetings(1)
    await p2

    expect(useMeetingStore.getState().meetings[0].title).toBe('두번째 응답')

    // 뒤늦게 도착한 첫 요청 응답이 최신 상태를 덮어쓰면 안 된다
    resolveFirst({ meetings: [{ ...mockMeeting, id: 1, title: '첫번째 응답(stale)' }], meta: { total: 1, page: 1, per: 20 } })
    await p1

    expect(useMeetingStore.getState().meetings[0].title).toBe('두번째 응답')
  })

  it('경쟁 가드: 뒤늦게 도착한 이전 요청의 에러도 최신 상태를 덮지 않는다', async () => {
    let rejectFirst!: (e: Error) => void
    const firstPromise = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject
    })
    mockGetMeetings
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() =>
        Promise.resolve({ meetings: [mockMeeting], meta: { total: 1, page: 1, per: 20 } }),
      )

    const p1 = useMeetingStore.getState().fetchMeetings(1)
    const p2 = useMeetingStore.getState().fetchMeetings(1)
    await p2

    expect(useMeetingStore.getState().error).toBeNull()
    expect(useMeetingStore.getState().meetings).toHaveLength(1)

    rejectFirst(new Error('stale 에러'))
    await p1.catch(() => {})

    // stale 에러가 최신 성공 상태를 덮으면 안 된다
    expect(useMeetingStore.getState().error).toBeNull()
    expect(useMeetingStore.getState().meetings).toHaveLength(1)
  })

  it('최초 로드 완료 후에는 hasLoadedOnce=true, 재조회는 isLoading이 아니라 isRefreshing으로 토글된다', async () => {
    mockGetMeetings.mockResolvedValue({ meetings: [mockMeeting], meta: { total: 1, page: 1, per: 20 } })

    expect(useMeetingStore.getState().hasLoadedOnce).toBe(false)
    await useMeetingStore.getState().fetchMeetings(1)

    expect(useMeetingStore.getState().hasLoadedOnce).toBe(true)
    expect(useMeetingStore.getState().isLoading).toBe(false)
    expect(useMeetingStore.getState().isRefreshing).toBe(false)

    // 두번째 fetch: 진행 중에는 isLoading이 아니라 isRefreshing만 켜져야 한다
    let resolveSecond!: (v: { meetings: typeof mockMeeting[]; meta: { total: number; page: number; per: number } }) => void
    const second = new Promise<{ meetings: typeof mockMeeting[]; meta: { total: number; page: number; per: number } }>((resolve) => {
      resolveSecond = resolve
    })
    mockGetMeetings.mockImplementationOnce(() => second)

    const p = useMeetingStore.getState().fetchMeetings(1)
    expect(useMeetingStore.getState().isLoading).toBe(false)
    expect(useMeetingStore.getState().isRefreshing).toBe(true)

    resolveSecond({ meetings: [mockMeeting], meta: { total: 1, page: 1, per: 20 } })
    await p

    expect(useMeetingStore.getState().isRefreshing).toBe(false)
  })

  it('addMeeting으로 목록 맨 앞에 추가', () => {
    useMeetingStore.setState({ meetings: [mockMeeting] })
    const newMeeting = { ...mockMeeting, id: 2, title: '새 회의' }
    useMeetingStore.getState().addMeeting(newMeeting)
    const meetings = useMeetingStore.getState().meetings
    expect(meetings[0].id).toBe(2)
    expect(meetings[1].id).toBe(1)
  })

  it('reset으로 초기 상태로 복귀', () => {
    useMeetingStore.setState({
      meetings: [mockMeeting],
      searchQuery: '검색어',
    })
    useMeetingStore.getState().reset()
    const state = useMeetingStore.getState()
    expect(state.meetings).toEqual([])
    expect(state.searchQuery).toBe('')
  })
})
