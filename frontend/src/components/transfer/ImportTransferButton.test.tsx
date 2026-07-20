import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const importMeeting = vi.fn()
const importFolder = vi.fn()
vi.mock('../../api/transfers', () => ({
  importMeeting: (...a: unknown[]) => importMeeting(...a),
  importFolder: (...a: unknown[]) => importFolder(...a),
}))

import ImportTransferButton from './ImportTransferButton'

beforeEach(() => {
  importMeeting.mockReset()
  importFolder.mockReset()
})

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

describe('ImportTransferButton', () => {
  it('T7: 회의 import 응답에 warnings 가 있으면 경고 문구를 표시한다', async () => {
    importMeeting.mockResolvedValue({
      meeting_id: 1,
      warnings: ["D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정"],
    })
    const onImported = vi.fn()

    render(<ImportTransferButton projectId={1} onImported={onImported} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'meeting.ddobak-meeting.tgz', { type: 'application/gzip' })
    selectFile(input, file)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정",
      )
    })
    expect(onImported).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'meeting', meeting_id: 1 }),
    )
  })

  it('경고가 없으면 alert 를 렌더링하지 않는다', async () => {
    importMeeting.mockResolvedValue({ meeting_id: 2, warnings: [] })
    const onImported = vi.fn()

    render(<ImportTransferButton projectId={1} onImported={onImported} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'meeting.ddobak-meeting.tgz', { type: 'application/gzip' })
    selectFile(input, file)

    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('T7: 폴더 import 응답에 warnings 가 있으면 경고 문구를 표시한다', async () => {
    importFolder.mockResolvedValue({
      folder_id: 5,
      meeting_ids: [10, 11],
      warnings: ["D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정"],
    })
    const onImported = vi.fn()

    render(<ImportTransferButton projectId={1} onImported={onImported} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'folder.ddobak-folder.tgz', { type: 'application/gzip' })
    selectFile(input, file)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정",
      )
    })
  })
})
