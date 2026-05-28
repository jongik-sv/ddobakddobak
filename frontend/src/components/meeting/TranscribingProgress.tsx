/** 파일 변환(STT) 진행률 전체 화면 */
export function TranscribingProgress({
  title,
  progressPercent,
  message,
  isError,
  error,
}: {
  title: string
  progressPercent: number
  message: string
  isError: boolean
  error?: string | null
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-4 p-8 rounded-xl bg-white border shadow-sm">
          <svg className="w-12 h-12 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500">{message}</p>

          {/* 진행률 바 */}
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-xs text-gray-400">{progressPercent}%</p>

          {isError && (
            <div className="mt-2 p-3 rounded-md bg-red-50 text-sm text-red-600 w-full">
              오류: {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
