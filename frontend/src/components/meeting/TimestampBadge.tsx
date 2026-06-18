import { Clock } from 'lucide-react'
import { formatTime } from '../../lib/audioUtils'
import { speakerColor } from './SpeakerLabel'

interface Props {
  ms: number
  speaker: string            // speaker_label, 예 "화자 1"
  speakerName?: string | null // 표시용 사람 이름(있으면 tooltip)
  onSeek: (ms: number) => void
  isAudioReady?: boolean
}

export function TimestampBadge({ ms, speaker, speakerName, onSeek, isAudioReady = true }: Props) {
  const color = speakerColor(speaker) // 'bg-…-100 text-…-800'
  const title = `${speakerName || speaker} · ${formatTime(ms)}`
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={!isAudioReady}
      onClick={() => { if (isAudioReady) onSeek(ms) }}
      className={`inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1 py-0 rounded text-[10px] font-medium ${color} ${isAudioReady ? 'cursor-pointer hover:brightness-95' : 'opacity-40 cursor-default'}`}
    >
      <Clock className="w-2.5 h-2.5" />
      {formatTime(ms)}
    </button>
  )
}
