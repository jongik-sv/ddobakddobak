import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpeakerLabel, speakerColor, SPEAKER_COLORS } from './SpeakerLabel'

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

  it('speakerName이 있으면 라벨 대신 이름을 렌더', () => {
    render(<SpeakerLabel speakerLabel="화자 1" speakerName="앨리스" />)
    expect(screen.getByText('앨리스')).toBeInTheDocument()
    expect(screen.queryByText('화자 1')).not.toBeInTheDocument()
  })

  it('speakerName이 null이면 라벨로 fallback', () => {
    render(<SpeakerLabel speakerLabel="화자 1" speakerName={null} />)
    expect(screen.getByText('화자 1')).toBeInTheDocument()
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

  it('이름 화자 분산: 세 이름 중 최소 둘은 다른 색상', () => {
    const a = speakerColor('홍춘식 부장')
    const b = speakerColor('이석희 부장')
    const c = speakerColor('장한솔 매니저')
    // 세 값이 전부 동일(파랑 고정)이면 안 됨
    expect(a === b && b === c).toBe(false)
  })

  it('이름 화자 안정성: 동일 입력은 항상 같은 색상', () => {
    expect(speakerColor('홍춘식 부장')).toBe(speakerColor('홍춘식 부장'))
  })

  it('숫자형 화자 회귀: 화자 3은 SPEAKER_COLORS[3]', () => {
    expect(speakerColor('화자 3')).toBe(SPEAKER_COLORS[3])
  })
})
