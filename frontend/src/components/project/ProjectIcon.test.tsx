import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProjectIcon from './ProjectIcon'

describe('ProjectIcon', () => {
  it('emoji 타입은 이모지 렌더', () => {
    render(
      <ProjectIcon project={{ name: '마케팅', icon_type: 'emoji', icon_value: '📣', color: '#ec4899' }} />,
    )
    expect(screen.getByText('📣')).toBeTruthy()
  })

  it('아이콘 미설정 시 이름 첫 글자 폴백', () => {
    render(
      <ProjectIcon project={{ name: '신제품', icon_type: null, icon_value: null, color: null }} />,
    )
    expect(screen.getByText('신')).toBeTruthy()
  })
})
