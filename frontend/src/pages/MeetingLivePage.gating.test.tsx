import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingLivePage from './MeetingLivePage'
import { useRecordingSignalsStore } from '../stores/recordingSignalsStore'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useRecordingStore } from '../stores/recordingStore'

// ──────────────────────────────────────────────
// 제어 게이팅: canEditMeeting(meeting, me)=false면 회의 시작/회의 초기화 버튼 숨김.
// canEditMeeting은 실제 구현을 사용한다(서버 editable 필드 1순위) — 게이팅 배선 자체가 관심사.
// ──────────────────────────────────────────────

vi.mock('../api/meetings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/meetings')>()
  return {
    ...actual,
    startMeeting: vi.fn().mockResolvedValue({ id: 7, status: 'recording' }),
    stopMeeting: vi.fn().mockResolvedValue({ id: 7, status: 'completed' }),
    getMeeting: vi.fn(),
    getMeetingDetail: vi.fn().mockResolvedValue({ meeting: { id: 7, title: '남의 회의', status: 'pending', started_at: null, ended_at: null, created_by_id: 99, created_at: '', updated_at: '' }, error: null }),
    getTranscripts: vi.fn().mockResolvedValue([]),
    getSummary: vi.fn().mockResolvedValue(null),
    triggerRealtimeSummary: vi.fn().mockResolvedValue(undefined),
    updateMeeting: vi.fn().mockResolvedValue({ id: 7 }),
    resetMeetingContent: vi.fn().mockResolvedValue({ id: 7, status: 'pending' }),
    updateNotes: vi.fn().mockResolvedValue(undefined),
  }
})

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

// GlossaryPanel(useGlossary)이 실제 API를 호출해 미mock fetch가 실백엔드로 나가는 것을 막는다
// (MeetingPage.test.tsx와 동일 패턴 — 오타수정 영역이 AI 회의록 아래로 내려오며 GlossaryPanel이
// 항상 마운트되므로 이 mock이 필요해졌다).
vi.mock('../api/glossary', () => ({
  getGlossary: vi.fn().mockResolvedValue({
    meeting: { entries: [] },
    folder: null,
    ancestors: [],
    resolved: [],
  }),
  createMeetingGlossaryEntry: vi.fn(),
  createFolderGlossaryEntry: vi.fn(),
  updateGlossaryEntry: vi.fn(),
  deleteGlossaryEntry: vi.fn(),
  reapplyGlossary: vi.fn(),
  applyGlossaryEntry: vi.fn(),
}))

// ──────────────────────────────────────────────

import * as meetingsApi from '../api/meetings'

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, status: 'pending', title: '남의 회의', meeting_type: 'general',
    created_by: { id: 99, name: '남' }, brief_summary: null,
    audio_duration_ms: 0, last_transcript_end_ms: 0, last_sequence_number: 0,
    started_at: null, ended_at: null, created_at: '',
    ...overrides,
  }
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/meetings/7/live']}>
      <Routes>
        <Route path="/meetings/:id/live" element={<MeetingLivePage />} />
        <Route path="/meetings/:id/viewer" element={<div data-testid="viewer-route">VIEWER</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MeetingLivePage 제어 게이팅 (canEditMeeting)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRecordingSignalsStore.getState().reset()
    useTranscriptStore.getState().reset()
    useRecordingStore.getState().endSession()
    setDesktopMode(true)
  })

  it('editable=false 회의면 데스크톱에서 회의 시작/회의 초기화 버튼이 숨겨진다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting({ editable: false }) as never)
    renderPage()
    // 회의 로드 후 게이팅 적용 — 버튼이 사라질 때까지 대기
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /회의 시작/i })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /회의 초기화/i })).not.toBeInTheDocument()
  })

  it('editable=true 회의면 회의 시작/회의 초기화 버튼이 노출된다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting({ editable: true }) as never)
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('남의 회의')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /회의 시작/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /회의 초기화/i })).toBeInTheDocument()
  })

  // 레이아웃 변경: 오타수정 UI는 더 이상 우측 탭이 아니라 회의 상세 화면과 동일하게
  // AI 회의록(summary) 패널 아래에 배치된다 — 탭 버튼은 canEdit 여부와 무관하게 항상 사라져야 한다.
  it('오타수정은 더 이상 우측 탭 버튼으로 노출되지 않는다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting({ editable: true }) as never)
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('남의 회의')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: '오타수정' })).not.toBeInTheDocument()
  })

  // idea 44: 오타수정·오타사전은 canEdit(=editable)이 false면 아예 노출되지 않아야 한다
  // (비협업자에게 편집 UI가 열려 있다가 서버 403으로만 막히던 원래 버그 증상 재발 방지).
  it('editable=false 회의면 AI 회의록 아래 오타수정 영역이 노출되지 않는다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting({ editable: false }) as never)
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('남의 회의')).toBeInTheDocument()
    })
    expect(screen.queryByText('오타 수정')).not.toBeInTheDocument()
    expect(screen.queryByText('오타 사전')).not.toBeInTheDocument()
  })

  it('editable=true 회의면 AI 회의록 아래에 오타수정·오타사전 영역이 노출된다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting({ editable: true }) as never)
    renderPage()
    const minutes = await screen.findByTestId('ai-minutes')
    await waitFor(() => {
      expect(within(minutes).getByText('오타 수정')).toBeInTheDocument()
    })
    expect(within(minutes).getByText('오타 사전')).toBeInTheDocument()
  })

  it('editable=false 모바일에서도 회의 시작 버튼과 더보기 시트의 회의 초기화가 숨겨진다', async () => {
    setDesktopMode(false)
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue(makeMeeting({ editable: false }) as never)
    renderPage()
    const controls = screen.getByTestId('mobile-record-controls')
    await waitFor(() => {
      expect(within(controls).queryByRole('button', { name: /회의 시작/i })).not.toBeInTheDocument()
    })
    // 더보기 시트에도 회의 초기화가 없어야 한다
    fireEvent.click(within(controls).getByRole('button', { name: /더보기/i }))
    const sheet = screen.getByTestId('mobile-more-options')
    expect(within(sheet).queryByText(/회의 초기화/)).not.toBeInTheDocument()
  })
})
