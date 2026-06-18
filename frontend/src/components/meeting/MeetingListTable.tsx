import { FolderClosed, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Lock, Star } from 'lucide-react'
import type { Meeting } from '../../api/meetings'
import type { FolderNode } from '../../api/folders'
import { initDrag } from '../../utils/dragState'
import { StatusBadge, MeetingTypeBadge, MeetingActionButtons } from './MeetingListUI'
import { formatDate, folderPath } from '../../lib/meetingFormat'
import { Tooltip } from '../ui/Tooltip'

type SortField = 'created_at' | 'title'
type SortDirection = 'asc' | 'desc'

interface MeetingListTableProps {
  childFolders: FolderNode[]
  meetings: Meeting[]
  searchQuery: string
  folders: FolderNode[]
  isDesktop: boolean
  meetingTypeMap: Record<string, string>
  sortField: SortField
  sortDirection: SortDirection
  onSort: (field: SortField) => void
  onFolderSelect: (id: number) => void
  onMeetingOpen: (id: number) => void
  onEdit: (m: Meeting) => void
  onMove: (m: Meeting) => void
  onMoveProject: (m: Meeting) => void
  onDelete: (m: Meeting) => void
  onStop: (m: Meeting) => void
  /** 중요 표시 토글. 미지정이면 별 토글 숨김. 잠긴 회의는 비활성(update 경유라 막힘). */
  onToggleImportant?: (m: Meeting) => void
}

export function MeetingListTable({
  childFolders,
  meetings,
  searchQuery,
  folders,
  isDesktop,
  meetingTypeMap,
  sortField,
  sortDirection,
  onSort,
  onFolderSelect,
  onMeetingOpen,
  onEdit,
  onMove,
  onMoveProject,
  onDelete,
  onStop,
  onToggleImportant,
}: MeetingListTableProps) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* 폴더 리스트 (검색 중에는 숨김) */}
      {!searchQuery && childFolders.length > 0 && (
        <div className="border-b">
          {childFolders.map((child, idx) => (
            <div
              key={`folder-${child.id}`}
              data-drop-folder-id={child.id}
              onPointerDown={(e) => initDrag('folder', child.id, e)}
              onClick={() => onFolderSelect(child.id)}
              className={`group flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                idx < childFolders.length - 1 ? 'border-b border-border/50' : ''
              }`}
            >
              <FolderClosed className="w-4 h-4 text-primary/70 shrink-0" />
              <span className="font-medium text-sm truncate">{child.name}</span>
              {child.tags?.length > 0 && (
                <div className="flex gap-1">
                  {child.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="text-[10px] px-1.5 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
              <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                회의 {child.meeting_count}개
                {child.children.length > 0 && ` · 하위 ${child.children.length}개`}
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
          ))}
        </div>
      )}

      {/* 회의 테이블 헤더 */}
      {meetings.length > 0 && (
        <>
          <div className="grid grid-cols-[1fr_80px_120px_80px_100px_140px] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/20">
            <button
              onClick={() => onSort('title')}
              className="flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              제목
              {sortField === 'title' ? (
                sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
              ) : (
                <ArrowUpDown className="w-3 h-3 opacity-50" />
              )}
            </button>
            <span>호스트</span>
            <button
              onClick={() => onSort('created_at')}
              className="flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              날짜
              {sortField === 'created_at' ? (
                sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
              ) : (
                <ArrowUpDown className="w-3 h-3 opacity-50" />
              )}
            </button>
            <span>상태</span>
            <span>유형</span>
            <span className="text-right">작업</span>
          </div>

          {/* 회의 리스트 행 */}
          {meetings.map((meeting, idx) => (
            <div
              key={meeting.id}
              onPointerDown={(e) => initDrag('meeting', meeting.id, e)}
              onClick={() => onMeetingOpen(meeting.id)}
              className={`group grid grid-cols-[1fr_80px_120px_80px_100px_140px] gap-2 items-center px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${
                idx < meetings.length - 1 ? 'border-b border-border/50' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {onToggleImportant && (
                    <Tooltip text={meeting.locked ? '잠긴 회의입니다' : meeting.important ? '중요 해제' : '중요 표시'}>
                      <button
                        type="button"
                        aria-label={meeting.important ? '중요 해제' : '중요 표시'}
                        disabled={meeting.locked}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleImportant(meeting)
                        }}
                        className="shrink-0 p-0.5 rounded hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Star
                          className={`w-4 h-4 ${meeting.important ? 'text-amber-500 fill-amber-500' : 'text-gray-300'}`}
                        />
                      </button>
                    </Tooltip>
                  )}
                  {meeting.locked && (
                    <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-label="잠긴 회의" />
                  )}
                  <span className="text-sm font-medium truncate">{meeting.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 flex items-center gap-0.5 shrink-0 max-w-[220px]">
                    <FolderClosed className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{meeting.folder_id ? (folderPath(folders, meeting.folder_id) ?? '폴더') : '미분류'}</span>
                  </span>
                  {meeting.tags?.map((tag) => (
                    <span
                      key={tag.id}
                      className="text-[10px] px-1.5 py-0.5 rounded-full text-white shrink-0"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
                {meeting.brief_summary && (
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{meeting.brief_summary}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground truncate">{meeting.created_by?.name || '-'}</span>
              <span className="text-xs text-muted-foreground">{formatDate(meeting.created_at)}</span>
              <StatusBadge status={meeting.status} />
              <MeetingTypeBadge type={meeting.meeting_type} typeMap={meetingTypeMap} />
              <div className="flex items-center justify-end gap-1">
                <MeetingActionButtons
                  meeting={meeting}
                  isDesktop={isDesktop}
                  onEdit={onEdit}
                  onMove={onMove}
                  onMoveProject={onMoveProject}
                  onDelete={onDelete}
                  onStop={onStop}
                  forceHoverOpacity
                />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
