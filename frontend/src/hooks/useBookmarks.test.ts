import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBookmarks } from './useBookmarks'

vi.mock('../api/bookmarks', () => ({
  getBookmarks: vi.fn(async () => [
    { id: 1, meeting_id: 1, timestamp_ms: 1000, label: 'a', created_at: '' },
  ]),
  createBookmark: vi.fn(),
  updateBookmark: vi.fn(),
  deleteBookmark: vi.fn(async () => {}),
}))

describe('useBookmarks', () => {
  beforeEach(() => vi.clearAllMocks())

  // idea 44: canEdit=false 사용자가 삭제를 시도(서버 403)하면 handleEditBookmark/handleSaveBookmark와
  // 동일하게 alert로 실패를 알려야 한다 — 조용히 삼키면(catch { // ignore }) "삭제가 안 됐나?" 하며
  // 재시도하거나 실패를 인지하지 못한 채 넘어가는 원래 버그 증상이 재현된다.
  it('삭제 실패 시 조용히 삼키지 않고 alert로 사용자에게 알린다', async () => {
    const api = await import('../api/bookmarks')
    vi.mocked(api.deleteBookmark).mockRejectedValueOnce(new Error('forbidden'))
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    const { result } = renderHook(() => useBookmarks(1, { transcripts: [], currentTimeMs: 0 }))
    await waitFor(() => expect(result.current.bookmarks).toHaveLength(1))

    await act(async () => { await result.current.handleDeleteBookmark(1) })

    expect(alertSpy).toHaveBeenCalled()
    // 삭제 실패 시 로컬 state는 그대로 남아야 한다(성공한 것처럼 지워지면 안 됨)
    expect(result.current.bookmarks).toHaveLength(1)
    alertSpy.mockRestore()
  })

  it('삭제 성공 시 로컬 state에서 제거된다', async () => {
    const { result } = renderHook(() => useBookmarks(1, { transcripts: [], currentTimeMs: 0 }))
    await waitFor(() => expect(result.current.bookmarks).toHaveLength(1))

    await act(async () => { await result.current.handleDeleteBookmark(1) })

    expect(result.current.bookmarks).toHaveLength(0)
  })
})
