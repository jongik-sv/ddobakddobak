import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UserManagementModal from './UserManagementModal'

// ── Mock store ──
const mockCloseUserMgmt = vi.fn()
let mockUserMgmtOpen = true

vi.mock('../../stores/uiStore', () => ({
  useUiStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      userMgmtOpen: mockUserMgmtOpen,
      closeUserMgmt: mockCloseUserMgmt,
    }),
}))

// ── Mock child panel ──
vi.mock('./UserManagementPanel', () => ({
  default: () => <div data-testid="user-management">UserManagementPanel</div>,
}))

// ── Mock useMediaQuery ──
let mockIsDesktop = true
vi.mock('../../hooks/useMediaQuery', () => ({
  useMediaQuery: () => mockIsDesktop,
}))

describe('UserManagementModal', () => {
  beforeEach(() => {
    mockUserMgmtOpen = true
    mockIsDesktop = true
    mockCloseUserMgmt.mockClear()
  })

  it('renders the panel with "사용자 관리" header when open', () => {
    render(<UserManagementModal />)
    expect(screen.getByText('사용자 관리')).toBeTruthy()
    expect(screen.getByTestId('user-management')).toBeTruthy()
  })

  it('has no tab bar', () => {
    render(<UserManagementModal />)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('does not render when closed', () => {
    mockUserMgmtOpen = false
    const { container } = render(<UserManagementModal />)
    expect(container.firstChild).toBeNull()
  })

  it('closes on close button click', () => {
    render(<UserManagementModal />)
    const header = screen.getByText('사용자 관리').closest('div')!
    fireEvent.click(header.querySelector('button')!)
    expect(mockCloseUserMgmt).toHaveBeenCalled()
  })

  it('closes on Escape key', () => {
    render(<UserManagementModal />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mockCloseUserMgmt).toHaveBeenCalled()
  })
})
