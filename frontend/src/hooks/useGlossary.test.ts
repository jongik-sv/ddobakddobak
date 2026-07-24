import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGlossary } from './useGlossary'

vi.mock('../api/glossary', () => ({
  getGlossary: vi.fn(async () => ({
    meeting: { entries: [{ id: 1, from_text: 'a', to_text: 'b', match_type: 'literal', enabled: true, owner_type: 'Meeting', owner_id: 1 }] },
    folder: null,
    ancestors: [],
    resolved: [{ from: 'a', to: 'b', match_type: 'literal' }],
  })),
  createMeetingGlossaryEntry: vi.fn(async () => ({ entry: { id: 2, from_text: 'c', to_text: 'd', match_type: 'literal', enabled: true, owner_type: 'Meeting', owner_id: 1 } })),
  createFolderGlossaryEntry: vi.fn(async () => ({ entry: { id: 3, from_text: 'e', to_text: 'f', match_type: 'literal', enabled: true, owner_type: 'Folder', owner_id: 1 } })),
  updateGlossaryEntry: vi.fn(async () => ({ entry: { id: 1, from_text: 'a', to_text: 'z', match_type: 'literal', enabled: true, owner_type: 'Meeting', owner_id: 1 } })),
  deleteGlossaryEntry: vi.fn(async () => {}),
  reapplyGlossary: vi.fn(async () => ({ notes_markdown: '', corrected_transcripts: 3 })),
  applyGlossaryEntry: vi.fn(async () => ({ notes_markdown: '', corrected_transcripts: 1 })),
}))

describe('useGlossary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('마운트 시 사전 뷰를 로드한다', async () => {
    const { result } = renderHook(() => useGlossary(1))
    await waitFor(() => expect(result.current.view).not.toBeNull())
    expect(result.current.view?.meeting.entries).toHaveLength(1)
  })

  it('reapply 호출 후 재조회', async () => {
    const api = await import('../api/glossary')
    const { result } = renderHook(() => useGlossary(1))
    await waitFor(() => expect(result.current.view).not.toBeNull())
    await act(async () => { await result.current.reapply() })
    expect(api.reapplyGlossary).toHaveBeenCalledWith(1)
    expect(api.getGlossary).toHaveBeenCalledTimes(2) // 초기 + reapply 후
  })

  it('applyEntry 호출 시 해당 엔트리를 적용하고 재조회', async () => {
    const api = await import('../api/glossary')
    const { result } = renderHook(() => useGlossary(1))
    await waitFor(() => expect(result.current.view).not.toBeNull())
    await act(async () => { await result.current.applyEntry(1) })
    expect(api.applyGlossaryEntry).toHaveBeenCalledWith(1, 1)
    expect(api.getGlossary).toHaveBeenCalledTimes(2) // 초기 + 적용 후
  })

  // idea 44: canEdit=false 사용자가 오타사전 편집/삭제를 시도(서버 403)하면 예외가
  // unhandled rejection으로 콘솔에만 남지 않고 status에 실패가 반영돼야 한다.
  it('editEntry 실패 시 조용히 삼키지 않고 status에 실패를 반영한다', async () => {
    const api = await import('../api/glossary')
    vi.mocked(api.updateGlossaryEntry).mockRejectedValueOnce(new Error('forbidden'))
    const { result } = renderHook(() => useGlossary(1))
    await waitFor(() => expect(result.current.view).not.toBeNull())

    await act(async () => { await result.current.editEntry(1, { enabled: false }) })

    expect(result.current.status).toContain('실패')
  })

  it('removeEntry 실패 시 조용히 삼키지 않고 status에 실패를 반영한다', async () => {
    const api = await import('../api/glossary')
    vi.mocked(api.deleteGlossaryEntry).mockRejectedValueOnce(new Error('forbidden'))
    const { result } = renderHook(() => useGlossary(1))
    await waitFor(() => expect(result.current.view).not.toBeNull())

    await act(async () => { await result.current.removeEntry(1) })

    expect(result.current.status).toContain('실패')
  })
})
