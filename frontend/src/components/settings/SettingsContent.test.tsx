import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SettingsContent from './SettingsContent'

let mockUser: { role?: string; email?: string } | null = { role: 'member', email: 'm@x.com' }
let mockMode = 'server'

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: mockUser }),
}))

vi.mock('../../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config')>()
  return {
    ...actual,
    getMode: () => mockMode,
    IS_TAURI: false,
  }
})

vi.mock('./PersonalSettingsTab', () => ({
  default: () => <div data-testid="personal-tab">personal</div>,
}))
vi.mock('./GlobalSettingsTab', () => ({
  default: () => <div data-testid="global-tab">global</div>,
}))

describe('SettingsContent tabs', () => {
  beforeEach(() => {
    mockUser = { role: 'member', email: 'm@x.com' }
    mockMode = 'server'
  })

  it('member: 전역 탭 버튼 없음, 개인 탭만 렌더', () => {
    render(<SettingsContent />)
    expect(screen.queryByRole('tab', { name: /전역설정/ })).toBeNull()
    expect(screen.getByTestId('personal-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('global-tab')).toBeNull()
  })

  it('admin: 개인/전역 탭 둘 다 존재', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    expect(screen.getByRole('tab', { name: /개인설정/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /전역설정/ })).toBeInTheDocument()
  })

  it('local mode: 비-admin도 전역 탭 노출', () => {
    mockUser = { role: 'member', email: 'm@x.com' }
    mockMode = 'local'
    render(<SettingsContent />)
    expect(screen.getByRole('tab', { name: /전역설정/ })).toBeInTheDocument()
  })
})
