import { useState, useEffect } from 'react'
import { getMeetingDetail, type MeetingDetail, type MeetingAccessError } from '../api/meetings'

interface UseMeetingAccessReturn {
  meeting: MeetingDetail | null
  isLoading: boolean
  error: MeetingAccessError | null
}

export function useMeetingAccess(meetingId: number): UseMeetingAccessReturn {
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<MeetingAccessError | null>(null)

  useEffect(() => {
    if (!meetingId || isNaN(meetingId)) {
      setError('not_found')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const fetchMeeting = async () => {
      const { meeting, error } = await getMeetingDetail(meetingId)
      setMeeting(meeting)
      setError(error)
      setIsLoading(false)
    }
    fetchMeeting()
  }, [meetingId])

  return { meeting, isLoading, error }
}
