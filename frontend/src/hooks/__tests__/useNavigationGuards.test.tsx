import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }))
import { useNavigationGuards } from '../useNavigationGuards'

describe('useNavigationGuards', () => {
  beforeEach(() => navigate.mockClear())
  afterEach(() => vi.restoreAllMocks())

  it('handleNavigateBack은 미리보기로 네비', () => {
    const { result } = renderHook(() => useNavigationGuards(7, true), { wrapper: MemoryRouter })
    result.current.handleNavigateBack()
    expect(navigate).toHaveBeenCalledWith('/meetings/7')
  })

  it('녹음 중 마운트 시 센티넬 히스토리 항목을 쌓아 뒤로가기를 흡수', () => {
    const push = vi.spyOn(window.history, 'pushState')
    renderHook(() => useNavigationGuards(7, true), { wrapper: MemoryRouter })
    expect(push).toHaveBeenCalled()
  })

  it('뒤로가기(popstate) 시 재고정 + 확인 다이얼로그 노출, 즉시 이탈 안 함', () => {
    const push = vi.spyOn(window.history, 'pushState')
    const { result } = renderHook(() => useNavigationGuards(7, true), { wrapper: MemoryRouter })
    expect(result.current.showLeaveConfirm).toBe(false)
    push.mockClear()
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(push).toHaveBeenCalled() // 센티넬 재고정
    expect(result.current.showLeaveConfirm).toBe(true)
    expect(navigate).not.toHaveBeenCalled() // 확인 전엔 이탈 없음
  })

  it('confirmLeave → 미리보기로 이탈하고 다이얼로그 닫힘', () => {
    const { result } = renderHook(() => useNavigationGuards(7, true), { wrapper: MemoryRouter })
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    act(() => result.current.confirmLeave())
    expect(navigate).toHaveBeenCalledWith('/meetings/7')
    expect(result.current.showLeaveConfirm).toBe(false)
  })

  it('cancelLeave → 머무름(네비 없음, 다이얼로그 닫힘)', () => {
    const { result } = renderHook(() => useNavigationGuards(7, true), { wrapper: MemoryRouter })
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    act(() => result.current.cancelLeave())
    expect(navigate).not.toHaveBeenCalled()
    expect(result.current.showLeaveConfirm).toBe(false)
  })

  it('녹음 중이 아니면 뒤로가기 가드 없음(popstate 무시)', () => {
    const { result } = renderHook(() => useNavigationGuards(7, false), { wrapper: MemoryRouter })
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(result.current.showLeaveConfirm).toBe(false)
  })
})
