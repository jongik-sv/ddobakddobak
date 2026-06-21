import { useState } from 'react'
import { correctTerms } from '../api/meetings'
import type { TermCorrection } from '../api/meetings'

export function useLiveTermCorrections(
  meetingId: number,
  showStatus: (msg: string, durationMs?: number) => void,
) {
  // 오타 수정 상태
  const [corrections, setCorrections] = useState<TermCorrection[]>([{ from: '', to: '' }])
  const [isApplyingCorrections, setIsApplyingCorrections] = useState(false)

  // 오타 수정 적용
  const handleApplyCorrections = async () => {
    const valid = corrections.filter((c) => c.from.trim() && c.to.trim())
    if (valid.length === 0 || isApplyingCorrections) return

    setIsApplyingCorrections(true)
    showStatus('오타 수정 반영 중...', 10000)
    try {
      const result = await correctTerms(meetingId, valid)
      setCorrections([{ from: '', to: '' }])
      const msg = result.corrected_transcripts > 0
        ? `오타 수정 완료 (트랜스크립트 ${result.corrected_transcripts}건 수정)`
        : '오타 수정이 회의록에 반영되었습니다'
      showStatus(msg)
    } catch {
      showStatus('오타 수정 반영에 실패했습니다')
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

  return { corrections, isApplyingCorrections, handleApplyCorrections, updateCorrection, addCorrectionRow, removeCorrectionRow }
}
