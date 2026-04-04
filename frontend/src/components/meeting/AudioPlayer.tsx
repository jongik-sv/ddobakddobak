import { useRef, useEffect } from 'react'
import { Play, Pause, Download } from 'lucide-react'
import { useAudioPlayer } from '../../hooks/useAudioPlayer'

interface AudioPlayerProps {
  meetingId: number
  onTimeUpdate: (ms: number) => void
  seekMs: number | null
  autoPlayOnSeek?: boolean
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

export function AudioPlayer({ meetingId, onTimeUpdate, seekMs, autoPlayOnSeek = false }: AudioPlayerProps) {
  const progressRef = useRef<HTMLDivElement>(null)
  const { isReady, isPlaying, hasAudio, audioLoaded, currentTimeMs, durationMs, playbackRate, play, pause, seekTo, setPlaybackRate, download } = useAudioPlayer(meetingId)

  const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2]
  const cycleSpeed = () => {
    const currentIndex = SPEED_PRESETS.indexOf(playbackRate)
    const nextIndex = (currentIndex + 1) % SPEED_PRESETS.length
    setPlaybackRate(SPEED_PRESETS[nextIndex])
  }

  useEffect(() => {
    onTimeUpdate(currentTimeMs)
  }, [currentTimeMs, onTimeUpdate])

  useEffect(() => {
    if (seekMs !== null) {
      seekTo(seekMs)
      if (autoPlayOnSeek) play()
    }
  }, [seekMs, seekTo, autoPlayOnSeek, play])

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressRef.current
    if (!bar || durationMs <= 0) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seekTo(ratio * durationMs)
  }

  if (isReady && !hasAudio) return null

  const progress = durationMs > 0 ? (currentTimeMs / durationMs) * 100 : 0

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-white border-b">
      {!isReady ? (
        <span className="text-sm text-gray-400">오디오 불러오는 중...</span>
      ) : (
        <>
          {/* 재생/정지 버튼 */}
          <button
            onClick={isPlaying ? pause : play}
            disabled={!audioLoaded}
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          {/* 시간 (현재) */}
          <span className="shrink-0 text-xs text-gray-500 tabular-nums text-right">
            {formatTime(currentTimeMs)}
          </span>

          {/* 프로그레스 바 */}
          <div
            ref={progressRef}
            onClick={handleProgressClick}
            className="flex-1 h-2 bg-gray-200 rounded-full cursor-pointer relative group py-4 box-content"
          >
            <div
              className="h-full bg-indigo-600 rounded-full transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-indigo-600 rounded-full shadow hover-hide hover-show-parent transition-opacity"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>

          {/* 시간 (전체) */}
          <span className="shrink-0 text-xs text-gray-500 tabular-nums">
            {formatTime(durationMs)}
          </span>

          {/* 배속 */}
          <button
            onClick={cycleSpeed}
            className="shrink-0 px-3 py-1.5 min-h-[44px] rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 tabular-nums flex items-center"
          >
            {playbackRate}x
          </button>

          {/* 다운로드 */}
          <button
            onClick={() => download()}
            disabled={!audioLoaded}
            className="shrink-0 p-2.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="다운로드"
          >
            <Download className="w-4 h-4" />
          </button>

          {!audioLoaded && (
            <span className="text-xs text-gray-400">로딩...</span>
          )}
        </>
      )}
    </div>
  )
}
