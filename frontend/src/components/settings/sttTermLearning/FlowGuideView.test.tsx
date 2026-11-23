import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FlowGuideView from './FlowGuideView'

describe('FlowGuideView', () => {
  it('등록 순서 1~6 단계 문구 렌더', () => {
    render(<FlowGuideView />)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText(/마지막 사람 수정 후 대기 시간/)).toBeInTheDocument()
    expect(screen.getByText(/처리 내역에 기록/)).toBeInTheDocument()
  })
})
