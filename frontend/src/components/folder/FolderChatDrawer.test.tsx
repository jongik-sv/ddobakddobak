import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FolderChatDrawer } from './FolderChatDrawer'

vi.mock('../meeting/AiChatPanel', () => ({
  AiChatPanel: ({ scopeType, scopeId }: { scopeType: string; scopeId: number }) => (
    <div data-testid="panel">{scopeType}:{scopeId}</div>
  ),
}))

const getUserLlmSettings = vi.fn()
vi.mock('../../api/userLlmSettings', () => ({
  getUserLlmSettings: () => getUserLlmSettings(),
}))

beforeEach(() => {
  getUserLlmSettings.mockReset()
  getUserLlmSettings.mockResolvedValue({
    llm_settings: { effective_chat_model: 'Claude Haiku 4' },
    server_default: {},
  })
})

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
    expect(getUserLlmSettings).not.toHaveBeenCalled()
  })

  it('열리면 사용 모델명을 헤더에 미리보기로 표시한다', async () => {
    render(<MemoryRouter><FolderChatDrawer {...base} /></MemoryRouter>)
    expect(getUserLlmSettings).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Claude Haiku 4/)).toBeInTheDocument()
  })

  it('모델 fetch가 실패해도 패널은 정상 렌더한다', async () => {
    getUserLlmSettings.mockRejectedValueOnce(new Error('boom'))
    render(<MemoryRouter><FolderChatDrawer {...base} /></MemoryRouter>)
    expect(screen.getByTestId('panel').textContent).toBe('folder:7')
    await waitFor(() => expect(getUserLlmSettings).toHaveBeenCalled())
  })

  // 모바일(matchMedia matches:false=lg 미만)에서는 설정 모달처럼 전체화면 컨테이너.
  it('모바일에서는 전체화면 컨테이너로 렌더한다', () => {
    const { container } = render(<MemoryRouter><FolderChatDrawer {...base} /></MemoryRouter>)
    expect(container.querySelector('.h-dvh')).not.toBeNull()
  })

  // 회귀: 마운트 시 projectId만 있어 scope='project'로 굳은 뒤, 프로젝트 없이 폴더만
  // 선택되면(projectId=null) stale scope로 빈 드로어가 뜨던 버그. 폴더로 폴백해야 함.
  it('마운트 후 프로젝트→폴더만으로 바뀌어도 패널을 렌더한다', () => {
    const { rerender } = render(
      <MemoryRouter><FolderChatDrawer open onClose={vi.fn()} folderId={null} projectId={3} /></MemoryRouter>,
    )
    expect(screen.getByTestId('panel').textContent).toBe('project:3')
    rerender(
      <MemoryRouter><FolderChatDrawer open onClose={vi.fn()} folderId={7} projectId={null} /></MemoryRouter>,
    )
    expect(screen.getByTestId('panel').textContent).toBe('folder:7')
  })
})
