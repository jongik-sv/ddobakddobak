import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import MeetingPage from './MeetingPage'

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const { mockMeetingBase, mockAudioFileA, mockAudioFileB, mockOtherFileA, mockOtherFileB } = vi.hoisted(() => {
  function makeDropFile(name: string, type: string) {
    return new File([new Uint8Array(4)], name, { type })
  }
  return {
    mockAudioFileA: makeDropFile('audio-a.mp3', 'audio/mpeg'),
    mockAudioFileB: makeDropFile('audio-b.mp3', 'audio/mpeg'),
    mockOtherFileA: makeDropFile('other-a.pdf', 'application/pdf'),
    mockOtherFileB: makeDropFile('other-b.pdf', 'application/pdf'),
    mockMeetingBase: {
      id: 1,
      title: '테스트 회의',
      status: 'completed' as const,
      meeting_type: 'general',
      created_by: { id: 1, name: '테스터' },
      brief_summary: null,
      audio_duration_ms: 0,
      last_transcript_end_ms: 0,
      last_sequence_number: 0,
      memo: null,
      attendees: null,
      folder_id: null,
      shared: true,
      locked: false,
      locked_at: null,
      important: false,
      editable: true,
      started_at: '2026-03-25T10:00:00Z',
      ended_at: '2026-03-25T11:00:00Z',
      created_at: '2026-03-25T10:00:00Z',
    },
  }
})

vi.mock('../api/meetings', async () => ({
  ...(await vi.importActual<typeof import('../api/meetings')>('../api/meetings')),
  getMeetingDetail: vi.fn().mockResolvedValue({
    meeting: {
      id: 1,
      title: '테스트 회의',
      status: 'completed',
      team_id: 1,
      created_by_id: 1,
      created_by: { id: 1, name: '테스터' },
      shared: true,
      locked: false,
      locked_at: null,
      important: false,
      editable: true,
      started_at: '2026-03-25T10:00:00Z',
      ended_at: '2026-03-25T11:00:00Z',
      created_at: '2026-03-25T10:00:00Z',
      updated_at: '2026-03-25T11:00:00Z',
    },
    error: null,
  }),
  getMeeting: vi.fn().mockResolvedValue(mockMeetingBase),
  getSummary: vi.fn().mockResolvedValue({
    id: 1,
    meeting_id: 1,
    key_points: ['핵심 요약 내용'],
    decisions: ['결정 사항'],
    discussion_details: ['논의 세부 사항'],
    notes_markdown: '# 회의 노트',
    summary_type: 'final',
    generated_at: '2026-03-25T10:30:00Z',
  }),
  updateMeeting: vi.fn().mockResolvedValue({
    ...mockMeetingBase,
    title: '수정된 회의 제목',
  }),
  deleteMeeting: vi.fn().mockResolvedValue(undefined),
  getTranscripts: vi.fn().mockResolvedValue([]),
  reopenMeeting: vi.fn().mockResolvedValue(mockMeetingBase),
  regenerateStt: vi.fn().mockResolvedValue(mockMeetingBase),
  regenerateNotes: vi.fn().mockResolvedValue(undefined),
  updateNotes: vi.fn().mockResolvedValue(undefined),
  correctTerms: vi.fn().mockResolvedValue({ corrected_transcripts: 0 }),
}))

vi.mock('../hooks/useBlockSync', () => ({
  useBlockSync: vi.fn().mockReturnValue({
    isLoading: false,
    isSaving: false,
    error: null,
    initialContent: null,
    onEditorChange: vi.fn(),
  }),
}))

vi.mock('../components/editor/MeetingEditor', () => ({
  MeetingEditor: () => <div data-testid="meeting-editor">에디터 영역</div>,
  customSchema: { blockSpecs: {} },
}))

vi.mock('../hooks/useAudioPlayer', () => ({
  useAudioPlayer: vi.fn(() => ({
    isReady: true,
    isPlaying: false,
    hasAudio: true,
    audioLoaded: true,
    srcReady: true,
    currentTimeMs: 0,
    durationMs: 60000,
    playbackRate: 1,
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    setPlaybackRate: vi.fn(),
    download: vi.fn(),
  })),
}))

vi.mock('../components/meeting/AudioPlayer', () => ({
  AudioPlayer: (props: { seekMs?: number | null }) => (
    <div data-testid="audio-player" data-seek-ms={props.seekMs ?? ''} />
  ),
}))

vi.mock('../components/meeting/MiniAudioPlayer', () => ({
  MiniAudioPlayer: () => <div data-testid="mini-audio-player" />,
}))

