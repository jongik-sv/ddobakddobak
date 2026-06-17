import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useProjectStore } from '../stores/projectStore'
import type { Project } from '../api/projects'
import ProjectSelectLanding from './ProjectSelectLanding'

// fetchProjects는 네트워크 → api 목. 각 테스트가 mockResolvedValue로 목록 주입.
const { mockGetProjects } = vi.hoisted(() => ({ mockGetProjects: vi.fn() }))
vi.mock('../api/projects', () => ({
  getProjects: mockGetProjects,
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  projectDisplayName: (p: { name: string; personal: boolean; owner: string | null }) =>
    p.personal ? `${p.owner ?? '알 수 없음'}의 회의` : p.name,
}))
// 진입 시 폴더/회의 store는 네트워크 호출 → 목으로 차단.
vi.mock('../stores/folderStore', () => ({
  useFolderStore: { getState: () => ({ setSelectedFolder: vi.fn(), fetchFolders: vi.fn() }) },
}))
vi.mock('../stores/meetingStore', () => ({
  useMeetingStore: { getState: () => ({ setFolderId: vi.fn(), fetchMeetings: vi.fn() }) },
}))
// ProjectDialog 내부(IconPicker 등) 분리 — onSaved 트리거만 검증.
vi.mock('../components/project/ProjectDialog', () => ({
  default: ({ onSaved }: { onSaved?: (p: unknown) => void }) => (
    <button onClick={() => onSaved?.({ id: 99 })}>DIALOG_SAVE</button>
  ),
}))

function makeProject(o: Partial<Project> = {}): Project {
  return {
    id: 1, name: 'P', description: null, icon_type: null, icon_value: null,
    color: null, personal: false, role: 'admin', member_count: 1, meeting_count: 0, owner: null, ...o,
  }
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ProjectSelectLanding />} />
        <Route path="/meetings" element={<div>MEETINGS_SENTINEL</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProjectSelectLanding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.getState().reset()
    localStorage.clear()
  })

  it('선택 이력(localStorage) 있으면 /meetings로 리다이렉트', () => {
    localStorage.setItem('current_project_id', '5')
    renderLanding()
    expect(screen.getByText('MEETINGS_SENTINEL')).toBeInTheDocument()
  })

  it('이력 없으면 프로젝트 목록 렌더(리다이렉트 안 함)', async () => {
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 9, name: '기본', personal: false }),
      makeProject({ id: 3, name: '개인', personal: true }),
    ])
    renderLanding()
    expect(await screen.findAllByText('기본')).not.toHaveLength(0)
    expect(screen.queryByText('MEETINGS_SENTINEL')).not.toBeInTheDocument()
  })

  it('비개인 프로젝트가 디폴트 강조(aria-current)', async () => {
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 3, name: '개인', personal: true }),
      makeProject({ id: 9, name: '기본', personal: false }),
    ])
    renderLanding()
    await screen.findAllByText('기본')
    const highlighted = document.querySelector('[aria-current="true"]')
    expect(highlighted?.textContent).toContain('기본')
  })

  it('프로젝트 클릭 시 setCurrentProject + /meetings 이동', async () => {
    // 비개인(id9)이 fallback 디폴트 → 개인(id3)을 클릭해 "클릭이 선택을 바꿨음"을 입증.
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 9, name: '기본', personal: false }),
      makeProject({ id: 3, name: '개인', personal: true, owner: '홍길동' }),
    ])
    renderLanding()
    const items = await screen.findAllByText('홍길동의 회의')
    fireEvent.click(items[0])
    expect(useProjectStore.getState().currentProjectId).toBe(3)
    expect(screen.getByText('MEETINGS_SENTINEL')).toBeInTheDocument()
  })

  it('새 프로젝트 생성 후 /meetings 진입', async () => {
    mockGetProjects.mockResolvedValue([])
    renderLanding()
    const addBtns = await screen.findAllByText(/새 프로젝트/)
    fireEvent.click(addBtns[0])
    fireEvent.click(screen.getByText('DIALOG_SAVE'))
    expect(screen.getByText('MEETINGS_SENTINEL')).toBeInTheDocument()
  })

  it('비멤버(role=null) 프로젝트는 목록에서 제외하고 멤버 비개인을 강조', async () => {
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 1, name: '더미', personal: false, role: null }),
      makeProject({ id: 6, name: '기본', personal: false, role: 'admin' }),
      makeProject({ id: 9, name: '내회의', personal: true, role: 'admin' }),
    ])
    renderLanding()
    await screen.findAllByText('기본')
    expect(screen.queryByText('더미')).not.toBeInTheDocument()
    const highlighted = document.querySelector('[aria-current="true"]')
    expect(highlighted?.textContent).toContain('기본')
  })
})
