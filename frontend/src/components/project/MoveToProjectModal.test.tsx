import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MoveToProjectModal from './MoveToProjectModal'
import { useProjectStore } from '../../stores/projectStore'
import { useAuthStore } from '../../stores/authStore'

const moveMeetings = vi.fn((..._args: unknown[]) => Promise.resolve({ moved: 1 }))
vi.mock('../../api/meetings', () => ({ moveMeetingsToProject: (...a: unknown[]) => moveMeetings(...a) }))
vi.mock('../../api/folders', () => ({ moveFolderToProject: vi.fn(() => Promise.resolve({ moved_folders: 1, moved_meetings: 0 })) }))

function seed(projects: unknown[], role: 'admin' | 'member' = 'member') {
  useProjectStore.setState({ projects } as never)
  useAuthStore.setState({ user: { id: 1, email: 'a@b.c', name: 'A', role } } as never)
}

const P = (over: Record<string, unknown>) => ({
  id: 1, name: 'P', personal: false, role: 'member', owner: null, meeting_count: 3,
  icon_type: null, icon_value: null, color: null, ...over,
})

describe('MoveToProjectModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('원본 프로젝트와 클러터는 후보에서 제외, 멤버만 노출', () => {
    seed([
      P({ id: 1, name: '원본' }),
      P({ id: 2, name: '대상B' }),
      P({ id: 3, name: '비멤버', role: null }),
      P({ id: 4, name: '빈개인', personal: true, role: null, meeting_count: 0 }),
    ])
    render(<MoveToProjectModal mode="meetings" meetingIds={[10]} sourceProjectId={1} title="회의X" onClose={() => {}} onMoved={() => {}} />)
    expect(screen.queryByText('원본')).toBeNull()
    expect(screen.getByText('대상B')).toBeInTheDocument()
    expect(screen.queryByText('비멤버')).toBeNull()
    expect(screen.queryByText('빈개인')).toBeNull()
  })

  it('시스템 admin은 비멤버 프로젝트도 후보에 포함', () => {
    seed([P({ id: 1, name: '원본' }), P({ id: 3, name: '비멤버', role: null })], 'admin')
    render(<MoveToProjectModal mode="meetings" meetingIds={[10]} sourceProjectId={1} title="회의X" onClose={() => {}} onMoved={() => {}} />)
    expect(screen.getByText('비멤버')).toBeInTheDocument()
  })

  it('대상 선택 후 이동 → moveMeetingsToProject 호출 + onMoved', async () => {
    const onMoved = vi.fn()
    seed([P({ id: 1, name: '원본' }), P({ id: 2, name: '대상B' })])
    render(<MoveToProjectModal mode="meetings" meetingIds={[10]} sourceProjectId={1} title="회의X" onClose={() => {}} onMoved={onMoved} />)
    fireEvent.click(screen.getByText('대상B'))
    fireEvent.click(screen.getByRole('button', { name: '이동' }))
    await waitFor(() => expect(moveMeetings).toHaveBeenCalledWith([10], 2))
    await waitFor(() => expect(onMoved).toHaveBeenCalled())
  })
})
