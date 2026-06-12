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

    // 새 구독(새 전사 실행) 시작 시 이전 실행의 상태가 남지 않도록 초기화.
    // (deps가 meetingId뿐이라 같은 회의를 재전사하면 'complete'/'변환 완료'/100이
    //  latch된 채 새 실행에 잘못 표시되던 버그 방지)
    setProgress(0)
    setMessage(null)
    setStatus('processing')
    setError(null)

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
