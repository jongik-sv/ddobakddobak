import { useEffect, useState } from 'react'
import { getMeeting, getTranscripts, getSummary } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { mapTranscriptsToFinals } from '../lib/transcriptMapper'

export function useViewerData(meetingId: number) {
  const [meetingTitle, setMeetingTitle] = useState('')
  const [locked, setLocked] = useState(false)
  // 진입 시점의 일시정지 여부(REST 스냅샷) — 이후 실시간 갱신은 recording_paused/resumed 신호가 담당.
  const [paused, setPaused] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useTranscriptStore((s) => s.reset)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)

  useEffect(() => {
    reset()

    Promise.all([
      getMeeting(meetingId).then((m) => {
        setMeetingTitle(m.title)
        setLocked(!!m.locked)
        setPaused(m.status === 'recording' && !!m.paused_at)
      }),
      getTranscripts(meetingId).then((t) => loadFinals(mapTranscriptsToFinals(t))),
      getSummary(meetingId).then((s) => {
        if (s?.notes_markdown) setMeetingNotes(s.notes_markdown)
      }),
    ])
      .then(() => setIsLoaded(true))
      .catch(() => setError('회의 정보를 불러올 수 없습니다'))
  }, [meetingId, reset, loadFinals, setMeetingNotes])

  return { meetingTitle, locked, paused, isLoaded, error }
}
