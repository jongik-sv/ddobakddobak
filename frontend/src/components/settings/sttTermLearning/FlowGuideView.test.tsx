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

  it('형식 부적합·전사에 없음·등록 레벨 없음은 오인식 기록에 남지 않고 처리 내역에만 남는다고 안내', () => {
    render(<FlowGuideView />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/모든 후보는 오인식 기록에 남/)
    expect(text).toMatch(/형식 부적합·전사에 없음·등록할 레벨 없음[^.]*오인식 기록에 남지 않고[^.]*처리 내역/)
  })
})
