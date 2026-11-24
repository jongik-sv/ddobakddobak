import { useState, useEffect, useRef } from 'react'
import { regenerateStt, reDiarize, regenerateNotes } from '../api/meetings'
import { getAiOriginal } from '../api/sttTermLearning'
import { createAuthenticatedConsumer } from '../lib/actionCableAuth'
import { useTranscriptStore } from '../stores/transcriptStore'

const NOTES_CONFIRM_BASE =
  '기존 회의록을 삭제하고 전체 트랜스크립트를 바탕으로 처음부터 다시 생성합니다. 계속하시겠습니까?'
const NOTES_CONFIRM_EDITED =
  '직접 고친 문장은 새로 작성됩니다. 학습된 용어는 새 회의록에도 반영됩니다. 다시 작성할까요?'
// 사람이 고쳤지만 STT 용어 학습이 꺼져 있으면 "용어 유지"를 약속하지 않는다.
const NOTES_CONFIRM_EDITED_NO_LEARNING = '직접 고친 내용은 새로 작성됩니다. 다시 작성할까요?'

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
  const [notesHumanEdited, setNotesHumanEdited] = useState(false)
  const [notesLearningEnabled, setNotesLearningEnabled] = useState(false)
  const [isCheckingNotesConfirm, setIsCheckingNotesConfirm] = useState(false)
  const checkingRef = useRef(false) // 더블클릭 중복 조회 방지(상태 반영 전 재진입 차단)

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
            // 재생성 성공 — 이전 실패 배지가 남아 있으면 클리어 (transcription.ts와 동일 규약)
            if (useTranscriptStore.getState().summaryError) {
              useTranscriptStore.getState().setSummaryError(null)
            }
            refetch()
          }
          // final 요약 실패 — meeting_notes_update가 오지 않으므로 여기서 스피너를 풀어야
          // isRegeneratingNotes가 영구 true로 고착되지 않는다.
          // 주의: 회의 상세 페이지에는 전역 토스트(LiveStatusBar)도, transcription.ts의
          // 채널 핸들러도 렌더/구독되지 않으므로 여기서 직접 summaryError를 세팅해
          // AiSummaryPanel 실패 배지로 사용자에게 레포트한다.
          if (
            data.type === 'summarization_finished' &&
            data.ok === false &&
            data.summary_type === 'final'
          ) {
            setIsRegeneratingNotes(false)
            useTranscriptStore.getState().setSummaryError({
              kind: 'final',
              message:
                typeof data.error === 'string' && data.error !== ''
                  ? data.error
                  : '알 수 없는 오류',
            })
            // 서버 정본 동기화 — 영속 실패 필드(summary_error_message) 포함 최신 상태 반영
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

  // 재생성 확인창 열기 — 사람이 고친 회의록이면 안내 문구를 바꿔 보여준다(서버에서 최신 편집 여부 조회).
  // 조회 실패는 기존(무편집) 확인창으로 폴백한다.
  async function requestNotesConfirm() {
    if (checkingRef.current) return
    checkingRef.current = true
    setIsCheckingNotesConfirm(true)
    let edited = false
    let learning = false
    try {
      const r = await getAiOriginal(meetingId)
      edited = r.available && !!r.human_edited_at
      learning = r.stt_learning_enabled === true
    } catch {
      edited = false
    } finally {
      checkingRef.current = false
      setIsCheckingNotesConfirm(false)
    }
    setNotesHumanEdited(edited)
    setNotesLearningEnabled(learning)
    setShowNotesConfirm(true)
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
    notesHumanEdited,
    isCheckingNotesConfirm,
    notesConfirmMessage: !notesHumanEdited
      ? NOTES_CONFIRM_BASE
      : notesLearningEnabled
        ? NOTES_CONFIRM_EDITED
        : NOTES_CONFIRM_EDITED_NO_LEARNING,
    requestNotesConfirm,
    handleRegenerateStt,
    handleReDiarize,
    handleRegenerateNotes,
  }
}
