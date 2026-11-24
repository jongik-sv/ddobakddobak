import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MoveTermsDialog from './MoveTermsDialog'
import { buildLevelTree } from './levelTree'
import { treeFixture, row } from './fixtures'
import { useAuthStore } from '../../../stores/authStore'
import * as api from '../../../api/sttTermLearning'

vi.mock('../../../api/sttTermLearning')
const m = vi.mocked(api)
const tree = buildLevelTree(treeFixture)

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: { id: 1, email: 'a@x.com', name: 'A', role: 'admin' } })
  m.getImpact.mockResolvedValue([3, 46])
  m.applyMoves.mockResolvedValue({ moved: 2, merged: 0 })
})

const setup = (extra = {}) => {
  const onClose = vi.fn()
  const onApplied = vi.fn()
  render(<MoveTermsDialog rows={[row({ n: 1 }), row({ n: 3 })]} tree={tree} onClose={onClose} onApplied={onApplied} {...extra} />)
  return { onClose, onApplied }
}

describe('MoveTermsDialog', () => {
  it('대상 선택 시 getImpact 로 적용 회의 수 전→후 표시', async () => {
    setup()
    fireEvent.click(screen.getByRole('treeitem', { name: /TF/ }))
    expect(await screen.findByText('3건 → 46건')).toBeInTheDocument()
    expect(m.getImpact).toHaveBeenCalledWith([
      { level: { type: 'Folder', id: 10 }, domain_file_id: 101 },
      { level: { type: 'Project', id: 1 } },
    ])
    expect(screen.getByRole('button', { name: 'TF로 올리기' })).toBeInTheDocument()
  })

  it('merge_descendants·copy 체크가 applyMoves 페이로드에 반영', async () => {
    const { onApplied } = setup({ initialTarget: { type: 'Project', id: 1 } })
    fireEvent.click(screen.getByLabelText(/하위 폴더에 있는 같은 용어도/))
    fireEvent.click(screen.getByLabelText(/원래 레벨에도 남겨 두기/))
    fireEvent.click(screen.getByRole('button', { name: 'TF로 올리기' }))
    await waitFor(() => expect(onApplied).toHaveBeenCalled())
    expect(m.applyMoves).toHaveBeenCalledWith([
      { domain_file_id: 101, term_keys: ['k1', 'k3'], target: { type: 'Project', id: 1 }, copy: true, merge_descendants: true },
    ])
  })

  it('applyMoves 실패(422) 시 오류 문구 표시, onApplied 호출 안 함', async () => {
    m.applyMoves.mockRejectedValueOnce({ response: { status: 422, json: async () => ({ error: '대상에 같은 키가 있습니다' }) } })
    const { onApplied } = setup({ initialTarget: { type: 'global', id: null } })
    fireEvent.click(screen.getByRole('button', { name: '전역(공용)로 올리기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('대상에 같은 키가 있습니다')
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('여러 레벨 행이면 중립 문구·영향 숫자 숨김, 합치기 체크 없음', async () => {
    const other = row({ n: 2, level: { type: 'Folder', id: 11, name: '주간', path: ['TF', '생산회의', '주간'] } })
    render(<MoveTermsDialog rows={[row({ n: 1 }), other]} tree={tree} initialTarget={{ type: 'Project', id: 1 }} onClose={vi.fn()} onApplied={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'TF로 옮기기' })).toBeInTheDocument()
    expect(screen.getByText(/여러 레벨 선택됨/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/하위 폴더에 있는 같은 용어도/)).toBeNull()
    expect(m.getImpact).not.toHaveBeenCalled()
  })

  it('하위(down) 대상이면 합치기 체크박스 숨김', () => {
    setup({ initialTarget: { type: 'Folder', id: 11 } })
    expect(screen.queryByLabelText(/하위 폴더에 있는 같은 용어도/)).toBeNull()
  })
})

describe('MoveTermsDialog 전역 대상(프로젝트 관리자)', () => {
  it('시스템 관리자가 아니면 전역 레벨은 이동 대상으로 고를 수 없다', async () => {
    useAuthStore.setState({ user: { id: 2, email: 'p@x.com', name: 'P', role: 'member' } })
    render(<MoveTermsDialog rows={[row({ n: 1 })]} tree={buildLevelTree(treeFixture)} onClose={() => {}} onApplied={() => {}} />)
    const items = await screen.findAllByRole('treeitem')
    expect(items[0]).toBeDisabled() // 전역
  })
})
