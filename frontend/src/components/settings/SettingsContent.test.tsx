import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingsContent from './SettingsContent'
import { useProjectStore } from '../../stores/projectStore'
import type { Project } from '../../api/projects'

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
vi.mock('./DflowSettingsPanel', () => ({
  DflowSettingsPanel: () => <div data-testid="dflow-tab">dflow</div>,
}))

vi.mock('./sttTermLearning/SttTermLearningTab', () => ({
  default: () => <div data-testid="stt-learning-tab">sttLearning</div>,
}))

describe('SettingsContent tabs', () => {
  beforeEach(() => {
    mockUser = { role: 'member', email: 'm@x.com' }
    mockMode = 'server'
    useProjectStore.setState({ projects: [] })
  })

  it('member: 관리자 탭 없음, 개인 탭만 렌더', () => {
    render(<SettingsContent />)
    expect(screen.queryByRole('tab', { name: /LLM/ })).toBeNull()
    expect(screen.getByTestId('personal-tab')).toBeInTheDocument()
  })

  it('admin: 5개 탭(개인설정·LLM·음성·인식·회의록 설정·연동) 존재', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    expect(screen.getByRole('tab', { name: /개인설정/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /LLM/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /음성.*인식/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /회의록 설정/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /연동/ })).toBeInTheDocument()
  })

  it('admin: STT 용어 학습 탭이 있고 누르면 SttTermLearningTab 렌더', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    fireEvent.click(screen.getByRole('tab', { name: /STT 용어 학습/ }))
    expect(screen.getByTestId('stt-learning-tab')).toBeInTheDocument()
  })

  it('F1 도움말: 탭별 data-help slug (연동→integrations, STT 용어 학습→stt-learning)', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    const { container } = render(<SettingsContent />)
    const root = () => container.querySelector('[data-help]')?.getAttribute('data-help')
    expect(root()).toBe('settings/personal')
    fireEvent.click(screen.getByRole('tab', { name: /연동/ }))
    expect(root()).toBe('settings/integrations')
    fireEvent.click(screen.getByRole('tab', { name: /STT 용어 학습/ }))
    expect(root()).toBe('settings/stt-learning')
  })

  it('프로젝트 관리자(비 시스템 admin): 개인설정·STT 용어 학습 탭만 노출', () => {
    useProjectStore.setState({ projects: [{ id: 1, role: 'admin', personal: false } as Project] })
    render(<SettingsContent />)
    expect(screen.getByRole('tab', { name: /개인설정/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /STT 용어 학습/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /LLM/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: /연동/ })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /STT 용어 학습/ }))
    expect(screen.getByTestId('stt-learning-tab')).toBeInTheDocument()
  })

  it('개인 프로젝트의 admin 은 팀 관리자가 아니므로 STT 용어 학습 탭 없음', () => {
    useProjectStore.setState({ projects: [{ id: 1, role: 'admin', personal: true } as Project] })
    render(<SettingsContent />)
    expect(screen.queryByRole('tab', { name: /STT 용어 학습/ })).toBeNull()
  })

  it('팀 프로젝트 admin 이 개인 프로젝트와 함께 있어도 탭 노출', () => {
    useProjectStore.setState({
      projects: [{ id: 1, role: 'admin', personal: true } as Project, { id: 2, role: 'admin', personal: false } as Project],
    })
    render(<SettingsContent />)
    expect(screen.getByRole('tab', { name: /STT 용어 학습/ })).toBeInTheDocument()
  })

  it('일반 멤버(프로젝트 admin 아님)는 STT 용어 학습 탭 없음', () => {
    useProjectStore.setState({ projects: [{ id: 1, role: 'member' } as Project] })
    render(<SettingsContent />)
    expect(screen.queryByRole('tab', { name: /STT 용어 학습/ })).toBeNull()
  })

  it('member: STT 용어 학습 탭 없음', () => {
    render(<SettingsContent />)
    expect(screen.queryByRole('tab', { name: /STT 용어 학습/ })).toBeNull()
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

  it('admin: 연동 탭 클릭 시 DflowSettingsPanel 렌더', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    fireEvent.click(screen.getByRole('tab', { name: /연동/ }))
    expect(screen.getByTestId('dflow-tab')).toBeInTheDocument()
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
