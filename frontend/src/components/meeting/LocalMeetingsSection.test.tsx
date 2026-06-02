import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { LocalMeetingsSection } from './LocalMeetingsSection'
import * as localStore from '../../stt/localStore'

// 오프라인 섹션은 Android(Tauri 모바일)에서만 렌더 → 테스트 환경 강제.
vi.mock('../../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config')>()),
  IS_TAURI: true,
  IS_MOBILE: true,
}))
vi.mock('../../stt/localStore', () => ({
  listLocal: vi.fn(),
  createLocal: vi.fn(),
  deleteLocal: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../stt/syncQueue', () => ({ flush: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../stores/appSettingsStore', () => ({
  useAppSettingsStore: (sel: (s: { localUploadEnabled: boolean }) => unknown) =>
    sel({ localUploadEnabled: false }),
}))

const META = {
  localId: 'x1',
  title: '테스트 오프라인 회의',
  lang: 'ko',
  created_at: '2026-06-01T00:00:00.000Z',
  status: 'completed' as const,
  pendingSync: false,
}

function renderSection() {
  return render(
    <MemoryRouter>
      <LocalMeetingsSection />
    </MemoryRouter>,
  )
}

describe('LocalMeetingsSection 삭제', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(localStore.listLocal).mockResolvedValue([META])
    vi.mocked(localStore.deleteLocal).mockResolvedValue(undefined)
  })

  it('각 회의에 삭제 버튼이 있다', async () => {
    renderSection()
    expect(await screen.findByText('테스트 오프라인 회의')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
  })

  it('삭제 → 인라인 확인 → deleteLocal(localId) 호출', async () => {
    renderSection()
    await screen.findByText('테스트 오프라인 회의')
    // 1차 탭: 인라인 확인 노출(즉시 삭제 아님)
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(localStore.deleteLocal).not.toHaveBeenCalled()
    // 확인 탭 → 실제 삭제
    fireEvent.click(await screen.findByRole('button', { name: '삭제 확인' }))
    await waitFor(() => expect(localStore.deleteLocal).toHaveBeenCalledWith('x1'))
  })

  it('삭제 확인 후 취소하면 deleteLocal 미호출', async () => {
    renderSection()
    await screen.findByText('테스트 오프라인 회의')
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    fireEvent.click(await screen.findByRole('button', { name: '삭제 취소' }))
    // 다시 삭제 버튼으로 복귀
    expect(await screen.findByRole('button', { name: '삭제' })).toBeInTheDocument()
    expect(localStore.deleteLocal).not.toHaveBeenCalled()
  })
})

describe('LocalMeetingsSection 헤더/네비게이션 (F/E)', () => {
  function LocationProbe() {
    const loc = useLocation()
    return <div data-testid="loc">{loc.pathname}</div>
  }
  function renderWithLocation() {
    return render(
      <MemoryRouter initialEntries={['/meetings']}>
        <Routes>
          <Route path="*" element={<><LocalMeetingsSection /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('WifiOff 아이콘/"기기 저장 (오프라인)" 헤딩 제거 + "오프라인 회의 시작" 전체폭(w-full)', async () => {
    vi.mocked(localStore.listLocal).mockResolvedValue([])
    renderWithLocation()
    await waitFor(() => {
      expect(screen.queryByText('기기 저장 (오프라인)')).not.toBeInTheDocument()
    })
    const startBtn = screen.getByRole('button', { name: /오프라인 회의 시작/i })
    expect(startBtn.className).toContain('w-full')
  })

  it("completed 회의 클릭 → 상세(/local-meetings/:id), recording 클릭 → 라이브(/live)", async () => {
    vi.mocked(localStore.listLocal).mockResolvedValue([
      { ...META, localId: 'done', title: '끝난 회의', status: 'completed' },
      { ...META, localId: 'rec', title: '녹음중 회의', status: 'recording' },
    ])
    renderWithLocation()

    fireEvent.click(await screen.findByText('끝난 회의'))
    expect(screen.getByTestId('loc').textContent).toBe('/local-meetings/done')

    fireEvent.click(screen.getByText('녹음중 회의'))
    expect(screen.getByTestId('loc').textContent).toBe('/local-meetings/rec/live')
  })
})
