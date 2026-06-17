import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MeetingActionButtons } from './MeetingListUI'
import type { Meeting } from '../../api/meetings'
import { useAuthStore } from '../../stores/authStore'

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 1,
    title: '회의',
    status: 'completed',
    meeting_type: 'general',
    created_by: { id: 1, name: '소유자' },
    brief_summary: null,
    folder_id: null,
    audio_duration_ms: 0,
    last_transcript_end_ms: 0,
    last_sequence_number: 0,
    memo: null,
    attendees: null,
    shared: true,
    locked: false,
    locked_at: null,
    important: false,
    started_at: null,
    ended_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const noop = () => {}

function renderButtons(meeting: Meeting) {
  return render(
    <MeetingActionButtons
      meeting={meeting}
      isDesktop
      onEdit={noop}
      onMove={noop}
      onDelete={noop}
      onStop={noop}
    />,
  )
}

describe('MeetingActionButtons 소유권 게이팅', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 1, email: 'me@x.com', name: '나', role: 'member' } })
  })

  it('편집 가능 회의: ⋯ 메뉴를 열면 수정/이동/삭제가 노출된다', () => {
    renderButtons(makeMeeting({ editable: true }))
    // 메뉴 닫힌 상태에선 항목이 보이지 않음
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '회의 메뉴' }))
    expect(screen.getByRole('button', { name: '정보 수정' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '폴더로 이동' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
  })

  it('삭제 클릭 시 onDelete가 호출된다', () => {
    let deleted = 0
    render(
      <MeetingActionButtons
        meeting={makeMeeting({ editable: true })}
        isDesktop
        onEdit={noop}
        onMove={noop}
        onDelete={() => { deleted += 1 }}
        onStop={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '회의 메뉴' }))
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(deleted).toBe(1)
  })

  it('편집 불가(타인 소유) 회의에는 ⋯ 메뉴 버튼이 노출되지 않는다', () => {
    renderButtons(makeMeeting({ editable: false, created_by: { id: 99, name: '남' } }))
    expect(screen.queryByRole('button', { name: '회의 메뉴' })).not.toBeInTheDocument()
  })

  it('editable 미제공이고 내가 소유자면 ⋯ 메뉴가 노출된다', () => {
    renderButtons(makeMeeting({ editable: undefined, created_by: { id: 1, name: '나' } }))
    expect(screen.getByRole('button', { name: '회의 메뉴' })).toBeInTheDocument()
  })

  it('editable 미제공이고 타인 소유면 ⋯ 메뉴가 노출되지 않는다', () => {
    renderButtons(makeMeeting({ editable: undefined, created_by: { id: 99, name: '남' } }))
    expect(screen.queryByRole('button', { name: '회의 메뉴' })).not.toBeInTheDocument()
  })

  it('editable 미제공이고 admin이면 타인 소유라도 ⋯ 메뉴가 노출된다', () => {
    useAuthStore.setState({ user: { id: 5, email: 'admin@x.com', name: '관리자', role: 'admin' } })
    renderButtons(makeMeeting({ editable: undefined, created_by: { id: 99, name: '남' } }))
    expect(screen.getByRole('button', { name: '회의 메뉴' })).toBeInTheDocument()
  })

  it('녹음중 회의여도 타인 소유면 종료 버튼이 노출되지 않는다', () => {
    renderButtons(makeMeeting({ status: 'recording', editable: false, created_by: { id: 99, name: '남' } }))
    expect(screen.queryByRole('button', { name: '종료' })).not.toBeInTheDocument()
  })

  it('녹음중 회의이고 소유자면 종료 버튼이 노출된다', () => {
    renderButtons(makeMeeting({ status: 'recording', editable: true }))
    expect(screen.getByRole('button', { name: '종료' })).toBeInTheDocument()
  })
})
