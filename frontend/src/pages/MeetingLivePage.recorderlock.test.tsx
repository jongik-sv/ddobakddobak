import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HTTPError } from 'ky'
import MeetingLivePage from './MeetingLivePage'
import { RecordingLayer } from '../components/recording/RecordingLayer'
import { useRecordingSignalsStore } from '../stores/recordingSignalsStore'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useRecordingStore } from '../stores/recordingStore'
import { useToastStore } from '../stores/toastStore'
import { getClientId } from '../lib/clientId'

// ──────────────────────────────────────────────
// 단일 녹음 기기 락:
// 1) 라이브 진입 시 다른 기기가 활성 녹음 중(recorder_active)이면 뷰어로 리다이렉트
//    (채널 denied 신호는 청크 전송 후에만 오므로 첫 발화 전 침묵 구간을 이 검사가 커버).
// 2) handleStart의 startMeeting 409(recorder_conflict)/403 에러 처리.
// ──────────────────────────────────────────────

vi.mock('../api/meetings', () => ({
  startMeeting: vi.fn(),
  stopMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'completed' }),
  getMeeting: vi.fn(),
  getMeetingDetail: vi.fn().mockResolvedValue({ meeting: { id: 1, title: '테스트 회의', status: 'pending', started_at: null, ended_at: null, created_by_id: 1, created_at: '', updated_at: '' }, error: null }),
  getTranscripts: vi.fn().mockResolvedValue([]),
  getSummary: vi.fn().mockResolvedValue(null),
  reopenMeeting: vi.fn(),
  triggerRealtimeSummary: vi.fn().mockResolvedValue(undefined),
  pauseMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording' }),
  resumeMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording' }),
  updateMeeting: vi.fn().mockResolvedValue({ id: 1 }),
  resetMeetingContent: vi.fn().mockResolvedValue({ id: 1, status: 'pending' }),
  updateNotes: vi.fn().mockResolvedValue(undefined),
  // 이 파일은 게이팅 관심사가 아니므로 항상 편집 가능으로 고정.
  canEditMeeting: vi.fn().mockReturnValue(true),
}))

const audioRecorderStart = vi.fn().mockResolvedValue(undefined)
vi.mock('../hooks/useAudioRecorder', () => ({
  useAudioRecorder: vi.fn(() => ({
    isRecording: false,
    isPaused: false,
    error: null,
    start: audioRecorderStart,
    stop: vi.fn(),
    discard: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    feedSystemAudio: vi.fn(),
  })),
}))

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: vi.fn().mockReturnValue({
    sendChunk: vi.fn(),
    sendSystemChunk: vi.fn(),
    sendHeartbeat: vi.fn(),
  }),
}))

vi.mock('../hooks/useSystemAudioCapture', () => ({
  useSystemAudioCapture: vi.fn().mockReturnValue({
    isCapturing: false,
    error: null,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }),
}))

vi.mock('../hooks/useMicCapture', () => ({
  useMicCapture: vi.fn().mockReturnValue({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    feedSystemAudio: vi.fn(),
  }),
}))

vi.mock('../hooks/useMemoEditor', () => ({
  useMemoEditor: vi.fn().mockReturnValue({
    memoEditorRef: { current: null },
    isSavingMemo: false,
    handleSaveMemo: vi.fn(),
  }),
}))

vi.mock('../components/meeting/RecordTabPanel', () => ({
  RecordTabPanel: () => <div data-testid="live-transcript">기록 영역</div>,
}))

vi.mock('../components/meeting/AiSummaryPanel', () => ({
  AiSummaryPanel: () => <div data-testid="ai-summary">AI 요약 영역</div>,
}))

vi.mock('../components/meeting/SpeakerPanel', () => ({
  SpeakerPanel: () => <div data-testid="speaker-panel">화자 영역</div>,
}))

vi.mock('../components/editor/MeetingEditor', () => ({
  MeetingEditor: () => <div data-testid="meeting-editor">에디터 영역</div>,
  customSchema: { blockSpecs: {}, blockSchema: {} },
}))

vi.mock('../components/meeting/AttachmentSection', () => ({
  AttachmentSection: () => <div data-testid="attachment-section" />,
}))

vi.mock('../api/settings', () => ({
  getSttSettings: vi.fn().mockResolvedValue({ stt_engine: 'whisper' }),
}))

// ──────────────────────────────────────────────

import * as meetingsApi from '../api/meetings'

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, status: 'pending', title: '테스트 회의', meeting_type: 'general',
    created_by: { id: 1, name: '사용자' }, brief_summary: null,
    audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0,
    started_at: null, ended_at: null, created_at: '',
    ...overrides,
  }
}

/** ky HTTPError 구성 헬퍼 — 코드 경로(httpErrorInfo)가 읽는 status/json만 갖춘 fake response. */
function makeHttpError(status: number, body: Record<string, unknown>) {
  const response = { status, statusText: '', json: () => Promise.resolve(body) } as unknown as Response
  const request = { method: 'POST', url: 'http://localhost/api/v1/meetings/1/start' } as unknown as Request
  return new HTTPError(response, request, {} as never)
}

