import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingLivePage from './MeetingLivePage'
import { useRecordingStore } from '../stores/recordingStore'
import { useSharingStore } from '../stores/sharingStore'
import { useTranscriptStore } from '../stores/transcriptStore'

// ──────────────────────────────────────────────
// 단일 소유자(single-owner) 가드 테스트.
// 페이지는 더 이상 useLiveRecording을 직접 실행하지 않는다 —
// 녹음 본체는 앱-레벨 헤드리스 세션(RecordingSession)만 소유한다.
// 이 파일은 RecordingLayer를 의도적으로 마운트하지 않고 페이지만 렌더해
// 페이지가 useLiveRecording을 호출하지 않음을 검증한다.
// ──────────────────────────────────────────────

// useLiveRecording을 스파이로 모킹 — 호출되면 즉시 잡힌다(페이지는 호출하지 않아야 함).
const useLiveRecordingSpy = vi.fn().mockReturnValue({
  isActive: false,
  isPaused: false,
  meetingApiStatus: null,
  elapsedSeconds: 0,
  summaryCountdown: 0,
  summaryIntervalSec: 30,
  canManualSummary: false,
  systemAudioEnabled: false,
  systemAudioError: null,
  isResetting: false,
  isStopping: false,
  error: null,
  sttEngine: null,
  activeSttMode: 'server',
  handleStart: vi.fn().mockResolvedValue(undefined),
  handlePause: vi.fn(),
  handleResume: vi.fn(),
  performStop: vi.fn().mockResolvedValue(undefined),
  handleManualSummary: vi.fn(),
  handleToggleSystemAudio: vi.fn(),
  setSummaryIntervalSec: vi.fn(),
  handleResetConfirm: vi.fn(),
})
vi.mock('../hooks/useLiveRecording', () => ({
  useLiveRecording: (...args: unknown[]) => useLiveRecordingSpy(...args),
}))

// 페이지 렌더에 필요한 스캐폴딩 모킹 (MeetingLivePage.test.tsx와 동일).
vi.mock('../api/meetings', () => ({
  startMeeting: vi.fn().mockResolvedValue({ id: 5, status: 'recording' }),
  stopMeeting: vi.fn().mockResolvedValue({ id: 5, status: 'completed' }),
  getMeeting: vi.fn().mockResolvedValue({ id: 5, status: 'recording', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  getMeetingDetail: vi.fn().mockResolvedValue({ meeting: { id: 5, title: '테스트 회의', status: 'recording', started_at: null, ended_at: null, created_by_id: 1, created_at: '', updated_at: '' }, error: null }),
  uploadAudio: vi.fn().mockResolvedValue(undefined),
  getTranscripts: vi.fn().mockResolvedValue([]),
  getSummary: vi.fn().mockResolvedValue(null),
  reopenMeeting: vi.fn().mockResolvedValue({ id: 5, status: 'recording' }),
  triggerRealtimeSummary: vi.fn().mockResolvedValue(undefined),
  pauseMeeting: vi.fn().mockResolvedValue({ id: 5, status: 'recording' }),
  resumeMeeting: vi.fn().mockResolvedValue({ id: 5, status: 'recording' }),
  updateMeeting: vi.fn().mockResolvedValue({ id: 5, status: 'recording' }),
  resetMeetingContent: vi.fn().mockResolvedValue({ id: 5, status: 'pending' }),
  correctTerms: vi.fn().mockResolvedValue({ notes_markdown: '', corrected_transcripts: 0 }),
  updateNotes: vi.fn().mockResolvedValue(undefined),
  getParticipants: vi.fn().mockResolvedValue([]),
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

/** matchMedia mock 헬퍼 */
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

function renderPageOnly(meetingId = '5') {
  return render(
    // RecordingLayer를 의도적으로 마운트하지 않는다 — 페이지만.
    <MemoryRouter initialEntries={[`/meetings/${meetingId}/live`]}>
      <Routes>
        <Route path="/meetings/:id/live" element={<MeetingLivePage />} />
        <Route path="/meetings/:id/viewer" element={<div data-testid="viewer-route">VIEWER</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MeetingLivePage 단일 소유자 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSharingStore.getState().reset()
    useTranscriptStore.getState().reset()
    useRecordingStore.getState().endSession()
    setDesktopMode(true)
  })

  it('페이지는 useLiveRecording을 절대 호출하지 않는다(세션만 소유)', () => {
    // 이 회의(5)를 활성 녹음 상태로 설정 — 그래도 페이지는 hook을 실행하지 않아야 한다.
    useRecordingStore.getState().start(5)
    useRecordingStore.getState().publish({ status: 'recording' })
    renderPageOnly('5')
    // 페이지는 useLiveRecording을 import하지 않으므로 스파이는 0회.
    expect(useLiveRecordingSpy).not.toHaveBeenCalled()
  })

  it('종료 컨트롤 클릭 시 recordingStore.requestStop을 호출한다(인텐트 배선)', () => {
    useRecordingStore.getState().start(5)
    useRecordingStore.getState().publish({ status: 'recording' })
    // 스파이는 render 전에 설치해야 한다 —
    // 페이지가 render 시점에 rec.requestStop을 값으로 캡처하기 때문.
    const requestStopSpy = vi.spyOn(useRecordingStore.getState(), 'requestStop')
    renderPageOnly('5')
    // 데스크톱 종료 버튼 텍스트는 '회의 종료'(DesktopRecordControls).
    fireEvent.click(screen.getByRole('button', { name: /회의 종료/ }))
    expect(requestStopSpy).toHaveBeenCalled()
  })
})
