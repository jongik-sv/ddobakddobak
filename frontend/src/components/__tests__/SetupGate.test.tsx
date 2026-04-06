import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Mocks ──
const { mockGetMode, mockHasMode } = vi.hoisted(() => ({
  mockGetMode: vi.fn(() => 'local' as 'local' | 'server'),
  mockHasMode: vi.fn(() => true),
}))

let mockIsTauri = true

vi.mock('../../config', () => ({
  get IS_TAURI() {
    return mockIsTauri
  },
  getMode: mockGetMode,
  hasMode: mockHasMode,
}))

// SetupPage를 단순한 컴포넌트로 모킹 (Tauri invoke 호출 방지)
vi.mock('../../pages/SetupPage', () => ({
  default: ({ onReady }: { onReady: () => void }) => (
    <div data-testid="setup-page">
      <button onClick={onReady}>Ready</button>
    </div>
  ),
}))

// ServerSetup 모킹
vi.mock('../auth/ServerSetup', () => ({
  ServerSetup: ({ onComplete }: { onComplete: () => void }) => (
    <div data-testid="server-setup">
      <button onClick={onComplete}>Complete</button>
    </div>
  ),
}))

import SetupGate from '../SetupGate'

describe('SetupGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsTauri = true
    mockHasMode.mockReturnValue(true)
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

  describe('모드 미설정 (첫 실행)', () => {
    it('hasMode()=false일 때 ServerSetup을 표시한다', () => {
      mockHasMode.mockReturnValue(false)
      mockIsTauri = true

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      expect(screen.getByTestId('server-setup')).toBeInTheDocument()
      expect(screen.queryByTestId('setup-page')).not.toBeInTheDocument()
      expect(screen.queryByTestId('child')).not.toBeInTheDocument()
    })

    it('ServerSetup 완료 후 로컬 모드 선택 시 SetupPage로 전환한다', () => {
      mockHasMode.mockReturnValue(false)
      mockIsTauri = true
      mockGetMode.mockReturnValue('local')

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      // ServerSetup이 표시됨
      expect(screen.getByTestId('server-setup')).toBeInTheDocument()

      // Complete 버튼 클릭 (ServerSetup이 onComplete 호출)
      fireEvent.click(screen.getByText('Complete'))

      // SetupPage로 전환됨
      expect(screen.getByTestId('setup-page')).toBeInTheDocument()
      expect(screen.queryByTestId('server-setup')).not.toBeInTheDocument()
      expect(screen.queryByTestId('child')).not.toBeInTheDocument()
    })

    it('ServerSetup 완료 후 서버 모드 선택 시 children으로 전환한다', () => {
      mockHasMode.mockReturnValue(false)
      mockIsTauri = true
      mockGetMode.mockReturnValue('server')

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      // ServerSetup이 표시됨
      expect(screen.getByTestId('server-setup')).toBeInTheDocument()

      // Complete 버튼 클릭 (ServerSetup이 onComplete 호출)
      fireEvent.click(screen.getByText('Complete'))

      // children으로 전환됨
      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.queryByTestId('server-setup')).not.toBeInTheDocument()
      expect(screen.queryByTestId('setup-page')).not.toBeInTheDocument()
    })

    it('웹 모드에서는 hasMode()=false여도 children을 바로 표시한다', () => {
      mockHasMode.mockReturnValue(false)
      mockIsTauri = false

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.queryByTestId('server-setup')).not.toBeInTheDocument()
      expect(screen.queryByTestId('setup-page')).not.toBeInTheDocument()
    })

    it('DEV=true에서는 hasMode()=false여도 children을 바로 표시한다', () => {
      mockHasMode.mockReturnValue(false)
      mockIsTauri = true
      vi.stubEnv('DEV', 'true')

      render(
        <SetupGate>
          <div data-testid="child">앱 콘텐츠</div>
        </SetupGate>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.queryByTestId('server-setup')).not.toBeInTheDocument()
    })
  })

  describe('mode 설정됨 (기본값 local)', () => {
    it('getMode()가 local을 반환하면 로컬 모드 동작을 한다', () => {
      // getMode()는 localStorage에 mode 키가 없으면 'local' 반환
      mockGetMode.mockReturnValue('local')
      mockHasMode.mockReturnValue(true)
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
