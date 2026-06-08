import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Dialog } from '../Dialog'

afterEach(cleanup)

describe('Dialog', () => {
  it('children을 렌더한다', () => {
    render(<Dialog onClose={() => {}}><p>내용</p></Dialog>)
    expect(screen.getByText('내용')).toBeInTheDocument()
  })

  it('기본값(closeOnBackdrop 미지정)은 백드롭 클릭을 무시한다', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose}><p>내용</p></Dialog>)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closeOnBackdrop=true면 백드롭 클릭 시 onClose 호출', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose} closeOnBackdrop><p>내용</p></Dialog>)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('카드(내부) 클릭은 onClose를 호출하지 않는다', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose}><p>내용</p></Dialog>)
    fireEvent.click(screen.getByText('내용'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closeOnBackdrop=false면 백드롭 클릭을 무시한다', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose} closeOnBackdrop={false}><p>내용</p></Dialog>)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Esc 키 입력 시 onClose 호출', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose}><p>내용</p></Dialog>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('언마운트 후 body overflow를 복원한다', () => {
    const { unmount } = render(<Dialog onClose={() => {}}><p>내용</p></Dialog>)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
