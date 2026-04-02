import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { ShareButton } from './ShareButton'
import { useSharingStore } from '../../stores/sharingStore'

// ── Mocks ──

const mockShareMeeting = vi.fn()
const mockStopSharing = vi.fn()

vi.mock('../../api/meetings', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/meetings')>()
  return {
    ...original,
    shareMeeting: (...args: unknown[]) => mockShareMeeting(...args),
    stopSharing: (...args: unknown[]) => mockStopSharing(...args),
  }
})

describe('ShareButton', () => {
  const writeTextMock = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    useSharingStore.getState().reset()
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('미공유 시 "공유" 버튼 렌더링', () => {
    render(<ShareButton meetingId={1} />)
    expect(screen.getByText('공유')).toBeInTheDocument()
  })

  it('공유 클릭 시 shareMeeting API 호출', async () => {
    mockShareMeeting.mockResolvedValue({
      share_code: 'ABC123',
      participants: [{ id: 1, user_id: 10, user_name: '홍길동', role: 'host', joined_at: '2026-04-02T10:00:00Z' }],
    })

    render(<ShareButton meetingId={42} />)
    await act(async () => {
      fireEvent.click(screen.getByText('공유'))
    })

    expect(mockShareMeeting).toHaveBeenCalledWith(42)
  })

  it('공유 시작 후 공유 코드 표시', async () => {
    mockShareMeeting.mockResolvedValue({
      share_code: 'A1B2C3',
      participants: [{ id: 1, user_id: 10, user_name: '홍길동', role: 'host', joined_at: '2026-04-02T10:00:00Z' }],
    })

    render(<ShareButton meetingId={1} />)
    await act(async () => {
      fireEvent.click(screen.getByText('공유'))
    })

    expect(screen.getByText('A1B2C3')).toBeInTheDocument()
  })

  it('공유 중 상태에서 공유 코드 표시', () => {
    useSharingStore.getState().startSharing('XYZ789', [
      { id: 1, user_id: 10, user_name: '홍길동', role: 'host', joined_at: '2026-04-02T10:00:00Z' },
    ])

    render(<ShareButton meetingId={1} />)
    expect(screen.getByText('XYZ789')).toBeInTheDocument()
  })

  it('복사 버튼 클릭 시 클립보드에 공유 코드 복사', async () => {
    useSharingStore.getState().startSharing('COPY01', [
      { id: 1, user_id: 10, user_name: '홍길동', role: 'host', joined_at: '2026-04-02T10:00:00Z' },
    ])

    render(<ShareButton meetingId={1} />)
    const copyButton = screen.getByTitle('공유 코드 복사')
    await act(async () => {
      fireEvent.click(copyButton)
    })

    expect(writeTextMock).toHaveBeenCalledWith('COPY01')
  })

  it('복사 후 2초간 "복사됨" 피드백 (체크 아이콘)', async () => {
    useSharingStore.getState().startSharing('COPY02', [
      { id: 1, user_id: 10, user_name: '홍길동', role: 'host', joined_at: '2026-04-02T10:00:00Z' },
    ])

    render(<ShareButton meetingId={1} />)
    const copyButton = screen.getByTitle('공유 코드 복사')
    await act(async () => {
      fireEvent.click(copyButton)
    })

    // 복사됨 상태
    expect(screen.getByTitle('복사됨')).toBeInTheDocument()

    // 2초 후 원래 상태로 복귀
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByTitle('공유 코드 복사')).toBeInTheDocument()
  })

  it('중지 클릭 시 stopSharing API 호출', async () => {
    mockStopSharing.mockResolvedValue(undefined)
    useSharingStore.getState().startSharing('STOP01', [
      { id: 1, user_id: 10, user_name: '홍길동', role: 'host', joined_at: '2026-04-02T10:00:00Z' },
    ])

    render(<ShareButton meetingId={42} />)
    await act(async () => {
      fireEvent.click(screen.getByTitle('공유 중지'))
    })

    expect(mockStopSharing).toHaveBeenCalledWith(42)
  })

  it('중지 후 미공유 상태로 복귀', async () => {
    mockStopSharing.mockResolvedValue(undefined)
    useSharingStore.getState().startSharing('STOP02', [
      { id: 1, user_id: 10, user_name: '홍길동', role: 'host', joined_at: '2026-04-02T10:00:00Z' },
    ])

    render(<ShareButton meetingId={1} />)
    await act(async () => {
      fireEvent.click(screen.getByTitle('공유 중지'))
    })

    expect(screen.getByText('공유')).toBeInTheDocument()
    expect(screen.queryByText('STOP02')).not.toBeInTheDocument()
  })

  it('API 호출 중 로딩 표시', async () => {
    let resolveShare: (value: unknown) => void
    mockShareMeeting.mockReturnValue(
      new Promise((resolve) => { resolveShare = resolve })
    )

    render(<ShareButton meetingId={1} />)
    await act(async () => {
      fireEvent.click(screen.getByText('공유'))
    })

    // 로딩 중에는 버튼 비활성화
    const button = screen.getByRole('button', { name: /공유/ })
    expect(button).toBeDisabled()

    // 해소
    await act(async () => {
      resolveShare!({
        share_code: 'LOAD01',
        participants: [{ id: 1, user_id: 10, user_name: '홍길동', role: 'host', joined_at: '2026-04-02T10:00:00Z' }],
      })
    })
  })
})
