import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingsModal from './SettingsModal'

// ── Mock stores ──
const mockCloseSettings = vi.fn()
let mockSettingsOpen = true

vi.mock('../../stores/uiStore', () => ({
  useUiStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      settingsOpen: mockSettingsOpen,
      closeSettings: mockCloseSettings,
    }),
}))

// ── Mock child components ──
vi.mock('./SettingsContent', () => ({
  default: () => <div data-testid="settings-content">SettingsContent</div>,
}))

// ── Mock useMediaQuery ──
let mockIsDesktop = true
vi.mock('../../hooks/useMediaQuery', () => ({
  useMediaQuery: () => mockIsDesktop,
}))

describe('SettingsModal responsive behavior', () => {
  beforeEach(() => {
    mockSettingsOpen = true
    mockCloseSettings.mockClear()
    mockIsDesktop = true
  })

  // ── Desktop mode tests ──
  describe('desktop (>= lg)', () => {
    beforeEach(() => {
      mockIsDesktop = true
    })

    it('renders centered modal with max-w-3xl', () => {
      render(<SettingsModal />)
      const modal = screen.getByRole('dialog')
      const container = modal.firstElementChild
      expect(container?.className).toContain('max-w-3xl')
      expect(container?.className).toContain('rounded-xl')
    })

    it('renders close button on the right side of the header', () => {
      render(<SettingsModal />)
      const header = screen.getByText('설정').closest('div')
      const closeBtn = header?.querySelector('button')
      expect(closeBtn).toBeTruthy()
      const h2 = header?.querySelector('h2')
      expect(h2).toBeTruthy()
    })

    it('does not apply fullscreen classes', () => {
      render(<SettingsModal />)
      const modal = screen.getByRole('dialog')
      const container = modal.firstElementChild
      expect(container?.className).not.toContain('h-dvh')
      expect(container?.className).not.toContain('inset-0')
    })
  })

  // ── Mobile mode tests ──
  describe('mobile (< lg)', () => {
    beforeEach(() => {
      mockIsDesktop = false
    })

    it('renders fullscreen sheet with h-dvh', () => {
      render(<SettingsModal />)
      const modal = screen.getByRole('dialog')
      const container = modal.firstElementChild
      expect(container?.className).toContain('h-dvh')
      expect(container?.className).toContain('fixed')
      expect(container?.className).toContain('inset-0')
    })

    it('does not have rounded corners or max-w', () => {
      render(<SettingsModal />)
      const modal = screen.getByRole('dialog')
      const container = modal.firstElementChild
      expect(container?.className).not.toContain('max-w-3xl')
      expect(container?.className).not.toContain('rounded-xl')
    })

    it('renders close button (X) on the left side of header', () => {
      render(<SettingsModal />)
      const header = screen.getByText('설정').closest('div')!
      const buttons = header.querySelectorAll('button')
      expect(buttons.length).toBeGreaterThanOrEqual(1)
      // On mobile, the close X button is on the left (first element)
      fireEvent.click(buttons[0])
      expect(mockCloseSettings).toHaveBeenCalled()
    })
  })

  // ── Content ──
  describe('content', () => {
    it('renders SettingsContent (no tab bar)', () => {
      render(<SettingsModal />)
      expect(screen.getByTestId('settings-content')).toBeTruthy()
      expect(screen.queryByRole('tablist')).toBeNull()
    })
  })

  // ── Settings closed ──
  describe('when settings are closed', () => {
    it('does not render when settingsOpen is false', () => {
      mockSettingsOpen = false
      const { container } = render(<SettingsModal />)
      expect(container.firstChild).toBeNull()
    })
  })
})
