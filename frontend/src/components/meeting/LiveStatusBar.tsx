import { Monitor, Smartphone } from 'lucide-react'
import { ENGINE_LABELS_SHORT } from '../../config'

interface LiveStatusBarProps {
  isSystemCapturing: boolean
  isActive: boolean
  meetingApiStatus: 'pending' | 'recording' | 'completed' | null
  statusMessage: string | null
  sttEngine: string | null
  /** 이번 세션의 활성 STT 모드 — 'local'이면 전사가 서버가 아닌 이 기기에 저장됨을 알린다. */
  activeSttMode?: 'server' | 'local'
}

/** MeetingLivePage 하단 상태바 (시스템오디오/회의상태/메시지/STT엔진). */
export function LiveStatusBar({
  isSystemCapturing,
  isActive,
  meetingApiStatus,
  statusMessage,
  sttEngine,
  activeSttMode,
}: LiveStatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 h-7 border-t bg-gray-50 text-[11px] text-gray-500 shrink-0 select-none">
      <div className="flex items-center gap-3">
        {isActive && activeSttMode === 'local' && (
          <span
            className="flex items-center gap-1 text-amber-600 font-medium"
            title="서버 미도달 또는 개인설정 — 전사가 서버 회의록이 아닌 이 기기에 저장됩니다"
          >
            <Smartphone className="w-3 h-3" />
            온디바이스 STT
          </span>
        )}
        {isSystemCapturing && (
          <span className="flex items-center gap-1 text-purple-500 font-medium">
            <Monitor className="w-3 h-3" />
            시스템 오디오
          </span>
        )}
        {!isActive && meetingApiStatus === 'completed' && (
          <span className="text-gray-400">종료됨</span>
        )}
        {!isActive && meetingApiStatus === 'pending' && (
          <span className="text-gray-400">대기 중</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {statusMessage && (
          <span className="text-blue-600 font-medium truncate max-w-xs">{statusMessage}</span>
        )}
        {sttEngine && (
          <span className="font-mono text-gray-400">
            STT: {ENGINE_LABELS_SHORT[sttEngine] ?? sttEngine}
          </span>
        )}
      </div>
    </div>
  )
}
