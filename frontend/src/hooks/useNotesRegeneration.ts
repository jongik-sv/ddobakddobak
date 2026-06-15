import { useState, useEffect } from 'react'
import { regenerateStt, reDiarize, regenerateNotes } from '../api/meetings'
import { createAuthenticatedConsumer } from '../lib/actionCableAuth'
import { useTranscriptStore } from '../stores/transcriptStore'

interface UseNotesRegenerationOptions {
  pauseAudio: () => void
  refetch: () => void
}

/**
 * STT 재생성 / 화자분리 재실행 / 회의록 재생성 + 확인 다이얼로그 + 완료 구독.
 *
 * MeetingPage god 컴포넌트에서 분리 — 순수 코드 이동, 동작 무변경.
 */
export function useNotesRegeneration(meetingId: number, { pauseAudio, refetch }: UseNotesRegenerationOptions) {
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)

  const [isRegeneratingNotes, setIsRegeneratingNotes] = useState(false)
  const [showSttConfirm, setShowSttConfirm] = useState(false)
  const [showReDiarizeConfirm, setShowReDiarizeConfirm] = useState(false)
  const [showNotesConfirm, setShowNotesConfirm] = useState(false)

  // 회의록 재생성 완료 감지용 ActionCable 구독
  useEffect(() => {
    if (!isRegeneratingNotes) return

    const consumer = createAuthenticatedConsumer()
    const sub = consumer.subscriptions.create(
      { channel: 'TranscriptionChannel', meeting_id: meetingId },
      {
        received(data: Record<string, unknown>) {
          if (data.type === 'meeting_notes_update') {
            setIsRegeneratingNotes(false)
            setMeetingNotes((data.notes_markdown as string) ?? '')
            refetch()
          }
        },
      }
    )
    return () => {
      sub.unsubscribe()
      consumer.disconnect()
    }
  }, [isRegeneratingNotes, meetingId, setMeetingNotes, refetch])

  async function handleRegenerateStt() {
    setShowSttConfirm(false)
    pauseAudio() // STT 재실행 전 음성 재생 정지 (동시 재생 방지)
    try {
      await regenerateStt(meetingId)
      refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '재생성에 실패했습니다'
      alert(msg)
    }
  }

  // 화자분리만 재실행: STT는 그대로 두고 현재 민감도로 화자만 재분리.
  // 서버가 STT 재실행과 동일한 ActionCable 이벤트(transcription_progress·
  // file_transcription_complete)를 브로드캐스트하므로 진행률 UI가 그대로 반응한다.
  async function handleReDiarize() {
    setShowReDiarizeConfirm(false)
    pauseAudio()
    try {
      await reDiarize(meetingId)
      refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '재실행에 실패했습니다'
      alert(msg)
    }
  }

  async function handleRegenerateNotes() {
    setShowNotesConfirm(false)
    setIsRegeneratingNotes(true)
    // 에디터 즉시 비움(+보류 자동저장 취소, AiSummaryPanel null 처리) — 옛 회의록 잔상이
    // 대기 중 자동저장되면 last_user_edit_at 갱신으로 재생성 결과가 폐기된다.
    setMeetingNotes(null)
    try {
      await regenerateNotes(meetingId)
    } catch (e: unknown) {
      setIsRegeneratingNotes(false)
      const msg = e instanceof Error ? e.message : '재생성에 실패했습니다'
      alert(msg)
    }
  }

  return {
    isRegeneratingNotes,
    showSttConfirm,
    setShowSttConfirm,
    showReDiarizeConfirm,
    setShowReDiarizeConfirm,
    showNotesConfirm,
    setShowNotesConfirm,
    handleRegenerateStt,
    handleReDiarize,
    handleRegenerateNotes,
  }
}
