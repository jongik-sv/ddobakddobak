import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpeakerLabel, speakerColor } from './SpeakerLabel'

describe('SpeakerLabel', () => {
  it('화자 레이블 텍스트 렌더', () => {
    render(<SpeakerLabel speakerLabel="SPEAKER_00" />)
    expect(screen.getByText('SPEAKER_00')).toBeInTheDocument()
  })

  it('다른 화자 레이블 렌더', () => {
    render(<SpeakerLabel speakerLabel="SPEAKER_01" />)
    expect(screen.getByText('SPEAKER_01')).toBeInTheDocument()
  })

  it('role="status" 접근성 속성 포함', () => {
    render(<SpeakerLabel speakerLabel="SPEAKER_00" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

describe('speakerColor', () => {
  it('SPEAKER_00은 첫 번째 색상 반환', () => {
    const color = speakerColor('SPEAKER_00')
    expect(color).toBeTruthy()
    expect(typeof color).toBe('string')
  })

  it('SPEAKER_01은 두 번째 색상 반환 (SPEAKER_00과 다름)', () => {
    expect(speakerColor('SPEAKER_01')).not.toBe(speakerColor('SPEAKER_00'))
  })

  it('알 수 없는 화자는 기본 색상 반환', () => {
    const color = speakerColor('UNKNOWN')
    expect(color).toBeTruthy()
  })
})
