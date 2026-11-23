import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MisrecognitionsView from './MisrecognitionsView'
import { treeFixture } from './fixtures'
import { mis } from './testHelpers'
import * as api from '../../../api/sttTermLearning'

vi.mock('../../../api/sttTermLearning')
const m = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
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
})
