import { Settings, Monitor, Mic, ArrowLeft, StickyNote, Paperclip, Bookmark, Save, Timer, Pencil } from 'lucide-react'
import { Switch } from '../ui/Switch'
import { Tooltip } from '../ui/Tooltip'
import { ShareButton } from './ShareButton'
import { useUiStore } from '../../stores/uiStore'
import { formatElapsedSeconds } from '../../lib/audioUtils'
import { IS_TAURI, SUMMARY_INTERVAL_OPTIONS } from '../../config'

/** 데스크톱 전용 녹음 컨트롤 헤더 바 (모바일은 MobileRecordControls 사용) */
export function DesktopRecordControls({
  meetingId,
  title,
  isActive,
  isPaused,
  elapsedSeconds,
  summaryCountdown,
  summaryIntervalSec,
  onSummaryIntervalChange,
  error,
  attachmentsVisible,
  onToggleAttachments,
  memoVisible,
  onToggleMemo,
  canManageTemplates,
  systemAudioEnabled,
  onToggleSystemAudio,
  isResetting,
  isStopping,
  onNavigateBack,
  onShowEdit,
  onShowSaveTemplate,
  onOpenBookmark,
  onResetClick,
  onStart,
  onPause,
  onResume,
  onStop,
  onManualSummary,
  canManualSummary,
}: {
  meetingId: number
  title: string
  isActive: boolean
  isPaused: boolean
  elapsedSeconds: number
  summaryCountdown: number
  summaryIntervalSec: number
  onSummaryIntervalChange: (value: number) => void
  error: string | null
  attachmentsVisible: boolean
  onToggleAttachments: () => void
  memoVisible: boolean
  onToggleMemo: () => void
  canManageTemplates: boolean
  systemAudioEnabled: boolean
  onToggleSystemAudio: (next: boolean) => void
  isResetting: boolean
  isStopping: boolean
  onNavigateBack: () => void
  onShowEdit: () => void
  onShowSaveTemplate: () => void
  onOpenBookmark: () => void
  onResetClick: () => void
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onManualSummary?: () => void
  canManualSummary?: boolean
}) {
  return (
    <div className={`hidden lg:flex items-center justify-between px-4 py-2 shadow-sm shrink-0 transition-colors duration-300 ${
      isActive && !isPaused
        ? 'bg-red-50 border-b-2 border-red-400'
        : isActive && isPaused
          ? 'bg-amber-50 border-b-2 border-amber-400'
          : 'bg-card border-b'
    }`}>
      {/* 좌측: 네비게이션 */}
      <div className="flex items-center gap-2">
        <Tooltip text="미리보기로">
          <button
            onClick={onNavigateBack}
            className="p-1.5 rounded-md hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
        </Tooltip>
        <h1 className="text-lg font-semibold text-foreground truncate max-w-[200px]">
          {title}
        </h1>
        <Tooltip text="회의 정보 수정">
          <button
            onClick={onShowEdit}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip text={attachmentsVisible ? '첨부 숨기기' : '첨부 보기'}>
          <button
            onClick={onToggleAttachments}
            className={`p-1.5 rounded-md transition-colors ${attachmentsVisible ? 'text-blue-600 bg-blue-50' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
          >
            <Paperclip className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip text={memoVisible ? '메모 숨기기' : '메모 보기'}>
          <button
            onClick={onToggleMemo}
            className={`p-1.5 rounded-md transition-colors ${memoVisible ? 'text-blue-600 bg-blue-50' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
          >
            <StickyNote className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip text="설정">
          <button
            onClick={useUiStore.getState().openSettings}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </Tooltip>
        {canManageTemplates && (
          <Tooltip text="템플릿으로 저장">
            <button
              onClick={onShowSaveTemplate}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Save className="w-4 h-4" />
            </button>
          </Tooltip>
        )}
      </div>

      {/* 중앙: 녹음 상태 인디케이터 */}
      {isActive && (
        <div className="flex items-center gap-3">
          <div
            data-testid="recording-indicator"
            className={`flex items-center gap-2 px-3 py-1 rounded-full border ${
              isPaused
                ? 'bg-amber-100 border-amber-300'
                : 'bg-red-100 border-red-200'
            }`}
          >
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${isPaused ? 'bg-amber-500' : 'bg-red-500'}`}
              style={!isPaused ? { animation: 'recording-blink 1.2s ease-in-out infinite' } : undefined}
            />
            <Mic className={`w-3.5 h-3.5 ${isPaused ? 'text-amber-600' : 'text-red-500'}`} />
            <span className={`text-sm font-semibold ${isPaused ? 'text-amber-700' : 'text-red-600'}`}>
              {isPaused ? '일시정지' : '녹음 중'}
            </span>
          </div>

          {/* 경과 시간 */}
          <span className="font-mono text-sm font-semibold text-foreground tabular-nums tracking-wide">
            {formatElapsedSeconds(elapsedSeconds)}
          </span>

          {/* 원형 카운트다운 타이머 */}
          {summaryCountdown > 0 && (
            <div className="flex items-center gap-1" title="다음 AI 회의록 적용까지">
              <div className="relative w-7 h-7">
                <svg className="w-7 h-7 -rotate-90" viewBox="0 0 28 28">
                  <circle cx="14" cy="14" r="12" fill="none" stroke="#e5e7eb" strokeWidth="2" />
                  <circle
                    cx="14" cy="14" r="12" fill="none" stroke="#3b82f6" strokeWidth="2"
                    strokeDasharray={`${2 * Math.PI * 12}`}
                    strokeDashoffset={`${2 * Math.PI * 12 * (1 - (summaryIntervalSec - summaryCountdown) / summaryIntervalSec)}`}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-linear"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-blue-600 font-mono">
                  {summaryCountdown}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 우측: 컨트롤 */}
      <div className="flex items-center gap-2">
        {error && (
          <span className="text-sm text-red-500">{error}</span>
        )}

        {/* 북마크 추가 버튼 (녹음 중만 표시) */}
        {isActive && (
          <Tooltip text="북마크 추가 (Ctrl+B)">
            <button
              onClick={onOpenBookmark}
              className="p-1.5 rounded-md text-amber-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
            >
              <Bookmark className="w-4 h-4" />
            </button>
          </Tooltip>
        )}

        {/* 공유 버튼 */}
        <ShareButton meetingId={meetingId} />

        {/* 시스템 오디오 토글 (Tauri 데스크톱 앱에서만 표시) */}
        {IS_TAURI && (
          <Tooltip text="시스템 오디오 캡처">
            <div className="flex items-center gap-1.5">
              <Monitor className={`w-3.5 h-3.5 ${systemAudioEnabled ? 'text-purple-600' : 'text-muted-foreground'}`} />
              <Switch
                checked={systemAudioEnabled}
                onChange={onToggleSystemAudio}
              />
            </div>
          </Tooltip>
        )}

        {/* 적용주기 선택 */}
        <Tooltip text="AI 회의록 적용 주기">
        <div className="flex items-center gap-1.5">
          <Timer className="w-3.5 h-3.5 text-muted-foreground" />
          <select
            value={summaryIntervalSec}
            onChange={(e) => onSummaryIntervalChange(Number(e.target.value))}
            className="text-xs border border-border rounded-md px-1.5 py-1 bg-background text-foreground"
          >
            {SUMMARY_INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        </Tooltip>

        {!isActive && (
          <button
            onClick={onResetClick}
            disabled={isResetting}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-50"
          >
            {isResetting ? '초기화 중...' : '회의 초기화'}
          </button>
        )}

        {!isActive ? (
          <button
            onClick={onStart}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            회의 시작
          </button>
        ) : (
          <>
            {onManualSummary && (
              <button
                onClick={onManualSummary}
                disabled={!canManualSummary}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                지금 요약
              </button>
            )}
            <button
              onClick={isPaused ? onResume : onPause}
              className={`px-3 py-1.5 rounded-md text-sm font-medium text-white transition-colors ${
                isPaused
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-yellow-500 hover:bg-yellow-600'
              }`}
            >
              {isPaused ? '재개' : '일시정지'}
            </button>
            <button
              onClick={onStop}
              disabled={isStopping}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {isStopping ? '종료 중...' : '회의 종료'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
