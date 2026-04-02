import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ── Mocks ──
const { mockGetMode } = vi.hoisted(() => ({
  mockGetMode: vi.fn(() => 'local' as 'local' | 'server'),
}))

let mockIsTauri = true

vi.mock('../../config', () => ({
  get IS_TAURI() {
    return mockIsTauri
  },
  getMode: mockGetMode,
}))

// SetupPage를 단순한 컴포넌트로 모킹 (Tauri invoke 호출 방지)
vi.mock('../../pages/SetupPage', () => ({
  default: ({ onReady }: { onReady: () => void }) => (
    <div data-testid="setup-page">
      <button onClick={onReady}>Ready</button>
    </div>
  ),
}))

import SetupGate from '../SetupGate'

describe('SetupGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsTauri = true
    // import.meta.env.DEV는 vitest에서 기본 true이므로
    // needsSetup을 true로 만들려면 DEV=false로 오버라이드해야 함
    vi.stubEnv('DEV', '')
  })

  describe('서버 모드 (mode=server)', () => {
    it('SetupPage 없이 children을 즉시 렌더링한다', () => {
      mockGetMode.mockReturnValue('server')

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.getByText('앱 콘텐츠')).toBeInTheDocument()
      expect(screen.queryByTestId('setup-page')).not.toBeInTheDocument()
    })

    it('IS_TAURI=true, DEV=false에서도 SetupPage를 건너뛴다', () => {
      mockGetMode.mockReturnValue('server')
      mockIsTauri = true

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.queryByTestId('setup-page')).not.toBeInTheDocument()
    })
  })

  describe('로컬 모드 (mode=local)', () => {
    it('IS_TAURI=true, DEV=false에서 SetupPage를 렌더링한다', () => {
      mockGetMode.mockReturnValue('local')
      mockIsTauri = true

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      expect(screen.getByTestId('setup-page')).toBeInTheDocument()
      expect(screen.queryByTestId('child')).not.toBeInTheDocument()
    })

    it('IS_TAURI=false에서 children을 즉시 렌더링한다 (웹 모드)', () => {
      mockGetMode.mockReturnValue('local')
      mockIsTauri = false

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.queryByTestId('setup-page')).not.toBeInTheDocument()
    })

    it('DEV=true에서 children을 즉시 렌더링한다 (개발 모드)', () => {
      mockGetMode.mockReturnValue('local')
      mockIsTauri = true
      vi.stubEnv('DEV', 'true') // truthy string → !DEV = false → needsSetup = false

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.queryByTestId('setup-page')).not.toBeInTheDocument()
    })
  })

  describe('mode 미설정 (기본값 local)', () => {
    it('getMode()가 local을 반환하면 로컬 모드 동작을 한다', () => {
      // getMode()는 localStorage에 mode 키가 없으면 'local' 반환
      mockGetMode.mockReturnValue('local')
      mockIsTauri = true

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      expect(screen.getByTestId('setup-page')).toBeInTheDocument()
      expect(screen.queryByTestId('child')).not.toBeInTheDocument()
    })
  })
})
