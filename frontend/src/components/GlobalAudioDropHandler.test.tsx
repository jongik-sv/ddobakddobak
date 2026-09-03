import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { GlobalAudioDropHandler } from './GlobalAudioDropHandler'
import { useProjectStore } from '../stores/projectStore'
import { useToastStore } from '../stores/toastStore'

// ──────────────────────────────────────────────
// Mocks — 실제 드래그 이벤트/모달 UI 대신 버튼으로 콜백을 직접 트리거해
// GlobalAudioDropHandler의 배선(라우트별 disabled·필터링·모달 오픈·navigate)만 검증한다.
// (MeetingPage.test.tsx의 MeetingFileDropOverlay mock 패턴 참고)
// ──────────────────────────────────────────────

const { mockAudioFile, mockOtherFile } = vi.hoisted(() => {
  function makeFile(name: string): File {
    return new File([new Uint8Array(4)], name)
  }
  return { mockAudioFile: makeFile('audio.mp3'), mockOtherFile: makeFile('doc.pdf') }
})

vi.mock('./meeting/MeetingFileDropOverlay', () => ({
  MeetingFileDropOverlay: (props: { disabled?: boolean; onFilesDropped: (files: File[]) => void }) => (
    <div data-testid="global-drop-overlay" data-disabled={String(!!props.disabled)}>
      <button onClick={() => props.onFilesDropped([mockAudioFile])}>drop-audio</button>
      <button onClick={() => props.onFilesDropped([mockOtherFile])}>drop-other</button>
      <button onClick={() => props.onFilesDropped([mockAudioFile, mockOtherFile])}>drop-mixed</button>
    </div>
  ),
}))

