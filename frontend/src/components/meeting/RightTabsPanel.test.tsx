import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RightTabsPanel } from './RightTabsPanel'

// AiChatPanel은 실제 API(api/chat)를 호출하므로 이 파일에서는 얕게 mock한다.
vi.mock('./AiChatPanel', () => ({
  AiChatPanel: () => <div data-testid="ai-chat">AI 챗</div>,
}))

describe('RightTabsPanel — 패널 접기 버튼(PanelRightClose)', () => {
  it('onCollapse가 주어지면 탭 헤더 우측에 "패널 접기" 버튼이 표시되고 클릭 시 호출된다', () => {
    const onCollapse = vi.fn()
    render(
      <RightTabsPanel meetingId={1} memo={<div>메모</div>} onCollapse={onCollapse} />
    )
    const collapseButton = screen.getByRole('button', { name: '패널 접기' })
    expect(collapseButton).toBeInTheDocument()
    fireEvent.click(collapseButton)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('onCollapse가 없으면(예: LivePage 등 미배선 소비처) 접기 버튼을 렌더하지 않는다', () => {
    render(<RightTabsPanel meetingId={1} memo={<div>메모</div>} />)
    expect(screen.queryByRole('button', { name: '패널 접기' })).not.toBeInTheDocument()
  })
})
