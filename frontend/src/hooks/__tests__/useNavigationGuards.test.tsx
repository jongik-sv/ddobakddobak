import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }))
import { useNavigationGuards } from '../useNavigationGuards'

describe('useNavigationGuards (반전: 차단 없음)', () => {
  it('녹음 중에도 handleNavigateBack이 즉시 미리보기로 네비(차단 안 함)', () => {
    navigate.mockClear()
    const { result } = renderHook(() => useNavigationGuards(7, true), { wrapper: MemoryRouter })
    result.current.handleNavigateBack()
    expect(navigate).toHaveBeenCalledWith('/meetings/7')
  })
  it('반환에 showLeaveBlock 없음(차단 UI 제거)', () => {
    const { result } = renderHook(() => useNavigationGuards(7, true), { wrapper: MemoryRouter })
    expect('showLeaveBlock' in result.current).toBe(false)
  })
})
