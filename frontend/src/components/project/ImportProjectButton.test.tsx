import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const importProject = vi.fn()
vi.mock('../../api/projectTransfers', () => ({
  importProject: (...a: unknown[]) => importProject(...a),
}))

import ImportProjectButton from './ImportProjectButton'

beforeEach(() => {
  importProject.mockReset()
})

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

describe('ImportProjectButton', () => {
  it('프로젝트 import 응답에 warnings 가 있으면 경고 문구를 표시한다', async () => {
    importProject.mockResolvedValue({
      project_id: 42,
      warnings: ['화자 로스터 복원 실패 — 사이드카 연결을 확인한 뒤 화자 관리에서 재등록하세요'],
    })
    const onImported = vi.fn()

    render(<ImportProjectButton onImported={onImported} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'p.ddobak.tgz', { type: 'application/gzip' })
    selectFile(input, file)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '화자 로스터 복원 실패 — 사이드카 연결을 확인한 뒤 화자 관리에서 재등록하세요',
      )
    })
    expect(onImported).toHaveBeenCalledWith(42, [
      '화자 로스터 복원 실패 — 사이드카 연결을 확인한 뒤 화자 관리에서 재등록하세요',
    ])
  })

  it('warnings 가 여러 개면 공백으로 이어 붙여 표시한다', async () => {
    importProject.mockResolvedValue({
      project_id: 7,
      warnings: ['화자 로스터 복원 실패', "D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨"],
    })

    render(<ImportProjectButton onImported={vi.fn()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    selectFile(input, new File(['x'], 'p.ddobak.tgz', { type: 'application/gzip' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "화자 로스터 복원 실패 D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨",
      )
    })
  })

  it('경고가 없으면 alert 를 렌더링하지 않는다', async () => {
    importProject.mockResolvedValue({ project_id: 3, warnings: [] })
    const onImported = vi.fn()

    render(<ImportProjectButton onImported={onImported} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    selectFile(input, new File(['x'], 'p.ddobak.tgz', { type: 'application/gzip' }))

    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('import 실패 시 에러 문구를 표시한다', async () => {
    importProject.mockRejectedValue(new Error('boom'))

    render(<ImportProjectButton onImported={vi.fn()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    selectFile(input, new File(['x'], 'p.ddobak.tgz', { type: 'application/gzip' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('가져오기에 실패했습니다')
    })
  })
})
