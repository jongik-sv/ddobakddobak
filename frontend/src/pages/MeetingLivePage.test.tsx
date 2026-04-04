import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingLivePage from './MeetingLivePage'

// ────────────────���─────────────────────────────
// Mocks
// ───────────────────────────────���──────────────

vi.mock('../api/meetings', () => ({
  startMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  stopMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'completed', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  getMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'pending', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  uploadAudio: vi.fn().mockResolvedValue(undefined),
  getTranscripts: vi.fn().mockResolvedValue([]),
  getSummary: vi.fn().mockResolvedValue(null),
  reopenMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  triggerRealtimeSummary: vi.fn().mockResolvedValue(undefined),
  resetMeetingContent: vi.fn().mockResolvedValue({ id: 1, status: 'pending', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  correctTerms: vi.fn().mockResolvedValue({ notes_markdown: '', corrected_transcripts: 0 }),
  updateNotes: vi.fn().mockResolvedValue(undefined),
  getParticipants: vi.fn().mockResolvedValue([]),
}))

vi.mock('../hooks/useAudioRecorder', () => ({
  useAudioRecorder: vi.fn().mockReturnValue({
    isRecording: false,
    isPaused: false,
    error: null,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    feedSystemAudio: vi.fn(),
  }),
}))

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: vi.fn().mockReturnValue({
    sendChunk: vi.fn(),
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
import * as useAudioRecorderModule from '../hooks/useAudioRecorder'

/** matchMedia mock 헬퍼: matches 값을 설정한다 */
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

function renderPage(meetingId = '1') {
  return render(
    <MemoryRouter initialEntries={[`/meetings/${meetingId}/live`]}>
      <Routes>
        <Route path="/meetings/:id/live" element={<MeetingLivePage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MeetingLivePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 기본: 데스크톱 모드
    setDesktopMode(true)
    vi.mocked(useAudioRecorderModule.useAudioRecorder).mockReturnValue({
      isRecording: false,
      isPaused: false,
      error: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      feedSystemAudio: vi.fn(),
    })
    vi.mocked(meetingsApi.startMeeting).mockResolvedValue({ id: 1, status: 'recording', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' } as any)
    vi.mocked(meetingsApi.stopMeeting).mockResolvedValue({ id: 1, status: 'completed', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' } as any)
    vi.mocked(meetingsApi.uploadAudio).mockResolvedValue(undefined)
  })

  it('"회의 시작" 버튼 렌더', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /회의 시작/i })).toBeInTheDocument()
  })

  it('"회의 종료" 버튼은 회의 시작 전에 표시되지 않음', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /회의 종료/i })).not.toBeInTheDocument()
  })

  it('"회의 시작" 클릭 시 startMeeting API 호출', async () => {
    renderPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
    })
    expect(meetingsApi.startMeeting).toHaveBeenCalledWith(1)
  })

  it('회의 시작 후 녹음 표시등 표시', async () => {
    vi.mocked(useAudioRecorderModule.useAudioRecorder).mockReturnValue({
      isRecording: true,
      isPaused: false,
      error: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      feedSystemAudio: vi.fn(),
    })
    renderPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('recording-indicator')).toBeInTheDocument()
    })
  })

  it('"회의 종료" 클릭 시 stopMeeting API 호출', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPage()
    // 먼�� 회의 시작
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
    })
    // 회의 시작 후 "회의 종료" 버튼이 나타날 때까지 대기
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /회의 종료/i })).toBeInTheDocument()
    })
    // 회의 종료
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 종료/i }))
    })
    // handleStop 내부에 2초 지연이 있어 타이머를 진행시킨다
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    await waitFor(() => {
      expect(meetingsApi.stopMeeting).toHaveBeenCalledWith(1)
    })
    vi.useRealTimers()
  })

  // ──────────────────────────────────────────────
  // 데스크톱 레이아웃 테스트
  // ───────────────────────────────────��──────────

  describe('데스크톱 모드 (>= lg)', () => {
    beforeEach(() => {
      setDesktopMode(true)
    })

    it('PanelGroup 3��역 레이아웃 표시 (기록, ���약, 메모)', () => {
      renderPage()
      expect(screen.getByTestId('live-transcript')).toBeInTheDocument()
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
      expect(screen.getByTestId('meeting-editor')).toBeInTheDocument()
    })

    it('MobileTabLayout 탭이 표시되지 않음', () => {
      renderPage()
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    })
  })

  // ──────────────────���───────────────────────────
  // 모바일 레이아웃 테스트
  // ─────────────��────────────────────────────────

  describe('모바일 모드 (< lg)', () => {
    beforeEach(() => {
      setDesktopMode(false)
    })

    it('MobileTabLayout 탭바가 표시됨', () => {
      renderPage()
      expect(screen.getByRole('tablist')).toBeInTheDocument()
    })

    it('전사/요약/메모 3개 탭이 존재함', () => {
      renderPage()
      expect(screen.getByRole('tab', { name: /전사/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /요약/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /메모/i })).toBeInTheDocument()
    })

    it('기본 탭은 전사 탭이며 기록 영역이 보임', () => {
      renderPage()
      expect(screen.getByTestId('live-transcript')).toBeInTheDocument()
    })

    it('전사 탭에 화자 관리 accordion이 포함됨', () => {
      renderPage()
      const details = screen.getByText('화자 관리')
      expect(details).toBeInTheDocument()
    })

    it('화자 관리 accordion은 기본 닫힘 상태', () => {
      renderPage()
      const detailsEl = screen.getByText('화자 관리').closest('details')
      expect(detailsEl).not.toHaveAttribute('open')
    })

    it('요약 탭 클릭 시 AI 요약 영역이 보임', async () => {
      renderPage()
      const summaryTab = screen.getByRole('tab', { name: /요약/i })
      fireEvent.click(summaryTab)
      // 요약 탭의 tabpanel이 visible이 됨
      const summaryPanel = screen.getByTestId('ai-summary')
      expect(summaryPanel).toBeInTheDocument()
      // 해당 tabpanel의 visibility가 visible인지 확인
      const tabPanel = summaryPanel.closest('[role="tabpanel"]')
      expect(tabPanel).toHaveStyle({ visibility: 'visible' })
    })

    it('메모 탭 클릭 시 에디터 영��이 보임', async () => {
      renderPage()
      const memoTab = screen.getByRole('tab', { name: /메모/i })
      fireEvent.click(memoTab)
      const editorPanel = screen.getByTestId('meeting-editor')
      expect(editorPanel).toBeInTheDocument()
      const tabPanel = editorPanel.closest('[role="tabpanel"]')
      expect(tabPanel).toHaveStyle({ visibility: 'visible' })
    })

    it('PanelGroup resize handle이 존재하지 않음', () => {
      const { container } = renderPage()
      // react-resizable-panels의 resize handle은 데스크톱에서만 렌더링
      const resizeHandles = container.querySelectorAll('[data-panel-resize-handle-id]')
      expect(resizeHandles.length).toBe(0)
    })

    // ── MobileRecordControls 통합 테스트 ──

    it('녹음 중이 아닐 때 MobileRecordControls가 표시되지 않음', () => {
      renderPage()
      expect(screen.queryByTestId('mobile-record-controls')).not.toBeInTheDocument()
    })

    it('녹음 중일 때 MobileRecordControls가 표시됨', async () => {
      vi.mocked(useAudioRecorderModule.useAudioRecorder).mockReturnValue({
        isRecording: true,
        isPaused: false,
        error: null,
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        feedSystemAudio: vi.fn(),
      })
      renderPage()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('mobile-record-controls')).toBeInTheDocument()
      })
    })
  })
})
