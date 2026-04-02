import { useEffect, useState } from 'react'
import { getMeeting, getTranscripts, getSummary, getParticipants } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useSharingStore } from '../stores/sharingStore'
import { mapTranscriptsToFinals } from '../lib/transcriptMapper'

export function useViewerData(meetingId: number) {
  const [meetingTitle, setMeetingTitle] = useState('')
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useTranscriptStore((s) => s.reset)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)

  useEffect(() => {
    reset()

    Promise.all([
      getMeeting(meetingId).then((m) => setMeetingTitle(m.title)),
      getTranscripts(meetingId).then((t) => loadFinals(mapTranscriptsToFinals(t))),
      getSummary(meetingId).then((s) => {
        if (s?.notes_markdown) setMeetingNotes(s.notes_markdown)
      }),
      getParticipants(meetingId).then((list) =>
        useSharingStore.getState().setParticipants(list),
      ),
    ])
      .then(() => setIsLoaded(true))
      .catch(() => setError('회의 정보를 불러올 수 없습니다'))
  }, [meetingId, reset, loadFinals, setMeetingNotes])

  return { meetingTitle, isLoaded, error }
}
