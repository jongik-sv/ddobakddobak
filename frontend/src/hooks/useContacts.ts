import { useCallback, useEffect, useState } from 'react'
import {
  getContacts,
  updateContact as apiUpdate,
  deleteContact as apiDelete,
  type MeetingContact,
  type UpdateContactParams,
} from '../api/contacts'

// 모듈 레벨 캐시 — 페이지 전환 시 이전 데이터 즉시 표시 (useAttachments와 동일 패턴)
const contactsCache = new Map<number, MeetingContact[]>()

// 변경 알림(pub/sub) — 업로드→비동기 추출 완료를 ActionCable 누락 시에도 폴백으로 반영한다.
const listeners = new Map<number, Set<() => void>>()
export function notifyContactsChanged(meetingId: number) {
  listeners.get(meetingId)?.forEach((fn) => fn())
}

export interface UseContactsReturn {
  contacts: MeetingContact[]
  isLoading: boolean
  error: string | null
  update: (id: number, data: UpdateContactParams) => Promise<void>
  remove: (id: number) => Promise<void>
  refetch: () => void
}

export function useContacts(meetingId: number): UseContactsReturn {
  const [contacts, setContacts] = useState<MeetingContact[]>(() => contactsCache.get(meetingId) ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchKey, setFetchKey] = useState(0)

  const refetch = useCallback(() => setFetchKey((k) => k + 1), [])

  useEffect(() => {
    if (!contactsCache.has(meetingId)) setIsLoading(true)
    setError(null)
    getContacts(meetingId)
      .then((data) => {
        setContacts(data)
        contactsCache.set(meetingId, data)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false))
  }, [meetingId, fetchKey])

  // 폴백 알림 구독 — notifyContactsChanged(meetingId) 호출 시 refetch (ActionCable 누락 대비)
  useEffect(() => {
    const set = listeners.get(meetingId) ?? new Set<() => void>()
    set.add(refetch)
    listeners.set(meetingId, set)
    return () => { set.delete(refetch) }
  }, [meetingId, refetch])

  const update = useCallback(async (id: number, data: UpdateContactParams) => {
    const updated = await apiUpdate(meetingId, id, data)
    setContacts((prev) => {
      const next = prev.map((c) => (c.id === id ? updated : c))
      contactsCache.set(meetingId, next)
      return next
    })
  }, [meetingId])

  const remove = useCallback(async (id: number) => {
    await apiDelete(meetingId, id)
    setContacts((prev) => {
      const next = prev.filter((c) => c.id !== id)
      contactsCache.set(meetingId, next)
      return next
    })
  }, [meetingId])

  return { contacts, isLoading, error, update, remove, refetch }
}
