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
    expect(trigger.textContent).not.toContain('지시')
    fireEvent.click(trigger)
    expect(screen.getByRole('radio', { name: /보통/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('요약 추가 지시가 있으면 트리거 버튼에 "지시" 표시', () => {
    render(
      <SummaryOptionsControl
        meeting={{ summary_verbosity: 'standard', summary_restructure: true, summary_custom_prompt: '숫자는 표로 정리' }}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /보통 · 지시/ })).toBeInTheDocument()
  })

  it('팝오버를 열면 저장된 추가 지시가 textarea 에 채워짐', () => {
    render(
      <SummaryOptionsControl
        meeting={{ summary_verbosity: 'standard', summary_restructure: true, summary_custom_prompt: '영어 용어 병기' }}
        onSave={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /보통/ }))
    expect(screen.getByLabelText('요약 추가 지시')).toHaveValue('영어 용어 병기')
  })

  it('추가 지시 입력 후 blur → onSave({ summary_custom_prompt }) 호출', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SummaryOptionsControl
        meeting={{ summary_verbosity: 'standard', summary_restructure: true }}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /보통/ }))
    const textarea = screen.getByLabelText('요약 추가 지시')
    fireEvent.change(textarea, { target: { value: '  수치는 표로 정리  ' } })
    fireEvent.blur(textarea)

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ summary_custom_prompt: '수치는 표로 정리' }),
    )
  })

  it('추가 지시를 비우고 저장하면 null 전달', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SummaryOptionsControl
        meeting={{ summary_verbosity: 'standard', summary_restructure: true, summary_custom_prompt: '기존 지시' }}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /보통/ }))
    const textarea = screen.getByLabelText('요약 추가 지시')
    fireEvent.change(textarea, { target: { value: '' } })
    fireEvent.blur(textarea)

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ summary_custom_prompt: null }))
  })

  it('변경 없이 blur 하면 저장하지 않음', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SummaryOptionsControl
        meeting={{ summary_verbosity: 'standard', summary_restructure: true, summary_custom_prompt: '기존 지시' }}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /보통/ }))
    const textarea = screen.getByLabelText('요약 추가 지시')
    fireEvent.blur(textarea)

    expect(onSave).not.toHaveBeenCalled()
  })
})
