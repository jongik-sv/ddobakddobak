import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import LocalMeetingLivePage from './LocalMeetingLivePage'
import * as useLocalRecordingModule from '../hooks/useLocalRecording'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../api/settings', () => ({
  getLanguageSettings: vi.fn().mockResolvedValue({ mode: 'single', languages: ['ko'] }),
}))
vi.mock('../stt/cohereLang', () => ({ localSttLanguage: () => 'ko' }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  IS_TAURI: true,
}))
vi.mock('../components/stt/ModelManager', () => ({
  default: () => <div data-testid="model-manager">모델 매니저</div>,
}))
vi.mock('../components/meeting/LiveRecord', () => ({
  LiveRecord: ({ editable }: { editable?: boolean }) => (
    <div data-testid="live-record" data-editable={String(editable)}>기록 본문</div>
  ),
}))
vi.mock('../hooks/useLocalRecording')

const baseRec = {
  status: 'idle' as const,
  meta: { title: '내 오프라인 회의' } as any,
  error: null as string | null,
  elapsedSeconds: 0,
  isRecording: false,
  modelLoading: false,
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/local-meetings/local-abc/live']}>
      <Routes>
        <Route path="/local-meetings/:localId/live" element={<LocalMeetingLivePage />} />
        <Route path="/meetings" element={<div data-testid="meetings-route">회의목록</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LocalMeetingLivePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useLocalRecordingModule.useLocalRecording).mockReturnValue({ ...baseRec })
  })

  it('모델 준비됨 → 3-zone 셸(헤더/기록탭/상태바) + 읽기전용 LiveRecord 렌더', async () => {
    vi.mocked(invoke).mockResolvedValue({ dir: '/models/cohere' })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('mobile-record-controls')).toBeInTheDocument()
    })
    // 단일 "기록" 탭
    expect(screen.getByRole('tab', { name: /기록/i })).toBeInTheDocument()
    // 전사 본문 = 읽기전용 LiveRecord
    const rec = screen.getByTestId('live-record')
    expect(rec).toHaveAttribute('data-editable', 'false')
    // 상태바 STT 엔진 표기
    expect(screen.getByText(/온디바이스/)).toBeInTheDocument()
    // 제목은 meta.title
    expect(screen.getByText('내 오프라인 회의')).toBeInTheDocument()
  })

  it('모델 미설치 → 기록 탭 본문이 ModelManager로 대체', async () => {
    vi.mocked(invoke).mockResolvedValue(null)
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('model-manager')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('live-record')).not.toBeInTheDocument()
  })

  it('rec.error는 상태바 statusMessage로 노출', async () => {
    vi.mocked(invoke).mockResolvedValue({ dir: '/models/cohere' })
    vi.mocked(useLocalRecordingModule.useLocalRecording).mockReturnValue({
      ...baseRec,
      error: '온디바이스 모델이 준비되지 않았습니다.',
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('온디바이스 모델이 준비되지 않았습니다.')).toBeInTheDocument()
    })
  })

  it('헤더 "회의 시작" 클릭 시 rec.start 호출', async () => {
    vi.mocked(invoke).mockResolvedValue({ dir: '/models/cohere' })
    const start = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useLocalRecordingModule.useLocalRecording).mockReturnValue({ ...baseRec, start })
    renderPage()
    const controls = await screen.findByTestId('mobile-record-controls')
    fireEvent.click(within(controls).getByRole('button', { name: /회의 시작/i }))
    expect(start).toHaveBeenCalled()
  })
})
