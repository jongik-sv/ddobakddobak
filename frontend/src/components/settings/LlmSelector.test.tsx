import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { LlmSelector, type LlmSelectorValue } from './LlmSelector'
import type { LlmProfile } from '../../api/llmProfiles'

const profiles: LlmProfile[] = [
  { id: 1, name: 'Gemini · 무료키', preset_id: 'gemini', provider: 'openai', base_url: null, model: 'gemini-3.5-flash', max_input_tokens: null, max_output_tokens: null, has_token: true, auth_token_masked: 'AIza...z8kQ' },
]
const special = [{ id: 'none', label: '선택 안함', description: '서버 기본값 사용' }] as const

function renderSel(value: LlmSelectorValue, over: Partial<React.ComponentProps<typeof LlmSelector>> = {}) {
  const onChange = vi.fn()
  render(<LlmSelector title="요약 LLM" idPrefix="sum" specialOptions={special} profiles={profiles}
    cliAllowed value={value} onChange={onChange} onManageProfiles={vi.fn()} onCreateProfile={vi.fn()} {...over} />)
  return onChange
}

describe('LlmSelector', () => {
  it('드롭다운에 시스템 CLI 그룹 + 내 프로필 그룹 + ＋새 프로필', () => {
    renderSel({ type: 'special', id: 'none' })
    const sel = screen.getByLabelText('요약 LLM 프로필') as HTMLSelectElement
    const groups = within(sel).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['시스템 CLI', '내 프로필'])
    expect(within(sel).getByText('Claude Code')).toBeInTheDocument()
    expect(within(sel).getByText(/Gemini · 무료키/)).toBeInTheDocument()
    expect(within(sel).getByText('＋ 새 프로필 만들기…')).toBeInTheDocument()
  })

  it('cliAllowed=false면 시스템 CLI 그룹 숨김', () => {
    renderSel({ type: 'special', id: 'none' }, { cliAllowed: false })
    const sel = screen.getByLabelText('요약 LLM 프로필') as HTMLSelectElement
    expect(within(sel).queryByText('Claude Code')).toBeNull()
  })

  it('프로필 선택 → onChange({type:profile})', () => {
    const onChange = renderSel({ type: 'special', id: 'none' })
    fireEvent.change(screen.getByLabelText('요약 LLM 프로필'), { target: { value: 'profile:1' } })
    expect(onChange).toHaveBeenCalledWith({ type: 'profile', profileId: 1 })
  })

  it('CLI 선택 시 모델 셀렉터 노출, 모델 변경 전파', () => {
    const onChange = renderSel({ type: 'cli', presetId: 'claude_cli', model: 'sonnet' })
    const model = screen.getByLabelText('요약 LLM CLI 모델')
    expect(model).toBeInTheDocument()
    fireEvent.change(model, { target: { value: 'opus' } })
    expect(onChange).toHaveBeenCalledWith({ type: 'cli', presetId: 'claude_cli', model: 'opus' })
  })

  it('＋새 프로필 선택 → onCreateProfile, 값은 변경 안 함', () => {
    const onCreate = vi.fn()
    const onChange = renderSel({ type: 'special', id: 'none' }, { onCreateProfile: onCreate })
    fireEvent.change(screen.getByLabelText('요약 LLM 프로필'), { target: { value: '__new__' } })
    expect(onCreate).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("'직접 선택' 버튼 — special 상태에서 클릭 시 첫 프로필로 전환", () => {
    const onChange = renderSel({ type: 'special', id: 'none' })
    fireEvent.click(screen.getByText('직접 선택'))
    expect(onChange).toHaveBeenCalledWith({ type: 'profile', profileId: 1 })
  })

  it('특수옵션 버튼 클릭 → special 전파, 프로필 관리 버튼 → onManageProfiles', () => {
    const onManage = vi.fn()
    const onChange = renderSel({ type: 'profile', profileId: 1 }, { onManageProfiles: onManage })
    fireEvent.click(screen.getByText('선택 안함'))
    expect(onChange).toHaveBeenCalledWith({ type: 'special', id: 'none' })
    fireEvent.click(screen.getByText('프로필 관리'))
    expect(onManage).toHaveBeenCalled()
  })
})
