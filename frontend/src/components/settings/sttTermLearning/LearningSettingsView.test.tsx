import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LearningSettingsView from './LearningSettingsView'
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
})
