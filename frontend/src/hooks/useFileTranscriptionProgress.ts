import { useState, useEffect } from 'react'
import { createAuthenticatedConsumer } from '../lib/actionCableAuth'

type TranscriptionStatus = 'processing' | 'complete' | 'error'

interface FileTranscriptionProgress {
  progress: number
  message: string | null
  status: TranscriptionStatus
  error: string | null
}

export function useFileTranscriptionProgress(meetingId: number | null): FileTranscriptionProgress {
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [status, setStatus] = useState<TranscriptionStatus>('processing')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!meetingId) return

    const consumer = createAuthenticatedConsumer()

    const subscription = consumer.subscriptions.create(
      { channel: 'TranscriptionChannel', meeting_id: meetingId },
      {
        received(data: Record<string, unknown>) {
          switch (data.type) {
            case 'transcription_progress':
              setProgress(data.progress as number)
              if (data.message) setMessage(data.message as string)
              break
            case 'file_transcription_complete':
              setProgress(100)
              setStatus('complete')
              setMessage('변환 완료')
              break
            case 'file_transcription_error':
              setStatus('error')
              setError(data.error as string)
              break
          }
        },
      }
    )

    return () => {
      subscription.unsubscribe()
      consumer.disconnect()
    }
  }, [meetingId])

  return { progress, message, status, error }
}
