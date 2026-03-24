import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ActionItemForm } from './ActionItemForm'
import * as actionItemsApi from '../../api/actionItems'

vi.mock('../../api/actionItems')

const teamMembers = [
  { id: 10, name: '홍길동' },
  { id: 11, name: '김철수' },
]

const mockCreatedItem: actionItemsApi.ActionItem = {
  id: 99,
  content: '새 할 일',
  status: 'todo',
  due_date: null,
  ai_generated: false,
  assignee: null,
  created_at: '2026-03-25T00:00:00Z',
}

describe('ActionItemForm', () => {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('폼 렌더링 (content textarea, 담당자 select, 마감일 input)', () => {
    render(
      <ActionItemForm
        meetingId={1}
        teamMembers={teamMembers}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    expect(screen.getByPlaceholderText('할 일을 입력하세요')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByLabelText('마감일')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '추가' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument()
  })

  it('content 입력 후 submit 시 createActionItem 호출', async () => {
    vi.mocked(actionItemsApi.createActionItem).mockResolvedValue(mockCreatedItem)

    render(
      <ActionItemForm
        meetingId={1}
        teamMembers={teamMembers}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('할 일을 입력하세요'), {
      target: { value: '새 할 일' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => {
      expect(actionItemsApi.createActionItem).toHaveBeenCalledWith(1, {
        content: '새 할 일',
        assignee_id: null,
        due_date: null,
      })
    })
  })

  it('submit 성공 시 onSubmit 콜백 호출', async () => {
    vi.mocked(actionItemsApi.createActionItem).mockResolvedValue(mockCreatedItem)

    render(
      <ActionItemForm
        meetingId={1}
        teamMembers={teamMembers}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('할 일을 입력하세요'), {
      target: { value: '새 할 일' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(mockCreatedItem)
    })
  })

  it('담당자 선택', async () => {
    vi.mocked(actionItemsApi.createActionItem).mockResolvedValue(mockCreatedItem)

    render(
      <ActionItemForm
        meetingId={1}
        teamMembers={teamMembers}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '10' } })
    fireEvent.change(screen.getByPlaceholderText('할 일을 입력하세요'), {
      target: { value: '담당자 있는 할 일' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => {
      expect(actionItemsApi.createActionItem).toHaveBeenCalledWith(1, {
        content: '담당자 있는 할 일',
        assignee_id: 10,
        due_date: null,
      })
    })
  })

  it('마감일 입력', async () => {
    vi.mocked(actionItemsApi.createActionItem).mockResolvedValue(mockCreatedItem)

    render(
      <ActionItemForm
        meetingId={1}
        teamMembers={teamMembers}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('할 일을 입력하세요'), {
      target: { value: '마감일 있는 할 일' },
    })
    fireEvent.change(screen.getByLabelText('마감일'), { target: { value: '2026-04-01' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => {
      expect(actionItemsApi.createActionItem).toHaveBeenCalledWith(1, {
        content: '마감일 있는 할 일',
        assignee_id: null,
        due_date: '2026-04-01',
      })
    })
  })

  it('취소 버튼 클릭 시 onCancel 콜백 호출', () => {
    render(
      <ActionItemForm
        meetingId={1}
        teamMembers={teamMembers}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('content 빈값 submit 시 에러 메시지 표시', async () => {
    render(
      <ActionItemForm
        meetingId={1}
        teamMembers={teamMembers}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => {
      expect(screen.getByText('할 일 내용을 입력해주세요')).toBeInTheDocument()
    })
    expect(actionItemsApi.createActionItem).not.toHaveBeenCalled()
  })

  it('수정 모드: initialValues가 있으면 폼 필드에 기존 값 표시', () => {
    const initialValues: Partial<actionItemsApi.ActionItem> = {
      id: 5,
      content: '기존 할 일',
      due_date: '2026-04-15',
      assignee: { id: 10, name: '홍길동' },
      status: 'in_progress',
    }

    render(
      <ActionItemForm
        meetingId={1}
        teamMembers={teamMembers}
        initialValues={initialValues}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    const textarea = screen.getByPlaceholderText('할 일을 입력하세요') as HTMLTextAreaElement
    expect(textarea.value).toBe('기존 할 일')

    const dateInput = screen.getByLabelText('마감일') as HTMLInputElement
    expect(dateInput.value).toBe('2026-04-15')

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('10')
  })

  it('수정 모드: submit 시 updateActionItem 호출', async () => {
    const initialValues: Partial<actionItemsApi.ActionItem> = {
      id: 5,
      content: '기존 할 일',
      due_date: null,
      assignee: null,
      status: 'todo',
    }
    const updatedItem: actionItemsApi.ActionItem = {
      id: 5,
      content: '수정된 할 일',
      status: 'todo',
      due_date: null,
      ai_generated: false,
      assignee: null,
      created_at: '2026-03-25T00:00:00Z',
    }
    vi.mocked(actionItemsApi.updateActionItem).mockResolvedValue(updatedItem)

    render(
      <ActionItemForm
        meetingId={1}
        teamMembers={teamMembers}
        initialValues={initialValues}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('할 일을 입력하세요'), {
      target: { value: '수정된 할 일' },
    })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(actionItemsApi.updateActionItem).toHaveBeenCalledWith(5, {
        content: '수정된 할 일',
        assignee_id: null,
        due_date: null,
      })
    })
  })
})
