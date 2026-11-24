import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MisrecognitionsView from './MisrecognitionsView'
import { treeFixture } from './fixtures'
import { mis, lvl } from './testHelpers'
import { useAuthStore } from '../../../stores/authStore'
import * as api from '../../../api/sttTermLearning'

vi.mock('../../../api/sttTermLearning')
const confirmMock = vi.fn()
vi.mock('../../../lib/confirmDialog', () => ({ confirmDialog: (...a: unknown[]) => confirmMock(...a) }))
const m = vi.mocked(api)

beforeEach(() => {
  useAuthStore.setState({ user: { id: 1, email: 'a@x.com', name: 'A', role: 'admin' } })
  vi.clearAllMocks()
  confirmMock.mockReset()
  m.getTree.mockResolvedValue(treeFixture)
  m.getMisrecognitions.mockResolvedValue({
    misrecognitions: [mis(), mis({ id: 2, wrong: '우반', status: 'undecided', registered: null })],
    counts: { total: 63, undecided: 4 },
  })
  m.updateMisrecognition.mockResolvedValue(mis())
  m.applyMoves.mockResolvedValue({ moved: 1, merged: 0 })
})

describe('MisrecognitionsView', () => {
  it('상태 필터(전체/확정/미정/제외) + 검색어로 getMisrecognitions, 상태 전환은 updateMisrecognition', async () => {
    render(<MisrecognitionsView />)
    await screen.findByText('우반')
    expect(m.getMisrecognitions).toHaveBeenLastCalledWith({ status: undefined, q: undefined })
    fireEvent.click(screen.getByRole('button', { name: '미정' }))
    await waitFor(() => expect(m.getMisrecognitions).toHaveBeenLastCalledWith({ status: 'undecided', q: undefined }))
    fireEvent.change(screen.getByLabelText('오인식 검색'), { target: { value: '후판' } })
    await waitFor(() => expect(m.getMisrecognitions).toHaveBeenLastCalledWith({ status: 'undecided', q: '후판' }))
    fireEvent.click(screen.getByRole('button', { name: '우반 확정' }))
    await waitFor(() => expect(m.updateMisrecognition).toHaveBeenCalledWith(2, { status: 'confirmed' }))
  })

  it('registered 가 있으면 ⬆ 버튼 → applyMoves(부모 레벨)', async () => {
    render(<MisrecognitionsView />)
    const up = await screen.findByRole('button', { name: '우판 상위 레벨로' })
    await waitFor(() => expect(up).not.toBeDisabled())
    expect(screen.queryByRole('button', { name: '우반 상위 레벨로' })).toBeNull()
    fireEvent.click(up)
    await waitFor(() =>
      expect(m.applyMoves).toHaveBeenCalledWith([{ domain_file_id: 101, term_keys: ['k1'], target: { type: 'Project', id: 1 } }]),
    )
  })

  it('⬆ 대상이 전역이면 confirmDialog — 취소면 applyMoves 안 함', async () => {
    const projectLevel = { type: 'Project' as const, id: 1, name: 'TF', path: ['TF'] }
    m.getMisrecognitions.mockResolvedValue({
      misrecognitions: [mis({ registered: { domain_file_id: 101, term_key: 'k1', auto: true, level: projectLevel } })],
      counts: { total: 1, undecided: 0 },
    })
    render(<MisrecognitionsView />)
    const up = await screen.findByRole('button', { name: '우판 상위 레벨로' })
    await waitFor(() => expect(up).not.toBeDisabled())
    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(up)
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock.mock.calls[0][0]).toMatch(/전역/)
    await new Promise((r) => setTimeout(r, 10))
    expect(m.applyMoves).not.toHaveBeenCalled()
    confirmMock.mockResolvedValueOnce(true)
    fireEvent.click(up)
    await waitFor(() =>
      expect(m.applyMoves).toHaveBeenCalledWith([{ domain_file_id: 101, term_keys: ['k1'], target: { type: 'global', id: null } }]),
    )
  })

  it('⬆ 등록 위치가 사람 파일이면 confirmDialog — 취소면 applyMoves 안 함', async () => {
    m.getMisrecognitions.mockResolvedValue({
      misrecognitions: [mis({ registered: { domain_file_id: 101, term_key: 'k1', auto: false, level: lvl } })],
      counts: { total: 1, undecided: 0 },
    })
    render(<MisrecognitionsView />)
    const up = await screen.findByRole('button', { name: '우판 상위 레벨로' })
    await waitFor(() => expect(up).not.toBeDisabled())
    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(up)
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock.mock.calls[0][0]).toMatch(/사람이 작성한/)
    await new Promise((r) => setTimeout(r, 10))
    expect(m.applyMoves).not.toHaveBeenCalled()
  })

  it('늦게 도착한 옛 응답은 최신 목록을 덮어쓰지 않는다', async () => {
    render(<MisrecognitionsView />)
    await screen.findByText('우반')
    let resolveOld!: (v: Awaited<ReturnType<typeof api.getMisrecognitions>>) => void
    m.getMisrecognitions.mockImplementationOnce(() => new Promise((r) => { resolveOld = r }))
    fireEvent.click(screen.getByRole('button', { name: '미정' }))
    await waitFor(() => expect(m.getMisrecognitions).toHaveBeenCalledTimes(2))
    m.getMisrecognitions.mockResolvedValueOnce({ misrecognitions: [mis({ id: 3, wrong: '신규표기' })], counts: { total: 1, undecided: 0 } })
    fireEvent.click(screen.getByRole('button', { name: '확정' }))
    await screen.findByText('신규표기')
    resolveOld({ misrecognitions: [mis({ id: 9, wrong: '옛표기' })], counts: { total: 1, undecided: 0 } })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('옛표기')).toBeNull()
    expect(screen.getByText('신규표기')).toBeInTheDocument()
  })
})
