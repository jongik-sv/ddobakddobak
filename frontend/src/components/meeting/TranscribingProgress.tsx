/** 파일 변환(STT) 진행률 전체 화면 */
export function TranscribingProgress({
  title,
  progressPercent,
  message,
  isError,
  error,
  queuePosition,
}: {
  title: string
  progressPercent: number
  message: string
  isError: boolean
  error?: string | null
  /** 전사 대기열에서 앞선 미완료 잡 수. 1 이상이면 진행률 대신 대기 안내를 보여준다.
   *  실행이 시작되면(잡 claim) 서버가 null을 내려줘 기존 진행률 표시로 자연 전환된다. */
  queuePosition?: number | null
}) {
  // queuePosition은 회의 폴링(10초 주기)으로만 갱신돼, 잡이 claim된 직후 최대 10초간
  // stale하게 남을 수 있다. progressPercent>0은 ActionCable 진행률 브로드캐스트(잡 실행 중에만
  // 발생)를 이미 수신했다는 뜻이므로, 그 신호를 우선해 대기 표시를 즉시 해제한다.
  const isWaiting = !isError && typeof queuePosition === 'number' && queuePosition >= 1 && progressPercent === 0

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-4 p-8 rounded-xl bg-card border shadow-sm">
          <svg className="w-12 h-12 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>

          {isWaiting ? (
            <p className="text-sm text-muted-foreground">앞에 {queuePosition}건 대기 중</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{message}</p>

              {/* 진행률 바 */}
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{progressPercent}%</p>
            </>
          )}

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
