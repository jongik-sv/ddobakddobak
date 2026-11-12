import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../api/settings', () => ({ getWhiteboardSettings: vi.fn(), updateWhiteboardSettings: vi.fn() }))
vi.mock('../PromptTemplateManager', () => ({ default: () => null }))
vi.mock('./MeetingTemplateManager', () => ({ default: () => null }))
vi.mock('../../config', () => ({ IS_TAURI: false, getMode: () => 'server' }))
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'admin' } }),
}))

import MeetingSettingsTab from './MeetingSettingsTab'
import { getWhiteboardSettings, updateWhiteboardSettings } from '../../api/settings'

describe('MeetingSettingsTab 화이트보드 구역', () => {
  beforeEach(() => vi.clearAllMocks())

  it('라벨 순서·기본 선택: 서버(기본) 먼저, server_claude 면 서버 선택', async () => {
    vi.mocked(getWhiteboardSettings).mockResolvedValue({ web_mode: 'server_claude', server_claude_available: true })
    render(<MeetingSettingsTab />)
    const server = await screen.findByLabelText(/서버의 Claude Code \(기본\)/)
    await waitFor(() => expect(server).toBeChecked())
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toBe(server)
    expect(radios[1]).toBe(screen.getByLabelText(/끄기 · 지시문 파일로 내려받기/))
    expect(radios[1]).not.toBeChecked()
  })

  it('claude 없으면 서버 라디오 비활성, copy 모드면 끄기 선택', async () => {
    vi.mocked(getWhiteboardSettings).mockResolvedValue({ web_mode: 'copy', server_claude_available: false })
    render(<MeetingSettingsTab />)
    const server = await screen.findByLabelText(/서버의 Claude Code/)
    await waitFor(() => expect(server).toBeDisabled())
    expect(screen.getByLabelText(/지시문 파일로 내려받기/)).toBeChecked()
    expect(screen.getByText('찾을 수 없음')).toBeInTheDocument()
  })

  it('claude 확인됨이면 선택 시 PUT 호출', async () => {
    vi.mocked(getWhiteboardSettings).mockResolvedValue({ web_mode: 'copy', server_claude_available: true })
    vi.mocked(updateWhiteboardSettings).mockResolvedValue({ web_mode: 'server_claude', server_claude_available: true })
    render(<MeetingSettingsTab />)
    const server = await screen.findByLabelText(/서버의 Claude Code/)
    await waitFor(() => expect(server).toBeEnabled())
    await userEvent.click(server)
    expect(updateWhiteboardSettings).toHaveBeenCalledWith('server_claude')
    await waitFor(() => expect(server).toBeChecked())
  })
})
