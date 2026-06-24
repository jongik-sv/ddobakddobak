import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatMermaid } from './ChatMermaid'

// MermaidRenderer는 mermaid/DOM 의존이 커서 모킹 — code를 노출하는 더미로 대체
vi.mock('./mermaidBlock', () => ({
  MermaidRenderer: ({ code }: { code: string }) => <div data-testid="mr">{code}</div>,
}))

describe('ChatMermaid', () => {
  it('다이어그램 렌더 + 클릭 시 확대 모달 open/close', () => {
    render(<ChatMermaid code="graph TD; A-->B" />)
    // 인라인 1개
    expect(screen.getAllByTestId('mr')).toHaveLength(1)
    // 클릭 → 모달(2번째 인스턴스 + 닫기 버튼)
    fireEvent.click(screen.getByRole('button', { name: '다이어그램 확대' }))
    expect(screen.getAllByTestId('mr')).toHaveLength(2)
    const closeBtn = screen.getByRole('button', { name: /닫기/ })
    fireEvent.click(closeBtn)
    expect(screen.getAllByTestId('mr')).toHaveLength(1)
  })

  it('Enter 키로도 모달 open', () => {
    render(<ChatMermaid code="graph TD; A-->B" />)
    fireEvent.keyDown(screen.getByRole('button', { name: '다이어그램 확대' }), { key: 'Enter' })
    expect(screen.getAllByTestId('mr')).toHaveLength(2)
  })

  it('Space 키로도 모달 open', () => {
    render(<ChatMermaid code="graph TD; A-->B" />)
    fireEvent.keyDown(screen.getByRole('button', { name: '다이어그램 확대' }), { key: ' ' })
    expect(screen.getAllByTestId('mr')).toHaveLength(2)
  })

  it('확대 모달 줌 +/−/리셋 컨트롤', () => {
    render(<ChatMermaid code="graph TD; A-->B" />)
    fireEvent.click(screen.getByRole('button', { name: '다이어그램 확대' }))
    expect(screen.getByText('150%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '확대' }))
    expect(screen.getByText('175%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '축소' }))
    fireEvent.click(screen.getByRole('button', { name: '축소' }))
    expect(screen.getByText('125%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '원래대로' }))
    expect(screen.getByText('150%')).toBeInTheDocument()
  })
})
