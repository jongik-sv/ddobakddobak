import { ArrowLeft, Info, Users } from 'lucide-react'

interface ViewerHeaderProps {
  title: string
  participantCount: number
  isRecordingStopped: boolean
  onLeave: () => void
}

export function ViewerHeader({
  title,
  participantCount,
  isRecordingStopped,
  onLeave,
}: ViewerHeaderProps) {
  return (
    <div className="shrink-0">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={onLeave}
            className="p-2.5 rounded-md hover:bg-accent transition-colors"
            title="나가기"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <span className="text-sm font-medium text-muted-foreground">회의 참여 중</span>
        </div>

        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Users className="w-4 h-4" />
            <span className="text-sm font-medium">{participantCount}</span>
          </div>
          {isRecordingStopped ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              종료됨
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1 font-medium">
              <span
                className="inline-block w-1.5 h-1.5 bg-red-500 rounded-full"
                style={{ animation: 'recording-blink 1.2s ease-in-out infinite' }}
              />
              녹음중
            </span>
          )}
        </div>

        <button
          onClick={onLeave}
          className="px-3 py-2 min-h-[44px] rounded-md text-sm font-medium border border-border text-foreground hover:bg-accent transition-colors"
        >
          나가기
        </button>
      </div>

      {isRecordingStopped && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-200 text-sm text-blue-700">
          <Info className="w-4 h-4 shrink-0" />
          회의가 종료되었습니다. 최종 회의록을 확인하세요.
        </div>
      )}
    </div>
  )
}