function setDesktopMode(isDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function renderPage({ withRecordingLayer = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/meetings/1/live']}>
      <Routes>
        <Route path="/meetings/:id/live" element={<MeetingLivePage />} />
        <Route path="/meetings/:id/viewer" element={<div data-testid="viewer-route">VIEWER</div>} />
      </Routes>
      {withRecordingLayer && <RecordingLayer />}
    </MemoryRouter>
  )
}

describe('MeetingLivePage 단일 녹음 기기 락', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRecordingSignalsStore.getState().reset()
    useTranscriptStore.getState().reset()
    useRecordingStore.getState().endSession()
    useToastStore.getState().clear()
    setDesktopMode(true)
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting() as never)
    vi.mocked(meetingsApi.startMeeting).mockResolvedValue(makeMeeting({ status: 'recording' }) as never)
    vi.mocked(meetingsApi.reopenMeeting).mockResolvedValue(makeMeeting({ status: 'recording' }) as never)
  })

  describe('라이브 진입 시 기기 점유 검사', () => {
    it('다른 기기가 활성 녹음 중이면 토스트 후 뷰어로 리다이렉트한다', async () => {
      vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting({
        status: 'recording',
        recorder_active: true,
        recording_client_id: 'other-device-id',
      }) as never)
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('viewer-route')).toBeInTheDocument()
      })
      expect(useToastStore.getState().message).toBe('다른 기기에서 녹음 중입니다')
    })

    it('같은 기기의 새로고침 복귀(client_id 일치)는 리다이렉트하지 않는다', async () => {
      vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting({
        status: 'recording',
        recorder_active: true,
        recording_client_id: getClientId(),
      }) as never)
      renderPage()
      await waitFor(() => {
        expect(meetingsApi.getMeeting).toHaveBeenCalled()
      })
      expect(screen.queryByTestId('viewer-route')).not.toBeInTheDocument()
    })

    it('recording이어도 recorder_active가 아니면(하트비트 stale) 리다이렉트하지 않는다', async () => {
      vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting({
        status: 'recording',
        recorder_active: false,
        recording_client_id: 'other-device-id',
      }) as never)
      renderPage()
      await waitFor(() => {
        expect(meetingsApi.getMeeting).toHaveBeenCalled()
      })
      expect(screen.queryByTestId('viewer-route')).not.toBeInTheDocument()
    })
  })

  describe('다른 탭/기기 종료 동기화 (recording_stopped)', () => {
    it('세션 비소유 탭은 종료 신호 시 회의를 재조회해 완료로 갱신하고 안내한다', async () => {
      // 같은 브라우저 두 번째 탭: activeMeetingId null(세션 비소유) + 같은 clientId라 진입 리다이렉트 없음.
      vi.mocked(meetingsApi.getMeeting)
        .mockResolvedValueOnce(makeMeeting({ status: 'recording', recorder_active: true, recording_client_id: getClientId() }) as never)
        .mockResolvedValueOnce(makeMeeting({ status: 'completed' }) as never)
      renderPage()
      await waitFor(() => expect(meetingsApi.getMeeting).toHaveBeenCalledTimes(1))

      // 다른 탭에서 회의 종료 → recording_stopped 브로드캐스트 수신
      act(() => { useRecordingSignalsStore.getState().setRecordingStopped(true) })

      await waitFor(() => {
        expect(useToastStore.getState().message).toBe('다른 탭에서 회의가 종료되었습니다')
      })
      expect(meetingsApi.getMeeting).toHaveBeenCalledTimes(2) // 재조회로 완료 상태 반영
      expect(screen.queryByTestId('viewer-route')).not.toBeInTheDocument()
    })

    it('완료 상태에서는 종료 신호가 와도 재조회하지 않는다(루프 방지)', async () => {
      vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting({ status: 'completed' }) as never)
      renderPage()
      await waitFor(() => expect(meetingsApi.getMeeting).toHaveBeenCalledTimes(1))
      act(() => { useRecordingSignalsStore.getState().setRecordingStopped(true) })
      // 잠깐 흘려보내도 추가 호출 없어야 함
      await Promise.resolve()
      expect(meetingsApi.getMeeting).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleStart 시작 API 에러 처리', () => {
    it('startMeeting 409(recorder_conflict)면 캡처 시작 없이 토스트 + 뷰어로 이동한다', async () => {
      vi.mocked(meetingsApi.startMeeting).mockRejectedValue(
        makeHttpError(409, { error: '다른 기기에서 녹음이 진행 중입니다.', code: 'recorder_conflict' })
      )
      renderPage({ withRecordingLayer: true })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('viewer-route')).toBeInTheDocument()
      })
      expect(useRecordingSignalsStore.getState().recordingDenied).toBe(true)
      expect(useToastStore.getState().message).toContain('다른 기기에서 녹음이 진행 중입니다')
      // 로컬 캡처는 시작되지 않아야 한다 (409에서 조기 중단)
      expect(audioRecorderStart).not.toHaveBeenCalled()
    })

    it('startMeeting 403이면 토스트("권한이 없습니다") + 세션 종료, 뷰어로 가지 않는다', async () => {
      vi.mocked(meetingsApi.startMeeting).mockRejectedValue(
        makeHttpError(403, { error: '권한이 없습니다.' })
      )
      renderPage({ withRecordingLayer: true })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
      })
      await waitFor(() => {
        expect(useToastStore.getState().message).toBe('권한이 없습니다')
      })
      // 세션 종료 → activeMeetingId 해제(재시도 가능) + 캡처 미시작 + 리다이렉트 없음
      expect(useRecordingStore.getState().activeMeetingId).toBeNull()
      expect(audioRecorderStart).not.toHaveBeenCalled()
      expect(screen.queryByTestId('viewer-route')).not.toBeInTheDocument()
    })

    it('그 외 에러(이미 recording 합류 등)는 기존 관용대로 캡처를 계속한다', async () => {
      vi.mocked(meetingsApi.startMeeting).mockRejectedValue(new Error('network flake'))
      renderPage({ withRecordingLayer: true })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
      })
      await waitFor(() => {
        expect(audioRecorderStart).toHaveBeenCalled()
      })
      expect(screen.queryByTestId('viewer-route')).not.toBeInTheDocument()
    })
  })
})