vi.mock('../components/meeting/TranscriptPanel', () => ({
  TranscriptPanel: (props: {
    seekTick?: number
    onSeek?: (ms: number) => void
    readOnly?: boolean
    transcripts?: { id: number; sequence_number: number }[]
    onSplit?: (updated: unknown, inserted: unknown) => void
  }) => (
    <div
      data-testid="transcript-panel"
      data-seek-tick={props.seekTick}
      data-read-only={String(!!props.readOnly)}
      data-transcripts-count={props.transcripts?.length ?? 0}
      data-seq-json={JSON.stringify(props.transcripts?.map((t) => [t.id, t.sequence_number]) ?? [])}
    >
      <button onClick={() => props.onSeek?.(5000)}>transcript-seek-btn</button>
      <button
        onClick={() =>
          props.onSplit?.(
            { id: 1, speaker_label: 'A', content: '조각1', started_at_ms: 0, ended_at_ms: 500, sequence_number: 1 },
            { id: 2, speaker_label: 'B', content: '조각2', started_at_ms: 500, ended_at_ms: 1000, sequence_number: 2 },
          )
        }
      >
        transcript-split-btn
      </button>
    </div>
  ),
}))

vi.mock('../components/meeting/SpeakerPanel', () => ({
  SpeakerPanel: (props: { readOnly?: boolean }) => (
    <div data-testid="speaker-panel" data-read-only={String(!!props.readOnly)}>화자 영역</div>
  ),
}))

vi.mock('../api/bookmarks', () => ({
  getBookmarks: vi.fn().mockResolvedValue([]),
  deleteBookmark: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../components/meeting/ExportButton', () => ({
  ExportButton: () => <button data-testid="export-button">내보내기</button>,
}))

vi.mock('../components/meeting/AiSummaryPanel', () => ({
  AiSummaryPanel: (props: { editable?: boolean }) => (
    <div data-testid="ai-summary" data-editable={String(!!props.editable)}>AI 요약 영역</div>
  ),
}))

vi.mock('../components/meeting/AttachmentSection', () => ({
  AttachmentSection: () => <div data-testid="attachment-section" />,
}))

// ── 파일 드롭 트리아지 관련 컴포넌트 mock (findings #4·#5·#6 회귀 테스트용) ──────────
// 실제 드래그 이벤트/모달 UI 대신 버튼으로 각 콜백을 직접 트리거해 MeetingPage의 배선
// (병합 시맨틱·오버레이 disabled·지연 navigate)만 검증한다.
vi.mock('../components/meeting/MeetingFileDropOverlay', () => ({
  MeetingFileDropOverlay: (props: { disabled?: boolean; onFilesDropped: (files: File[]) => void }) => (
    <div data-testid="drop-overlay" data-disabled={String(!!props.disabled)}>
      <button onClick={() => props.onFilesDropped([mockOtherFileA])}>drop-other-1</button>
      <button onClick={() => props.onFilesDropped([mockOtherFileB])}>drop-other-2</button>
      <button onClick={() => props.onFilesDropped([mockAudioFileA])}>drop-audio-1</button>
      <button onClick={() => props.onFilesDropped([mockAudioFileA, mockOtherFileA])}>drop-mixed-1</button>
      <button onClick={() => props.onFilesDropped([mockAudioFileB, mockOtherFileB])}>drop-mixed-2</button>
    </div>
  ),
}))

vi.mock('../components/meeting/AttachmentTriageDialog', () => ({
  AttachmentTriageDialog: (props: { open: boolean; files: File[]; onClose: () => void; onUploaded?: () => void }) => (
    <div data-testid="triage-dialog" data-open={String(props.open)} data-files={props.files.map((f) => f.name).join(',')}>
      <button onClick={props.onClose}>triage-close</button>
      {/* 실제 다이얼로그가 업로드 전부 완료 시 onUploaded 후 onClose를 호출하며 자동으로
          닫히는 경로를 흉내낸다 — MeetingPage의 files=[] 리셋이 이 경로에서도 동작하는지 검증. */}
      <button
        onClick={() => {
          props.onUploaded?.()
          props.onClose()
        }}
      >
        triage-complete
      </button>
    </div>
  ),
}))

vi.mock('../components/meeting/AudioAppendChoiceDialog', () => ({
  AudioAppendChoiceDialog: (props: { fileCount: number; onAppend: () => void; onNewMeeting: () => void; onCancel: () => void }) => (
    <div data-testid="audio-choice-dialog" data-file-count={props.fileCount}>
      <button onClick={props.onAppend}>choice-append</button>
      <button onClick={props.onNewMeeting}>choice-new-meeting</button>
      <button onClick={props.onCancel}>choice-cancel</button>
    </div>
  ),
}))

vi.mock('../components/meeting/AudioAppendFlowDialog', () => ({
  AudioAppendFlowDialog: (props: { open: boolean; onClose: () => void; onMergeStarted?: () => void }) =>
    props.open ? (
      <div data-testid="audio-append-flow">
        <button onClick={() => props.onMergeStarted?.()}>flow-merge-started</button>
        <button onClick={props.onClose}>flow-close</button>
      </div>
    ) : null,
}))

vi.mock('../components/meeting/UploadAudioModal', () => ({
  UploadAudioModal: (props: { onCreated: (m: { id: number }) => void; onClose: () => void }) => (
    <div data-testid="upload-audio-modal">
      <button onClick={() => props.onCreated({ id: 999 })}>upload-modal-created</button>
      <button onClick={props.onClose}>upload-modal-close</button>
    </div>
  ),
}))

// GlossaryPanel(useGlossary)·RightTabsPanel 내 AiChatPanel(chatStore)이 실제 API를 호출해
// 미mock fetch가 실백엔드(127.0.0.1:3000)로 나가 Unhandled Rejection을 일으키는 것을 막는다.
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

