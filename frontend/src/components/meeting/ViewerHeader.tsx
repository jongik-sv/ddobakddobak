import { ArrowLeft, Info } from 'lucide-react'

interface ViewerHeaderProps {
  title: string
  isRecordingStopped: boolean
  /** 녹음 기기가 일시정지 중인지. 종료(isRecordingStopped)가 우선. */
  isPaused?: boolean
  onBack: () => void
}

/** 읽기전용 뷰어 헤더 — 다른 기기에서 녹음 중인 회의를 실시간으로 지켜보는 화면. */
export function ViewerHeader({
  title,
  isRecordingStopped,
  isPaused = false,
  onBack,
}: ViewerHeaderProps) {
  return (
    <div className="shrink-0">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-2.5 rounded-md hover:bg-accent transition-colors"
            title="뒤로"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <span className="text-sm font-medium text-muted-foreground">
            다른 기기에서 녹음 중 — 실시간 보기
          </span>
        </div>

        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          {isRecordingStopped ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              종료됨
            </span>
          ) : isPaused ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1 font-medium">
              <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full" />
              일시정지
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

        {/* 우측 여백 — 중앙 제목이 좌측 그룹과 균형 잡히도록 자리만 유지 */}
        <div className="w-10" />
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
