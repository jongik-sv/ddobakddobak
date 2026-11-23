import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import AllTermsView from './AllTermsView'
import { treeFixture, row } from './fixtures'
import * as api from '../../../api/sttTermLearning'

vi.mock('../../../api/sttTermLearning')
const confirmMock = vi.fn()
vi.mock('../../../lib/confirmDialog', () => ({ confirmDialog: (...a: unknown[]) => confirmMock(...a) }))

const m = vi.mocked(api)
const proj = { type: 'Project' as const, id: 1, name: 'TF', path: ['TF'] }

const rows = () => [
  row({ n: 1 }),
  row({ n: 2, source: 'human', domain_file: { id: 200, name: '용어집', auto: false } }),
  row({ n: 3, term: '산세라인', key: 'ss', mispronunciations: ['상세 라인'], duplicate_group: 'g1', merge_target: proj,
    level: { type: 'Folder', id: 11, name: '주간', path: ['TF', '생산회의', '주간'] } }),
  row({ n: 4, term: '산세라인', key: 'ss', mispronunciations: ['산세 라인'], duplicate_group: 'g1', merge_target: proj,
    level: { type: 'Folder', id: 10, name: '생산회의', path: ['TF', '생산회의'] } }),
]

beforeEach(() => {
  vi.clearAllMocks()
  m.getTree.mockResolvedValue(treeFixture)
  m.getTerms.mockResolvedValue({ terms: rows() })
  m.getImpact.mockResolvedValue([3, 5])
  m.applyMoves.mockResolvedValue({ moved: 1, merged: 0 })
})

async function stage1() {
  render(<AllTermsView />)
  await screen.findByText('용어1')
  fireEvent.click(screen.getByRole('button', { name: '용어1 레벨 변경' }))
  const menu = await screen.findByRole('menu', { name: '용어1 레벨 선택' })
  fireEvent.click(within(menu).getByRole('menuitem', { name: /TF/ }))
}

describe('AllTermsView', () => {
  it('전체 용어 표: 필터(출처·중복만·올릴 후보만), duplicate_group 행은 "중복" 강조', async () => {
    render(<AllTermsView />)
    await screen.findByText('용어1')
    expect(m.getTerms).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('중복').length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getByRole('button', { name: '사람 작성' }))
    expect(screen.queryByText('용어1')).not.toBeInTheDocument()
    expect(screen.getByText('용어2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '출처 전체' }))
    fireEvent.click(screen.getByRole('button', { name: '중복만' }))
    expect(screen.queryByText('용어1')).not.toBeInTheDocument()
    expect(screen.getAllByText('산세라인')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '중복만' }))
    fireEvent.click(screen.getByRole('button', { name: '올릴 후보만' }))
    expect(screen.queryByText('용어2')).not.toBeInTheDocument()
    expect(screen.getAllByText('산세라인')).toHaveLength(2)
  })

  it('레벨 칸 클릭 → 트리 선택 → "변경 예정" 배지, 하단 요약', async () => {
    await stage1()
    expect(await screen.findByText('변경 예정')).toBeInTheDocument()
    expect(await screen.findByText(/변경 1건 — 용어1 ⬆ TF \(적용 회의 3→5\)/)).toBeInTheDocument()
    expect(m.getImpact).toHaveBeenCalledWith([
      { level: { type: 'Folder', id: 10 }, domain_file_id: 101 },
      { level: { type: 'Project', id: 1 } },
    ])
    expect(m.applyMoves).not.toHaveBeenCalled()
  })

  it('"변경 적용" 은 applyMoves 한 번 호출 후 목록 재조회, "모두 취소" 는 비움', async () => {
    await stage1()
    await screen.findByText(/변경 1건/)
    fireEvent.click(screen.getByRole('button', { name: '모두 취소' }))
    expect(screen.queryByText(/변경 1건/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '용어1 레벨 변경' }))
    fireEvent.click(within(await screen.findByRole('menu', { name: '용어1 레벨 선택' })).getByRole('menuitem', { name: /TF/ }))
    await screen.findByText(/변경 1건/)
    const before = m.getTerms.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '변경 적용' }))
    await waitFor(() => expect(m.applyMoves).toHaveBeenCalledTimes(1))
    expect(m.applyMoves).toHaveBeenCalledWith([
      { domain_file_id: 101, term_keys: ['k1'], target: { type: 'Project', id: 1 } },
    ])
    await waitFor(() => expect(m.getTerms.mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByText(/변경 1건/)).not.toBeInTheDocument())
  })

  it('"공통 상위로 합치기" 는 merge_target 으로 그룹 행 전부 변경 예정에 추가', async () => {
    render(<AllTermsView />)
    await screen.findByText('용어1')
    fireEvent.click(screen.getAllByRole('button', { name: 'TF로 합치기' })[0])
    expect(await screen.findByText(/변경 2건/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '변경 적용' }))
    await waitFor(() =>
      expect(m.applyMoves).toHaveBeenCalledWith([
        { domain_file_id: 101, term_keys: ['ss'], target: { type: 'Project', id: 1 } },
        { domain_file_id: 100, term_keys: ['ss'], target: { type: 'Project', id: 1 } },
      ]),
    )
  })

  it('적용 실패(422) 시 변경 예정 유지 + 오류 표시', async () => {
    m.applyMoves.mockRejectedValue({ response: { json: async () => ({ error: '대상 충돌' }) } })
    await stage1()
    await screen.findByText(/변경 1건/)
    fireEvent.click(screen.getByRole('button', { name: '변경 적용' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('대상 충돌')
    expect(screen.getByText(/변경 1건/)).toBeInTheDocument()
    expect(screen.getByText('변경 예정')).toBeInTheDocument()
  })
})
