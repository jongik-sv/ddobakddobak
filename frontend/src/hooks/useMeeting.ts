import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMeeting,
  getSummary,
  updateMeeting,
  deleteMeeting as deleteMeetingApi,
} from '../api/meetings'
import type { Meeting, SummaryResponse, UpdateMeetingParams } from '../api/meetings'

// 모듈 레벨 캐시 — 페이지 전환 시 이전 데이터 즉시 표시
const meetingCache = new Map<number, { meeting: Meeting; summary: SummaryResponse | null }>()

interface UseMeetingReturn {
  meeting: Meeting | null
  summary: SummaryResponse | null
  teamMembers: { id: number; name: string }[]
  isLoading: boolean
  error: string | null
  updateTitle: (title: string) => Promise<void>
  updateMeetingInfo: (data: UpdateMeetingParams) => Promise<void>
  deleteMeeting: () => Promise<void>
  refetch: () => void
}

export function useMeeting(meetingId: number): UseMeetingReturn {
  const navigate = useNavigate()
  const cached = meetingCache.get(meetingId)
  const [meeting, setMeeting] = useState<Meeting | null>(cached?.meeting ?? null)
  const [summary, setSummary] = useState<SummaryResponse | null>(cached?.summary ?? null)
  const [isLoading, setIsLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)

  const [fetchKey, setFetchKey] = useState(0)
  const refetch = useCallback(() => setFetchKey((k) => k + 1), [])

  useEffect(() => {
    if (!meetingCache.has(meetingId)) setIsLoading(true)
    setError(null)

    Promise.all([getMeeting(meetingId), getSummary(meetingId)])
      .then(([meetingData, summaryData]) => {
        setMeeting(meetingData)
        setSummary(summaryData)
        meetingCache.set(meetingId, { meeting: meetingData, summary: summaryData })
      })
      .catch((err: Error) => {
        setError(err.message)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [meetingId, fetchKey])

  async function updateTitle(title: string) {
    const updated = await updateMeeting(meetingId, { title })
    setMeeting(updated)
  }

  async function updateMeetingInfo(data: UpdateMeetingParams) {
    const updated = await updateMeeting(meetingId, data)
    setMeeting(updated)
  }

  async function deleteMeeting() {
    await deleteMeetingApi(meetingId)
    navigate('/dashboard')
  }

  const teamMembers: { id: number; name: string }[] = []

  return {
    meeting,
    summary,
    teamMembers,
    isLoading,
    error,
    updateTitle,
    updateMeetingInfo,
    deleteMeeting,
    refetch,
  }
}
