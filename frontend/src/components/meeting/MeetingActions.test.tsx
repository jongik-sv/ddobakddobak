import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MeetingActions } from './MeetingActions'
import type { Meeting } from '../../api/meetings'

// ExportButton은 내보내기(읽기) 전용 — 의존성(다운로드 등)이 무거우니 스텁으로 치환.
vi.mock('./ExportButton', () => ({
  ExportButton: () => <button>내보내기</button>,
}))

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 1,
    title: '회의',
    status: 'completed',
    meeting_type: 'general',
    created_by: { id: 1, name: '소유자' },
    brief_summary: null,
    folder_id: null,
    has_audio_file: true,
    audio_duration_ms: 0,
    last_transcript_end_ms: 0,
    last_sequence_number: 0,
    memo: null,
    attendees: null,
    shared: true,
    locked: false,
    locked_at: null,
    important: false,
    editable: true,
    started_at: null,
    ended_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const noop = () => {}

function renderActions(meeting: Meeting) {
  return render(
    <MeetingActions
      meeting={meeting}
      meetingId={meeting.id}
      isDesktop
      transcriptsCount={3}
      isRegeneratingNotes={false}
      onShowSttConfirm={noop}
      onShowReDiarizeConfirm={noop}
      onShowNotesConfirm={noop}
      onReopen={noop}
      onGoLive={noop}
      onDelete={noop}
      canEdit
    />,
  )
}

describe('MeetingActions 잠금 비활성', () => {
  it('잠금 해제 상태에서는 변경 버튼이 활성화된다', () => {
    renderActions(makeMeeting({ locked: false }))
    expect(screen.getByRole('button', { name: 'STT 재생성' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '회의록 재생성' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '삭제' })).not.toBeDisabled()
  })

  it('잠긴 회의면 STT/화자분리/회의록 재생성/재개/삭제 버튼이 모두 비활성화된다', () => {
    renderActions(makeMeeting({ locked: true }))
    expect(screen.getByRole('button', { name: 'STT 재생성' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '화자분리만 재실행' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '회의록 재생성' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '회의 재개' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled()
  })

  it('잠긴 회의여도 내보내기(읽기)는 노출된다', () => {
    renderActions(makeMeeting({ locked: true }))
    expect(screen.getByRole('button', { name: '내보내기' })).toBeInTheDocument()
  })
})
