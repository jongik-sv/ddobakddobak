import { useLocation, useNavigate } from 'react-router-dom'
import { Pause, Play, Sparkles, Maximize2, Square } from 'lucide-react'
import { useRecordingStore } from '../../stores/recordingStore'
import { useTranscriptStore } from '../../stores/transcriptStore'

function fmt(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 떠다니는 녹음바. 녹음 중 + 해당 회의 라이브 라우트가 아닐 때 하단 전체폭으로 표시.
 *  아이콘 컨트롤(요약/일시정지/돌아가기/종료) + 마지막 발화 미리보기.
 *  TranscriptFinalData 실제 필드: speaker_label, content (plan 플레이스홀더 speakerLabel/text 아님). */
export function RecordingBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeMeetingId = useRecordingStore((s) => s.activeMeetingId)
  const status = useRecordingStore((s) => s.status)
  const isPaused = useRecordingStore((s) => s.isPaused)
  const elapsedSeconds = useRecordingStore((s) => s.elapsedSeconds)
  const summaryCountdown = useRecordingStore((s) => s.summaryCountdown)
  const canManualSummary = useRecordingStore((s) => s.canManualSummary)
  const lastFinal = useTranscriptStore((s) => s.finals[s.finals.length - 1])
  const isSummarizing = useTranscriptStore((s) => s.isSummarizing)

  if (activeMeetingId == null || status !== 'recording') return null
  if (location.pathname === `/meetings/${activeMeetingId}/live`) return null

  const store = useRecordingStore.getState()

  // 미리보기 텍스트: speaker_label + content (TranscriptFinalData 실제 필드명)
  const previewText = isSummarizing
    ? '요약 중…'
    : lastFinal
      ? `${lastFinal.speaker_label ?? ''} ${lastFinal.content}`.trim()
      : '듣는 중…'

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 flex items-center gap-3 px-4 py-2 bg-gray-900 text-white shadow-[0_-2px_8px_rgba(0,0,0,0.2)]">
      <span className="flex items-center gap-1.5 shrink-0 font-medium">
        <span className={`w-2 h-2 rounded-full ${isPaused ? 'bg-yellow-400' : 'bg-red-500 animate-pulse'}`} />
        {fmt(elapsedSeconds)}
      </span>
      <span className="flex-1 truncate text-sm text-gray-300">
        {previewText}
      </span>
      <span className="shrink-0 text-xs text-gray-400 tabular-nums">⏱{fmt(summaryCountdown)}</span>
      <button
        title="지금 요약"
        aria-label="지금 요약"
        disabled={!canManualSummary}
        onClick={() => store.manualSummary()}
        className="p-1.5 rounded hover:bg-white/10 disabled:opacity-40"
      >
        <Sparkles className={`w-4 h-4 ${isSummarizing ? 'animate-spin' : ''}`} />
      </button>
      <button
        title={isPaused ? '재개' : '일시정지'}
        aria-label={isPaused ? '재개' : '일시정지'}
        onClick={() => (isPaused ? store.resume() : store.pause())}
        className="p-1.5 rounded hover:bg-white/10"
      >
        {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
      </button>
      <button
        title="회의로 돌아가기"
        aria-label="회의로 돌아가기"
        onClick={() => navigate(`/meetings/${activeMeetingId}/live`)}
        className="p-1.5 rounded hover:bg-white/10"
      >
        <Maximize2 className="w-4 h-4" />
      </button>
      <button
        title="녹음 종료"
        aria-label="녹음 종료"
        onClick={() => store.requestStop()}
        className="p-1.5 rounded bg-red-600 hover:bg-red-500"
      >
        <Square className="w-4 h-4" />
      </button>
    </div>
  )
}
