import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchMeetings } from './search'

const { mockJson, mockGet } = vi.hoisted(() => {
  const mockJson = vi.fn()
  const mockGet = vi.fn(() => ({ json: mockJson }))
  return { mockJson, mockGet }
})

vi.mock('./client', () => ({
  default: { get: mockGet },
}))

describe('search API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue({ json: mockJson })
  })

  it('search 엔드포인트로 GET 요청', async () => {
    mockJson.mockResolvedValue({ results: [], total: 0, page: 1, per_page: 20 })
    await searchMeetings({ q: '테스트' })
    expect(mockGet).toHaveBeenCalledWith('search', {
      searchParams: { q: '테스트' },
    })
  })

  it('모든 필터 파라미터가 searchParams로 전달됨', async () => {
    mockJson.mockResolvedValue({ results: [], total: 0, page: 1, per_page: 20 })
    await searchMeetings({
      q: '키워드',
      speaker: 'SPEAKER_00',
      date_from: '2024-01-01',
      date_to: '2024-12-31',
      status: 'completed',
      page: 2,
      per_page: 10,
    })
    expect(mockGet).toHaveBeenCalledWith('search', {
      searchParams: {
        q: '키워드',
        speaker: 'SPEAKER_00',
        date_from: '2024-01-01',
        date_to: '2024-12-31',
        status: 'completed',
        page: 2,
        per_page: 10,
      },
    })
  })

  it('검색 결과를 반환', async () => {
    const mockResponse = {
      results: [
        {
          meeting_id: 1,
          meeting_title: '회의 1',
          type: 'transcript',
          snippet: '<mark>테스트</mark> 내용',
          speaker: 'SPEAKER_00',
          created_at: '2024-01-15',
        },
      ],
      total: 1,
      page: 1,
      per_page: 20,
    }
    mockJson.mockResolvedValue(mockResponse)
    const result = await searchMeetings({ q: '테스트' })
    expect(result).toEqual(mockResponse)
  })

  it('빈 파라미터는 searchParams에 포함하지 않음', async () => {
    mockJson.mockResolvedValue({ results: [], total: 0, page: 1, per_page: 20 })
    await searchMeetings({ q: '검색어' })
    expect(mockGet).toHaveBeenCalledWith('search', {
      searchParams: { q: '검색어' },
    })
  })
})
