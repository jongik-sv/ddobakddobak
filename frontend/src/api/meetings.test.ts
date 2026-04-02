import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HTTPError } from 'ky'
import { getMeeting, getMeetings, createMeeting, getMeetingDetail } from './meetings'

const { mockJson, mockGet, mockPost } = vi.hoisted(() => {
  const mockJson = vi.fn()
  const mockGet = vi.fn(() => ({ json: mockJson }))
  const mockPost = vi.fn(() => ({ json: mockJson }))
  return { mockJson, mockGet, mockPost }
})

vi.mock('./client', () => ({
  default: { get: mockGet, post: mockPost },
}))

function makeHTTPError(status: number): HTTPError {
  const response = { status, statusText: '' } as Response
  const request = { method: 'GET', url: '/test' } as Request
  const options = {} as never
  return new HTTPError(response, request, options)
}

describe('meetings API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue({ json: mockJson })
    mockPost.mockReturnValue({ json: mockJson })
  })

  describe('getMeeting', () => {
    it('meetings/:id 엔드포인트로 GET 요청', async () => {
      mockJson.mockResolvedValue({ id: 1, title: '회의1', status: 'pending' })
      await getMeeting(1)
      expect(mockGet).toHaveBeenCalledWith('meetings/1')
    })
  })

  describe('getMeetings', () => {
    it('meetings 엔드포인트로 GET 요청', async () => {
      mockJson.mockResolvedValue({
        meetings: [],
        meta: { total: 0, page: 1, per: 20 },
      })
      await getMeetings({})
      expect(mockGet).toHaveBeenCalledWith('meetings', { searchParams: expect.any(Object) })
    })

    it('파라미터가 searchParams로 전달됨', async () => {
      mockJson.mockResolvedValue({
        meetings: [],
        meta: { total: 0, page: 1, per: 20 },
      })
      await getMeetings({ page: 2, per: 10, q: '검색어' })
      expect(mockGet).toHaveBeenCalledWith('meetings', {
        searchParams: { page: 2, per: 10, q: '검색어' },
      })
    })

    it('meetings 목록과 meta를 반환', async () => {
      const meetings = [
        {
          id: 1,
          title: '회의1',
          status: 'pending' as const,
          team: { id: 1, name: '팀A' },
          created_by: { id: 1, name: '사용자1' },
          started_at: null,
          ended_at: null,
          created_at: '2024-01-01T00:00:00Z',
        },
      ]
      mockJson.mockResolvedValue({ meetings, meta: { total: 1, page: 1, per: 20 } })
      const result = await getMeetings({})
      expect(result.meetings).toHaveLength(1)
      expect(result.meetings[0].title).toBe('회의1')
      expect(result.meta.total).toBe(1)
    })
  })

  describe('createMeeting', () => {
    it('meetings 엔드포인트로 POST 요청', async () => {
      mockJson.mockResolvedValue({
        meeting: {
          id: 2,
          title: '새 회의',
          status: 'pending',
          created_by: { id: 1, name: '사용자1' },
          started_at: null,
          ended_at: null,
          created_at: '2024-01-01T00:00:00Z',
        },
      })
      await createMeeting({ title: '새 회의' })
      expect(mockPost).toHaveBeenCalledWith('meetings', {
        json: { title: '새 회의' },
      })
    })

    it('생성된 Meeting을 반환', async () => {
      const meeting = {
        id: 2,
        title: '새 회의',
        status: 'pending' as const,
        created_by: { id: 1, name: '사용자1' },
        started_at: null,
        ended_at: null,
        created_at: '2024-01-01T00:00:00Z',
      }
      mockJson.mockResolvedValue({ meeting })
      const result = await createMeeting({ title: '새 회의' })
      expect(result.id).toBe(2)
      expect(result.title).toBe('새 회의')
    })
  })
})

const mockMeeting = {
  id: 1,
  title: '3월 스프린트 회고',
  status: 'completed' as const,
  started_at: '2026-03-25T10:00:00.000Z',
  ended_at: '2026-03-25T11:00:00.000Z',
  team_id: 1,
  created_by_id: 2,
  created_at: '2026-03-25T09:50:00.000Z',
  updated_at: '2026-03-25T11:00:00.000Z',
}

describe('getMeetingDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue({ json: mockJson })
  })

  it('성공 시 meeting 데이터와 null error 반환', async () => {
    mockJson.mockResolvedValue({ meeting: mockMeeting })
    const result = await getMeetingDetail(1)
    expect(result.meeting).toEqual(mockMeeting)
    expect(result.error).toBeNull()
  })

  it('올바른 엔드포인트로 GET 요청', async () => {
    mockJson.mockResolvedValue(mockMeeting)
    await getMeetingDetail(42)
    expect(mockGet).toHaveBeenCalledWith('meetings/42')
  })

  it('403 응답 시 forbidden error 반환', async () => {
    mockJson.mockRejectedValue(makeHTTPError(403))
    const result = await getMeetingDetail(1)
    expect(result.meeting).toBeNull()
    expect(result.error).toBe('forbidden')
  })

  it('404 응답 시 not_found error 반환', async () => {
    mockJson.mockRejectedValue(makeHTTPError(404))
    const result = await getMeetingDetail(1)
    expect(result.meeting).toBeNull()
    expect(result.error).toBe('not_found')
  })

  it('알 수 없는 에러 시 unknown error 반환', async () => {
    mockJson.mockRejectedValue(new Error('Network error'))
    const result = await getMeetingDetail(1)
    expect(result.meeting).toBeNull()
    expect(result.error).toBe('unknown')
  })
})
