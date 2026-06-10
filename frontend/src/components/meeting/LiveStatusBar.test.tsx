import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveStatusBar } from './LiveStatusBar'

const base = {
  isSystemCapturing: false,
  isActive: true,
  meetingApiStatus: 'recording' as const,
  statusMessage: null,
  sttEngine: null,
}

describe('LiveStatusBar — 온디바이스 STT 배지', () => {
  it('녹음 중 local 모드면 배지를 표시한다 (조용한 폴백 방지)', () => {
    render(<LiveStatusBar {...base} activeSttMode="local" />)
    expect(screen.getByText('온디바이스 STT')).toBeInTheDocument()
  })

  it('server 모드면 배지가 없다', () => {
    render(<LiveStatusBar {...base} activeSttMode="server" />)
    expect(screen.queryByText('온디바이스 STT')).toBeNull()
  })

  it('녹음 중이 아니면 local이어도 배지가 없다', () => {
    render(<LiveStatusBar {...base} isActive={false} meetingApiStatus="completed" activeSttMode="local" />)
    expect(screen.queryByText('온디바이스 STT')).toBeNull()
  })
})
