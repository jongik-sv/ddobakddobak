import { Clock } from 'lucide-react'
import { formatTime } from '../../lib/audioUtils'
import { speakerColor } from './SpeakerLabel'

interface Props {
  ms: number
  speaker: string            // speaker_label, 예 "화자 1"
  speakerName?: string | null // 표시용 사람 이름(있으면 tooltip)
  onSeek: (ms: number) => void
  isAudioReady?: boolean
  /** 인용 출처 회의 id. >0이면 "이전 회의에서 복사된 마커" — 현재 회의 오디오 기준 seek가
   *  의미 없으므로 클릭 무동작(inert) span으로 렌더하고 중립색을 쓴다. 기본 0(현재 회의, 클릭 가능). */
  meetingId?: number
  /** meetingId>0일 때 툴팁에 쓸 출처 회의명. 미상이면 "이전 회의" 폴백은 호출측이 채워 넘긴다. */
  meetingTitle?: string
}

export function TimestampBadge({ ms, speaker, speakerName, onSeek, isAudioReady = true, meetingId = 0, meetingTitle }: Props) {
  const inert = meetingId > 0
  const color = inert ? 'bg-muted text-muted-foreground' : speakerColor(speaker) // 'bg-…-100 text-…-800'
  // 회의명 미상(meetingTitle 없음)이면 "이전 회의: 이전 회의" 중복을 피하려 접두 없이 폴백한다.
  const title = inert
    ? meetingTitle
      ? `이전 회의: ${meetingTitle} · ${speakerName || speaker} · ${formatTime(ms)}`
      : `이전 회의 · ${speakerName || speaker} · ${formatTime(ms)}`
    : `${speakerName || speaker} · ${formatTime(ms)}`

  if (inert) {
    return (
      <span
        title={title}
        aria-label={title}
        className={`inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1 py-0 rounded text-[10px] font-medium cursor-default ${color}`}
      >
        <Clock className="w-2.5 h-2.5" />
        {formatTime(ms)}
      </span>
    )
  }

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={!isAudioReady}
      onClick={() => { if (isAudioReady) onSeek(ms) }} // guard for programmatic calls; disabled attr handles browser clicks
      className={`inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1 py-0 rounded text-[10px] font-medium ${color} ${isAudioReady ? 'cursor-pointer hover:brightness-95' : 'opacity-40 cursor-default'}`}
    >
      <Clock className="w-2.5 h-2.5" />
      {formatTime(ms)}
    </button>
  )
}
