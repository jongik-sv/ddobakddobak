import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SummaryOptionsControl } from './SummaryOptionsControl'

describe('SummaryOptionsControl', () => {
  it('팝오버에서 압축율 선택 → onSave({ summary_verbosity }) 호출', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SummaryOptionsControl
        meeting={{ summary_verbosity: 'standard', summary_restructure: true }}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /보통/ }))
    fireEvent.click(screen.getByRole('radio', { name: /아주 간결/ }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ summary_verbosity: 'very_concise' }))
  })

  it('이미 선택된 압축율을 다시 눌러도 저장하지 않음', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SummaryOptionsControl
        meeting={{ summary_verbosity: 'standard', summary_restructure: true }}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /보통/ }))
    fireEvent.click(screen.getByRole('radio', { name: /보통/ }))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('재구조화 토글 → onSave({ summary_restructure }) 호출', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SummaryOptionsControl
        meeting={{ summary_verbosity: 'standard', summary_restructure: true }}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /보통/ }))
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ summary_restructure: false }))
  })

  it('증분 모드면 트리거 버튼에 "증분" 표시', () => {
    render(
      <SummaryOptionsControl
        meeting={{ summary_verbosity: 'concise', summary_restructure: false }}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /간결 · 증분/ })).toBeInTheDocument()
  })

  it('저장 실패 시 에러 메시지 표시', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('403'))
    render(
      <SummaryOptionsControl
        meeting={{ summary_verbosity: 'standard', summary_restructure: true }}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /보통/ }))
    fireEvent.click(screen.getByRole('radio', { name: /아주 간결/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('저장 실패')
  })

  it('값이 없으면 보통 + 재구조화 ON 으로 표시', () => {
    render(<SummaryOptionsControl meeting={{}} onSave={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: /보통/ })
    expect(trigger.textContent).not.toContain('증분')
    fireEvent.click(trigger)
    expect(screen.getByRole('radio', { name: /보통/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })
})
