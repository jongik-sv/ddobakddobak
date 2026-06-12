import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MeetingSearchBar } from './MeetingSearchBar'

function setup(overrides: Partial<React.ComponentProps<typeof MeetingSearchBar>> = {}) {
  const props = {
    query: '발사대',
    onQueryChange: vi.fn(),
    matchCount: 3,
    currentIndex: 0,
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onClose: vi.fn(),
    focusTick: 0,
    ...overrides,
  }
  render(<MeetingSearchBar {...props} />)
  return props
}

describe('MeetingSearchBar', () => {
  it('Enter=다음, Shift+Enter=이전, Esc=닫기', () => {
    const props = setup()
    const input = screen.getByPlaceholderText('전사·요약 검색')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onNext).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(props.onPrev).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('IME 조합 중 Enter는 매치 이동으로 새지 않는다', () => {
    const props = setup()
    const input = screen.getByPlaceholderText('전사·요약 검색')

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(props.onNext).not.toHaveBeenCalled()
  })

  it('카운터 n/m 표시, 매치 0이면 0/0', () => {
    setup({ matchCount: 3, currentIndex: 1 })
    expect(screen.getByTestId('search-match-counter').textContent).toBe('2/3')
  })

  it('매치 없으면 0/0 + 이동 버튼 비활성', () => {
    setup({ matchCount: 0 })
    expect(screen.getByTestId('search-match-counter').textContent).toBe('0/0')
    expect(screen.getByLabelText('다음 매치')).toBeDisabled()
    expect(screen.getByLabelText('이전 매치')).toBeDisabled()
  })
})
