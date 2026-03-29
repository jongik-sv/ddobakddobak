import { useRef, useEffect } from 'react'
import { useAudioPlayer } from '../../hooks/useAudioPlayer'

interface AudioPlayerProps {
  meetingId: number
  onTimeUpdate: (ms: number) => void
  seekMs: number | null
  autoPlayOnSeek?: boolean
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function AudioPlayer({ meetingId, onTimeUpdate, seekMs, autoPlayOnSeek = false }: AudioPlayerProps) {
  const waveformRef = useRef<HTMLDivElement>(null)
  const { isReady, isPlaying, hasAudio, currentTimeMs, durationMs, playbackRate, play, pause, seekTo, setPlaybackRate, download } = useAudioPlayer(
    meetingId,
    waveformRef
  )

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

  if (isReady && !hasAudio) return null

  return (
    <div className="flex flex-col gap-2 p-4 bg-white border-b">
      {/* WaveSurfer 파형 컨테이너 */}
      <div data-testid="waveform" ref={waveformRef} className="w-full h-20 overflow-hidden" />

      {/* 컨트롤 영역 */}
      <div className="relative z-10 flex items-center gap-4">
        {!isReady ? (
          <span className="text-sm text-gray-400">오디오 불러오는 중...</span>
        ) : (
          <>
            {isPlaying ? (
              <button
                aria-label="정지"
                onClick={pause}
                className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700"
              >
                정지
              </button>
            ) : (
              <button
                aria-label="재생"
                onClick={play}
                className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700"
              >
                재생
              </button>
            )}
            <span className="text-sm text-gray-600 tabular-nums">
              {formatTime(currentTimeMs)} / {formatTime(durationMs)}
            </span>
            <button
              aria-label="배속"
              onClick={cycleSpeed}
              className="px-3 py-1.5 rounded bg-gray-100 text-gray-700 text-sm hover:bg-gray-200 tabular-nums"
            >
              {playbackRate}x
            </button>
            <button
              aria-label="다운로드"
              onClick={() => download()}
              className="ml-auto px-3 py-1.5 rounded bg-gray-100 text-gray-700 text-sm hover:bg-gray-200"
            >
              다운로드
            </button>
          </>
        )}
      </div>
    </div>
  )
}