vi.mock('../api/chat', () => ({
  getChatMessages: vi.fn().mockResolvedValue([]),
  sendChatMessage: vi.fn(),
  getScopedChatMessages: vi.fn().mockResolvedValue([]),
  sendScopedChatMessage: vi.fn(),
}))

vi.mock('../api/bookmarks', () => ({
  getBookmarks: vi.fn().mockResolvedValue([]),
  deleteBookmark: vi.fn().mockResolvedValue(undefined),
  createBookmark: vi.fn(),
}))


vi.mock('../components/meeting/EditMeetingDialog', () => ({
  default: () => null,
}))

vi.mock('../hooks/useFileTranscriptionProgress', () => ({
  useFileTranscriptionProgress: vi.fn().mockReturnValue({
    progress: 0,
    status: 'idle',
    message: '',
    error: null,
  }),
}))

vi.mock('../hooks/useMemoEditor', () => ({
  useMemoEditor: vi.fn().mockReturnValue({
    memoEditorRef: { current: null },
    isSavingMemo: false,
    handleSaveMemo: vi.fn(),
  }),
}))

let mockIsDesktop = true
vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: () => mockIsDesktop,
  BREAKPOINTS: {
    sm: '(min-width: 640px)',
    md: '(min-width: 768px)',
    lg: '(min-width: 1024px)',
    xl: '(min-width: 1280px)',
  },
}))

