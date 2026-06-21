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

describe('BookmarkList 잠금 게이팅', () => {
  it('readOnly=true면 추가·편집·삭제 버튼 없음 (탐색은 가능)', () => {
    const onSeek = vi.fn()
    render(
      <BookmarkList
        bookmarks={[bm]}
        onSeek={onSeek}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        readOnly
      />,
    )
    expect(screen.queryByText('현재 지점 추가')).not.toBeInTheDocument()
    expect(screen.queryByTitle('라벨 편집')).not.toBeInTheDocument()
    expect(screen.queryByTitle('삭제')).not.toBeInTheDocument()
    // 북마크 항목 자체는 표시되어 탐색은 가능
    expect(screen.getByText('원래 라벨')).toBeInTheDocument()
  })

  it('readOnly=false면 추가·편집·삭제 버튼 표시', () => {
    render(
      <BookmarkList
        bookmarks={[bm]}
        onSeek={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByText('현재 지점 추가')).toBeInTheDocument()
    expect(screen.getByTitle('라벨 편집')).toBeInTheDocument()
    expect(screen.getByTitle('삭제')).toBeInTheDocument()
  })
})

describe('BookmarkList 접기/펼치기 (collapsible)', () => {
  it('collapsible 미지정 시 토글 없음 — 목록 항상 표시', () => {
    render(<BookmarkList bookmarks={[bm]} onSeek={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByTitle('북마크 접기')).not.toBeInTheDocument()
    expect(screen.queryByTitle('북마크 펼치기')).not.toBeInTheDocument()
    expect(screen.getByText('원래 라벨')).toBeInTheDocument()
  })

  it('collapsible=true면 기본 펼침 — 헤더 클릭 시 목록 숨김, 다시 클릭 시 표시', async () => {
    render(<BookmarkList bookmarks={[bm]} onSeek={vi.fn()} onDelete={vi.fn()} collapsible />)

    // 기본 펼침: 항목 보임
    expect(screen.getByText('원래 라벨')).toBeInTheDocument()

    await userEvent.click(screen.getByTitle('북마크 접기'))
    expect(screen.queryByText('원래 라벨')).not.toBeInTheDocument()

    // 다시 펼치기
    await userEvent.click(screen.getByTitle('북마크 펼치기'))
    expect(screen.getByText('원래 라벨')).toBeInTheDocument()
  })

  it('collapsible=true에서 추가 버튼 클릭은 onAdd만 호출하고 접지 않음 (stopPropagation)', async () => {
    const onAdd = vi.fn()
    render(
      <BookmarkList bookmarks={[bm]} onSeek={vi.fn()} onDelete={vi.fn()} onAdd={onAdd} collapsible />,
    )

    await userEvent.click(screen.getByText('현재 지점 추가'))

    expect(onAdd).toHaveBeenCalledTimes(1)
    // 목록은 여전히 펼쳐진 상태여야 한다
    expect(screen.getByText('원래 라벨')).toBeInTheDocument()
  })
})
