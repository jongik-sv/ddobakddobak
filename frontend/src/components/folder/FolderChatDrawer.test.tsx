import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FolderChatDrawer } from './FolderChatDrawer'

vi.mock('../meeting/AiChatPanel', () => ({
  AiChatPanel: ({ scopeType, scopeId }: { scopeType: string; scopeId: number }) => (
    <div data-testid="panel">{scopeType}:{scopeId}</div>
  ),
}))

describe('FolderChatDrawer', () => {
  const base = { open: true, onClose: vi.fn(), folderId: 7, projectId: 3 }

  it('열리면 폴더 scope로 패널을 렌더한다', () => {
    render(<MemoryRouter><FolderChatDrawer {...base} /></MemoryRouter>)
    expect(screen.getByTestId('panel').textContent).toBe('folder:7')
  })

  it('스코프를 프로젝트 전체로 토글한다', () => {
    render(<MemoryRouter><FolderChatDrawer {...base} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /프로젝트 전체/ }))
    expect(screen.getByTestId('panel').textContent).toBe('project:3')
  })

  it('open=false면 렌더하지 않는다', () => {
    render(<MemoryRouter><FolderChatDrawer {...base} open={false} /></MemoryRouter>)
    expect(screen.queryByTestId('panel')).toBeNull()
  })
})
