import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLiveTermCorrections } from './useLiveTermCorrections'
import { correctTerms } from '../api/meetings'

vi.mock('../api/meetings', () => ({
  correctTerms: vi.fn(async () => ({ notes_markdown: '', corrected_transcripts: 0 })),
}))

const mockCorrectTerms = vi.mocked(correctTerms)
const MEETING_ID = 42

describe('useLiveTermCorrections', () => {
  beforeEach(() => {
    mockCorrectTerms.mockReset()
    mockCorrectTerms.mockResolvedValue({ notes_markdown: '', corrected_transcripts: 0 })
  })

  it('초기 corrections는 빈 1행, isApplyingCorrections는 false', () => {
    const { result } = renderHook(() => useLiveTermCorrections(MEETING_ID, vi.fn()))
    expect(result.current.corrections).toEqual([{ from: '', to: '' }])
    expect(result.current.isApplyingCorrections).toBe(false)
  })

  it('updateCorrection이 해당 행의 필드를 갱신한다', () => {
    const { result } = renderHook(() => useLiveTermCorrections(MEETING_ID, vi.fn()))
    act(() => result.current.updateCorrection(0, 'from', 'x'))
    expect(result.current.corrections).toEqual([{ from: 'x', to: '' }])
    act(() => result.current.updateCorrection(0, 'to', 'y'))
    expect(result.current.corrections).toEqual([{ from: 'x', to: 'y' }])
  })

  it('addCorrectionRow가 빈 행을 추가한다', () => {
    const { result } = renderHook(() => useLiveTermCorrections(MEETING_ID, vi.fn()))
    act(() => result.current.addCorrectionRow())
    expect(result.current.corrections).toEqual([{ from: '', to: '' }, { from: '', to: '' }])
  })

  it('removeCorrectionRow가 해당 행을 제거한다', () => {
    const { result } = renderHook(() => useLiveTermCorrections(MEETING_ID, vi.fn()))
    act(() => result.current.addCorrectionRow())
    act(() => result.current.updateCorrection(1, 'from', 'b'))
    act(() => result.current.removeCorrectionRow(0))
    expect(result.current.corrections).toEqual([{ from: 'b', to: '' }])
  })

  it('removeCorrectionRow는 마지막 1행이면 빈 행으로 초기화한다', () => {
    const { result } = renderHook(() => useLiveTermCorrections(MEETING_ID, vi.fn()))
    act(() => result.current.updateCorrection(0, 'from', 'only'))
    act(() => result.current.removeCorrectionRow(0))
    expect(result.current.corrections).toEqual([{ from: '', to: '' }])
  })

  it('유효한 행이 없으면 correctTerms를 호출하지 않는다', async () => {
    const showStatus = vi.fn()
    const { result } = renderHook(() => useLiveTermCorrections(MEETING_ID, showStatus))
    await act(async () => {
      await result.current.handleApplyCorrections()
    })
    expect(mockCorrectTerms).not.toHaveBeenCalled()
  })

  it('유효한 행이 있으면 correctTerms 호출·corrections 리셋·플래그 토글', async () => {
    const showStatus = vi.fn()
    mockCorrectTerms.mockResolvedValue({ notes_markdown: '', corrected_transcripts: 3 })
    const { result } = renderHook(() => useLiveTermCorrections(MEETING_ID, showStatus))
    act(() => result.current.updateCorrection(0, 'from', 'a'))
    act(() => result.current.updateCorrection(0, 'to', 'b'))

    await act(async () => {
      await result.current.handleApplyCorrections()
    })

    expect(mockCorrectTerms).toHaveBeenCalledWith(MEETING_ID, [{ from: 'a', to: 'b' }])
    expect(result.current.corrections).toEqual([{ from: '', to: '' }])
    expect(result.current.isApplyingCorrections).toBe(false)
  })

  it('corrected_transcripts > 0이면 건수 메시지를 표시한다', async () => {
    const showStatus = vi.fn()
    mockCorrectTerms.mockResolvedValue({ notes_markdown: '', corrected_transcripts: 5 })
    const { result } = renderHook(() => useLiveTermCorrections(MEETING_ID, showStatus))
    act(() => result.current.updateCorrection(0, 'from', 'a'))
    act(() => result.current.updateCorrection(0, 'to', 'b'))

    await act(async () => {
      await result.current.handleApplyCorrections()
    })

    expect(showStatus).toHaveBeenCalledWith('오타 수정 완료 (트랜스크립트 5건 수정)')
  })

  it('corrected_transcripts === 0이면 일반 메시지를 표시한다', async () => {
    const showStatus = vi.fn()
    mockCorrectTerms.mockResolvedValue({ notes_markdown: '', corrected_transcripts: 0 })
    const { result } = renderHook(() => useLiveTermCorrections(MEETING_ID, showStatus))
    act(() => result.current.updateCorrection(0, 'from', 'a'))
    act(() => result.current.updateCorrection(0, 'to', 'b'))

    await act(async () => {
      await result.current.handleApplyCorrections()
    })

    expect(showStatus).toHaveBeenCalledWith('오타 수정이 회의록에 반영되었습니다')
  })
})
