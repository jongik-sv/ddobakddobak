import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from '../uiStore'

describe('uiStore - 모바일 상태', () => {
  beforeEach(() => {
    // 각 테스트 전 스토어 초기화
    useUiStore.setState({
      mobileMenuOpen: false,
      meetingActiveTab: 'transcript',
      liveActiveTab: 'transcript',
    })
  })

  describe('mobileMenuOpen', () => {
    it('기본값은 false', () => {
      expect(useUiStore.getState().mobileMenuOpen).toBe(false)
    })

    it('setMobileMenuOpen(true)로 열기', () => {
      useUiStore.getState().setMobileMenuOpen(true)
      expect(useUiStore.getState().mobileMenuOpen).toBe(true)
    })

    it('setMobileMenuOpen(false)로 닫기', () => {
      useUiStore.getState().setMobileMenuOpen(true)
      useUiStore.getState().setMobileMenuOpen(false)
      expect(useUiStore.getState().mobileMenuOpen).toBe(false)
    })
  })

  describe('meetingActiveTab', () => {
    it('기본값은 transcript', () => {
      expect(useUiStore.getState().meetingActiveTab).toBe('transcript')
    })

    it('setMeetingActiveTab으로 summary 탭 변경', () => {
      useUiStore.getState().setMeetingActiveTab('summary')
      expect(useUiStore.getState().meetingActiveTab).toBe('summary')
    })

    it('memo 탭으로 전환', () => {
      useUiStore.getState().setMeetingActiveTab('memo')
      expect(useUiStore.getState().meetingActiveTab).toBe('memo')
    })
  })

  describe('liveActiveTab', () => {
    it('기본값은 transcript', () => {
      expect(useUiStore.getState().liveActiveTab).toBe('transcript')
    })

    it('setLiveActiveTab으로 summary 탭 변경', () => {
      useUiStore.getState().setLiveActiveTab('summary')
      expect(useUiStore.getState().liveActiveTab).toBe('summary')
    })

    it('memo 탭으로 전환', () => {
      useUiStore.getState().setLiveActiveTab('memo')
      expect(useUiStore.getState().liveActiveTab).toBe('memo')
    })
  })

  describe('탭 상태 독립성', () => {
    it('meetingActiveTab과 liveActiveTab은 서로 영향 없음', () => {
      useUiStore.getState().setMeetingActiveTab('memo')
      useUiStore.getState().setLiveActiveTab('summary')
      expect(useUiStore.getState().meetingActiveTab).toBe('memo')
      expect(useUiStore.getState().liveActiveTab).toBe('summary')
    })

    it('mobileMenuOpen 변경이 탭 상태에 영향 없음', () => {
      useUiStore.getState().setMeetingActiveTab('summary')
      useUiStore.getState().setLiveActiveTab('memo')
      useUiStore.getState().setMobileMenuOpen(true)
      expect(useUiStore.getState().meetingActiveTab).toBe('summary')
      expect(useUiStore.getState().liveActiveTab).toBe('memo')
      expect(useUiStore.getState().mobileMenuOpen).toBe(true)
    })
  })
})
