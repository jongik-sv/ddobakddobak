import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ParticipantList } from './ParticipantList'
import { useSharingStore } from '../../stores/sharingStore'
import type { Participant } from '../../api/meetings'

const hostParticipant: Participant = {
  id: 1,
  user_id: 10,
  user_name: '홍길동',
  role: 'host',
  joined_at: '2026-04-02T10:00:00Z',
}

const viewerParticipant: Participant = {
  id: 2,
  user_id: 20,
  user_name: '김철수',
  role: 'viewer',
  joined_at: '2026-04-02T10:01:00Z',
}

const viewerParticipant2: Participant = {
  id: 3,
  user_id: 30,
  user_name: '이영희',
  role: 'viewer',
  joined_at: '2026-04-02T10:02:00Z',
}

describe('ParticipantList', () => {
  beforeEach(() => {
    useSharingStore.getState().reset()
    vi.clearAllMocks()
  })

  it('참여자 수 헤더 표시', () => {
    useSharingStore.getState().setParticipants([hostParticipant, viewerParticipant])
    render(<ParticipantList isHost={true} currentUserId={10} />)
    expect(screen.getByText('참여자 (2)')).toBeInTheDocument()
  })

  it('참여자 이름 렌더링', () => {
    useSharingStore.getState().setParticipants([hostParticipant, viewerParticipant])
    render(<ParticipantList isHost={true} currentUserId={10} />)
    expect(screen.getByText(/홍길동/)).toBeInTheDocument()
    expect(screen.getByText(/김철수/)).toBeInTheDocument()
  })

  it('현재 사용자에게 "(나)" 표시', () => {
    useSharingStore.getState().setParticipants([hostParticipant, viewerParticipant])
    render(<ParticipantList isHost={true} currentUserId={10} />)
    expect(screen.getByText(/\(나\)/)).toBeInTheDocument()
  })

  it('호스트 역할 라벨 표시', () => {
    useSharingStore.getState().setParticipants([hostParticipant])
    render(<ParticipantList isHost={true} currentUserId={10} />)
    expect(screen.getByText('호스트')).toBeInTheDocument()
  })

  it('isHost=true일 때 뷰어에 "넘기기" 버튼 표시', () => {
    useSharingStore.getState().setParticipants([hostParticipant, viewerParticipant])
    render(<ParticipantList isHost={true} currentUserId={10} />)
    expect(screen.getByText('넘기기')).toBeInTheDocument()
  })

  it('isHost=false일 때 "넘기기" 버튼 숨김', () => {
    useSharingStore.getState().setParticipants([hostParticipant, viewerParticipant])
    render(<ParticipantList isHost={false} currentUserId={20} />)
    expect(screen.queryByText('넘기기')).not.toBeInTheDocument()
  })

  it('여러 뷰어에 각각 "넘기기" 버튼 표시', () => {
    useSharingStore.getState().setParticipants([hostParticipant, viewerParticipant, viewerParticipant2])
    render(<ParticipantList isHost={true} currentUserId={10} />)
    const transferButtons = screen.getAllByText('넘기기')
    expect(transferButtons).toHaveLength(2)
  })

  it('"넘기기" 클릭 시 onTransferRequest 콜백 호출', () => {
    const onTransferRequest = vi.fn()
    useSharingStore.getState().setParticipants([hostParticipant, viewerParticipant])
    render(
      <ParticipantList
        isHost={true}
        currentUserId={10}
        onTransferRequest={onTransferRequest}
      />
    )
    fireEvent.click(screen.getByText('넘기기'))
    expect(onTransferRequest).toHaveBeenCalledWith(viewerParticipant)
  })

  it('참여자 없을 때 빈 목록', () => {
    render(<ParticipantList isHost={true} currentUserId={10} />)
    expect(screen.getByText('참여자 (0)')).toBeInTheDocument()
  })
})
