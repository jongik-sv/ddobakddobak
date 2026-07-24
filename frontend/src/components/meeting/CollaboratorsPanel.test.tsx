import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CollaboratorsPanel from './CollaboratorsPanel'

const direct = [{ user_id: 2, name: '김철수', email: 'kim@x.com' }]
const inherited = [{ user_id: 3, name: '박영희', email: 'park@x.com', folder_id: 9, folder_name: '기획팀' }]
const projectMembers = [
  { user_id: 2, name: '김철수', email: 'kim@x.com', role: 'member' as const },
  { user_id: 4, name: '이민수', email: 'lee@x.com', role: 'member' as const },
]

const mockGetMeetingCollaborators = vi.fn(async (_meetingId: number) => ({ direct, inherited }))
const mockAddMeetingCollaborator = vi.fn(async (_meetingId: number, _userId: number) => ({ user_id: 4, name: '이민수', email: 'lee@x.com' }))
const mockRemoveMeetingCollaborator = vi.fn(async (_meetingId: number, _userId: number) => {})
const mockGetProjectMembers = vi.fn(async (_projectId: number) => projectMembers)

const mockGetFolderCollaborators = vi.fn(async (_folderId: number) => ({ direct: [] as typeof direct, inherited: [] as typeof inherited }))
const mockAddFolderCollaborator = vi.fn(async (_folderId: number, _userId: number) => ({ user_id: 4, name: '이민수', email: 'lee@x.com' }))
const mockRemoveFolderCollaborator = vi.fn(async (_folderId: number, _userId: number) => {})

vi.mock('../../api/meetings', () => ({
  getMeetingCollaborators: (...args: [number]) => mockGetMeetingCollaborators(...args),
  addMeetingCollaborator: (...args: [number, number]) => mockAddMeetingCollaborator(...args),
  removeMeetingCollaborator: (...args: [number, number]) => mockRemoveMeetingCollaborator(...args),
}))

vi.mock('../../api/folders', () => ({
  getFolderCollaborators: (...args: [number]) => mockGetFolderCollaborators(...args),
  addFolderCollaborator: (...args: [number, number]) => mockAddFolderCollaborator(...args),
  removeFolderCollaborator: (...args: [number, number]) => mockRemoveFolderCollaborator(...args),
}))

vi.mock('../../api/projects', () => ({
  getProjectMembers: (...args: [number]) => mockGetProjectMembers(...args),
}))

describe('CollaboratorsPanel — meeting', () => {
  beforeEach(() => vi.clearAllMocks())

  it('직접 지정 협업자 목록을 표시한다', async () => {
    render(<CollaboratorsPanel ownerType="meeting" ownerId={1} projectId={5} canManage={true} />)
    await waitFor(() => expect(screen.getByText('김철수')).toBeInTheDocument())
  })

  it('상속된 협업자는 폴더 뱃지와 함께 표시한다', async () => {
    render(<CollaboratorsPanel ownerType="meeting" ownerId={1} projectId={5} canManage={true} />)
    await waitFor(() => expect(screen.getByText('박영희')).toBeInTheDocument())
    expect(screen.getByText(/기획팀/)).toBeInTheDocument()
  })

  it('canManage=false면 추가/제거 버튼이 없다', async () => {
    render(<CollaboratorsPanel ownerType="meeting" ownerId={1} projectId={5} canManage={false} />)
    await waitFor(() => expect(screen.getByText('김철수')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '추가' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('김철수 제거')).not.toBeInTheDocument()
  })

  it('이미 협업자인 멤버는 추가 셀렉트 옵션에서 제외된다', async () => {
    render(<CollaboratorsPanel ownerType="meeting" ownerId={1} projectId={5} canManage={true} />)
    await waitFor(() => expect(screen.getByText('김철수')).toBeInTheDocument())
    const select = screen.getByRole('combobox')
    expect(screen.queryByRole('option', { name: /김철수/ })).not.toBeInTheDocument()
    expect(within(select).getByRole('option', { name: /이민수/ })).toBeInTheDocument()
  })

  it('추가 버튼 클릭 시 addMeetingCollaborator를 호출하고 목록을 갱신한다', async () => {
    render(<CollaboratorsPanel ownerType="meeting" ownerId={1} projectId={5} canManage={true} />)
    await waitFor(() => expect(screen.getByText('김철수')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByRole('combobox'), '4')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(mockAddMeetingCollaborator).toHaveBeenCalledWith(1, 4))
    expect(mockGetMeetingCollaborators).toHaveBeenCalledTimes(2) // 최초 로드 + reload
  })

  it('제거 버튼 클릭 시 removeMeetingCollaborator를 호출한다', async () => {
    render(<CollaboratorsPanel ownerType="meeting" ownerId={1} projectId={5} canManage={true} />)
    await waitFor(() => expect(screen.getByText('김철수')).toBeInTheDocument())

    await userEvent.click(screen.getByLabelText('김철수 제거'))

    await waitFor(() => expect(mockRemoveMeetingCollaborator).toHaveBeenCalledWith(1, 2))
  })
})

describe('CollaboratorsPanel — folder', () => {
  beforeEach(() => vi.clearAllMocks())

  it('folder ownerType이면 getFolderCollaborators/getProjectMembers를 호출한다', async () => {
    render(<CollaboratorsPanel ownerType="folder" ownerId={9} projectId={5} canManage={true} />)
    await waitFor(() => expect(mockGetFolderCollaborators).toHaveBeenCalledWith(9))
    expect(mockGetMeetingCollaborators).not.toHaveBeenCalled()
  })
})