vi.mock('@rails/actioncable', () => ({
  createConsumer: vi.fn(() => ({
    subscriptions: {
      create: vi.fn(() => ({
        unsubscribe: vi.fn(),
      })),
    },
    disconnect: vi.fn(),
  })),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// ──────────────────────────────────────────────

import * as meetingsApi from '../api/meetings'
import type { Meeting } from '../api/meetings'
import { useProjectStore } from '../stores/projectStore'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useUiStore } from '../stores/uiStore'

// 테스트에서 URL 쿼리스트링 상태를 관찰하기 위한 프로브 — MemoryRouter는 실제
// window.location을 건드리지 않으므로 useLocation()으로 직접 읽어 DOM에 노출한다.
function LocationSearchProbe() {
  const location = useLocation()
  return <div data-testid="location-search" data-search={location.search} />
}

function renderPage(meetingId = '1', search = '') {
  return render(
    <MemoryRouter initialEntries={[`/meetings/${meetingId}${search}`]}>
      <LocationSearchProbe />
      <Routes>
        <Route path="/meetings/:id" element={<MeetingPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MeetingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDesktop = true
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue(mockMeetingBase)
    vi.mocked(meetingsApi.getSummary).mockResolvedValue({
      id: 1,
      meeting_id: 1,
      key_points: ['핵심 요약 내용'],
      decisions: ['결정 사항'],
      discussion_details: ['논의 세부 사항'],
      notes_markdown: '# 회의 노트',
      summary_type: 'final',
      generated_at: '2026-03-25T10:30:00Z',
    })
    vi.mocked(meetingsApi.updateMeeting).mockResolvedValue({
      ...mockMeetingBase,
      title: '수정된 회의 제목',
    })
    vi.mocked(meetingsApi.deleteMeeting).mockResolvedValue(undefined)
    vi.mocked(meetingsApi.getTranscripts).mockResolvedValue([])
    vi.mocked(meetingsApi.getMeetingDetail).mockResolvedValue({
      meeting: {
        id: 1,
        title: '테스트 회의',
        status: 'completed',
        created_by_id: 1,
        shared: true,
        locked: false,
        locked_at: null,
        important: false,
        started_at: '2026-03-25T10:00:00Z',
        ended_at: '2026-03-25T11:00:00Z',
        created_at: '2026-03-25T10:00:00Z',
        updated_at: '2026-03-25T11:00:00Z',
      },
      error: null,
    })
  })

  it('회의 제목이 표시된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
  })

  it('에디터 영역이 렌더링된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('transcript-panel')).toBeInTheDocument()
    })
  })

  it('AI 요약 섹션이 표시된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
    })
  })

  it('화자 패널(SpeakerPanel)이 표시된다 — 배치 화자분리 결과 이름 변경용', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('speaker-panel')).toBeInTheDocument()
    })
  })

  // 우측(메모·AI챗) 패널 토글 시 트랜스크립트↔AI회의록 경계가 움직이던 버그의 회귀 방지.
  // 패널을 unmount하는 대신 collapse(0%)/expand로만 크기를 바꿔, 해제된 폭을
  // 항상 AI 회의록(가운데) 패널이 흡수하고 트랜스크립트(좌측) 폭은 고정되어야 한다.
  it('우측 패널을 숨겨도 트랜스크립트 폭은 그대로고 AI 회의록 폭만 늘어난다', async () => {
    useUiStore.setState({ memoVisible: true })
    const { container } = renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
    })

    const getFlex = (id: string) =>
      (container.querySelector(`#${id}`) as HTMLElement | null)?.style.flex

    await waitFor(() => {
      expect(getFlex('transcript')).toBeTruthy()
      expect(getFlex('right-tabs')).toBeTruthy()
    })
    const transcriptBefore = getFlex('transcript')
    const summaryBefore = getFlex('summary')

    act(() => {
      useUiStore.getState().toggleMemo()
    })

    // 우측 패널이 0%로 접힐 때까지 대기(collapse는 이펙트에서 비동기적으로 트리거됨)
    await waitFor(() => {
      expect(getFlex('right-tabs')).toMatch(/^0(\s|$)/)
    })

    expect(getFlex('transcript')).toBe(transcriptBefore)
    expect(getFlex('summary')).not.toBe(summaryBefore)

    useUiStore.setState({ memoVisible: true }) // 다른 테스트로 상태 오염 방지
  })

  // 우측 패널 토글 버튼을 탑바에서 패널 근처로 이동(사이드바 PanelLeftClose/PanelLeft와 대칭).
  it('탑바에는 더 이상 메모 토글 버튼이 없고, 패널 접기/펼치기는 패널 자체 근처에서 동작한다', async () => {
    useUiStore.setState({ memoVisible: true })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
    })

    // 탑바(StickyNote) 메모 토글 버튼은 완전히 제거되었다.
    expect(screen.queryByRole('button', { name: '메모 보기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '메모 숨기기' })).not.toBeInTheDocument()

    // 열림 상태: 우측 패널(RightTabsPanel) 탭 헤더 안의 "패널 접기" 버튼으로 접는다.
    const collapseButton = screen.getByRole('button', { name: '패널 접기' })
    fireEvent.click(collapseButton)

    // 접힘 상태: 화면 우측 엣지에 "패널 펼치기" 버튼이 나타나고, 접기 버튼은 사라진다(콘텐츠 언마운트).
    const expandButton = await screen.findByRole('button', { name: '패널 펼치기' })
    expect(screen.queryByRole('button', { name: '패널 접기' })).not.toBeInTheDocument()

    // 다시 펼치면 탭 헤더와 접기 버튼이 복귀한다.
    fireEvent.click(expandButton)
    await screen.findByRole('button', { name: '패널 접기' })
    expect(screen.queryByRole('button', { name: '패널 펼치기' })).not.toBeInTheDocument()

    useUiStore.setState({ memoVisible: true }) // 다른 테스트로 상태 오염 방지
  })

  // 데스크톱/모바일 두 분기가 MeetingActionHeader에 넘기는 공통 prop(메모 스프레드 추출) 회귀 방지.
  // isDesktop=false(모바일)일 때도 제목·잠금 토글 등 동일 prop이 그대로 전달되어야 한다.
  it('isDesktop=false(모바일)에서도 MeetingActionHeader에 제목·잠금 토글이 정상 전달된다', async () => {
    mockIsDesktop = false
    renderPage()

    await screen.findByText('테스트 회의')

    // 잠금 토글 버튼(canEdit=true, onToggleLock 전달)이 모바일 분기에서도 노출된다.
    expect(screen.getByRole('button', { name: /잠금/ })).toBeInTheDocument()
  })

  // idea 44: editable=false(비소유자)면 잠금 여부와 무관하게 전사·화자·AI요약이 readOnly여야 한다.
  // 서버 editable을 무시하고 locked만 보던 버그(수정은 되나 저장은 403) 회귀 방지.
  // meeting 상태는 useMeeting() 훅이 getMeeting()으로 채운다(getMeetingDetail은 useMeetingAccess 전용).
  it('editable=false(비소유자)면 SpeakerPanel/TranscriptPanel/AiSummaryPanel이 readOnly로 렌더된다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue({ ...mockMeetingBase, editable: false })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('speaker-panel')).toHaveAttribute('data-read-only', 'true')
    })
    expect(screen.getByTestId('transcript-panel')).toHaveAttribute('data-read-only', 'true')
    expect(screen.getByTestId('ai-summary')).toHaveAttribute('data-editable', 'false')
  })

  it('editable=true(소유자)면 SpeakerPanel/TranscriptPanel/AiSummaryPanel이 편집 가능하게 렌더된다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue({ ...mockMeetingBase, editable: true })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('speaker-panel')).toHaveAttribute('data-read-only', 'false')
    })
    expect(screen.getByTestId('transcript-panel')).toHaveAttribute('data-read-only', 'false')
    expect(screen.getByTestId('ai-summary')).toHaveAttribute('data-editable', 'true')
  })

  // idea 44: 오타수정/오타사전은 잠금뿐 아니라 canEdit(=editable)도 반영해야 한다.
  // canEdit 없이 locked만 보던 버그 회귀 방지(비협업자에게 편집 UI가 그대로 열려 있던 문제).
  it('editable=false(비소유자)면 오타수정/오타사전 섹션이 렌더되지 않는다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue({ ...mockMeetingBase, editable: false })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
    })
    expect(screen.queryByText('오타 수정')).not.toBeInTheDocument()
    expect(screen.queryByText('오타 사전')).not.toBeInTheDocument()
  })

  it('editable=true(소유자)면 오타수정 섹션이 렌더된다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue({ ...mockMeetingBase, editable: true })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('오타 수정')).toBeInTheDocument()
    })
  })

  it('제목 클릭 시 인라인 편집 input이 표시된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('테스트 회의'))
    expect(screen.getByDisplayValue('테스트 회의')).toBeInTheDocument()
  })

  it('제목 편집 후 Enter 키 입력 시 updateMeeting API가 호출된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('테스트 회의'))
    const input = screen.getByDisplayValue('테스트 회의')
    fireEvent.change(input, { target: { value: '수정된 회의 제목' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(meetingsApi.updateMeeting).toHaveBeenCalledWith(1, { title: '수정된 회의 제목' })
    })
  })

  it('삭제 버튼 클릭 시 deleteMeeting API가 호출된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    const deleteButton = screen.getByRole('button', { name: /삭제/i })
    await act(async () => {
      fireEvent.click(deleteButton)
    })
    await waitFor(() => {
      expect(meetingsApi.deleteMeeting).toHaveBeenCalledWith(1)
    })
  })

  it('삭제 후 /dashboard로 이동한다', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    const deleteButton = screen.getByRole('button', { name: /삭제/i })
    await act(async () => {
      fireEvent.click(deleteButton)
    })
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('뒤로가기 클릭 시 원래 폴더(folder_id)로 복귀한다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue({ ...mockMeetingBase, folder_id: 5 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '목록으로 돌아가기' }))
    expect(mockNavigate).toHaveBeenCalledWith('/meetings?folder=5')
  })

  it('미분류(folder_id null) 회의는 뒤로가기 시 ?folder=none으로 복귀한다', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue({ ...mockMeetingBase, folder_id: null })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '목록으로 돌아가기' }))
    expect(mockNavigate).toHaveBeenCalledWith('/meetings?folder=none')
  })

  it('뒤로가기 시 폴더 컨텍스트를 잃는 홈("/")으로 이동하지 않는다 — 회귀 방지', async () => {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue({ ...mockMeetingBase, folder_id: 5 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '목록으로 돌아가기' }))
    expect(mockNavigate).not.toHaveBeenCalledWith('/')
  })

  // useMeeting/useMeetingAccess의 모듈 캐시가 테스트 간 공유되므로,
  // 아래 신규 테스트들은 고유 meetingId로 캐시 오염을 피한다.
  function mockMeetingWithId(id: number, overrides: Partial<Meeting> = {}) {
    vi.mocked(meetingsApi.getMeeting).mockResolvedValue({ ...mockMeetingBase, id, ...overrides })
  }

  it('크로스 프로젝트 뒤로가기: 회의의 프로젝트로 컨텍스트 동기화 후 폴더로 이동한다', async () => {
    // 전역검색·딥링크로 다른 프로젝트의 회의에 진입한 경우 — 폴더가 현재 프로젝트 밖이면
    // 프로젝트를 먼저 전환해야 빈 회의 목록에 떨어지지 않는다.
    useProjectStore.setState({ currentProjectId: 1 })
    mockMeetingWithId(301, { folder_id: 5, project_id: 2 })
    renderPage('301')
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '목록으로 돌아가기' }))
    expect(useProjectStore.getState().currentProjectId).toBe(2)
    expect(mockNavigate).toHaveBeenCalledWith('/meetings?folder=5')
  })

  it('같은 프로젝트 회의의 뒤로가기는 프로젝트 컨텍스트를 바꾸지 않는다', async () => {
    useProjectStore.setState({ currentProjectId: 1 })
    mockMeetingWithId(302, { folder_id: 5, project_id: 1 })
    renderPage('302')
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '목록으로 돌아가기' }))
    expect(useProjectStore.getState().currentProjectId).toBe(1)
    expect(mockNavigate).toHaveBeenCalledWith('/meetings?folder=5')
  })

  it('summary_error_message가 없으면 summaryError를 주입하지 않는다', async () => {
    useTranscriptStore.setState({ summaryError: null })
    mockMeetingWithId(310)
    renderPage('310')
    await waitFor(() => {
      expect(screen.getByText('테스트 회의')).toBeInTheDocument()
    })
    expect(useTranscriptStore.getState().summaryError).toBeNull()
  })

  it('영속 실패 필드(summary_error_message)가 있으면 로드 시 summaryError 배지 상태를 주입한다', async () => {
    // 새로고침·정지 후 재진입 시나리오: broadcast는 이미 지나갔고 서버 영속 필드만 남아 있다
    useTranscriptStore.setState({ summaryError: null })
    mockMeetingWithId(311, {
      summary_error_message: '최종 요약 실패 사유',
      summary_error_at: '2026-03-25T11:00:00Z',
    })
    renderPage('311')
    await waitFor(() => {
      expect(useTranscriptStore.getState().summaryError).toEqual({
        kind: 'final',
        message: '최종 요약 실패 사유',
      })
    })
  })

  it('broadcast로 이미 summaryError가 떠 있으면 영속 필드로 덮어쓰지 않는다', async () => {
    useTranscriptStore.setState({ summaryError: null })
    mockMeetingWithId(312, { summary_error_message: '영속 필드 사유' })
    renderPage('312')
    // 최초 로드에서 영속 필드가 주입된 뒤,
    await waitFor(() => {
      expect(useTranscriptStore.getState().summaryError?.message).toBe('영속 필드 사유')
    })
    // 실시간 broadcast가 더 최신 사유를 세팅한 상황을 재현
    act(() => {
      useTranscriptStore.setState({ summaryError: { kind: 'final', message: '실시간 broadcast 사유' } })
    })
    // 이후 리렌더/refetch로 effect가 재실행돼도 덮어쓰지 않아야 한다
    await waitFor(() => {
      expect(useTranscriptStore.getState().summaryError?.message).toBe('실시간 broadcast 사유')
    })
  })

  it('getMeeting과 getSummary가 병렬 호출된다', async () => {
    renderPage()
    await waitFor(() => {
      expect(meetingsApi.getMeeting).toHaveBeenCalledWith(1)
      expect(meetingsApi.getSummary).toHaveBeenCalledWith(1)
    })
  })

  // 전역 검색에서 ?q=<query>와 함께 진입하면 회의내 검색이 1회 자동 실행되고,
  // 적용 후 URL에서 q가 제거되어야 한다(새로고침/뒤로가기 재발동 방지).
  it('?q= 로 진입하면 회의내 검색이 자동 실행되고 URL에서 q가 제거된다', async () => {
    renderPage('1', '?q=테스트검색어')
    await waitFor(() => {
      expect(screen.getByPlaceholderText('전사·요약 검색')).toHaveValue('테스트검색어')
    })
    await waitFor(() => {
      expect(screen.getByTestId('location-search').getAttribute('data-search')).not.toContain('q=')
    })
  })

  // 폴더/프로젝트 챗 인용 클릭으로 ?t=<ms>와 함께 진입하면 오디오 준비 후 1회 자동 seek되고,
  // 적용 후 URL에서 t가 제거되어야 한다.
  it('?t=<ms> 로 진입하면 오디오가 자동 seek되고 URL에서 t가 제거된다', async () => {
    renderPage('1', '?t=5000')
    await waitFor(() => {
      expect(screen.getByTestId('audio-player')).toHaveAttribute('data-seek-ms', '5000')
    })
    await waitFor(() => {
      expect(screen.getByTestId('location-search').getAttribute('data-search')).not.toContain('t=')
    })
  })

  // #43 — seek 발생 시 TranscriptPanel에 seekTick이 증가해 전달되는지 배선 수준에서 검증한다
  // (강제 스크롤 자체는 TranscriptPanel 단위 테스트가 커버).
  describe('seek 배선 (#43)', () => {
    it('seek 시 TranscriptPanel에 seekTick이 증가해 전달된다', async () => {
      mockMeetingWithId(330)
      renderPage('330')
      await waitFor(() => {
        expect(screen.getByTestId('transcript-panel')).toBeInTheDocument()
      })
      const beforeTick = screen.getByTestId('transcript-panel').getAttribute('data-seek-tick')

      fireEvent.click(screen.getByText('transcript-seek-btn'))

      await waitFor(() => {
        const afterTick = screen.getByTestId('transcript-panel').getAttribute('data-seek-tick')
        expect(afterTick).not.toBe(beforeTick)
      })
    })
  })

  // 전사 분할(split): 원격(다른 클라이언트) split은 store.applySplit만으론 이 페이지의
  // transcripts(prop 구조)에 반영되지 않아 조각2가 화면에서 소실된 것처럼 보이던 버그의 회귀 방지.
  // remoteStructureRevision 변화를 감지해 재조회하되, 로컬 split(onSplit 직접 호출)에서는
  // 중복 재조회가 없어야 한다.
  describe('전사 분할(split) 재조회 배선', () => {
    it('원격 split 신호(remoteStructureRevision 증가) 수신 후 getTranscripts가 재호출되고 화면에 반영된다', async () => {
      mockMeetingWithId(340)
      vi.mocked(meetingsApi.getTranscripts).mockResolvedValueOnce([])
      renderPage('340')
      await waitFor(() => {
        expect(screen.getByTestId('transcript-panel')).toHaveAttribute('data-transcripts-count', '0')
      })
      const callsBefore = vi.mocked(meetingsApi.getTranscripts).mock.calls.length

      vi.mocked(meetingsApi.getTranscripts).mockResolvedValueOnce([
        { id: 1, speaker_label: 'A', content: '조각1', started_at_ms: 0, ended_at_ms: 500, sequence_number: 1 },
        { id: 2, speaker_label: 'B', content: '조각2', started_at_ms: 500, ended_at_ms: 1000, sequence_number: 2 },
      ])

      act(() => {
        useTranscriptStore.getState().markRemoteStructureChange()
      })

      await waitFor(() => {
        expect(screen.getByTestId('transcript-panel')).toHaveAttribute('data-transcripts-count', '2')
      })
      expect(vi.mocked(meetingsApi.getTranscripts).mock.calls.length).toBeGreaterThan(callsBefore)
    })

    it('로컬 split(TranscriptPanel onSplit 콜백)은 화면에 즉시 반영되지만 getTranscripts를 재호출하지 않는다', async () => {
      mockMeetingWithId(341)
      vi.mocked(meetingsApi.getTranscripts).mockResolvedValue([
        { id: 1, speaker_label: 'A', content: '원본', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1 },
      ])
      renderPage('341')
      await waitFor(() => {
        expect(screen.getByTestId('transcript-panel')).toHaveAttribute('data-transcripts-count', '1')
      })
      const callsBefore = vi.mocked(meetingsApi.getTranscripts).mock.calls.length

      fireEvent.click(screen.getByText('transcript-split-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('transcript-panel')).toHaveAttribute('data-transcripts-count', '2')
      })
      expect(vi.mocked(meetingsApi.getTranscripts).mock.calls.length).toBe(callsBefore)
    })

    // 백엔드 split은 분할 대상 뒤의 모든 행을 sequence_number+1로 재번호하는데, 로컬 split은
    // 재조회를 하지 않으므로(위 테스트) handleTranscriptSplit이 같은 재번호를 직접 미러링해야
    // 트레일링 행의 클라 상태가 서버 실제값과 어긋나지 않는다.
    it('로컬 split 후 트레일링 행의 sequence_number가 서버 재번호 규칙대로 +1 된다', async () => {
      mockMeetingWithId(342)
      vi.mocked(meetingsApi.getTranscripts).mockResolvedValue([
        { id: 1, speaker_label: 'A', content: '원본1', started_at_ms: 0, ended_at_ms: 500, sequence_number: 1 },
        { id: 3, speaker_label: 'B', content: '트레일링', started_at_ms: 500, ended_at_ms: 1000, sequence_number: 2 },
      ])
      renderPage('342')
      await waitFor(() => {
        expect(screen.getByTestId('transcript-panel')).toHaveAttribute('data-transcripts-count', '2')
      })

      // 목(mock) TranscriptPanel의 분할 버튼은 항상 { id:1, sequence_number:1 } → { id:2, sequence_number:2 }로
      // onSplit을 호출한다 — 백엔드가 원행(seq 1)은 그대로 두고 조각2를 seq 2로 삽입하는 것과 동일한 형태.
      fireEvent.click(screen.getByText('transcript-split-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('transcript-panel')).toHaveAttribute('data-transcripts-count', '3')
      })
      const seq = JSON.parse(
        screen.getByTestId('transcript-panel').getAttribute('data-seq-json') ?? '[]'
      ) as [number, number][]
      // [id, sequence_number] — id:1(원행) 그대로 1, id:2(삽입) 2, id:3(트레일링)은 2→3으로 밀려야 한다.
      expect(seq).toEqual([
        [1, 1],
        [2, 2],
        [3, 3],
      ])
    })
  })

  // 파일 드롭 트리아지 findings #4·#5·#6 회귀 테스트
  describe('파일 드롭 트리아지', () => {
    // findings #4: 이미 열린 첨부 triage에 또 드롭하면 기존 목록에 병합돼야 한다(교체 금지).
    it('첨부 triage가 열려 있는 상태에서 다시 드롭하면 기존 파일 목록에 병합된다', async () => {
      mockMeetingWithId(350)
      renderPage('350')
      await waitFor(() => expect(screen.getByTestId('drop-overlay')).toBeInTheDocument())

      fireEvent.click(screen.getByText('drop-other-1'))
      await waitFor(() => expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-open', 'true'))
      expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-files', 'other-a.pdf')

      fireEvent.click(screen.getByText('drop-other-2'))
      await waitFor(() =>
        expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-files', 'other-a.pdf,other-b.pdf'),
      )
    })

    // findings #4: pendingOthersRef.current = others 덮어씀 버그 — 오디오 플로우 진행 중
    // 기타 파일이 포함된 드롭이 두 번 발생하면 첫 번째 분의 기타 파일이 유실되면 안 된다.
    it('오디오 선택 다이얼로그가 열린 동안 기타 파일이 섞인 드롭이 두 번 발생해도 보류된 기타 파일이 누적된다', async () => {
      mockMeetingWithId(351, { has_audio_file: true })
      renderPage('351')
      await waitFor(() => expect(screen.getByTestId('drop-overlay')).toBeInTheDocument())

      fireEvent.click(screen.getByText('drop-mixed-1'))
      await waitFor(() => expect(screen.getByTestId('audio-choice-dialog')).toBeInTheDocument())

      fireEvent.click(screen.getByText('drop-mixed-2'))

      // 오디오 선택을 취소하면 보류된 기타 파일들이 triage로 flush된다.
      fireEvent.click(screen.getByText('choice-cancel'))
      await waitFor(() => expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-open', 'true'))
      expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-files', 'other-a.pdf,other-b.pdf')
    })

    // findings #4 후속: 업로드가 전부 완료되어 다이얼로그가 자동으로 닫힌 뒤, 다시 드롭하면
    // 이전 세션의 파일 목록이 남아있어 새 드롭이 "이미 아는 파일"로 오인돼 조용히 씹히면 안 된다.
    it('업로드 완료로 triage가 자동 종료된 뒤 다시 드롭하면 새 세션으로 정상 접수된다', async () => {
      mockMeetingWithId(355)
      renderPage('355')
      await waitFor(() => expect(screen.getByTestId('drop-overlay')).toBeInTheDocument())

      fireEvent.click(screen.getByText('drop-other-1'))
      await waitFor(() => expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-open', 'true'))
      expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-files', 'other-a.pdf')

      // 업로드 전부 완료 → 자동 종료
      fireEvent.click(screen.getByText('triage-complete'))
      await waitFor(() => expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-open', 'false'))

      // 새 세션에서 다시 드롭 — other-b.pdf만 보여야 한다(other-a.pdf 잔류·중복 없음).
      fireEvent.click(screen.getByText('drop-other-2'))
      await waitFor(() => expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-open', 'true'))
      expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-files', 'other-b.pdf')
    })

    // findings #5: 오디오 선택/연결/새회의 플로우가 열린 동안은 드롭 오버레이가 비활성화돼야 한다.
    // 첨부 triage만 열려 있을 때는 계속 드롭을 허용한다.
    it('오디오 관련 다이얼로그가 열려 있는 동안 드롭 오버레이가 비활성화되고, 첨부 triage만 열려 있을 때는 허용된다', async () => {
      mockMeetingWithId(352, { has_audio_file: true })
      renderPage('352')
      await waitFor(() => expect(screen.getByTestId('drop-overlay')).toHaveAttribute('data-disabled', 'false'))

      // 첨부 triage만 열림 → 여전히 허용
      fireEvent.click(screen.getByText('drop-other-1'))
      await waitFor(() => expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-open', 'true'))
      expect(screen.getByTestId('drop-overlay')).toHaveAttribute('data-disabled', 'false')

      // 오디오 선택 다이얼로그가 열림 → 비활성화
      fireEvent.click(screen.getByText('drop-audio-1'))
      await waitFor(() => expect(screen.getByTestId('audio-choice-dialog')).toBeInTheDocument())
      expect(screen.getByTestId('drop-overlay')).toHaveAttribute('data-disabled', 'true')

      // "기존 녹음 뒤에 연결" 선택 → AudioAppendFlowDialog가 열림 → 계속 비활성화
      fireEvent.click(screen.getByText('choice-append'))
      await waitFor(() => expect(screen.getByTestId('audio-append-flow')).toBeInTheDocument())
      expect(screen.getByTestId('drop-overlay')).toHaveAttribute('data-disabled', 'true')

      // 플로우 종료 → 다시 활성화
      fireEvent.click(screen.getByText('flow-close'))
      await waitFor(() => expect(screen.getByTestId('drop-overlay')).toHaveAttribute('data-disabled', 'false'))
    })

    // findings #6: 새 회의 생성 후, 현재 회의의 첨부 triage가 아직 열려 있으면(업로드 미완료
    // 가능성) 즉시 navigate하지 않고 triage가 닫힐 때까지 보류한다.
    it('첨부 triage가 열려 있는 동안 새 회의가 생성되면 navigate를 보류했다가 triage가 닫힐 때 이동한다', async () => {
      mockMeetingWithId(353, { has_audio_file: true })
      renderPage('353')
      await waitFor(() => expect(screen.getByTestId('drop-overlay')).toBeInTheDocument())

      // 첨부 triage를 먼저 연다.
      fireEvent.click(screen.getByText('drop-other-1'))
      await waitFor(() => expect(screen.getByTestId('triage-dialog')).toHaveAttribute('data-open', 'true'))

      // 오디오 드롭 → 선택 다이얼로그 → 새 회의로 생성
      fireEvent.click(screen.getByText('drop-audio-1'))
      await waitFor(() => expect(screen.getByTestId('audio-choice-dialog')).toBeInTheDocument())
      fireEvent.click(screen.getByText('choice-new-meeting'))
      await waitFor(() => expect(screen.getByTestId('upload-audio-modal')).toBeInTheDocument())

      fireEvent.click(screen.getByText('upload-modal-created'))

      // triage가 아직 열려 있으므로 아직 navigate하면 안 된다.
      expect(mockNavigate).not.toHaveBeenCalledWith('/meetings/999')

      // triage를 닫으면 그제서야 navigate한다.
      fireEvent.click(screen.getByText('triage-close'))
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/meetings/999'))
    })

    // 기존 동작 회귀 방지: 첨부 triage가 열려 있지 않으면 새 회의 생성 즉시 navigate한다.
    it('첨부 triage가 열려 있지 않으면 새 회의 생성 시 즉시 navigate한다', async () => {
      mockMeetingWithId(354, { has_audio_file: true })
      renderPage('354')
      await waitFor(() => expect(screen.getByTestId('drop-overlay')).toBeInTheDocument())

      fireEvent.click(screen.getByText('drop-audio-1'))
      await waitFor(() => expect(screen.getByTestId('audio-choice-dialog')).toBeInTheDocument())
      fireEvent.click(screen.getByText('choice-new-meeting'))
      await waitFor(() => expect(screen.getByTestId('upload-audio-modal')).toBeInTheDocument())

      fireEvent.click(screen.getByText('upload-modal-created'))
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/meetings/999'))
    })
  })
})
