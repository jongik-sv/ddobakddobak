import { useState, useEffect } from 'react'
import { getMeetingDetail, type MeetingDetail, type MeetingAccessError } from '../api/meetings'

// 모듈 레벨 캐시 — 재방문 시 즉시 렌더
const accessCache = new Map<number, { meeting: MeetingDetail | null; error: MeetingAccessError | null }>()

interface UseMeetingAccessReturn {
  meeting: MeetingDetail | null
  isLoading: boolean
  error: MeetingAccessError | null
}

export function useMeetingAccess(meetingId: number): UseMeetingAccessReturn {
  const cached = accessCache.get(meetingId)
  const [meeting, setMeeting] = useState<MeetingDetail | null>(cached?.meeting ?? null)
  const [isLoading, setIsLoading] = useState(!cached)
  const [error, setError] = useState<MeetingAccessError | null>(cached?.error ?? null)

  useEffect(() => {
    if (!meetingId || isNaN(meetingId)) {
      setError('not_found')
      setIsLoading(false)
      return
    }

    if (!accessCache.has(meetingId)) setIsLoading(true)
    const fetchMeeting = async () => {
      const { meeting, error } = await getMeetingDetail(meetingId)
      setMeeting(meeting)
      setError(error)
      setIsLoading(false)
      accessCache.set(meetingId, { meeting, error })
    }
    fetchMeeting()
  }, [meetingId])

  return { meeting, isLoading, error }
}