vi.mock('./meeting/UploadAudioModal', () => ({
  UploadAudioModal: (props: {
    folderId: number | null
    initialFiles?: File[]
    onClose: () => void
    onCreated: (meeting: { id: number }) => void
  }) => (
    <div
      data-testid="global-upload-modal"
      data-folder-id={String(props.folderId)}
      data-initial-files={(props.initialFiles ?? []).map((f) => f.name).join(',')}
    >
      <button onClick={() => props.onCreated({ id: 42 })}>created</button>
      <button onClick={props.onClose}>close</button>
    </div>
  ),
  // 실제 구현과 동일 기준(확장자)의 최소 모사 — 컴포넌트가 이 이름으로 export한 판별 함수를 쓴다는 계약만 확인.
  isAcceptedAudioFile: (file: File) => /\.(mp3|wav|m4a|webm|ogg|flac|aac|mp4)$/i.test(file.name),
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <LocationProbe />
              <GlobalAudioDropHandler />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('GlobalAudioDropHandler', () => {
  beforeEach(() => {
    useProjectStore.setState({ currentProjectId: 1 })
    useToastStore.getState().clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('회의 목록(/meetings)에서는 오버레이가 비활성화된다 (자체 처리와 이중 처리 방지)', () => {
    renderAt('/meetings')
    expect(screen.getByTestId('global-drop-overlay')).toHaveAttribute('data-disabled', 'true')
  })

  it('회의 상세(/meetings/:id)에서는 오버레이가 비활성화된다', () => {
    renderAt('/meetings/5')
    expect(screen.getByTestId('global-drop-overlay')).toHaveAttribute('data-disabled', 'true')
  })

  it('회의 진행중 라이브(/meetings/:id/live)에서는 오버레이가 비활성화된다', () => {
    renderAt('/meetings/5/live')
    expect(screen.getByTestId('global-drop-overlay')).toHaveAttribute('data-disabled', 'true')
  })

  it('회의 뷰어(/meetings/:id/viewer)에서는 오버레이가 비활성화된다', () => {
    renderAt('/meetings/5/viewer')
    expect(screen.getByTestId('global-drop-overlay')).toHaveAttribute('data-disabled', 'true')
  })

  it('그 외 라우트(예: /projects)에서는 오버레이가 활성화된다', () => {
    renderAt('/projects')
    expect(screen.getByTestId('global-drop-overlay')).toHaveAttribute('data-disabled', 'false')
  })

  it('프로젝트가 선택되지 않은 상태면 오버레이가 비활성화된다', () => {
    useProjectStore.setState({ currentProjectId: null })
    renderAt('/projects')
    expect(screen.getByTestId('global-drop-overlay')).toHaveAttribute('data-disabled', 'true')
  })

  it('오디오 파일을 드롭하면 folderId=null로 업로드 모달이 initialFiles와 함께 열린다', async () => {
    const user = userEvent.setup()
    renderAt('/projects')
    await user.click(screen.getByText('drop-audio'))
    const modal = screen.getByTestId('global-upload-modal')
    expect(modal).toHaveAttribute('data-folder-id', 'null')
    expect(modal).toHaveAttribute('data-initial-files', 'audio.mp3')
  })

  it('모달이 열려 있는 동안 오버레이는 비활성화된다 (모달 내부 드롭존이 처리)', async () => {
    const user = userEvent.setup()
    renderAt('/projects')
    await user.click(screen.getByText('drop-audio'))
    expect(screen.getByTestId('global-drop-overlay')).toHaveAttribute('data-disabled', 'true')
  })

  it('비오디오 파일만 드롭하면 모달을 열지 않고 화면에 보이는 로컬 토스트로 안내한다', async () => {
    const user = userEvent.setup()
    renderAt('/projects')
    await user.click(screen.getByText('drop-other'))
    expect(screen.queryByTestId('global-upload-modal')).not.toBeInTheDocument()
    // 실제로 화면에 보이는 안내(LocalToast) — toastStore.message는 이 라우트에서 렌더되지 않으므로
    // 별도로 눈에 보이는 토스트를 검증한다.
    expect(screen.getByRole('status')).toHaveTextContent('오디오 파일만')
    // 기존 전역 상태 관례도 함께 기록됨을 확인 (다른 소비자가 있을 경우를 위한 하위호환).
    expect(useToastStore.getState().message).toMatch(/오디오 파일만/)
  })

  it('로컬 토스트는 3초 후 자동으로 사라진다', () => {
    // userEvent(내부적으로 실 타이머 기반 pointer 지연을 씀)와 fake timers를 함께 쓰면
    // click 자체가 멈추므로, 동기 fireEvent로 클릭해 fake timers와의 충돌을 피한다.
    vi.useFakeTimers()
    try {
      renderAt('/projects')
      fireEvent.click(screen.getByText('drop-other'))
      expect(screen.getByRole('status')).toBeInTheDocument()

      act(() => { vi.advanceTimersByTime(3000) })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('오디오+비오디오 혼합 드롭 시 오디오 파일만 걸러 모달에 전달한다', async () => {
    const user = userEvent.setup()
    renderAt('/projects')
    await user.click(screen.getByText('drop-mixed'))
    expect(screen.getByTestId('global-upload-modal')).toHaveAttribute('data-initial-files', 'audio.mp3')
  })

  it('업로드 완료(onCreated) 시 모달을 닫고 생성된 회의 상세로 이동한다', async () => {
    const user = userEvent.setup()
    renderAt('/projects')
    await user.click(screen.getByText('drop-audio'))
    await user.click(screen.getByText('created'))
    expect(screen.queryByTestId('global-upload-modal')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/meetings/42')
    // 이동한 곳이 회의 상세이므로(useMatch('/meetings/:id')) 오버레이는 계속 비활성 상태를 유지한다.
    expect(screen.getByTestId('global-drop-overlay')).toHaveAttribute('data-disabled', 'true')
  })

  it('onClose 시 모달을 닫고 오버레이를 다시 활성화한다', async () => {
    const user = userEvent.setup()
    renderAt('/projects')
    await user.click(screen.getByText('drop-audio'))
    await user.click(screen.getByText('close'))
    expect(screen.queryByTestId('global-upload-modal')).not.toBeInTheDocument()
    expect(screen.getByTestId('global-drop-overlay')).toHaveAttribute('data-disabled', 'false')
  })
})
