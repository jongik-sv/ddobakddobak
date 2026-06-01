import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

import ModelManager from './ModelManager'

// ── config 목: 기본 모바일 Tauri + 서버 연결됨 ───────────────
let mockIsMobile = true
let mockBase = 'http://127.0.0.1:9/api/v1'
vi.mock('../../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config')>()
  return {
    ...actual,
    IS_TAURI: true,
    get IS_MOBILE() {
      return mockIsMobile
    },
    getApiBaseUrl: () => mockBase,
  }
})

// ── modelDownloader 목 ───────────────────────────────────────
const cohereModelStatus = vi.fn()
const downloadCohereModel = vi.fn()
const ensureCohereModel = vi.fn()
const deleteCohereModel = vi.fn()
vi.mock('../../stt/modelDownloader', () => ({
  cohereModelStatus: () => cohereModelStatus(),
  downloadCohereModel: (cb?: unknown) => downloadCohereModel(cb),
  ensureCohereModel: () => ensureCohereModel(),
  deleteCohereModel: () => deleteCohereModel(),
}))

describe('ModelManager', () => {
  beforeEach(() => {
    mockIsMobile = true
    mockBase = 'http://127.0.0.1:9/api/v1'
    cohereModelStatus.mockReset()
    downloadCohereModel.mockReset()
    ensureCohereModel.mockReset()
    deleteCohereModel.mockReset()
  })

  it('비모바일이면 아무것도 렌더 안 함', () => {
    mockIsMobile = false
    const { container } = render(<ModelManager />)
    expect(container.firstChild).toBeNull()
  })

  it('미설치면 다운로드 버튼 노출', async () => {
    cohereModelStatus.mockResolvedValue({ present: false, dir: '', missing: ['x'], bytes: 0 })
    render(<ModelManager />)
    expect(await screen.findByRole('button', { name: /모델 다운로드/ })).toBeInTheDocument()
  })

  it('설치됨이면 용량 + 삭제 버튼 노출', async () => {
    cohereModelStatus.mockResolvedValue({
      present: true,
      dir: '/d',
      missing: [],
      bytes: 2_900_000_000,
    })
    render(<ModelManager />)
    expect(await screen.findByText(/준비됨/)).toBeInTheDocument()
    expect(screen.getByText(/2\.7 GB/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /모델 삭제/ })).toBeInTheDocument()
  })

  it('다운로드: 스테이징 없으면 네트워크 다운로드 폴백 + onChanged', async () => {
    cohereModelStatus
      .mockResolvedValueOnce({ present: false, dir: '', missing: ['x'], bytes: 0 })
      .mockResolvedValueOnce({ present: true, dir: '/d', missing: [], bytes: 2_900_000_000 })
    ensureCohereModel.mockRejectedValue(new Error('MODEL_MISSING')) // 스테이징 없음
    downloadCohereModel.mockResolvedValue({ dir: '/d' })
    const onChanged = vi.fn()

    render(<ModelManager onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: /모델 다운로드/ }))

    await waitFor(() => expect(downloadCohereModel).toHaveBeenCalled())
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('다운로드: 스테이징 있으면 네트워크 안 탐', async () => {
    cohereModelStatus
      .mockResolvedValueOnce({ present: false, dir: '', missing: ['x'], bytes: 0 })
      .mockResolvedValueOnce({ present: true, dir: '/d', missing: [], bytes: 2_900_000_000 })
    ensureCohereModel.mockResolvedValue({ dir: '/d' }) // 스테이징 있음
    render(<ModelManager />)
    fireEvent.click(await screen.findByRole('button', { name: /모델 다운로드/ }))

    await waitFor(() => expect(ensureCohereModel).toHaveBeenCalled())
    expect(downloadCohereModel).not.toHaveBeenCalled()
  })

  it('서버 미연결(base 빈문자열)에서 다운로드 시 안내 에러', async () => {
    mockBase = ''
    cohereModelStatus.mockResolvedValue({ present: false, dir: '', missing: ['x'], bytes: 0 })
    ensureCohereModel.mockRejectedValue(new Error('MODEL_MISSING'))
    render(<ModelManager />)
    fireEvent.click(await screen.findByRole('button', { name: /모델 다운로드/ }))

    expect(await screen.findByText(/모델을 받을 수 있습니다/)).toBeInTheDocument()
    expect(downloadCohereModel).not.toHaveBeenCalled()
  })

  it('삭제: 확인 후 deleteCohereModel 호출 + onChanged', async () => {
    cohereModelStatus
      .mockResolvedValueOnce({ present: true, dir: '/d', missing: [], bytes: 2_900_000_000 })
      .mockResolvedValueOnce({ present: false, dir: '/d', missing: ['x'], bytes: 0 })
    deleteCohereModel.mockResolvedValue(undefined)
    const onChanged = vi.fn()

    render(<ModelManager onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: /모델 삭제/ }))
    // 확인 단계 노출 → 삭제 확정
    fireEvent.click(await screen.findByRole('button', { name: /^삭제$/ }))

    await waitFor(() => expect(deleteCohereModel).toHaveBeenCalled())
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})
