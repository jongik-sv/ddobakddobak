import { useState } from 'react'
import { Bot, Play, RefreshCw, Trash2 } from 'lucide-react'
import type { Meeting } from '../../api/meetings'
import { ExportButton } from './ExportButton'

// 모바일에서 상태 배지를 짧게 표시 (PC는 원문 그대로 유지)
const STATUS_SHORT_LABEL: Record<string, string> = {
  recording: '녹음',
  completed: '완료',
  pending: '대기',
}

interface MeetingActionHeaderProps {
  meeting: Meeting
  meetingId: number
  isDesktop: boolean
  meetingTypeLabel: string
  transcriptsCount: number
  isRegeneratingNotes: boolean
  onUpdateTitle: (title: string) => Promise<void> | void
  onShowSttConfirm: () => void
  onShowNotesConfirm: () => void
  onReopen: () => void
  onGoLive: () => void
  onDelete: () => void
}

/** 회의 상세 헤더: 제목 인라인 편집 + 상태/유형/태그 배지 + 액션 버튼. */
export function MeetingActionHeader({
  meeting,
  meetingId,
  isDesktop,
  meetingTypeLabel,
  transcriptsCount,
  isRegeneratingNotes,
  onUpdateTitle,
  onShowSttConfirm,
  onShowNotesConfirm,
  onReopen,
  onGoLive,
  onDelete,
}: MeetingActionHeaderProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitleValue, setEditingTitleValue] = useState('')

  function handleTitleClick() {
    setEditingTitleValue(meeting.title)
    setIsEditingTitle(true)
  }

  async function handleTitleSubmit() {
    if (editingTitleValue.trim()) {
      await onUpdateTitle(editingTitleValue.trim())
    }
    setIsEditingTitle(false)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleTitleSubmit()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
    }
  }

  return (
    <div className={`flex items-center justify-between border-b bg-white shrink-0 ${isDesktop ? 'px-6 py-3' : 'px-3 py-2'}`}>
      <div className={`flex items-center flex-1 min-w-0 ${isDesktop ? 'gap-3' : 'gap-2'}`}>
        {isEditingTitle ? (
          <input
            type="text"
            value={editingTitleValue}
            onChange={(e) => setEditingTitleValue(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
            className="text-lg font-semibold text-gray-900 border-b-2 border-blue-500 outline-none bg-transparent flex-1 min-w-0"
            autoFocus
          />
        ) : (
          <h1
            className="text-lg font-semibold text-gray-900 truncate cursor-pointer hover:text-blue-700"
            onClick={handleTitleClick}
            title="클릭하여 제목 편집"
          >
            {meeting.title ?? '회의'}
          </h1>
        )}
        {meeting.status && (
          <span className={`shrink-0 rounded-full bg-gray-100 text-gray-600 ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}>
            {isDesktop ? meeting.status : (STATUS_SHORT_LABEL[meeting.status] ?? meeting.status)}
          </span>
        )}
        {meetingTypeLabel && (
          <span className={`shrink-0 rounded-full bg-blue-50 text-blue-600 border border-blue-200 ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}>
            {meetingTypeLabel}
          </span>
        )}
        {isDesktop && meeting.tags?.map((tag) => (
          <span
            key={tag.id}
            className="shrink-0 px-2 py-0.5 text-xs rounded-full text-white"
            style={{ backgroundColor: tag.color }}
          >
            {tag.name}
          </span>
        ))}
      </div>
      <div className={`flex items-center shrink-0 ${isDesktop ? 'gap-2' : 'gap-1'}`}>
        {meeting.status === 'completed' && (
          <>
            {meeting.has_audio_file && (
              <button
                onClick={onShowSttConfirm}
                aria-label="STT 재생성"
                className="rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors px-3 py-1.5"
              >
                {isDesktop ? 'STT 재생성' : <RefreshCw className="w-4 h-4" />}
              </button>
            )}
            {transcriptsCount > 0 && (
              <button
                onClick={onShowNotesConfirm}
                disabled={isRegeneratingNotes}
                aria-label="회의록 재생성"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRegeneratingNotes ? (
                  <span className="flex items-center gap-1">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {isDesktop && '재생성 중...'}
                  </span>
                ) : (isDesktop ? '회의록 재생성' : <Bot className="w-4 h-4" />)}
              </button>
            )}
            <button
              onClick={onReopen}
              aria-label="회의 재개"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors"
            >
              {isDesktop ? '회의 재개' : <Play className="w-4 h-4" />}
            </button>
          </>
        )}
        {(meeting.status === 'pending' || meeting.status === 'recording') && (
          <button
            onClick={onGoLive}
            aria-label="회의 진행"
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            {isDesktop ? '회의 진행' : <Play className="w-4 h-4" />}
          </button>
        )}
        <ExportButton
          meetingId={meetingId}
          meetingTitle={meeting.title}
          meetingDate={meeting.started_at ?? meeting.created_at}
        />
        <button
          onClick={onDelete}
          aria-label="삭제"
          className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
        >
          {isDesktop ? '삭제' : <Trash2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}
