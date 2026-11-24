import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import LineDiffView from '../ui/LineDiffView'
import { getAiOriginal, type AiOriginal } from '../../api/sttTermLearning'

interface Props {
  meetingId: number
  onClose: () => void
}

function fmt(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR')
}

/** AI가 만든 원본 회의록과 현재(사람 수정 반영) 회의록의 줄 단위 diff 보기. */
export default function AiOriginalDiffModal({ meetingId, onClose }: Props) {
  const [data, setData] = useState<AiOriginal | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAiOriginal(meetingId)
      .then((r) => { if (!cancelled) setData(r) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [meetingId])

  return (
    <Dialog onClose={onClose} ariaLabel="AI 원본과 비교" className="w-full max-w-3xl rounded-xl bg-card p-5 shadow-2xl border border-border max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">AI 원본과 비교</h2>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600">AI 원본을 불러오지 못했습니다.</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : !data.available ? (
        <p className="text-sm text-muted-foreground">이 회의에는 AI 원본이 없습니다(기능 도입 전 회의 또는 녹음 중)</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            <span>AI 생성: {fmt(data.ai_generated_at)}</span>
            <span>마지막 사람 수정: {fmt(data.human_edited_at)}</span>
          </div>
          <LineDiffView ops={data.diff} collapseEqual />
        </>
      )}
    </Dialog>
  )
}
