import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Meeting, SummaryResponse } from '../api/meetings/types'
import { useMeeting } from './useMeeting'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

const getMeeting = vi.fn<(id: number) => Promise<Meeting>>()
const getSummary = vi.fn<(id: number) => Promise<SummaryResponse | null>>()
const updateMeeting = vi.fn()
const deleteMeetingApi = vi.fn()

vi.mock('../api/meetings', () => ({
  getMeeting: (id: number) => getMeeting(id),
  getSummary: (id: number) => getSummary(id),
  updateMeeting: (...args: unknown[]) => updateMeeting(...args),
  deleteMeeting: (...args: unknown[]) => deleteMeetingApi(...args),
}))

/** 수동으로 resolve/reject 시점을 제어하는 프라미스 — 레이스의 도착 순서를 테스트가 지정한다. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeMeeting(over: Partial<Meeting> = {}): Meeting {
  return { id: 1, title: '회의', ...over } as Meeting
}

function makeSummary(over: Partial<SummaryResponse> = {}): SummaryResponse {
  return {
    id: 1,
    meeting_id: 1,
    key_points: [],
    decisions: [],
    discussion_details: [],
    summary_type: 'final',
    generated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

describe('useMeeting — stale-response 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 재현: 완료된 회의 상세에서 정보 수정(updateMeetingInfo) → refetch() 로 Fetch A 발화.
  // A 가 끝나기 전에 기밀 구간 절단이 확정 → applyLocalRedaction 이 refetchMeeting() 을
  // 또 호출해 Fetch B 발화. B(절단 후, notes 없음)가 A(절단 전, 기밀 포함)보다 먼저
  // 응답하면, 가드 없이는 뒤늦게 도착한 A 가 setSummary 로 이겨 파기된 기밀 회의록이
  // 화면에 되살아난다.
  it('먼저 나간 요청(A)이 나중에 응답해도, 나중에 나간 요청(B)의 결과를 덮어쓰지 않는다', async () => {
    const meetingA = makeMeeting({ title: '절단 전' })
    const meetingB = makeMeeting({ title: '절단 후' })
    const summaryA = makeSummary({ notes_markdown: '기밀 내용' })
    const summaryB = makeSummary({ notes_markdown: undefined })

    const meetingDeferredA = deferred<Meeting>()
    const summaryDeferredA = deferred<SummaryResponse | null>()
    const meetingDeferredB = deferred<Meeting>()
    const summaryDeferredB = deferred<SummaryResponse | null>()

    getMeeting
      .mockReturnValueOnce(meetingDeferredA.promise)
      .mockReturnValueOnce(meetingDeferredB.promise)
    getSummary
      .mockReturnValueOnce(summaryDeferredA.promise)
      .mockReturnValueOnce(summaryDeferredB.promise)

    const { result } = renderHook(() => useMeeting(1))

    // 마운트 = Fetch A 시작. refetch() = Fetch B 시작(레이스 트리거).
    act(() => {
      result.current.refetch()
    })

    // B(최신)가 먼저 응답한다.
    await act(async () => {
      meetingDeferredB.resolve(meetingB)
      summaryDeferredB.resolve(summaryB)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.summary).toEqual(summaryB)

    // A(스테일)가 뒤늦게 응답한다 — 화면을 되돌리면 안 된다.
    await act(async () => {
      meetingDeferredA.resolve(meetingA)
      summaryDeferredA.resolve(summaryA)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.summary).toEqual(summaryB)
    expect(result.current.meeting).toEqual(meetingB)
  })

  it('스테일 요청(A)이 뒤늦게 실패해도 최신 성공 상태(B)를 에러로 덮어쓰지 않는다', async () => {
    const meetingB = makeMeeting({ title: '절단 후' })
    const summaryB = makeSummary({ notes_markdown: undefined })

    const meetingDeferredA = deferred<Meeting>()
    const summaryDeferredA = deferred<SummaryResponse | null>()
    const meetingDeferredB = deferred<Meeting>()
    const summaryDeferredB = deferred<SummaryResponse | null>()

    getMeeting
      .mockReturnValueOnce(meetingDeferredA.promise)
      .mockReturnValueOnce(meetingDeferredB.promise)
    getSummary
      .mockReturnValueOnce(summaryDeferredA.promise)
      .mockReturnValueOnce(summaryDeferredB.promise)

    const { result } = renderHook(() => useMeeting(2))

    act(() => {
      result.current.refetch()
    })

    await act(async () => {
      meetingDeferredB.resolve(meetingB)
      summaryDeferredB.resolve(summaryB)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.error).toBeNull()

    // 스테일(A)이 뒤늦게 실패 — 최신 성공 상태를 에러로 덮으면 안 된다.
    await act(async () => {
      meetingDeferredA.reject(new Error('stale network error'))
      summaryDeferredA.resolve(null)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.error).toBeNull()
    expect(result.current.summary).toEqual(summaryB)
  })

  it('meetingId 가 바뀌면 새 데이터를 정상적으로 불러온다(가드가 정상 케이스를 막지 않는다)', async () => {
    getMeeting.mockResolvedValue(makeMeeting({ id: 9, title: '아홉' }))
    getSummary.mockResolvedValue(makeSummary({ meeting_id: 9 }))

    const { result, rerender } = renderHook(({ id }: { id: number }) => useMeeting(id), {
      initialProps: { id: 9 },
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.meeting?.id).toBe(9)

    getMeeting.mockResolvedValue(makeMeeting({ id: 10, title: '열' }))
    getSummary.mockResolvedValue(makeSummary({ meeting_id: 10 }))

    rerender({ id: 10 })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.meeting?.id).toBe(10)
  })
})
