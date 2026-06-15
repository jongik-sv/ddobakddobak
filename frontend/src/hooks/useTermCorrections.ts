import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { correctTerms, getTranscripts } from '../api/meetings'
import type { Transcript, TermCorrection } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'

interface UseTermCorrectionsOptions {
  setTranscripts: Dispatch<SetStateAction<Transcript[]>>
  refetch: () => void
}

/**
 * 회의록 오타(용어) 일괄 수정.
 *
 * MeetingPage god 컴포넌트에서 분리 — 순수 코드 이동, 동작 무변경.
 */
export function useTermCorrections(meetingId: number, { setTranscripts, refetch }: UseTermCorrectionsOptions) {
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)

  const [corrections, setCorrections] = useState<TermCorrection[]>([{ from: '', to: '' }])
  const [isApplyingCorrections, setIsApplyingCorrections] = useState(false)
  const [correctionStatus, setCorrectionStatus] = useState('')

  const handleApplyCorrections = async () => {
    const valid = corrections.filter((c) => c.from.trim() && c.to.trim())
    if (valid.length === 0 || isApplyingCorrections) return

    setIsApplyingCorrections(true)
    setCorrectionStatus('반영 중...')
    try {
      const result = await correctTerms(meetingId, valid)
      setCorrections([{ from: '', to: '' }])
      if (result.notes_markdown) {
        setMeetingNotes(result.notes_markdown)
      }
      // 트랜스크립트 리로드 — 로컬 state + store.finals(TranscriptPanel이 우선 조회) 모두 갱신해야 화면 반영됨
      if (result.corrected_transcripts > 0) {
        getTranscripts(meetingId).then((data) => {
          setTranscripts(data)
          loadFinals(
            data.map((t) => ({
              id: t.id,
              content: t.content,
              speaker_label: t.speaker_label,
              speaker_name: t.speaker_name ?? null,
              started_at_ms: t.started_at_ms,
              ended_at_ms: t.ended_at_ms,
              sequence_number: t.sequence_number,
              applied: t.applied_to_minutes ?? true,
            })),
          )
        })
      }
      // 구조화 요약(key_points/decisions/discussion_details)·brief 갱신을 위해 회의 리페치
      refetch()
      setCorrectionStatus(
        result.corrected_transcripts > 0
          ? `완료 (트랜스크립트 ${result.corrected_transcripts}건 수정)`
          : '완료'
      )
      setTimeout(() => setCorrectionStatus(''), 3000)
    } catch {
      setCorrectionStatus('반영 실패')
      setTimeout(() => setCorrectionStatus(''), 3000)
    } finally {
      setIsApplyingCorrections(false)
    }
  }

  const updateCorrection = (index: number, field: 'from' | 'to', value: string) => {
    setCorrections((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)))
  }

  const addCorrectionRow = () => {
    setCorrections((prev) => [...prev, { from: '', to: '' }])
  }

  const removeCorrectionRow = (index: number) => {
    setCorrections((prev) => (prev.length <= 1 ? [{ from: '', to: '' }] : prev.filter((_, i) => i !== index)))
  }

  return {
    corrections,
    isApplyingCorrections,
    correctionStatus,
    handleApplyCorrections,
    updateCorrection,
    addCorrectionRow,
    removeCorrectionRow,
  }
}
