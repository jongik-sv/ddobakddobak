import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
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

function setViewport(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true })
}

const KEY = 'ddobak.settingsModal.size'
const box = () => screen.getByRole('dialog').firstElementChild as HTMLElement
const dims = () => [box().style.width, box().style.height]

describe('SettingsModal responsive behavior', () => {
  beforeEach(() => {
    mockSettingsOpen = true
    mockCloseSettings.mockClear()
    mockIsDesktop = true
    localStorage.clear()
    setViewport(1440, 900)
  })

  // ── Desktop mode tests ──
  describe('desktop (>= lg)', () => {
    beforeEach(() => {
      mockIsDesktop = true
    })

    it('renders centered modal with rounded-xl', () => {
      render(<SettingsModal />)
      const modal = screen.getByRole('dialog')
      const container = modal.firstElementChild
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

  describe('resizable (desktop)', () => {
    it('uses default fixed size', () => {
      render(<SettingsModal />)
      expect(dims()).toEqual(['960px', '760px'])
    })

    it('default size shrinks with small viewport', () => {
      setViewport(800, 600)
      render(<SettingsModal />)
      expect(dims()).toEqual(['768px', '528px'])
    })

    it('size is state-derived and unchanged across re-render', () => {
      const { rerender } = render(<SettingsModal />)
      const before = dims()
      rerender(<SettingsModal offline />)
      expect(dims()).toEqual(before)
    })

    it('restores stored size and clamps to viewport', () => {
      localStorage.setItem(KEY, JSON.stringify({ w: 700, h: 500 }))
      const { unmount } = render(<SettingsModal />)
      expect(dims()).toEqual(['700px', '500px'])
      unmount()
      localStorage.setItem(KEY, JSON.stringify({ w: 5000, h: 10 }))
      render(<SettingsModal />)
      expect(dims()).toEqual(['1408px', '420px'])
    })

    it('ignores invalid storage', () => {
      localStorage.setItem(KEY, '{"w":"x"}')
      const { unmount } = render(<SettingsModal />)
      expect(dims()).toEqual(['960px', '760px'])
      unmount()
      localStorage.setItem(KEY, 'not json')
      render(<SettingsModal />)
      expect(dims()).toEqual(['960px', '760px'])
    })

    it('clamps on window resize', () => {
      localStorage.setItem(KEY, JSON.stringify({ w: 1200, h: 800 }))
      render(<SettingsModal />)
      act(() => {
        setViewport(1000, 700)
        window.dispatchEvent(new Event('resize'))
      })
      expect(dims()).toEqual(['968px', '668px'])
    })

    it('drag on corner handle resizes, persists, and does not close', () => {
      render(<SettingsModal />)
      const handle = screen.getByTestId('resize-handle')
      fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1, button: 0 })
      fireEvent.pointerMove(handle, { clientX: 70, clientY: 80, pointerId: 1, buttons: 1 })
      expect(dims()).toEqual(['900px', '720px'])
      fireEvent.pointerUp(handle, { clientX: 70, clientY: 80, pointerId: 1 })
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ w: 900, h: 720 })
      expect(mockCloseSettings).not.toHaveBeenCalled()
    })

    it('drag respects min size', () => {
      render(<SettingsModal />)
      const handle = screen.getByTestId('resize-handle')
      fireEvent.pointerDown(handle, { clientX: 500, clientY: 500, pointerId: 1, button: 0 })
      fireEvent.pointerMove(handle, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 })
      expect(dims()).toEqual(['560px', '420px'])
    })

    it('edge handles resize a single axis', () => {
      render(<SettingsModal />)
      const r = screen.getByTestId('resize-right')
      fireEvent.pointerDown(r, { clientX: 0, clientY: 0, pointerId: 1, button: 0 })
      fireEvent.pointerMove(r, { clientX: -50, clientY: 99, pointerId: 1, buttons: 1 })
      fireEvent.pointerUp(r, { pointerId: 1 })
      expect(dims()).toEqual(['860px', '760px'])
    })

    it('plain click without movement does not persist size', () => {
      render(<SettingsModal />)
      const handle = screen.getByTestId('resize-handle')
      fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1, button: 0 })
      fireEvent.pointerUp(handle, { clientX: 100, clientY: 100, pointerId: 1 })
      expect(localStorage.getItem(KEY)).toBeNull()
    })

    it('ends drag when move arrives with no buttons pressed', () => {
      render(<SettingsModal />)
      const handle = screen.getByTestId('resize-handle')
      fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1, button: 0 })
      fireEvent.pointerMove(handle, { clientX: 70, clientY: 80, pointerId: 1, buttons: 1 })
      expect(dims()).toEqual(['900px', '720px'])
      fireEvent.pointerMove(handle, { clientX: 0, clientY: 0, pointerId: 1, buttons: 0 })
      expect(dims()).toEqual(['900px', '720px'])
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ w: 900, h: 720 })
    })

    it('adds select-none while dragging', () => {
      render(<SettingsModal />)
      const handle = screen.getByTestId('resize-handle')
      fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1, button: 0 })
      expect(handle.parentElement!.className).toContain('select-none')
      fireEvent.pointerUp(handle, { pointerId: 1 })
      expect(handle.parentElement!.className).not.toContain('select-none')
    })

    it('double-click on handle resets to default', () => {
      localStorage.setItem(KEY, JSON.stringify({ w: 700, h: 500 }))
      render(<SettingsModal />)
      fireEvent.doubleClick(screen.getByTestId('resize-handle'))
      expect(dims()).toEqual(['960px', '760px'])
      expect(localStorage.getItem(KEY)).toBeNull()
    })

    it('Escape still closes', () => {
      render(<SettingsModal />)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(mockCloseSettings).toHaveBeenCalled()
    })

    it('mobile has no handle or inline size', () => {
      mockIsDesktop = false
      render(<SettingsModal />)
      expect(screen.queryByTestId('resize-handle')).toBeNull()
      expect(box().style.width).toBe('')
    })
  })
})
