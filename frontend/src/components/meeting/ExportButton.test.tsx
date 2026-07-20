import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportButton } from './ExportButton'
import { exportMeeting, getMeeting } from '../../api/meetings'
import { getDflowSettings } from '../../api/dflow'
import { downloadMarkdown } from '../../lib/markdown'

vi.mock('../../api/meetings', () => ({
  exportMeeting: vi.fn(),
  // D'Flow 진입점: 패널 열릴 때 status/folder_path 조회용. 기본은 노출 조건 미충족(completed 아님)으로
  // 응답해 기존 다운로드 시나리오 테스트에 영향을 주지 않는다.
  getMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'pending' }),
}))
vi.mock('../../api/dflow', () => ({
  getDflowSettings: vi.fn().mockResolvedValue({ enabled: false, base_url: null, api_secret_masked: '' }),
}))
vi.mock('../../lib/markdown', () => ({
  downloadMarkdown: vi.fn(),
  buildMarkdownFilename: vi.fn(() => 'meeting-1-2026-03-25.md'),
}))
// SendToDflowDialog는 자체적으로 getDflowStatus/getDflowMeta를 조회하는 별도 컴포넌트 —
// ExportButton 단위 테스트에서는 진입점 노출·클릭 동작만 확인하고 다이얼로그 내부는 스텁으로 치환.
vi.mock('./SendToDflowDialog', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div>
      <p>SendToDflowDialog stub</p>
      <button onClick={onClose}>dialog-close</button>
    </div>
  ),
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

  describe("D'Flow 진입점", () => {
    it('완료 + 연동 활성화 → 항목이 노출되고 클릭 시 다이얼로그가 열린다', async () => {
      vi.mocked(getMeeting).mockResolvedValue({ id: 1, status: 'completed' } as never)
      vi.mocked(getDflowSettings).mockResolvedValue({ enabled: true, base_url: null, api_secret_masked: '' })
      render(<ExportButton meetingId={1} />)

      await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
      const dflowItem = await screen.findByRole('button', { name: /D'Flow로 전송/ })

      await userEvent.click(dflowItem)
      expect(await screen.findByText('SendToDflowDialog stub')).toBeInTheDocument()
      // 다이얼로그를 열면 드롭다운 패널은 닫힌다.
      expect(screen.queryByText('회의록 내보내기')).not.toBeInTheDocument()
    })

    it('완료되지 않은 회의 → 항목이 노출되지 않는다', async () => {
      vi.mocked(getMeeting).mockResolvedValue({ id: 1, status: 'recording' } as never)
      vi.mocked(getDflowSettings).mockResolvedValue({ enabled: true, base_url: null, api_secret_masked: '' })
      render(<ExportButton meetingId={1} />)

      await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
      await screen.findByText('회의록 내보내기')
      expect(screen.queryByRole('button', { name: /D'Flow로 전송/ })).not.toBeInTheDocument()
    })

    it('D\'Flow 연동 비활성화 → 완료 회의여도 항목이 노출되지 않는다', async () => {
      vi.mocked(getMeeting).mockResolvedValue({ id: 1, status: 'completed' } as never)
      vi.mocked(getDflowSettings).mockResolvedValue({ enabled: false, base_url: null, api_secret_masked: '' })
      render(<ExportButton meetingId={1} />)

      await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
      await screen.findByText('회의록 내보내기')
      expect(screen.queryByRole('button', { name: /D'Flow로 전송/ })).not.toBeInTheDocument()
    })

    it('전송됨 상태면 항목 옆에 상태 텍스트를 표시한다', async () => {
      vi.mocked(getMeeting).mockResolvedValue({
        id: 1,
        status: 'completed',
        dflow_synced_at: '2026-03-25T00:00:00Z',
        dflow_needs_resync: false,
      } as never)
      vi.mocked(getDflowSettings).mockResolvedValue({ enabled: true, base_url: null, api_secret_masked: '' })
      render(<ExportButton meetingId={1} />)

      await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
      const dflowItem = await screen.findByRole('button', { name: /D'Flow로 전송/ })
      expect(dflowItem).toHaveTextContent('전송됨')
    })

    it('재전송 필요 상태면 항목 옆에 "재전송 필요"를 표시한다', async () => {
      vi.mocked(getMeeting).mockResolvedValue({
        id: 1,
        status: 'completed',
        dflow_synced_at: '2026-03-25T00:00:00Z',
        dflow_needs_resync: true,
      } as never)
      vi.mocked(getDflowSettings).mockResolvedValue({ enabled: true, base_url: null, api_secret_masked: '' })
      render(<ExportButton meetingId={1} />)

      await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
      const dflowItem = await screen.findByRole('button', { name: /D'Flow로 전송/ })
      expect(dflowItem).toHaveTextContent('재전송 필요')
    })

    it('상태·설정 조회 실패 → 항목이 노출되지 않는다(fail-closed)', async () => {
      vi.mocked(getMeeting).mockRejectedValue(new Error('network error'))
      render(<ExportButton meetingId={1} />)

      await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
      await screen.findByText('회의록 내보내기')
      expect(screen.queryByRole('button', { name: /D'Flow로 전송/ })).not.toBeInTheDocument()
    })
  })
})
