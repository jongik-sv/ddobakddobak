import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatMarkdown, mermaidCodeFromNode } from './ChatMarkdown'

vi.mock('./ChatMermaid', () => ({
  ChatMermaid: ({ code }: { code: string }) => <div data-testid="chat-mermaid">{code}</div>,
}))

describe('ChatMarkdown citation', () => {
  it('renders marker as a clickable badge that seeks', () => {
    const onSeek = vi.fn()
    render(<ChatMarkdown content={'일정 확정. ⟦t:125000|s:화자 1⟧'} onSeek={onSeek} />)
    const badge = screen.getByText('02:05')
    fireEvent.click(badge.closest('button')!)
    expect(onSeek).toHaveBeenCalledWith(125000)
  })

  it('mm:ss 마커를 ms로 변환해 onSeek 호출한다', () => {
    const onSeek = vi.fn()
    render(<ChatMarkdown content={'일정 확정. ⟦t:30:47/s:화자 1⟧'} onSeek={onSeek} />)
    const badge = screen.getByText('30:47')
    fireEvent.click(badge.closest('button')!)
    expect(onSeek).toHaveBeenCalledWith(1847000)
  })

  it('회의ID 마커는 onSeekMeeting으로 라우팅되는 배지를 만든다', () => {
    const onSeekMeeting = vi.fn()
    render(<ChatMarkdown content={'결정. ⟦m:142/t:5000/s:화자 1⟧'} onSeekMeeting={onSeekMeeting} />)
    const badge = screen.getByRole('button')
    fireEvent.click(badge)
    expect(onSeekMeeting).toHaveBeenCalledWith(142, 5000)
  })
})

describe('mermaidCodeFromNode', () => {
  it('language-mermaid code 노드 → 코드 텍스트(끝 개행 제거)', () => {
    const node = {
      tagName: 'pre',
      children: [
        {
          tagName: 'code',
          properties: { className: ['language-mermaid'] },
          children: [{ type: 'text', value: 'graph TD\nA-->B\n' }],
        },
      ],
    }
    expect(mermaidCodeFromNode(node)).toBe('graph TD\nA-->B')
  })

  it('비 mermaid 코드 → null', () => {
    const node = {
      tagName: 'pre',
      children: [{ tagName: 'code', properties: { className: ['language-js'] }, children: [{ type: 'text', value: 'x' }] }],
    }
    expect(mermaidCodeFromNode(node)).toBeNull()
  })

  it('code 자식 없음 → null', () => {
    expect(mermaidCodeFromNode({ tagName: 'pre', children: [] })).toBeNull()
    expect(mermaidCodeFromNode(undefined)).toBeNull()
  })
})

describe('ChatMarkdown mermaid 분기', () => {
  it('```mermaid 펜스 → ChatMermaid 렌더', () => {
    render(<ChatMarkdown content={'```mermaid\ngraph TD\nA-->B\n```'} />)
    expect(screen.getByTestId('chat-mermaid')).toHaveTextContent('graph TD')
  })

  it('```js 펜스 → 기존 코드블록(pre), ChatMermaid 아님', () => {
    const { container } = render(<ChatMarkdown content={'```js\nconst x = 1\n```'} />)
    expect(screen.queryByTestId('chat-mermaid')).toBeNull()
    expect(container.querySelector('pre')).toBeTruthy()
  })
})
