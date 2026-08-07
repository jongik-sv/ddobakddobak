import { useRef, useEffect } from 'react'
import { Play, Pause, Download } from 'lucide-react'
import type { AudioPlayerResult } from '../../hooks/useAudioPlayer'
import { formatTime } from '../../lib/audioUtils'

interface AudioPlayerProps {
  audio: AudioPlayerResult
  onTimeUpdate: (ms: number) => void
  seekMs: number | null
  autoPlayOnSeek?: boolean
}

export function AudioPlayer({ audio, onTimeUpdate, seekMs, autoPlayOnSeek = false }: AudioPlayerProps) {
  const progressRef = useRef<HTMLDivElement>(null)
  const { isReady, isPlaying, hasAudio, srcReady, currentTimeMs, durationMs, playbackRate, play, pause, seekTo, setPlaybackRate, download } = audio

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
    <div className="flex items-center gap-3 px-4 py-1 bg-card border-b">
      {!isReady ? (
        <span className="text-sm text-muted-foreground">오디오 불러오는 중...</span>
      ) : (
        <>
          {/* 재생/정지 버튼 — 모바일은 44px 터치 타깃 유지, 데스크톱(lg:)만 32px로 컴팩트화 */}
          <button
            onClick={isPlaying ? pause : play}
            disabled={!srcReady}
            className="shrink-0 w-11 h-11 lg:w-8 lg:h-8 flex items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          {/* 시간 (현재) */}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums text-right">
            {formatTime(currentTimeMs)}
          </span>

          {/* 프로그레스 바 */}
          <div
            ref={progressRef}
            onClick={handleProgressClick}
            className="flex-1 h-2 bg-muted rounded-full cursor-pointer relative group py-2 box-content"
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
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatTime(durationMs)}
          </span>

          {/* 배속 — 모바일은 44px 터치 타깃(min-h-[44px]) 유지, 데스크톱(lg:)은 재생 버튼(32px)과 높이를 맞춤 */}
          <button
            onClick={cycleSpeed}
            className="shrink-0 px-3 py-1.5 min-h-[44px] lg:py-2 lg:min-h-0 rounded text-xs font-medium bg-muted text-muted-foreground hover:bg-accent tabular-nums flex items-center"
          >
            {playbackRate}x
          </button>

          {/* 다운로드 — 모바일 p-2.5(36px)는 원래 값 그대로, 데스크톱(lg:)만 p-2로 32px 정렬 */}
          <button
            onClick={() => download()}
            disabled={!hasAudio}
            className="shrink-0 p-2.5 lg:p-2 rounded text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="다운로드"
          >
            <Download className="w-4 h-4" />
          </button>

          {!srcReady && (
            <span className="text-xs text-muted-foreground">로딩...</span>
          )}
        </>
      )}
    </div>
  )
}
