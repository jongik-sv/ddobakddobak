import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatMarkdown } from '../ChatMarkdown'

describe('ChatMarkdown', () => {
  it('renders bold (**) as <strong>', () => {
    render(<ChatMarkdown content="**굵게**" />)
    const strong = screen.getByText('굵게')
    expect(strong.tagName).toBe('STRONG')
  })

  it('renders ### as a heading element', () => {
    render(<ChatMarkdown content="### 제목" />)
    const heading = screen.getByRole('heading', { name: '제목' })
    expect(heading).toBeInTheDocument()
  })

  it('renders - item as a list item', () => {
    render(<ChatMarkdown content={'- 항목'} />)
    const li = screen.getByText('항목')
    expect(li.tagName).toBe('LI')
  })

  it('renders [링크](url) as an anchor opening in a new tab', () => {
    render(<ChatMarkdown content="[링크](https://x)" />)
    const a = screen.getByRole('link', { name: '링크' })
    expect(a).toHaveAttribute('href', 'https://x')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('does not render literal markdown syntax for formatted text', () => {
    render(<ChatMarkdown content="**굵게**" />)
    expect(screen.queryByText('**굵게**')).not.toBeInTheDocument()
  })
})
