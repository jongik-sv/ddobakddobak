import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import LocalMeetingDetailPage from './LocalMeetingDetailPage'
import * as localStore from '../stt/localStore'

// localStore: getLocal/renameLocal 스파이.
vi.mock('../stt/localStore', () => ({
  getLocal: vi.fn(),
  renameLocal: vi.fn().mockResolvedValue(undefined),
}))

// 오디오 훅: 오디오 없음 상태로 고정(상세 렌더에 영향 없게).
vi.mock('../hooks/useLocalAudioPlayer', () => ({
  useLocalAudioPlayer: () => ({
    isReady: true,
    isPlaying: false,
    hasAudio: false,
    audioLoaded: false,
    srcReady: false,
    currentTimeMs: 0,
    durationMs: 0,
    playbackRate: 1,
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    setPlaybackRate: vi.fn(),
    download: vi.fn(),
    segmentOffsetsMs: [],
    seekToSegment: vi.fn(),
  }),
}))

// LiveRecord를 스텁(transcriptStore를 직접 읽으므로 렌더 검증만).
vi.mock('../components/meeting/LiveRecord', () => ({
  LiveRecord: ({ editable, onSeek }: { editable?: boolean; onSeek?: (ms: number) => void }) => (
    <div data-testid="live-record" data-editable={String(editable)}>
      기록 본문
      <button onClick={() => onSeek?.(0)}>seek-seg-0</button>
    </div>
  ),
}))

const META = {
  localId: 'local-abc',
  title: '내 오프라인 회의',
  lang: 'ko',
  created_at: '2026-06-01T00:00:00.000Z',
  status: 'completed' as const,
  pendingSync: false,
}

const SEGMENTS = [
  {
    id: 0,
    content: '첫 발화',
    speaker_label: '',
    started_at_ms: 0,
    ended_at_ms: 1000,
    sequence_number: 0,
    applied: false,
  },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/local-meetings/local-abc']}>
      <Routes>
        <Route path="/local-meetings/:localId" element={<LocalMeetingDetailPage />} />
        <Route path="/local-meetings/:localId/live" element={<div data-testid="live-route">라이브</div>} />
        <Route path="/local-meetings" element={<div data-testid="local-meetings-route">오프라인 목록</div>} />
        <Route path="/meetings" element={<div data-testid="meetings-route">목록</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(localStore.getLocal).mockResolvedValue({ meta: { ...META }, segments: SEGMENTS })
})

describe('LocalMeetingDetailPage', () => {
  it('meta+segments를 로드해 제목과 읽기전용 LiveRecord를 렌더', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('live-record')).toBeInTheDocument())
    expect(screen.getByTestId('live-record')).toHaveAttribute('data-editable', 'false')
    // 제목 표시(헤더)
    expect(screen.getByText('내 오프라인 회의')).toBeInTheDocument()
    expect(localStore.getLocal).toHaveBeenCalledWith('local-abc')
  })

  it('서버 결합 패널(요약/메모)을 렌더하지 않는다', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('live-record')).toBeInTheDocument())
    expect(screen.queryByTestId('ai-summary-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('memo-editor-panel')).not.toBeInTheDocument()
  })

  it('인라인 rename: 연필 → input 수정 → 저장 시 renameLocal 호출 + 헤더 갱신', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('내 오프라인 회의')).toBeInTheDocument())

    // 연필(이름 수정) 버튼.
    fireEvent.click(screen.getByRole('button', { name: /이름 수정/i }))
    const input = screen.getByRole('textbox', { name: /제목/i })
    fireEvent.change(input, { target: { value: '바뀐 제목' } })
    fireEvent.click(screen.getByRole('button', { name: /저장/i }))

    await waitFor(() =>
      expect(localStore.renameLocal).toHaveBeenCalledWith('local-abc', '바뀐 제목'),
    )
    // 헤더가 새 제목으로 갱신.
    await waitFor(() => expect(screen.getByText('바뀐 제목')).toBeInTheDocument())
  })

  it('뒤로 버튼 → /local-meetings(오프라인 목록)로 이동(전체회의 아님)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('live-record')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /뒤로/i }))
    expect(screen.getByTestId('local-meetings-route')).toBeInTheDocument()
    expect(screen.queryByTestId('meetings-route')).not.toBeInTheDocument()
  })

  it('"녹음 이어하기" 버튼 → 라이브 페이지로 이동(이어녹음 진입)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('live-record')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /녹음 이어하기/i }))
    expect(screen.getByTestId('live-route')).toBeInTheDocument()
  })
})
