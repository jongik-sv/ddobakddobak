import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

vi.mock('./components/editor/MeetingEditor', () => ({
  MeetingEditor: () => null,
  customSchema: { blockSpecs: {} },
}))

vi.mock('./hooks/useSttBlockInserter', () => ({
  useSttBlockInserter: vi.fn(),
}))

vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: vi.fn(() => ({ document: [] })),
  createReactBlockSpec: vi.fn(() => ({})),
}))

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => null,
}))

vi.mock('@blocknote/core', () => ({
  BlockNoteSchema: { create: vi.fn(() => ({ blockSpecs: {} })) },
  defaultBlockSpecs: {},
}))

describe('App 라우팅', () => {
  it('/ 경로에서 HomePage가 렌더링됨', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )
    expect(screen.getByText(/또박또박/i)).toBeInTheDocument()
  })

  it('/login 경로에서 LoginPage가 렌더링됨', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: /로그인/i })).toBeInTheDocument()
  })
})
