import { Play, Pause, ChevronUp } from 'lucide-react'
import { formatTime } from '../../lib/audioUtils'

interface MiniAudioPlayerProps {
  isPlaying: boolean
  currentTimeMs: number
  durationMs: number
  onPlay: () => void
  onPause: () => void
  onSeek: (ms: number) => void
  onExpand: () => void
}

export function MiniAudioPlayer({
  isPlaying,
  currentTimeMs,
  durationMs,
  onPlay,
  onPause,
  onSeek,
  onExpand,
}: MiniAudioPlayerProps) {
  return (
    <div className="h-12 fixed bottom-14 left-0 right-0 lg:hidden z-40 bg-white border-t shadow-sm flex items-center gap-2 px-3">
      {/* 재생/일시정지 */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          isPlaying ? onPause() : onPlay()
        }}
        aria-label={isPlaying ? '일시정지' : '재생'}
        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      {/* 현재시간 */}
      <span className="shrink-0 text-xs text-gray-500 tabular-nums w-10 text-right">
        {formatTime(currentTimeMs)}
      </span>

      {/* 프로그레스 바 */}
      <input
        type="range"
        min={0}
        max={durationMs}
        value={currentTimeMs}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="flex-1 h-1 accent-indigo-600 cursor-pointer"
        onClick={(e) => e.stopPropagation()}
      />

      {/* 총시간 */}
      <span className="shrink-0 text-xs text-gray-500 tabular-nums w-10">
        {formatTime(durationMs)}
      </span>

      {/* 확장 버튼 */}
      <button
        onClick={onExpand}
        aria-label="확장"
        className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <ChevronUp className="w-4 h-4" />
      </button>
    </div>
  )
}
