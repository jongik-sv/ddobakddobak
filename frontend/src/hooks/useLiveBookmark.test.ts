import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLiveBookmark } from './useLiveBookmark'
import { createBookmark } from '../api/bookmarks'

vi.mock('../api/bookmarks', () => ({
  createBookmark: vi.fn(async () => ({})),
}))

const mockCreateBookmark = vi.mocked(createBookmark)
const MEETING_ID = 42

describe('useLiveBookmark', () => {
  beforeEach(() => {
    mockCreateBookmark.mockReset()
    mockCreateBookmark.mockResolvedValue({} as never)
  })

  it('초기 상태: 팝오버 닫힘·라벨 빈 문자열·타임스탬프 0', () => {
    const { result } = renderHook(() =>
      useLiveBookmark({ meetingId: MEETING_ID, elapsedSeconds: 12, isActive: true, showStatus: vi.fn() })
    )
    expect(result.current.showBookmarkPopover).toBe(false)
    expect(result.current.bookmarkLabel).toBe('')
    expect(result.current.bookmarkTimestampRef.current).toBe(0)
  })

  it('handleOpenBookmark: 타임스탬프=elapsedSeconds*1000, 라벨 초기화, 팝오버 오픈', () => {
    const { result } = renderHook(() =>
      useLiveBookmark({ meetingId: MEETING_ID, elapsedSeconds: 12, isActive: true, showStatus: vi.fn() })
    )
    act(() => result.current.setBookmarkLabel('이전 입력'))
    act(() => result.current.handleOpenBookmark())
    expect(result.current.bookmarkTimestampRef.current).toBe(12000)
    expect(result.current.bookmarkLabel).toBe('')
    expect(result.current.showBookmarkPopover).toBe(true)
  })

  it('handleSaveBookmark: 트림한 라벨로 createBookmark 호출·팝오버 닫힘·성공 메시지', async () => {
    const showStatus = vi.fn()
    const { result } = renderHook(() =>
      useLiveBookmark({ meetingId: MEETING_ID, elapsedSeconds: 7, isActive: true, showStatus })
    )
    act(() => result.current.handleOpenBookmark())
    act(() => result.current.setBookmarkLabel('  중요 발언  '))

    await act(async () => {
      await result.current.handleSaveBookmark()
    })

    expect(mockCreateBookmark).toHaveBeenCalledWith(MEETING_ID, {
      timestamp_ms: 7000,
      label: '중요 발언',
    })
    expect(result.current.showBookmarkPopover).toBe(false)
    expect(showStatus).toHaveBeenCalledWith('북마크가 추가되었습니다')
  })

  it('handleSaveBookmark: 라벨이 공백뿐이면 label=undefined', async () => {
    const { result } = renderHook(() =>
      useLiveBookmark({ meetingId: MEETING_ID, elapsedSeconds: 3, isActive: true, showStatus: vi.fn() })
    )
    act(() => result.current.handleOpenBookmark())
    act(() => result.current.setBookmarkLabel('   '))

    await act(async () => {
      await result.current.handleSaveBookmark()
    })

    expect(mockCreateBookmark).toHaveBeenCalledWith(MEETING_ID, {
      timestamp_ms: 3000,
      label: undefined,
    })
  })

  it('handleSaveBookmark: createBookmark 실패 시 실패 메시지', async () => {
    const showStatus = vi.fn()
    mockCreateBookmark.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() =>
      useLiveBookmark({ meetingId: MEETING_ID, elapsedSeconds: 1, isActive: true, showStatus })
    )

    await act(async () => {
      await result.current.handleSaveBookmark()
    })

    expect(showStatus).toHaveBeenCalledWith('북마크 추가에 실패했습니다')
  })

  it('Ctrl+B: isActive=true이면 팝오버를 연다', () => {
    const { result } = renderHook(() =>
      useLiveBookmark({ meetingId: MEETING_ID, elapsedSeconds: 9, isActive: true, showStatus: vi.fn() })
    )
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'b' }))
    })
    expect(result.current.showBookmarkPopover).toBe(true)
    expect(result.current.bookmarkTimestampRef.current).toBe(9000)
  })

  it('Ctrl+B: isActive=false이면 팝오버를 열지 않는다', () => {
    const { result } = renderHook(() =>
      useLiveBookmark({ meetingId: MEETING_ID, elapsedSeconds: 9, isActive: false, showStatus: vi.fn() })
    )
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'b' }))
    })
    expect(result.current.showBookmarkPopover).toBe(false)
  })

  it('언마운트 시 keydown 리스너를 정리한다', () => {
    const { result, unmount } = renderHook(() =>
      useLiveBookmark({ meetingId: MEETING_ID, elapsedSeconds: 9, isActive: true, showStatus: vi.fn() })
    )
    unmount()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'b' }))
    })
    // 언마운트 후엔 상태 변화가 없어야 함(리스너 제거 확인)
    expect(result.current.showBookmarkPopover).toBe(false)
  })
})
