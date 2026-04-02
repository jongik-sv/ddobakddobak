import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportButton } from './ExportButton'
import { exportMeeting } from '../../api/meetings'
import { downloadMarkdown } from '../../lib/markdown'

vi.mock('../../api/meetings', () => ({ exportMeeting: vi.fn() }))
vi.mock('../../lib/markdown', () => ({
  downloadMarkdown: vi.fn(),
  buildMarkdownFilename: vi.fn(() => 'meeting-1-2026-03-25.md'),
}))

describe('ExportButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('초기에는 옵션 패널이 보이지 않는다', () => {
    render(<ExportButton meetingId={1} />)
    expect(screen.queryByText('회의록 내보내기')).not.toBeInTheDocument()
  })

  it('버튼 클릭 시 옵션 패널이 표시된다', async () => {
    render(<ExportButton meetingId={1} />)
    await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
    expect(screen.getByText('회의록 내보내기')).toBeInTheDocument()
    expect(screen.getByLabelText('AI 요약 포함')).toBeChecked()
    expect(screen.getByLabelText('원본 텍스트 포함')).not.toBeChecked()
  })

  it('체크박스 해제 후 다운로드 시 올바른 옵션으로 API를 호출한다', async () => {
    const mockExport = vi.mocked(exportMeeting).mockResolvedValue('# Meeting')
    render(<ExportButton meetingId={1} meetingDate="2026-03-25T00:00:00Z" />)

    await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
    await userEvent.click(screen.getByLabelText('AI 요약 포함'))  // 체크 해제
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    await waitFor(() => {
      expect(mockExport).toHaveBeenCalledWith(1, {
        include_summary: false,
        include_memo: true,
        include_transcript: false,
      })
    })
    expect(vi.mocked(downloadMarkdown)).toHaveBeenCalled()
  })

  it('API 오류 시 에러 메시지를 표시한다', async () => {
    vi.mocked(exportMeeting).mockRejectedValue(new Error('Network error'))
    render(<ExportButton meetingId={1} />)

    await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    expect(await screen.findByText(/내보내기에 실패했습니다/)).toBeInTheDocument()
  })

  it('취소 버튼 클릭 시 패널이 닫힌다', async () => {
    render(<ExportButton meetingId={1} />)
    await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByText('회의록 내보내기')).not.toBeInTheDocument()
  })

  it('다운로드 완료 후 패널이 자동으로 닫힌다', async () => {
    vi.mocked(exportMeeting).mockResolvedValue('# Meeting')
    render(<ExportButton meetingId={1} />)

    await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    await waitFor(() => {
      expect(screen.queryByText('회의록 내보내기')).not.toBeInTheDocument()
    })
  })
})
