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

// ── Mock uiStore ──
// 드로어는 이제 uiStore에서 open/scope를 읽는다(App.tsx 글로벌 마운트 — idea.md #35 2단계).
const mockCloseFolderChat = vi.fn()
let mockFolderChatOpen = true
let mockFolderChatScope: { folderId: number | null; projectId: number | null; folderName?: string } | null = null
let mockFolderChatWidth = 672

vi.mock('../../stores/uiStore', () => ({
  useUiStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      folderChatOpen: mockFolderChatOpen,
      folderChatScope: mockFolderChatScope,
      folderChatWidth: mockFolderChatWidth,
      closeFolderChat: mockCloseFolderChat,
      setFolderChatWidth: vi.fn(),
    }),
  // 드래그 핸들러가 런타임에 읽는 최신 폭(snap).
}))

beforeEach(() => {
  getUserLlmSettings.mockReset()
  getUserLlmSettings.mockResolvedValue({
    llm_settings: { effective_chat_model: 'Claude Haiku 4' },
    server_default: {},
  })
  mockFolderChatOpen = true
  mockFolderChatScope = { folderId: 7, projectId: 3 }
  mockFolderChatWidth = 672
  mockCloseFolderChat.mockClear()
})

describe('FolderChatDrawer', () => {
  it('열리면 폴더 scope로 패널을 렌더한다', () => {
    render(<MemoryRouter><FolderChatDrawer /></MemoryRouter>)
    expect(screen.getByTestId('panel').textContent).toBe('folder:7')
  })

  it('스코프를 프로젝트 전체로 토글한다', () => {
    render(<MemoryRouter><FolderChatDrawer /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /프로젝트 전체/ }))
    expect(screen.getByTestId('panel').textContent).toBe('project:3')
  })

  it('open=false면 렌더하지 않는다', () => {
    mockFolderChatOpen = false
    render(<MemoryRouter><FolderChatDrawer /></MemoryRouter>)
    expect(screen.queryByTestId('panel')).toBeNull()
    expect(getUserLlmSettings).not.toHaveBeenCalled()
  })

  it('열리면 사용 모델명을 헤더에 미리보기로 표시한다', async () => {
    render(<MemoryRouter><FolderChatDrawer /></MemoryRouter>)
    expect(getUserLlmSettings).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Claude Haiku 4/)).toBeInTheDocument()
  })

  it('모델 fetch가 실패해도 패널은 정상 렌더한다', async () => {
    getUserLlmSettings.mockRejectedValueOnce(new Error('boom'))
    render(<MemoryRouter><FolderChatDrawer /></MemoryRouter>)
    expect(screen.getByTestId('panel').textContent).toBe('folder:7')
    await waitFor(() => expect(getUserLlmSettings).toHaveBeenCalled())
  })

  // 모바일(matchMedia matches:false=lg 미만)에서는 설정 모달처럼 전체화면 컨테이너.
  it('모바일에서는 전체화면 컨테이너로 렌더한다', () => {
    const { container } = render(<MemoryRouter><FolderChatDrawer /></MemoryRouter>)
    expect(container.querySelector('.h-dvh')).not.toBeNull()
  })

  // 회귀: 마운트 시 projectId만 있어 scope='project'로 굳은 뒤, 프로젝트 없이 폴더만
  // 선택되면(projectId=null) stale scope로 빈 드로어가 뜨던 버그. 폴더로 폴백해야 함.
  it('마운트 후 프로젝트→폴더만으로 바뀌어도 패널을 렌더한다', () => {
    mockFolderChatScope = { folderId: null, projectId: 3 }
    const { rerender } = render(<MemoryRouter><FolderChatDrawer /></MemoryRouter>)
    expect(screen.getByTestId('panel').textContent).toBe('project:3')
    mockFolderChatScope = { folderId: 7, projectId: null }
    rerender(<MemoryRouter><FolderChatDrawer /></MemoryRouter>)
    expect(screen.getByTestId('panel').textContent).toBe('folder:7')
  })

  // 닫기 버튼(X)과 백드롭 클릭이 uiStore.closeFolderChat를 호출하는지.
  it('닫기 버튼 클릭 시 closeFolderChat를 호출한다', () => {
    render(<MemoryRouter><FolderChatDrawer /></MemoryRouter>)
    fireEvent.click(screen.getByLabelText('닫기'))
    expect(mockCloseFolderChat).toHaveBeenCalledTimes(1)
  })

  it('백드롭 클릭 시 closeFolderChat를 호출한다', () => {
    const { container } = render(<MemoryRouter><FolderChatDrawer /></MemoryRouter>)
    const backdrop = container.querySelector('.bg-black\\/20')!
    fireEvent.click(backdrop)
    expect(mockCloseFolderChat).toHaveBeenCalledTimes(1)
  })
})
