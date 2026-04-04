import { useState, type ReactNode } from 'react'
import { ArrowLeft, Pause, Play, Square, MoreHorizontal, X } from 'lucide-react'
import { formatElapsedSeconds } from '../../lib/audioUtils'

export interface MobileRecordControlsProps {
  title: string
  isRecording: boolean
  isPaused: boolean
  elapsedSeconds: number
  onBack: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  isStopping: boolean
  /** 더보기 바텀 시트에 표시할 추가 옵션 */
  children?: ReactNode
}

export function MobileRecordControls({
  title,
  isRecording,
  isPaused,
  elapsedSeconds,
  onBack,
  onPause,
  onResume,
  onStop,
  isStopping,
  children,
}: MobileRecordControlsProps) {
  const [showMore, setShowMore] = useState(false)

  if (!isRecording) return null

  return (
    <div
      data-testid="mobile-record-controls"
      className={`lg:hidden sticky top-0 z-20 flex items-center justify-between px-2 py-1.5 border-b shadow-sm ${
        isPaused ? 'bg-amber-50 border-amber-300' : 'bg-red-50 border-red-300'
      }`}
    >
      {/* 좌측: 뒤로가기 + 제목 */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <button
          onClick={onBack}
          aria-label="뒤로"
          className="p-1 rounded-md hover:bg-white/60 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-gray-600" />
        </button>
        <span className="text-sm font-medium text-gray-900 truncate">
          {title}
        </span>
      </div>

      {/* 중앙: 녹음 상태 (빨간 점 + 타이머) */}
      <div className="flex items-center gap-1.5 shrink-0 mx-2">
        <span
          data-testid="mobile-recording-dot"
          className={`inline-block w-2 h-2 rounded-full ${
            isPaused ? 'bg-amber-500' : 'bg-red-500'
          }`}
          style={!isPaused ? { animation: 'recording-blink 1.2s ease-in-out infinite' } : undefined}
        />
        <span className="font-mono text-xs font-semibold text-gray-700 tabular-nums">
          {formatElapsedSeconds(elapsedSeconds)}
        </span>
      </div>

      {/* 우측: 핵심 버튼 (일시정지/재개 + 종료 + 더보기) */}
      <div className="flex items-center gap-1 shrink-0">
        {isPaused ? (
          <button
            onClick={onResume}
            aria-label="재개"
            className="p-1.5 rounded-md bg-green-500 text-white hover:bg-green-600 transition-colors"
          >
            <Play className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={onPause}
            aria-label="일시정지"
            className="p-1.5 rounded-md bg-yellow-500 text-white hover:bg-yellow-600 transition-colors"
          >
            <Pause className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={onStop}
          disabled={isStopping}
          aria-label="종료"
          className="p-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          <Square className="w-4 h-4" />
        </button>

        <button
          onClick={() => setShowMore(true)}
          aria-label="더보기"
          className="p-1.5 rounded-md text-gray-600 hover:bg-white/60 transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* 더보기 바텀 시트 오버레이 */}
      {showMore && (
        <div
          data-testid="mobile-more-options"
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
          onClick={() => setShowMore(false)}
        >
          <div
            className="bg-white rounded-t-2xl px-4 py-5 max-h-[60vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">추가 옵션</h3>
              <button
                onClick={() => setShowMore(false)}
                aria-label="닫기"
                className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
