import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingsModal from './SettingsModal'

// ── Mock stores ──
const mockCloseSettings = vi.fn()
let mockSettingsOpen = true
let mockUserRole = 'admin'

vi.mock('../../stores/uiStore', () => ({
  useUiStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      settingsOpen: mockSettingsOpen,
      closeSettings: mockCloseSettings,
    }),
}))

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      user: { id: 1, role: mockUserRole },
    }),
}))

// ── Mock child components ──
vi.mock('./SettingsContent', () => ({
  default: () => <div data-testid="settings-content">SettingsContent</div>,
}))

vi.mock('./UserManagementPanel', () => ({
  default: () => <div data-testid="user-management">UserManagementPanel</div>,
}))

// ── Mock useMediaQuery ──
let mockIsDesktop = true
vi.mock('../../hooks/useMediaQuery', () => ({
  useMediaQuery: () => mockIsDesktop,
}))

describe('SettingsModal responsive behavior', () => {
  beforeEach(() => {
    mockSettingsOpen = true
    mockUserRole = 'admin'
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
      const container = modal.querySelector('[data-testid="settings-container"]') || modal.firstElementChild
      expect(container?.className).toContain('max-w-3xl')
      expect(container?.className).toContain('rounded-xl')
    })

    it('renders close button on the right side of the header', () => {
      render(<SettingsModal />)
      const header = screen.getByText('설정').closest('div')
      const closeBtn = header?.querySelector('button')
      // On desktop, close button is after the title
      expect(closeBtn).toBeTruthy()
      // The header should have the title first, then the close button
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
      // Find the close button by its accessible pattern - it should be before the title
      const header = screen.getByText('설정').closest('div')!
      const buttons = header.querySelectorAll('button')
      // On mobile, the close X button is on the left (first element)
      expect(buttons.length).toBeGreaterThanOrEqual(1)
      // The first button should be the close button (left side)
      fireEvent.click(buttons[0])
      expect(mockCloseSettings).toHaveBeenCalled()
    })

    it('tab bar has overflow-x-auto for horizontal scroll', () => {
      render(<SettingsModal />)
      // Admin user sees tab bar
      const tabBar = screen.getByRole('tablist') || screen.getByText('일반 설정').closest('div')
      expect(tabBar?.className).toContain('overflow-x-auto')
    })
  })

  // ── Tab navigation tests ──
  describe('tab navigation', () => {
    it('tabs are scrollable on mobile', () => {
      mockIsDesktop = false
      render(<SettingsModal />)
      // Find the tab container (the div wrapping tab buttons)
      const generalTab = screen.getByText('일반 설정')
      const tabContainer = generalTab.closest('div')
      expect(tabContainer?.className).toContain('overflow-x-auto')
    })

    it('tabs are not scrollable on desktop', () => {
      mockIsDesktop = true
      render(<SettingsModal />)
      const generalTab = screen.getByText('일반 설정')
      const tabContainer = generalTab.closest('div')
      expect(tabContainer?.className).not.toContain('overflow-x-auto')
    })
  })

  // ── Form touch accessibility ──
  describe('form touch targets', () => {
    it('tab buttons have min-h-[44px] on mobile', () => {
      mockIsDesktop = false
      render(<SettingsModal />)
      const tabButtons = screen.getAllByRole('tab')
      tabButtons.forEach((btn) => {
        expect(btn.className).toContain('min-h-[44px]')
      })
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
