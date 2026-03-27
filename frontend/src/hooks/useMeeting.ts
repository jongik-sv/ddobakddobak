import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMeeting,
  getSummary,
  updateMeeting,
  deleteMeeting as deleteMeetingApi,
} from '../api/meetings'
import type { Meeting, SummaryResponse } from '../api/meetings'

interface UseMeetingReturn {
  meeting: Meeting | null
  summary: SummaryResponse | null
  teamMembers: { id: number; name: string }[]
  isLoading: boolean
  error: string | null
  updateTitle: (title: string) => Promise<void>
  deleteMeeting: () => Promise<void>
  refetch: () => void
}

export function useMeeting(meetingId: number): UseMeetingReturn {
  const navigate = useNavigate()
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [fetchKey, setFetchKey] = useState(0)
  const refetch = useCallback(() => setFetchKey((k) => k + 1), [])

  useEffect(() => {
    setIsLoading(true)
    setError(null)

    Promise.all([getMeeting(meetingId), getSummary(meetingId)])
      .then(([meetingData, summaryData]) => {
        setMeeting(meetingData)
        setSummary(summaryData)
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
    deleteMeeting,
    refetch,
  }
}
