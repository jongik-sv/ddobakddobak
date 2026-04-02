import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { JoinMeetingDialog } from './JoinMeetingDialog'

const mockJoinMeeting = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('../../api/meetings', () => ({
  joinMeeting: mockJoinMeeting,
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderDialog(props: { open: boolean; onClose: () => void }) {
  return render(
    <MemoryRouter>
      <JoinMeetingDialog {...props} />
    </MemoryRouter>,
  )
}

describe('JoinMeetingDialog', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('open=false 일 때 아무것도 렌더링하지 않는다', () => {
    renderDialog({ open: false, onClose })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('open=true 일 때 다이얼로그를 렌더링한다', () => {
    renderDialog({ open: true, onClose })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('회의 참여')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/공유 코드/i)).toBeInTheDocument()
  })

  it('공유 코드 입력 시 대문자로 자동 변환된다', async () => {
    const user = userEvent.setup()
    renderDialog({ open: true, onClose })
    const input = screen.getByPlaceholderText(/공유 코드/i)
    await user.type(input, 'abc123')
    expect(input).toHaveValue('ABC123')
  })

  it('공유 코드는 최대 6자로 제한된다', async () => {
    const user = userEvent.setup()
    renderDialog({ open: true, onClose })
    const input = screen.getByPlaceholderText(/공유 코드/i)
    await user.type(input, 'ABCDEFGH')
    expect(input).toHaveValue('ABCDEF')
  })

  it('참여 버튼 클릭 시 joinMeeting API를 호출한다', async () => {
    const user = userEvent.setup()
    mockJoinMeeting.mockResolvedValue({
      meeting: { id: 42, title: '테스트 회의' },
      participant: { id: 1, user_id: 10, user_name: '참여자', role: 'viewer', joined_at: '' },
    })
    renderDialog({ open: true, onClose })
    const input = screen.getByPlaceholderText(/공유 코드/i)
    await user.type(input, 'A1B2C3')
    await user.click(screen.getByRole('button', { name: '참여' }))
    expect(mockJoinMeeting).toHaveBeenCalledWith('A1B2C3')
  })

  it('참여 성공 시 뷰어 페이지로 이동하고 다이얼로그를 닫는다', async () => {
    const user = userEvent.setup()
    mockJoinMeeting.mockResolvedValue({
      meeting: { id: 42, title: '테스트 회의' },
      participant: { id: 1, user_id: 10, user_name: '참여자', role: 'viewer', joined_at: '' },
    })
    renderDialog({ open: true, onClose })
    const input = screen.getByPlaceholderText(/공유 코드/i)
    await user.type(input, 'A1B2C3')
    await user.click(screen.getByRole('button', { name: '참여' }))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/meetings/42/viewer')
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('참여 실패 시 에러 메시지를 표시한다', async () => {
    const user = userEvent.setup()
    mockJoinMeeting.mockRejectedValue(new Error('유효하지 않은 코드입니다'))
    renderDialog({ open: true, onClose })
    const input = screen.getByPlaceholderText(/공유 코드/i)
    await user.type(input, 'XXXXXX')
    await user.click(screen.getByRole('button', { name: '참여' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('취소 버튼 클릭 시 onClose를 호출한다', async () => {
    const user = userEvent.setup()
    renderDialog({ open: true, onClose })
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('공유 코드가 비어있으면 참여 버튼이 비활성화된다', () => {
    renderDialog({ open: true, onClose })
    expect(screen.getByRole('button', { name: '참여' })).toBeDisabled()
  })
})
