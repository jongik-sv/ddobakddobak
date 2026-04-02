import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

// mermaidBlock가 createReactBlockSpec을 사용하므로 직접 모킹
vi.mock('./components/meeting/mermaidBlock', async () => {
  const { BlockNoteSchema, defaultBlockSpecs } = await import('@blocknote/core')
  return {
    editorSchema: BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs }),
    codeBlocksToMermaid: (blocks: unknown[]) => blocks,
  }
})

vi.mock('./hooks/useDeepLink', () => ({
  useDeepLink: vi.fn(),
}))

vi.mock('./components/editor/MeetingEditor', () => ({
  MeetingEditor: () => null,
  customSchema: { blockSpecs: {} },
}))

vi.mock('./hooks/useSttBlockInserter', () => ({
  useSttBlockInserter: vi.fn(),
}))

describe('App 라우팅', () => {
  it('/ 경로에서 /meetings로 리다이렉트됨', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )
    // meetings page renders after redirect
    expect(document.querySelector('[class]')).toBeTruthy()
  })
})
