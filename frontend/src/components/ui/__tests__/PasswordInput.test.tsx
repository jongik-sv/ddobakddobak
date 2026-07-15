import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PasswordInput } from '../PasswordInput'

afterEach(cleanup)

describe('PasswordInput', () => {
  it('초기에는 type=password로 렌더한다', () => {
    render(<PasswordInput placeholder="비밀번호" />)
    expect(screen.getByPlaceholderText('비밀번호')).toHaveAttribute('type', 'password')
  })

  it('토글 클릭 시 text로, 다시 클릭 시 password로 전환한다', () => {
    render(<PasswordInput placeholder="비밀번호" />)
    const input = screen.getByPlaceholderText('비밀번호')

    fireEvent.click(screen.getByRole('button', { name: '비밀번호 표시' }))
    expect(input).toHaveAttribute('type', 'text')

    fireEvent.click(screen.getByRole('button', { name: '비밀번호 숨기기' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('토글 상태에 따라 aria-label이 전환된다', () => {
    render(<PasswordInput />)
    const button = screen.getByRole('button', { name: '비밀번호 표시' })

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-label', '비밀번호 숨기기')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-label', '비밀번호 표시')
  })

  it('id를 전달하면 label(htmlFor) 연결이 유지된다', () => {
    render(
      <>
        <label htmlFor="pw">비밀번호</label>
        <PasswordInput id="pw" />
      </>,
    )
    expect(screen.getByLabelText('비밀번호')).toHaveAttribute('type', 'password')
  })

  it('className은 그대로 전달되고 뒤에 pr-10이 덧붙는다', () => {
    render(<PasswordInput placeholder="비밀번호" className="w-full min-h-[44px]" />)
    const input = screen.getByPlaceholderText('비밀번호')
    expect(input.className).toContain('w-full min-h-[44px]')
    expect(input.className).toContain('pr-10')
  })

  it('토글 버튼 mousedown의 기본 동작을 막아 input 포커스를 유지한다 (모바일 키보드 닫힘 방지)', () => {
    render(<PasswordInput placeholder="비밀번호" />)
    const input = screen.getByPlaceholderText('비밀번호')
    input.focus()

    // preventDefault가 호출되면 fireEvent는 false를 반환한다
    const notPrevented = fireEvent.mouseDown(screen.getByRole('button', { name: '비밀번호 표시' }))
    expect(notPrevented).toBe(false)
    expect(input).toHaveFocus()
  })

  it('id를 전달하면 토글 버튼이 aria-controls로 input과 연결된다', () => {
    render(<PasswordInput id="pw-field" />)
    expect(screen.getByRole('button', { name: '비밀번호 표시' })).toHaveAttribute(
      'aria-controls',
      'pw-field',
    )
  })

  it('id가 없으면 토글 버튼에 aria-controls를 설정하지 않는다', () => {
    render(<PasswordInput />)
    expect(screen.getByRole('button', { name: '비밀번호 표시' })).not.toHaveAttribute('aria-controls')
  })

  it('toggleLabel로 필드별 aria-label을 구체화한다 (표시/숨기기 모두)', () => {
    render(<PasswordInput toggleLabel="현재 비밀번호" />)
    const button = screen.getByRole('button', { name: '현재 비밀번호 표시' })

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-label', '현재 비밀번호 숨기기')
  })

  it('같은 폼에 여러 개 렌더해도 toggleLabel로 스크린리더가 버튼을 구분할 수 있다', () => {
    render(
      <>
        <PasswordInput id="current-password" toggleLabel="현재 비밀번호" />
        <PasswordInput id="new-password" toggleLabel="새 비밀번호" />
        <PasswordInput id="confirm-password" toggleLabel="새 비밀번호 확인" />
      </>,
    )
    expect(screen.getByRole('button', { name: '현재 비밀번호 표시' })).toHaveAttribute(
      'aria-controls',
      'current-password',
    )
    expect(screen.getByRole('button', { name: '새 비밀번호 표시' })).toHaveAttribute(
      'aria-controls',
      'new-password',
    )
    expect(screen.getByRole('button', { name: '새 비밀번호 확인 표시' })).toHaveAttribute(
      'aria-controls',
      'confirm-password',
    )
  })

  it('토글 버튼은 type=button이라 form을 submit하지 않는다', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput placeholder="비밀번호" />
      </form>,
    )
    const button = screen.getByRole('button', { name: '비밀번호 표시' })
    expect(button).toHaveAttribute('type', 'button')

    fireEvent.click(button)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
