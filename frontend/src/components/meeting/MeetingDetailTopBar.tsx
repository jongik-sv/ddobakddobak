import { type ReactNode } from 'react'
import { Pencil, ArrowLeft, StickyNote, Paperclip, Bookmark } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'

interface MeetingDetailTopBarProps {
  isDesktop: boolean
  hasMeeting: boolean
  attachmentsVisible: boolean
  memoVisible: boolean
  bookmarksVisible: boolean
  /** 회의 정보 수정 어포던스를 노출할지 (소유자 ∨ admin). 기본 true. */
  canEdit?: boolean
  onBack: () => void
  onToggleAttachments: () => void
  onShowEdit: () => void
  onToggleMemo: () => void
  onToggleBookmarks: () => void
  /** 우측 정렬 액션 버튼 슬롯(회의 진행/내보내기/삭제 등). 자체적으로 ml-auto 정렬. */
  actions?: ReactNode
}

/** 회의 상세 상단 툴바: 뒤로가기 + 미리보기 제목 + 첨부/메모/북마크 토글. */
export function MeetingDetailTopBar({
  isDesktop,
  hasMeeting,
  attachmentsVisible,
  memoVisible,
  bookmarksVisible,
  canEdit = true,
  onBack,
  onToggleAttachments,
  onShowEdit,
  onToggleMemo,
  onToggleBookmarks,
  actions,
}: MeetingDetailTopBarProps) {
  return (
    <div className={`bg-white border-b shrink-0 flex items-center ${isDesktop ? 'px-6 py-4 gap-3' : 'px-3 py-2 gap-2'}`}>
      <Tooltip text="목록으로 돌아가기">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
      </Tooltip>
      {/* 액션 버튼이 같은 줄 우측에 오므로 라벨은 비좁을 때 줄임표 처리(min-w-0 truncate). */}
      <h1 className={`font-bold text-gray-900 min-w-0 truncate ${isDesktop ? 'text-xl' : 'text-lg'}`}>회의 미리보기</h1>
      <Tooltip text={attachmentsVisible ? '첨부 숨기기' : '첨부 보기'}>
        <button
          onClick={onToggleAttachments}
          className={`p-1.5 rounded-md transition-colors ${attachmentsVisible ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
        >
          <Paperclip className="w-4 h-4" />
        </button>
      </Tooltip>
      {hasMeeting && canEdit && (
        <Tooltip text="회의 정보 수정">
          <button
            aria-label="회의 정보 수정"
            onClick={onShowEdit}
            className="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>
        </Tooltip>
      )}
      {/* 메모·북마크 토글은 데스크톱 패널 표시 전용 — 모바일은 탭으로 접근하므로 숨김 */}
      {isDesktop && (
        <>
          <Tooltip text={memoVisible ? '메모 숨기기' : '메모 보기'}>
            <button
              onClick={onToggleMemo}
              className={`p-1.5 rounded-md transition-colors ${memoVisible ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            >
              <StickyNote className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip text={bookmarksVisible ? '북마크 숨기기' : '북마크 보기'}>
            <button
              onClick={onToggleBookmarks}
              className={`p-1.5 rounded-md transition-colors ${bookmarksVisible ? 'text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            >
              <Bookmark className="w-4 h-4" />
            </button>
          </Tooltip>
        </>
      )}
      {actions}
    </div>
  )
}
