import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LevelTreeView from './LevelTreeView'
import { treeFixture, row } from './fixtures'
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

  it('⬆ 대상이 전역이면 confirmDialog — 취소면 applyMoves 안 함, 확인이면 호출', async () => {
    const projectLevel = { type: 'Project' as const, id: 1, name: 'TF', path: ['TF'] }
    m.getTerms.mockResolvedValue({ terms: [row({ n: 3, level: projectLevel })] })
    render(<LevelTreeView />)
    await screen.findByText('용어3')
    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: '용어3 상위 레벨로' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock.mock.calls[0][0]).toMatch(/전역/)
    expect(m.applyMoves).not.toHaveBeenCalled()
    confirmMock.mockResolvedValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: '용어3 상위 레벨로' }))
    await waitFor(() =>
      expect(m.applyMoves).toHaveBeenCalledWith([{ domain_file_id: 101, term_keys: ['k3'], target: { type: 'global', id: null } }]),
    )
  })

  it.each(['human', 'human_merged'] as const)('⬆ 원본이 사람 파일(%s)이면 confirmDialog, 취소면 applyMoves 안 함', async (source) => {
    m.getTerms.mockResolvedValue({
      terms: [row({ n: 1, source, domain_file: { id: 101, name: '제강 용어', auto: false } })],
    })
    render(<LevelTreeView />)
    await screen.findByText('용어1')
    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: '용어1 상위 레벨로' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock.mock.calls[0][0]).toMatch(/사람이 작성한/)
    await new Promise((r) => setTimeout(r, 10))
    expect(m.applyMoves).not.toHaveBeenCalled()
  })

  it('자동 파일 행을 폴더 → 프로젝트로 올릴 때는 묻지 않는다', async () => {
    render(<LevelTreeView />)
    await screen.findByText('용어1')
    fireEvent.click(screen.getByRole('button', { name: '용어1 상위 레벨로' }))
    await waitFor(() => expect(m.applyMoves).toHaveBeenCalled())
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('체크 2건 후 "레벨 이동…" → MoveTermsDialog 에 2행', async () => {
    render(<LevelTreeView />)
    await screen.findByText('용어1')
    fireEvent.click(screen.getByLabelText('용어1 선택'))
    fireEvent.click(screen.getByLabelText('용어2 선택'))
    fireEvent.click(screen.getByRole('button', { name: '레벨 이동…' }))
    const dlg = await screen.findByRole('dialog', { name: '레벨 이동' })
    expect(dlg).toHaveTextContent('용어 2건을 다른 레벨로 이동')
    expect(dlg).toHaveTextContent('용어1')
    expect(dlg).toHaveTextContent('용어2')
  })

  it('늦게 도착한 이전 레벨 응답은 무시', async () => {
    let resolveFirst: (v: { terms: ReturnType<typeof row>[] }) => void = () => {}
    m.getTerms.mockReset()
    m.getTerms
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValue({ terms: [row({ n: 7 })] })
    render(<LevelTreeView />)
    fireEvent.click(await screen.findByRole('button', { name: /생산회의/ }))
    await screen.findByText('용어7')
    resolveFirst({ terms: [row({ n: 8 })] })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('용어8')).toBeNull()
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

describe('LevelTreeView 전역 읽기 전용(프로젝트 관리자)', () => {
  const globalRow = row({ n: 7, level: { type: 'global', id: null, name: '전역', path: [] } })

  beforeEach(() => {
    useAuthStore.setState({ user: { id: 2, email: 'p@x.com', name: 'P', role: 'member' } })
    m.getTerms.mockResolvedValue({ terms: [globalRow, row({ n: 1 })] })
  })

  it('전역 줄은 선택·이동·상위 이동이 막히고 안내가 보인다, 프로젝트 줄은 가능', async () => {
    render(<LevelTreeView />)
    await screen.findByText('용어7')
    expect(screen.getByText(/전역\(공용\) 용어는 읽기 전용/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '용어7 선택' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '용어7 이동…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '용어7 상위 레벨로' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '용어1 선택' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '용어1 이동…' })).not.toBeDisabled()
    // 프로젝트 직속이 아닌 폴더 줄이라도 전역으로 올리기는 막는다(부모가 전역인 레벨)
  })

  it('시스템 관리자는 전역 줄도 선택할 수 있다', async () => {
    useAuthStore.setState({ user: { id: 1, email: 'a@x.com', name: 'A', role: 'admin' } })
    render(<LevelTreeView />)
    await screen.findByText('용어7')
    expect(screen.getByRole('checkbox', { name: '용어7 선택' })).not.toBeDisabled()
    expect(screen.queryByText(/전역\(공용\) 용어는 읽기 전용/)).toBeNull()
  })
})
