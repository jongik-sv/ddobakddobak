import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
vi.mock('./LlmSettingsPanel', () => ({
  LlmSettingsPanel: () => <div data-testid="llm-tab">llm</div>,
}))
vi.mock('./VoiceSettingsTab', () => ({
  default: () => <div data-testid="voice-tab">voice</div>,
}))
vi.mock('./MeetingSettingsTab', () => ({
  default: () => <div data-testid="meeting-tab">meeting</div>,
}))
vi.mock('./UserSttSettings', () => ({
  default: () => <div data-testid="stt-settings">stt</div>,
}))

describe('SettingsContent tabs', () => {
  beforeEach(() => {
    mockUser = { role: 'member', email: 'm@x.com' }
    mockMode = 'server'
  })

  it('member: 관리자 탭 없음, 개인 탭만 렌더', () => {
    render(<SettingsContent />)
    expect(screen.queryByRole('tab', { name: /LLM/ })).toBeNull()
    expect(screen.getByTestId('personal-tab')).toBeInTheDocument()
  })

  it('admin: 4개 탭(개인설정·LLM·음성·인식·회의록 설정) 존재', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    expect(screen.getByRole('tab', { name: /개인설정/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /LLM/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /음성.*인식/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /회의록 설정/ })).toBeInTheDocument()
  })

  it('admin: LLM 탭 클릭 시 LlmSettingsPanel 렌더', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    fireEvent.click(screen.getByRole('tab', { name: /LLM/ }))
    expect(screen.getByTestId('llm-tab')).toBeInTheDocument()
  })

  it('admin: 음성·인식 탭 클릭 시 VoiceSettingsTab 렌더', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    fireEvent.click(screen.getByRole('tab', { name: /음성.*인식/ }))
    expect(screen.getByTestId('voice-tab')).toBeInTheDocument()
  })

  it('admin: 회의록 설정 탭 클릭 시 MeetingSettingsTab 렌더', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    fireEvent.click(screen.getByRole('tab', { name: /회의록 설정/ }))
    expect(screen.getByTestId('meeting-tab')).toBeInTheDocument()
  })

  it('local mode: 비-admin도 관리자 탭 노출', () => {
    mockMode = 'local'
    render(<SettingsContent />)
    expect(screen.getByRole('tab', { name: /LLM/ })).toBeInTheDocument()
  })
})

describe('SettingsContent offline (클라전용)', () => {
  beforeEach(() => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    mockMode = 'local'
  })

  it('offline=true: UserSttSettings만 렌더, 탭/서버패널 미렌더', () => {
    render(<SettingsContent offline />)
    expect(screen.getByTestId('stt-settings')).toBeInTheDocument()
    expect(screen.queryByTestId('personal-tab')).toBeNull()
    expect(screen.queryByTestId('llm-tab')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})
