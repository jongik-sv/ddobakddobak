import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HighlightedText, findOccurrences } from './HighlightedText'

describe('findOccurrences', () => {
  it('case-insensitive 비중첩 occurrence 인덱스를 반환한다', () => {
    expect(findOccurrences('Foo foo FOO', 'foo')).toEqual([0, 4, 8])
  })

  it('한국어 부분문자열을 매치한다', () => {
    expect(findOccurrences('회의록 정리, 회의록 공유', '의록')).toEqual([1, 9])
  })

  it('빈 쿼리는 빈 배열', () => {
    expect(findOccurrences('abc', '')).toEqual([])
  })

  it('비중첩: aaa에서 aa는 1회', () => {
    expect(findOccurrences('aaa', 'aa')).toEqual([0])
  })
})

describe('HighlightedText', () => {
  it('매치를 <mark>로 감싼다', () => {
    render(<HighlightedText text="발사대 점검 후 발사대 정리" query="발사대" activeOccurrence={-1} />)
    const marks = screen.getAllByText('발사대')
    expect(marks).toHaveLength(2)
    marks.forEach((m) => expect(m.tagName).toBe('MARK'))
  })

  it('활성 occurrence만 data-active를 가진다', () => {
    const { container } = render(
      <HighlightedText text="발사대 점검 후 발사대 정리" query="발사대" activeOccurrence={1} />
    )
    const marks = container.querySelectorAll('mark')
    expect(marks[0].getAttribute('data-active')).toBeNull()
    expect(marks[1].getAttribute('data-active')).toBe('true')
  })

  it('매치 없으면 평문 렌더', () => {
    const { container } = render(
      <HighlightedText text="아무 내용" query="없는단어" activeOccurrence={-1} />
    )
    expect(container.querySelectorAll('mark')).toHaveLength(0)
    expect(container.textContent).toBe('아무 내용')
  })
})
