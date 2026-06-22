import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingLivePage from './MeetingLivePage'
import { RecordingLayer } from '../components/recording/RecordingLayer'
import { useSharingStore } from '../stores/sharingStore'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useRecordingStore } from '../stores/recordingStore'

// ────────────────���─────────────────────────────
// Mocks
// ───────────────────────────────���──────────────

vi.mock('../api/meetings', () => ({
  startMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  stopMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'completed', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  getMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'pending', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  getMeetingDetail: vi.fn().mockResolvedValue({ meeting: { id: 1, title: '테스트 회의', status: 'pending', started_at: null, ended_at: null, created_by_id: 1, created_at: '', updated_at: '' }, error: null }),
  uploadAudio: vi.fn().mockResolvedValue(undefined),
  getTranscripts: vi.fn().mockResolvedValue([]),
  getSummary: vi.fn().mockResolvedValue(null),
  reopenMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' }),
  triggerRealtimeSummary: vi.fn().mockResolvedValue(undefined),
  pauseMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording' }),
  resumeMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording' }),
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
        <Route path="/meetings/:id/viewer" element={<div data-testid="viewer-route">VIEWER</div>} />
      </Routes>
      {/* 실제 앱(GatedApp)처럼 녹음 레이어를 라우트 밖 형제로 마운트 →
          start/stop이 실제 헤드리스 세션을 통해 흐른다. */}
      <RecordingLayer />
    </MemoryRouter>
  )
}

/** 예약 스케줄러가 넘기는 navigation state(autoStart)를 실은 채 렌더한다. */
function renderPageWithState(state: unknown, meetingId = '1') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/meetings/${meetingId}/live`, state }]}>
      <Routes>
        <Route path="/meetings/:id/live" element={<MeetingLivePage />} />
        <Route path="/meetings/:id/viewer" element={<div data-testid="viewer-route">VIEWER</div>} />
      </Routes>
      <RecordingLayer />
    </MemoryRouter>
  )
}

describe('MeetingLivePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSharingStore.getState().reset()
    useTranscriptStore.getState().reset()
    // 녹음 세션 상태를 테스트 간 초기화(activeMeetingId/handlers/showStopConfirm 등)
    useRecordingStore.getState().endSession()
    // 기본: 데스크톱 모드
    setDesktopMode(true)
    vi.mocked(useAudioRecorderModule.useAudioRecorder).mockReturnValue({
      isRecording: false,
      isPaused: false,
      error: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      discard: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      feedSystemAudio: vi.fn(),
    })
    vi.mocked(meetingsApi.startMeeting).mockResolvedValue({ id: 1, status: 'recording', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' } as any)
    vi.mocked(meetingsApi.stopMeeting).mockResolvedValue({ id: 1, status: 'completed', title: '테스트 회의', meeting_type: 'general', created_by: { id: 1, name: '사용자' }, brief_summary: null, audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0, started_at: null, ended_at: null, created_at: '' } as any)
    vi.mocked(meetingsApi.uploadAudio).mockResolvedValue(undefined)
  })

  it('다른 세션이 녹음 중이면(recordingDenied) 읽기전용 뷰어로 라우팅한다', async () => {
    renderPage()
    act(() => {
      useSharingStore.getState().setRecordingDenied(true)
    })
    await waitFor(() => {
      expect(screen.getByTestId('viewer-route')).toBeInTheDocument()
    })
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
      discard: vi.fn(),
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

  it('전사 없으면 "회의 종료" 클릭 시 다이얼로그 없이 skipSummary로 종료', async () => {
    renderPage()
    // 먼저 회의 시작
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
    })
    // 회의 시작 후 "회의 종료" 버튼이 나타날 때까지 대기
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /회의 종료/i })).toBeInTheDocument()
    })
    // 회의 종료 — 전사 0건이므로 확인 다이얼로그 없이 즉시 종료(skipSummary:true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 종료/i }))
    })
    expect(screen.queryByText('이번 회의를 AI로 최종 요약할까요?')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(meetingsApi.stopMeeting).toHaveBeenCalledWith(1, { skipSummary: true })
    })
  })

  it('전사 있으면 "회의 종료" → 다이얼로그 → "요약 없이 종료"는 skipSummary로 종료', async () => {
    renderPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 시작/i }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /회의 종료/i })).toBeInTheDocument()
    })
    // 라이브 기록 1건 주입(시작 정착 후) → 종료 시 확인 다이얼로그가 떠야 한다
    act(() => {
      useTranscriptStore.setState({
        finals: [{
          id: 1, content: '안녕하세요', speaker_label: 'SPEAKER_00',
          started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false,
        }],
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /회의 종료/i }))
    })
    const skipBtn = await screen.findByRole('button', { name: '요약 없이 종료' })
    await act(async () => {
      fireEvent.click(skipBtn)
    })
    await waitFor(() => {
      expect(meetingsApi.stopMeeting).toHaveBeenCalledWith(1, { skipSummary: true })
    })
  })

  // ──────────────────────────────────────────────
  // 예약 자동시작 (autoStart)
  // ──────────────────────────────────────────────

  describe('예약 자동시작 (autoStart)', () => {
    it('state.autoStart=true면 클릭 없이 마운트 시 startMeeting 호출', async () => {
      renderPageWithState({ autoStart: true })
      await waitFor(() => {
        expect(meetingsApi.startMeeting).toHaveBeenCalledWith(1)
      })
    })

    it('state.autoStart가 없으면 자동시작하지 않는다(수동 버튼 경로 보존)', async () => {
      renderPage()
      // 마운트가 정착할 시간을 준 뒤에도 startMeeting 미호출
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /회의 시작/i })).toBeInTheDocument()
      })
      expect(meetingsApi.startMeeting).not.toHaveBeenCalled()
    })
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
      // 데스크톱 우측 패널 기본 활성 탭이 'AI 챗'으로 바뀌어 메모 에디터가 기본 렌더되지 않음 → 메모 탭 클릭
      fireEvent.click(screen.getByRole('button', { name: '메모' }))
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
      expect(screen.getByRole('tab', { name: /기록/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /요약/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /메모/i })).toBeInTheDocument()
    })

    it('기본 탭은 AI 챗이며 챗 영역이 보임', () => {
      renderPage()
      // 모바일 기본 활성 탭이 'AI 챗'으로 변경됨 → 챗 입력창이 보이는 tabpanel이 활성
      const chatInput = screen.getByPlaceholderText('회의에 질문하기…')
      expect(chatInput).toBeInTheDocument()
      const tabPanel = chatInput.closest('[role="tabpanel"]')
      expect(tabPanel).toHaveStyle({ visibility: 'visible' })
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

    it('녹음 중이 아닐 때 MobileRecordControls는 회의 시작 상태로 표시된다', () => {
      renderPage()
      // 모바일 컨트롤 바는 항상 마운트되며 대기 상태에서는 "회의 시작"을 보여준다
      const controls = screen.getByTestId('mobile-record-controls')
      expect(controls).toBeInTheDocument()
      expect(within(controls).getByRole('button', { name: /회의 시작/i })).toBeInTheDocument()
      // 녹음 표시등은 아직 없음
      expect(screen.queryByTestId('mobile-recording-dot')).not.toBeInTheDocument()
    })

    it('녹음 중일 때 MobileRecordControls에 녹음 표시등이 보인다', async () => {
      vi.mocked(useAudioRecorderModule.useAudioRecorder).mockReturnValue({
        isRecording: true,
        isPaused: false,
        error: null,
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        discard: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        feedSystemAudio: vi.fn(),
      })
      renderPage()
      // 데스크톱/모바일 컨트롤이 모두 DOM에 있으므로 모바일 바 내부로 범위를 좁힌다
      const controls = screen.getByTestId('mobile-record-controls')
      await act(async () => {
        fireEvent.click(within(controls).getByRole('button', { name: /회의 시작/i }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('mobile-recording-dot')).toBeInTheDocument()
      })
    })
  })
})
