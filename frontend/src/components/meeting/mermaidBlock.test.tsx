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

  it('정상 mermaid → svg 렌더', async () => {
    ;(mermaid.parse as Mock).mockResolvedValue(true)
    ;(mermaid.render as Mock).mockResolvedValue({ svg: '<svg><rect/></svg>' })
    const { container } = render(<MermaidRenderer code="graph TD; A-->B" zoom={1} />)
    await waitFor(() => expect(container.querySelector('svg')).toBeTruthy())
  })
})
