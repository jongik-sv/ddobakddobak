import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocalToast } from '../LocalToast'

describe('LocalToast', () => {
  it('message가 null이면 아무것도 렌더하지 않는다', () => {
    render(<LocalToast message={null} />)
    expect(screen.queryByTestId('local-toast')).not.toBeInTheDocument()
  })

  it('message가 있으면 텍스트를 표시한다', () => {
    render(<LocalToast message="오디오 파일만 업로드할 수 있습니다." />)
    expect(screen.getByTestId('local-toast')).toHaveTextContent('오디오 파일만 업로드할 수 있습니다.')
  })

  it('role=status로 접근성 알림을 제공한다', () => {
    render(<LocalToast message="안내" />)
    expect(screen.getByRole('status')).toHaveTextContent('안내')
  })
})
