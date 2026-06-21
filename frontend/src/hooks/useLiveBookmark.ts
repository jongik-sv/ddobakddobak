import { useState, useRef, useCallback, useEffect } from 'react'
import { createBookmark } from '../api/bookmarks'

export function useLiveBookmark({
  meetingId,
  elapsedSeconds,
  isActive,
  showStatus,
}: {
  meetingId: number
  elapsedSeconds: number
  isActive: boolean
  showStatus: (msg: string, durationMs?: number) => void
}) {
  // 북마크 팝오버
  const [showBookmarkPopover, setShowBookmarkPopover] = useState(false)
  const [bookmarkLabel, setBookmarkLabel] = useState('')
  const bookmarkTimestampRef = useRef<number>(0)

  // 북마크 추가
  const handleOpenBookmark = useCallback(() => {
    bookmarkTimestampRef.current = elapsedSeconds * 1000
    setBookmarkLabel('')
    setShowBookmarkPopover(true)
  }, [elapsedSeconds])

  const handleSaveBookmark = async () => {
    setShowBookmarkPopover(false)
    try {
      await createBookmark(meetingId, {
        timestamp_ms: bookmarkTimestampRef.current,
        label: bookmarkLabel.trim() || undefined,
      })
      showStatus('북마크가 추가되었습니다')
    } catch {
      showStatus('북마크 추가에 실패했습니다')
    }
  }

  // Ctrl+B 단축키로 북마크 추가
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        if (isActive) {
          handleOpenBookmark()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isActive, handleOpenBookmark])

  return {
    showBookmarkPopover,
    setShowBookmarkPopover,
    bookmarkLabel,
    setBookmarkLabel,
    bookmarkTimestampRef,
    handleOpenBookmark,
    handleSaveBookmark,
  }
}
