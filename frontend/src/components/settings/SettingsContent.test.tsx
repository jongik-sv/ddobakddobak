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
vi.mock('./UserSttSettings', () => ({
  default: () => <div data-testid="stt-settings">stt</div>,
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

  it('offline 미지정: 기존대로 개인 탭(서버 패널) 렌더', () => {
    render(<SettingsContent />)
    expect(screen.getByTestId('personal-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('stt-settings')).toBeNull()
  })
})

describe('SettingsContent offline (클라전용)', () => {
  beforeEach(() => {
    // admin + local mode여도 offline이면 전역탭/서버패널을 절대 노출하지 않아야 함.
    mockUser = { role: 'admin', email: 'a@x.com' }
    mockMode = 'local'
  })

  it('offline=true: UserSttSettings만 렌더, 서버 fetch 패널·전역탭 미렌더', () => {
    render(<SettingsContent offline />)
    expect(screen.getByTestId('stt-settings')).toBeInTheDocument()
    // 개인/전역 탭(서버 fetch 패널)은 렌더하지 않는다.
    expect(screen.queryByTestId('personal-tab')).toBeNull()
    expect(screen.queryByTestId('global-tab')).toBeNull()
  })

  it('offline=true: 탭바를 숨긴다(단일 컬럼)', () => {
    render(<SettingsContent offline />)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
  })
})
