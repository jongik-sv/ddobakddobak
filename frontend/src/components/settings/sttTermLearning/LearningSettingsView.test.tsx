import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LearningSettingsView from './LearningSettingsView'
import { httpError } from './testHelpers'
import * as api from '../../../api/sttTermLearning'

vi.mock('../../../api/sttTermLearning')
const m = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  m.getSettings.mockResolvedValue({ enabled: true, idle_minutes: 30, min_confidence: 0.6 })
  m.updateSettings.mockImplementation(async (s) => s)
})

describe('LearningSettingsView', () => {
  it('사용 토글·대기 분·confidence 를 updateSettings 로 저장, 추출 LLM 은 "회의 생성자의 요약 LLM" 안내 문구', async () => {
    render(<LearningSettingsView />)
    const enabled = await screen.findByRole('checkbox', { name: '자동 추출·등록 사용' })
    expect(enabled).toBeChecked()
    expect(screen.getByText(/회의 생성자의 요약 LLM/)).toBeInTheDocument()
    expect(screen.queryByText(/서버 기본 LLM/)).toBeNull()
    fireEvent.click(enabled)
    fireEvent.change(screen.getByLabelText('대기 분'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('최소 confidence'), { target: { value: '0.8' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(m.updateSettings).toHaveBeenCalledWith({ enabled: false, idle_minutes: 45, min_confidence: 0.8 }))
    expect(await screen.findByText('저장했습니다.')).toBeInTheDocument()
  })

  it('범위를 벗어나거나 빈 입력이면 인라인 메시지와 저장 비활성', async () => {
    render(<LearningSettingsView />)
    await screen.findByLabelText('대기 분')
    fireEvent.change(screen.getByLabelText('대기 분'), { target: { value: '4' } })
    expect(screen.getByRole('alert')).toHaveTextContent('5~1440')
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('대기 분'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('최소 confidence'), { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('confidence')
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('최소 confidence'), { target: { value: '1.5' } })
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('서버 422 면 저장 실패 문구를 표시', async () => {
    m.updateSettings.mockRejectedValueOnce(httpError(422, { error: '범위 오류' }))
    render(<LearningSettingsView />)
    await screen.findByLabelText('대기 분')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('범위 오류')).toBeInTheDocument()
  })
})
