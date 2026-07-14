import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { MermaidRenderer } from './mermaidBlock'
import mermaid from 'mermaid'

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), parse: vi.fn(), render: vi.fn() },
}))

describe('MermaidRenderer', () => {
  beforeEach(() => {
    ;(mermaid.parse as Mock).mockReset()
    ;(mermaid.render as Mock).mockReset()
  })

  it('잘못된 mermaid → fallback 렌더', async () => {
    ;(mermaid.parse as Mock).mockRejectedValue(new Error('bad syntax'))
    render(<MermaidRenderer code="not mermaid" zoom={1} fallback={<div>FALLBACK</div>} />)
    await waitFor(() => expect(screen.getByText('FALLBACK')).toBeInTheDocument())
  })

  it('잘못된 mermaid + fallback 없음 → 빈 화면 대신 에러+코드 표시', async () => {
    ;(mermaid.parse as Mock).mockRejectedValue(new Error('bad syntax'))
    render(<MermaidRenderer code={'flowchart TD\n  D["MO 생성("현재 방식")"]'} zoom={1} />)
    await waitFor(() => expect(screen.getByText(/렌더 실패/)).toBeInTheDocument())
    // 원본 코드도 노출돼 사용자가 무엇을 고쳐야 할지 알 수 있어야 함
    expect(screen.getByText(/MO 생성/)).toBeInTheDocument()
  })

  it('정상 mermaid → svg 렌더', async () => {
    ;(mermaid.parse as Mock).mockResolvedValue(true)
    ;(mermaid.render as Mock).mockResolvedValue({ svg: '<svg><rect/></svg>' })
    const { container } = render(<MermaidRenderer code="graph TD; A-->B" zoom={1} />)
    await waitFor(() => expect(container.querySelector('svg')).toBeTruthy())
  })
})
