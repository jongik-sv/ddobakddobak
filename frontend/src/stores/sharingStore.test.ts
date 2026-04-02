import { describe, it, expect, beforeEach } from 'vitest'
import { useSharingStore } from './sharingStore'
import type { Participant } from '../api/meetings'

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

describe('sharingStore', () => {
  beforeEach(() => {
    useSharingStore.getState().reset()
  })

  it('초기 상태 확인', () => {
    const state = useSharingStore.getState()
    expect(state.shareCode).toBeNull()
    expect(state.participants).toEqual([])
    expect(state.isSharing).toBe(false)
    expect(state.isLoading).toBe(false)
  })

  it('setShareCode: 공유 코드 설정', () => {
    useSharingStore.getState().setShareCode('A1B2C3')
    expect(useSharingStore.getState().shareCode).toBe('A1B2C3')
  })

  it('setShareCode: null로 초기화', () => {
    useSharingStore.getState().setShareCode('A1B2C3')
    useSharingStore.getState().setShareCode(null)
    expect(useSharingStore.getState().shareCode).toBeNull()
  })

  it('setParticipants: 참여자 목록 설정 (host 우선 정렬)', () => {
    useSharingStore.getState().setParticipants([viewerParticipant, hostParticipant])
    const participants = useSharingStore.getState().participants
    expect(participants).toHaveLength(2)
    expect(participants[0].role).toBe('host')
    expect(participants[1].role).toBe('viewer')
  })

  it('addParticipant: 참여자 추가', () => {
    useSharingStore.getState().setParticipants([hostParticipant])
    useSharingStore.getState().addParticipant(viewerParticipant)
    const participants = useSharingStore.getState().participants
    expect(participants).toHaveLength(2)
    expect(participants[1].user_name).toBe('김철수')
  })

  it('addParticipant: host 우선 정렬 유지', () => {
    useSharingStore.getState().setParticipants([viewerParticipant])
    useSharingStore.getState().addParticipant(hostParticipant)
    const participants = useSharingStore.getState().participants
    expect(participants[0].role).toBe('host')
  })

  it('removeParticipant: userId로 참여자 제거', () => {
    useSharingStore.getState().setParticipants([hostParticipant, viewerParticipant])
    useSharingStore.getState().removeParticipant(20)
    const participants = useSharingStore.getState().participants
    expect(participants).toHaveLength(1)
    expect(participants[0].user_id).toBe(10)
  })

  it('updateParticipantRole: 참여자 역할 변경', () => {
    useSharingStore.getState().setParticipants([hostParticipant, viewerParticipant])
    useSharingStore.getState().updateParticipantRole(20, 'host')
    const participant = useSharingStore.getState().participants.find(p => p.user_id === 20)
    expect(participant?.role).toBe('host')
  })

  it('updateParticipantRole: 역할 변경 후 host 우선 정렬', () => {
    useSharingStore.getState().setParticipants([hostParticipant, viewerParticipant])
    useSharingStore.getState().updateParticipantRole(10, 'viewer')
    useSharingStore.getState().updateParticipantRole(20, 'host')
    const participants = useSharingStore.getState().participants
    expect(participants[0].role).toBe('host')
    expect(participants[0].user_id).toBe(20)
  })

  it('startSharing: 공유 시작 (코드 + 참여자 설정)', () => {
    useSharingStore.getState().startSharing('X9Y8Z7', [hostParticipant, viewerParticipant])
    const state = useSharingStore.getState()
    expect(state.shareCode).toBe('X9Y8Z7')
    expect(state.isSharing).toBe(true)
    expect(state.participants).toHaveLength(2)
  })

  it('stopSharing: 공유 중지 (상태 초기화)', () => {
    useSharingStore.getState().startSharing('X9Y8Z7', [hostParticipant])
    useSharingStore.getState().stopSharing()
    const state = useSharingStore.getState()
    expect(state.shareCode).toBeNull()
    expect(state.isSharing).toBe(false)
    expect(state.participants).toEqual([])
  })

  it('reset: 전체 상태 초기화', () => {
    useSharingStore.getState().startSharing('ABC123', [hostParticipant, viewerParticipant])
    useSharingStore.getState().reset()
    const state = useSharingStore.getState()
    expect(state.shareCode).toBeNull()
    expect(state.participants).toEqual([])
    expect(state.isSharing).toBe(false)
    expect(state.isLoading).toBe(false)
  })

  it('setParticipants: 여러 참여자 host 우선 정렬', () => {
    useSharingStore.getState().setParticipants([
      viewerParticipant2,
      viewerParticipant,
      hostParticipant,
    ])
    const participants = useSharingStore.getState().participants
    expect(participants[0].role).toBe('host')
    expect(participants[0].user_name).toBe('홍길동')
  })

  it('addParticipant: 중복 userId 참여자 추가 시 덮어쓰기', () => {
    useSharingStore.getState().setParticipants([hostParticipant])
    const updatedHost: Participant = { ...hostParticipant, user_name: '홍길동(수정)' }
    useSharingStore.getState().addParticipant(updatedHost)
    const participants = useSharingStore.getState().participants
    expect(participants).toHaveLength(1)
    expect(participants[0].user_name).toBe('홍길동(수정)')
  })
})
