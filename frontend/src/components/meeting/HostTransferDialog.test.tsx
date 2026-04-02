import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { HostTransferDialog } from './HostTransferDialog'

// ── Mocks ──

const mockTransferHost = vi.fn()

vi.mock('../../api/meetings', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/meetings')>()
  return {
    ...original,
    transferHost: (...args: unknown[]) => mockTransferHost(...args),
  }
})

describe('HostTransferDialog', () => {
  const defaultProps = {
    open: true,
    targetUserName: '김철수',
    targetUserId: 20,
    meetingId: 1,
    onClose: vi.fn(),
    onTransferred: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('open=true일 때 다이얼로그 렌더링', () => {
    render(<HostTransferDialog {...defaultProps} />)
    expect(screen.getByText('호스트 위임')).toBeInTheDocument()
    expect(screen.getByText(/김철수/)).toBeInTheDocument()
  })

  it('open=false일 때 렌더링 안 함', () => {
    render(<HostTransferDialog {...defaultProps} open={false} />)
    expect(screen.queryByText('호스트 위임')).not.toBeInTheDocument()
  })

  it('대상 사용자 이름 표시', () => {
    render(<HostTransferDialog {...defaultProps} />)
    expect(screen.getByText(/김철수에게 호스트를/)).toBeInTheDocument()
  })

  it('취소 버튼 클릭 시 onClose 호출', () => {
    render(<HostTransferDialog {...defaultProps} />)
    fireEvent.click(screen.getByText('취소'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('위임하기 클릭 시 transferHost API 호출', async () => {
    mockTransferHost.mockResolvedValue([
      { id: 1, user_id: 10, user_name: '홍길동', role: 'viewer', joined_at: '2026-04-02T10:00:00Z' },
      { id: 2, user_id: 20, user_name: '김철수', role: 'host', joined_at: '2026-04-02T10:01:00Z' },
    ])

    render(<HostTransferDialog {...defaultProps} />)
    await act(async () => {
      fireEvent.click(screen.getByText('위임하기'))
    })

    expect(mockTransferHost).toHaveBeenCalledWith(1, 20)
  })

  it('API 호출 성공 시 onTransferred 콜백 호출', async () => {
    mockTransferHost.mockResolvedValue([
      { id: 1, user_id: 10, user_name: '홍길동', role: 'viewer', joined_at: '2026-04-02T10:00:00Z' },
      { id: 2, user_id: 20, user_name: '김철수', role: 'host', joined_at: '2026-04-02T10:01:00Z' },
    ])

    render(<HostTransferDialog {...defaultProps} />)
    await act(async () => {
      fireEvent.click(screen.getByText('위임하기'))
    })

    expect(defaultProps.onTransferred).toHaveBeenCalled()
  })

  it('API 호출 중 버튼 비활성화 + "위임 중..." 텍스트', async () => {
    let resolveTransfer: (value: unknown) => void
    mockTransferHost.mockReturnValue(
      new Promise((resolve) => { resolveTransfer = resolve })
    )

    render(<HostTransferDialog {...defaultProps} />)
    await act(async () => {
      fireEvent.click(screen.getByText('위임하기'))
    })

    // 로딩 중 상태
    expect(screen.getByText('위임 중...')).toBeInTheDocument()
    const button = screen.getByText('위임 중...')
    expect(button).toBeDisabled()

    // 해소
    await act(async () => {
      resolveTransfer!([])
    })
  })

  it('호스트 위임 안내 문구 표시', () => {
    render(<HostTransferDialog {...defaultProps} />)
    expect(screen.getByText(/호스트를 넘기면 녹음 컨트롤/)).toBeInTheDocument()
  })
})
