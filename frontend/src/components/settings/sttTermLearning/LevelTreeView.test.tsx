import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LevelTreeView from './LevelTreeView'
import { treeFixture, row } from './fixtures'
import * as api from '../../../api/sttTermLearning'

vi.mock('../../../api/sttTermLearning')
const confirmMock = vi.fn()
vi.mock('../../../lib/confirmDialog', () => ({ confirmDialog: (...a: unknown[]) => confirmMock(...a) }))

const m = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  m.getTree.mockResolvedValue(treeFixture)
  m.getTerms.mockResolvedValue({ terms: [row({ n: 1 }), row({ n: 2 })] })
  m.getImpact.mockResolvedValue([3, 5])
  m.applyMoves.mockResolvedValue({ moved: 1, merged: 0 })
  m.deleteTerms.mockResolvedValue({ deleted: 1 })
})

describe('LevelTreeView', () => {
  it('트리 노드 클릭 → 그 레벨 getTerms 호출, 행에 오인식→용어·출처·도메인 파일 표시', async () => {
    render(<LevelTreeView />)
    await screen.findByText('용어1')
    fireEvent.click(await screen.findByRole('button', { name: /생산회의/ }))
    await waitFor(() =>
      expect(m.getTerms).toHaveBeenLastCalledWith({ level: { type: 'Folder', id: 10 }, includeDescendants: false }),
    )
    expect(screen.getAllByText('오1').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/자동 · #219/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('STT 오인식(자동)').length).toBeGreaterThan(0)
  })

  it('promote_candidates 가 있으면 "상위로 올릴 후보 N건" 안내', async () => {
    render(<LevelTreeView />)
    fireEvent.click(await screen.findByRole('button', { name: /생산회의/ }))
    expect(await screen.findByText(/상위로 올릴 후보 1건/)).toBeInTheDocument()
  })

  it('행 ⬆ 는 부모 레벨로 applyMoves(term_keys 1개) 후 목록 새로고침', async () => {
    render(<LevelTreeView />)
    await screen.findByText('용어1')
    const before = m.getTerms.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '용어1 상위 레벨로' }))
    await waitFor(() =>
      expect(m.applyMoves).toHaveBeenCalledWith([
        { domain_file_id: 101, term_keys: ['k1'], target: { type: 'Project', id: 1 } },
      ]),
    )
    await waitFor(() => expect(m.getTerms.mock.calls.length).toBeGreaterThan(before))
  })

  it('체크 2건 후 "레벨 이동…" → MoveTermsDialog 에 2행', async () => {
    render(<LevelTreeView />)
    await screen.findByText('용어1')
    fireEvent.click(screen.getByLabelText('용어1 선택'))
    fireEvent.click(screen.getByLabelText('용어2 선택'))
    fireEvent.click(screen.getByRole('button', { name: '레벨 이동…' }))
    expect(await screen.findByText('용어 2건을 다른 레벨로 이동')).toBeInTheDocument()
  })

  it('삭제는 confirmDialog 확인 후 deleteTerms, 취소면 호출 안 함', async () => {
    render(<LevelTreeView />)
    await screen.findByText('용어1')
    fireEvent.click(screen.getByLabelText('용어1 선택'))
    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(m.deleteTerms).not.toHaveBeenCalled()
    confirmMock.mockResolvedValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(m.deleteTerms).toHaveBeenCalledWith([{ domain_file_id: 101, term_key: 'k1' }]))
  })
})
