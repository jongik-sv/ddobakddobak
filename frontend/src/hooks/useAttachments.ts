import { useState, useEffect, useCallback } from 'react'
import {
  getAttachments,
  createFileAttachment,
  createLinkAttachment,
  deleteAttachment,
} from '../api/attachments'
import type { MeetingAttachment, AttachmentCategory } from '../api/attachments'

// 모듈 레벨 캐시 — 페이지 전환 시 이전 데이터 즉시 표시
const attachmentCache = new Map<number, MeetingAttachment[]>()

interface UseAttachmentsReturn {
  attachments: MeetingAttachment[]
  isLoading: boolean
  error: string | null
  addFile: (category: AttachmentCategory, file: File, displayName?: string) => Promise<void>
  addLink: (category: AttachmentCategory, url: string, displayName?: string) => Promise<void>
  remove: (attachmentId: number) => Promise<void>
  refetch: () => void
}

export function useAttachments(meetingId: number): UseAttachmentsReturn {
  const cached = attachmentCache.get(meetingId)
  const [attachments, setAttachments] = useState<MeetingAttachment[]>(cached ?? [])
  const [isLoading, setIsLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)

  const [fetchKey, setFetchKey] = useState(0)
  const refetch = useCallback(() => setFetchKey((k) => k + 1), [])

  useEffect(() => {
    if (!attachmentCache.has(meetingId)) setIsLoading(true)
    setError(null)

    getAttachments(meetingId)
      .then((data) => {
        setAttachments(data)
        attachmentCache.set(meetingId, data)
      })
      .catch((err: Error) => {
        setError(err.message)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [meetingId, fetchKey])

  const addFile = useCallback(
    async (category: AttachmentCategory, file: File, displayName?: string) => {
      const attachment = await createFileAttachment(meetingId, category, file, displayName)
      setAttachments((prev) => {
        const next = [...prev, attachment]
        attachmentCache.set(meetingId, next)
        return next
      })
    },
    [meetingId],
  )

  const addLink = useCallback(
    async (category: AttachmentCategory, url: string, displayName?: string) => {
      const attachment = await createLinkAttachment(meetingId, category, url, displayName)
      setAttachments((prev) => {
        const next = [...prev, attachment]
        attachmentCache.set(meetingId, next)
        return next
      })
    },
    [meetingId],
  )

  const remove = useCallback(
    async (attachmentId: number) => {
      // optimistic update
      setAttachments((prev) => {
        const next = prev.filter((a) => a.id !== attachmentId)
        attachmentCache.set(meetingId, next)
        return next
      })
      try {
        await deleteAttachment(meetingId, attachmentId)
      } catch {
        // rollback on failure
        refetch()
      }
    },
    [meetingId, refetch],
  )

  return { attachments, isLoading, error, addFile, addLink, remove, refetch }
}
