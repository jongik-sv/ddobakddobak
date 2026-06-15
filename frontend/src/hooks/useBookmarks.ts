import { useState, useEffect } from 'react'
import { getBookmarks, createBookmark, deleteBookmark, updateBookmark } from '../api/bookmarks'
import type { Bookmark as BookmarkType } from '../api/bookmarks'
import type { Transcript } from '../api/meetings'
import { computeBookmarkLabel } from '../lib/bookmarkLabel'

interface UseBookmarksOptions {
  transcripts: Transcript[]
  currentTimeMs: number
}

/**
 * 회의 북마크 CRUD + 추가 팝오버 상태.
 *
 * MeetingPage god 컴포넌트에서 분리 — 순수 코드 이동, 동작 무변경.
 */
export function useBookmarks(meetingId: number, { transcripts, currentTimeMs }: UseBookmarksOptions) {
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([])
  // 북마크 추가 팝오버 (회의 미리보기에서 현재 재생 위치에 추가)
  const [showBookmarkPopover, setShowBookmarkPopover] = useState(false)
  const [bookmarkLabel, setBookmarkLabel] = useState('')
  const [bookmarkTs, setBookmarkTs] = useState(0)

  // 북마크 로드
  useEffect(() => {
    getBookmarks(meetingId).then(setBookmarks).catch(() => {})
  }, [meetingId])

  async function handleDeleteBookmark(bookmarkId: number) {
    try {
      await deleteBookmark(meetingId, bookmarkId)
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId))
    } catch {
      // ignore
    }
  }

  async function handleEditBookmark(bookmarkId: number, label: string) {
    try {
      const updated = await updateBookmark(meetingId, bookmarkId, { label })
      setBookmarks((prev) => prev.map((b) => (b.id === bookmarkId ? updated : b)))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '북마크 수정에 실패했습니다'
      alert(`북마크 수정 실패: ${msg}`)
    }
  }

  function handleOpenBookmark() {
    // timestamp_ms 는 정수만 허용(모델 numericality only_integer) — audio.currentTime*1000 은 float 라 floor
    setBookmarkTs(Math.floor(currentTimeMs))
    setBookmarkLabel(computeBookmarkLabel(transcripts, currentTimeMs))
    setShowBookmarkPopover(true)
  }

  async function handleSaveBookmark() {
    setShowBookmarkPopover(false)
    try {
      const created = await createBookmark(meetingId, {
        timestamp_ms: bookmarkTs,
        label: bookmarkLabel.trim() || undefined,
      })
      setBookmarks((prev) =>
        [...prev, created].sort((a, b) => a.timestamp_ms - b.timestamp_ms),
      )
    } catch (e: unknown) {
      // 조용히 삼키면 "추가가 안 됨" 증상의 원인(권한 403·네트워크 등)을 사용자가 알 수 없다.
      const msg = e instanceof Error ? e.message : '북마크 추가에 실패했습니다'
      alert(`북마크 추가 실패: ${msg}`)
    }
  }

  return {
    bookmarks,
    showBookmarkPopover,
    setShowBookmarkPopover,
    bookmarkLabel,
    setBookmarkLabel,
    bookmarkTs,
    handleDeleteBookmark,
    handleEditBookmark,
    handleOpenBookmark,
    handleSaveBookmark,
  }
}
