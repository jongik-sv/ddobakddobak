import { FolderClosed, Star, Lock } from 'lucide-react'
import type { Meeting } from '../../api/meetings'
import type { FolderNode } from '../../api/folders'
import type { SelectedFolder } from '../../stores/folderStore'
import { initDrag } from '../../utils/dragState'
import { StatusBadge, MeetingTypeBadge, MeetingActionButtons } from './MeetingListUI'
import { formatDate, folderPath } from '../../lib/meetingFormat'
import { useAuthStore } from '../../stores/authStore'
import { Tooltip } from '../ui/Tooltip'

interface MeetingCardGridProps {
  childFolders: FolderNode[]
  meetings: Meeting[]
  searchQuery: string
  folders: FolderNode[]
  selectedFolderId: SelectedFolder
  isDesktop: boolean
  meetingTypeMap: Record<string, string>
  onFolderSelect: (id: number) => void
  onMeetingOpen: (id: number) => void
  onEdit: (m: Meeting) => void
  onMove: (m: Meeting) => void
  onMoveProject: (m: Meeting) => void
  onDelete: (m: Meeting) => void
  onStop: (m: Meeting) => void
  /** 중요 표시 토글. 미지정이면 별 토글 숨김. 잠긴 회의는 비활성. */
  onToggleImportant?: (m: Meeting) => void
}

export function MeetingCardGrid({
  childFolders,
  meetings,
  searchQuery,
  folders,
  selectedFolderId,
  isDesktop,
  meetingTypeMap,
  onFolderSelect,
  onMeetingOpen,
  onEdit,
  onMove,
  onMoveProject,
  onDelete,
  onStop,
  onToggleImportant,
}: MeetingCardGridProps) {
  const me = useAuthStore((s) => s.user)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {/* 폴더 카드 (검색 중에는 숨김) */}
      {!searchQuery && childFolders.map((child) => (
        <div
          key={`folder-${child.id}`}
          data-drop-folder-id={child.id}
          onPointerDown={(e) => initDrag('folder', child.id, e)}
          onClick={() => onFolderSelect(child.id)}
          className={`group rounded-lg border bg-card p-4 cursor-pointer hover:bg-muted/50 hover:shadow-sm transition-all flex flex-col ${isDesktop ? 'h-[250px]' : 'h-[160px]'} overflow-hidden`}
        >
          <div className="flex items-center gap-2 mb-2">
            <FolderClosed className="w-5 h-5 text-primary/70 shrink-0" />
            <h3 className="font-medium text-sm truncate">{child.name}</h3>
          </div>
          {child.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
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
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-auto pt-2 border-t border-border/50">
            <span>회의 {child.meeting_count}개</span>
            {child.children.length > 0 && <span>하위 폴더 {child.children.length}개</span>}
          </div>
        </div>
      ))}

      {/* 회의 카드 */}
      {meetings.map((meeting) => (
        <div
          key={meeting.id}
          onPointerDown={(e) => initDrag('meeting', meeting.id, e)}
          onClick={() => onMeetingOpen(meeting.id)}
          className={`group rounded-lg border bg-card p-4 cursor-pointer hover:bg-muted/50 hover:shadow-sm transition-all flex flex-col ${isDesktop ? 'h-[250px]' : 'h-[160px]'} overflow-hidden`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-start gap-1.5 min-w-0">
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
                      className="shrink-0 mt-0.5 p-0.5 rounded hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Star
                        className={`w-4 h-4 ${meeting.important ? 'text-amber-500 fill-amber-500' : 'text-gray-300'}`}
                      />
                    </button>
                  </Tooltip>
                )}
                {meeting.locked && (
                  <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" aria-label="잠긴 회의" />
                )}
                <h3 className="font-medium text-sm line-clamp-2">{meeting.title}</h3>
              </div>
              <StatusBadge status={meeting.status} />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <MeetingTypeBadge type={meeting.meeting_type} typeMap={meetingTypeMap} />
              {meeting.folder_id && selectedFolderId === 'all' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 flex items-center gap-1 min-w-0 max-w-[180px]">
                  <FolderClosed className="w-3 h-3 shrink-0" />
                  <span className="truncate">{folderPath(folders, meeting.folder_id) ?? '폴더'}</span>
                </span>
              )}
              {meeting.tags?.map((tag) => (
                <span
                  key={tag.id}
                  className="text-xs px-2 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
            {meeting.brief_summary && (
              <p className={`text-xs text-muted-foreground ${isDesktop ? 'line-clamp-5' : 'line-clamp-1'} mb-2 leading-relaxed`}>
                {meeting.brief_summary}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="whitespace-nowrap shrink-0">{formatDate(meeting.created_at)}</span>
              {meeting.created_by?.name && (
                <span className="truncate max-w-[120px]">
                  {me && meeting.created_by.id !== me.id ? `by ${meeting.created_by.name}` : meeting.created_by.name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1" data-testid="card-actions">
              <MeetingActionButtons
                meeting={meeting}
                isDesktop={isDesktop}
                onEdit={onEdit}
                onMove={onMove}
                onMoveProject={onMoveProject}
                onDelete={onDelete}
                onStop={onStop}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
