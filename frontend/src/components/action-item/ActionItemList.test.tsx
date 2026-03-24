import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ActionItemList } from './ActionItemList'
import * as actionItemsApi from '../../api/actionItems'

vi.mock('../../api/actionItems')

const mockItems: actionItemsApi.ActionItem[] = [
  {
    id: 1,
    content: '첫 번째 할 일',
    status: 'todo',
    due_date: null,
    ai_generated: false,
    assignee: null,
    created_at: '2026-03-25T00:00:00Z',
  },
  {
    id: 2,
    content: 'AI가 생성한 할 일',
    status: 'in_progress',
    due_date: '2026-04-01',
    ai_generated: true,
    assignee: { id: 10, name: '홍길동' },
    created_at: '2026-03-25T01:00:00Z',
  },
]

const teamMembers = [
  { id: 10, name: '홍길동' },
  { id: 11, name: '김철수' },
]

describe('ActionItemList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('로딩 상태 표시', async () => {
    vi.mocked(actionItemsApi.getActionItems).mockReturnValue(new Promise(() => {}))
    render(<ActionItemList meetingId={1} teamMembers={teamMembers} />)
    expect(screen.getByText('로딩 중...')).toBeInTheDocument()
  })

  it('action items 목록 렌더링', async () => {
    vi.mocked(actionItemsApi.getActionItems).mockResolvedValue(mockItems)
    render(<ActionItemList meetingId={1} teamMembers={teamMembers} />)

    await waitFor(() => {
      expect(screen.getByText('첫 번째 할 일')).toBeInTheDocument()
      expect(screen.getByText('AI가 생성한 할 일')).toBeInTheDocument()
    })
  })

  it('ai_generated 뱃지 표시', async () => {
    vi.mocked(actionItemsApi.getActionItems).mockResolvedValue(mockItems)
    render(<ActionItemList meetingId={1} teamMembers={teamMembers} />)

    await waitFor(() => {
      expect(screen.getByText('AI')).toBeInTheDocument()
    })
  })

  it('빈 목록 처리', async () => {
    vi.mocked(actionItemsApi.getActionItems).mockResolvedValue([])
    render(<ActionItemList meetingId={1} teamMembers={teamMembers} />)

    await waitFor(() => {
      expect(screen.getByText('Action Item이 없습니다')).toBeInTheDocument()
    })
  })

  it('체크박스 토글 시 updateActionItem 호출', async () => {
    vi.mocked(actionItemsApi.getActionItems).mockResolvedValue(mockItems)
    vi.mocked(actionItemsApi.updateActionItem).mockResolvedValue({
      ...mockItems[0],
      status: 'done',
    })

    render(<ActionItemList meetingId={1} teamMembers={teamMembers} />)

    await waitFor(() => {
      expect(screen.getByText('첫 번째 할 일')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])

    await waitFor(() => {
      expect(actionItemsApi.updateActionItem).toHaveBeenCalledWith(1, { status: 'done' })
    })
  })

  it('완료 상태 아이템 체크박스 토글 시 todo로 변경', async () => {
    const doneItem = { ...mockItems[0], status: 'done' as const }
    vi.mocked(actionItemsApi.getActionItems).mockResolvedValue([doneItem])
    vi.mocked(actionItemsApi.updateActionItem).mockResolvedValue({
      ...doneItem,
      status: 'todo',
    })

    render(<ActionItemList meetingId={1} teamMembers={teamMembers} />)

    await waitFor(() => {
      expect(screen.getByText('첫 번째 할 일')).toBeInTheDocument()
    })

    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(actionItemsApi.updateActionItem).toHaveBeenCalledWith(1, { status: 'todo' })
    })
  })

  it('삭제 버튼 클릭 시 deleteActionItem 호출', async () => {
    vi.mocked(actionItemsApi.getActionItems).mockResolvedValue([mockItems[0]])
    vi.mocked(actionItemsApi.deleteActionItem).mockResolvedValue(undefined)

    render(<ActionItemList meetingId={1} teamMembers={teamMembers} />)

    await waitFor(() => {
      expect(screen.getByText('첫 번째 할 일')).toBeInTheDocument()
    })

    const deleteButton = screen.getByRole('button', { name: '삭제' })
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(actionItemsApi.deleteActionItem).toHaveBeenCalledWith(1)
    })
  })

  it('삭제 후 목록에서 제거', async () => {
    vi.mocked(actionItemsApi.getActionItems).mockResolvedValue([mockItems[0]])
    vi.mocked(actionItemsApi.deleteActionItem).mockResolvedValue(undefined)

    render(<ActionItemList meetingId={1} teamMembers={teamMembers} />)

    await waitFor(() => {
      expect(screen.getByText('첫 번째 할 일')).toBeInTheDocument()
    })

    const deleteButton = screen.getByRole('button', { name: '삭제' })
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(screen.queryByText('첫 번째 할 일')).not.toBeInTheDocument()
    })
  })
})
