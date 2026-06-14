import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookmarkList } from './BookmarkList'
import type { Bookmark } from '../../api/bookmarks'

const bm: Bookmark = {
  id: 7,
  meeting_id: 1,
  timestamp_ms: 65000,
  label: '원래 라벨',
  created_at: '2026-06-15T00:00:00Z',
}

describe('BookmarkList 라벨 편집', () => {
  it('연필 클릭 → 입력 후 Enter 시 onEdit(id, 새라벨) 호출', async () => {
    const onEdit = vi.fn()
    render(
      <BookmarkList bookmarks={[bm]} onSeek={vi.fn()} onDelete={vi.fn()} onEdit={onEdit} />,
    )

    await userEvent.click(screen.getByTitle('라벨 편집'))

    const input = screen.getByLabelText('북마크 라벨') as HTMLInputElement
    expect(input.value).toBe('원래 라벨')

    await userEvent.clear(input)
    await userEvent.type(input, '바뀐 라벨{Enter}')

    expect(onEdit).toHaveBeenCalledWith(7, '바뀐 라벨')
  })

  it('Escape 시 취소 — onEdit 미호출', async () => {
    const onEdit = vi.fn()
    render(
      <BookmarkList bookmarks={[bm]} onSeek={vi.fn()} onDelete={vi.fn()} onEdit={onEdit} />,
    )

    await userEvent.click(screen.getByTitle('라벨 편집'))
    const input = screen.getByLabelText('북마크 라벨')
    await userEvent.type(input, '안바뀜{Escape}')

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByText('원래 라벨')).toBeInTheDocument()
  })

  it('onEdit 미제공 시 연필 버튼 없음', () => {
    render(<BookmarkList bookmarks={[bm]} onSeek={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByTitle('라벨 편집')).not.toBeInTheDocument()
  })

  it('편집 중 클릭은 seek를 트리거하지 않음', async () => {
    const onSeek = vi.fn()
    render(
      <BookmarkList bookmarks={[bm]} onSeek={onSeek} onDelete={vi.fn()} onEdit={vi.fn()} />,
    )
    await userEvent.click(screen.getByTitle('라벨 편집'))
    await userEvent.click(screen.getByLabelText('북마크 라벨'))
    expect(onSeek).not.toHaveBeenCalled()
  })
})
