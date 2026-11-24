import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LineDiffView from './LineDiffView'
import type { DiffOp } from '../../api/sttTermLearning'

describe('LineDiffView', () => {
  it('delete/insert 를 구분 표시', () => {
    const ops: DiffOp[] = [
      { op: 'equal', text: '같음' },
      { op: 'delete', text: '우판' },
      { op: 'insert', text: '후판' },
    ]
    render(<LineDiffView ops={ops} />)
    expect(screen.getByText('우판').closest('[data-op]')).toHaveAttribute('data-op', 'delete')
    expect(screen.getByText('우판').closest('[data-op]')?.className).toMatch(/line-through/)
    expect(screen.getByText('후판').closest('[data-op]')).toHaveAttribute('data-op', 'insert')
    expect(screen.getByText('같음').closest('[data-op]')).toHaveAttribute('data-op', 'equal')
  })

  it('collapseEqual 이면 3줄 이상 연속 equal 을 접는다', () => {
    const ops: DiffOp[] = [
      ...['a', 'b', 'c', 'd'].map((t) => ({ op: 'equal' as const, text: t })),
      { op: 'insert', text: 'x' },
      { op: 'equal', text: 'e' },
      { op: 'equal', text: 'f' },
    ]
    render(<LineDiffView ops={ops} collapseEqual />)
    expect(screen.getByText('… 4줄 동일')).toBeInTheDocument()
    expect(screen.queryByText('a')).not.toBeInTheDocument()
    expect(screen.getByText('e')).toBeInTheDocument()
    expect(screen.getByText('f')).toBeInTheDocument()
  })

  it('collapseEqual 아니면 전부 표시', () => {
    const ops: DiffOp[] = ['a', 'b', 'c'].map((t) => ({ op: 'equal' as const, text: t }))
    render(<LineDiffView ops={ops} />)
    expect(screen.getByText('b')).toBeInTheDocument()
  })
})
