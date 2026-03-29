import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMeetingStore } from './meetingStore'

const { mockGetMeetings } = vi.hoisted(() => ({
  mockGetMeetings: vi.fn(),
}))

vi.mock('../api/meetings', () => ({
  getMeetings: mockGetMeetings,
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

  it('fetchMeetings 실패 시 error 설정', async () => {
    mockGetMeetings.mockRejectedValue(new Error('API 오류'))

    await useMeetingStore.getState().fetchMeetings(1)
    const state = useMeetingStore.getState()
    expect(state.error).toBeTruthy()
    expect(state.isLoading).toBe(false)
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
