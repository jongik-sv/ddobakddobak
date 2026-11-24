import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('../../api/sttTermLearning', () => ({ getAiOriginal: vi.fn() }))

import { getAiOriginal } from '../../api/sttTermLearning'
import AiOriginalDiffModal from './AiOriginalDiffModal'

describe('AiOriginalDiffModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getAiOriginal 호출 후 diff와 AI 생성·마지막 사람 수정 시각을 표시한다', async () => {
    vi.mocked(getAiOriginal).mockResolvedValue({
      available: true,
      ai_generated_at: '2026-11-20T01:00:00Z',
      human_edited_at: '2026-11-21T02:00:00Z',
      diff: [
        { op: 'delete', text: '우판' },
        { op: 'insert', text: '후판' },
      ],
    })
    render(<AiOriginalDiffModal meetingId={7} onClose={() => {}} />)
    expect(getAiOriginal).toHaveBeenCalledWith(7)
    expect(await screen.findByText('후판')).toBeInTheDocument()
    expect(screen.getByText('우판')).toBeInTheDocument()
    expect(screen.getByText(/AI 생성/)).toBeInTheDocument()
    expect(screen.getByText(/마지막 사람 수정/)).toBeInTheDocument()
  })

  it('available false 면 안내 문구', async () => {
    vi.mocked(getAiOriginal).mockResolvedValue({
      available: false, ai_generated_at: null, human_edited_at: null, diff: [],
    })
    render(<AiOriginalDiffModal meetingId={7} onClose={() => {}} />)
    expect(
      await screen.findByText('이 회의에는 AI 원본이 없습니다(기능 도입 전 회의 또는 녹음 중)'),
    ).toBeInTheDocument()
  })

  it('조회 실패 시 오류 문구, 닫기 버튼은 onClose', async () => {
    vi.mocked(getAiOriginal).mockRejectedValue(new Error('x'))
    const onClose = vi.fn()
    render(<AiOriginalDiffModal meetingId={7} onClose={onClose} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('닫기'))
    expect(onClose).toHaveBeenCalled()
  })
})
