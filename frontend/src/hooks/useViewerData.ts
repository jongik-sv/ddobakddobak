import { useEffect, useState } from 'react'
import { getMeeting, getTranscripts, getSummary, getParticipants } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useSharingStore } from '../stores/sharingStore'
import { mapTranscriptsToFinals } from '../lib/transcriptMapper'

/**
 * 뷰어 페이지 초기 데이터 로드 훅.
 * 회의 정보, 전사 기록, AI 요약, 참여자 목록을 병렬로 로드한다.
 */
export function useViewerData(meetingId: number) {
  const [meetingTitle, setMeetingTitle] = useState('')
  const [isLoaded, setIsLoaded] = useState(false)

  const reset = useTranscriptStore((s) => s.reset)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)

  useEffect(() => {
    reset()

    getMeeting(meetingId)
      .then((m) => {
        setMeetingTitle(m.title)
        setIsLoaded(true)
      })
      .catch(() => {})

    getTranscripts(meetingId)
      .then((transcripts) => loadFinals(mapTranscriptsToFinals(transcripts)))
      .catch(() => {})

    getSummary(meetingId)
      .then((summary) => {
        if (summary?.notes_markdown) {
          setMeetingNotes(summary.notes_markdown)
        }
      })
      .catch(() => {})

    getParticipants(meetingId)
      .then((list) => useSharingStore.getState().setParticipants(list))
      .catch(() => {})
  }, [meetingId, reset, loadFinals, setMeetingNotes])

  return { meetingTitle, isLoaded }
}
