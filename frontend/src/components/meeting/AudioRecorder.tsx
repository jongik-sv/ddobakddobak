import { useAudioRecorder, type AudioRecorderCallbacks } from '../../hooks/useAudioRecorder'

export function AudioRecorder({ onChunk, onStop }: AudioRecorderCallbacks) {
  const { isRecording, error, start, stop } = useAudioRecorder({ onChunk, onStop })

  return (
    <div className="flex items-center gap-3">
      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        onClick={isRecording ? stop : () => start()}
        className={
          isRecording
            ? 'px-4 py-2 min-h-[44px] rounded-md font-medium bg-red-500 text-white hover:bg-red-600 transition-colors'
            : 'px-4 py-2 min-h-[44px] rounded-md font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors'
        }
      >
        {isRecording ? '녹음 중지' : '녹음 시작'}
      </button>

      {isRecording && (
        <span className="flex items-center gap-1.5 text-red-500 text-sm font-medium">
          <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          녹음 중
        </span>
      )}
    </div>
  )
}
