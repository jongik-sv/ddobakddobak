import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FolderClosed, LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, Search, X, Filter, Plus, UserPlus, Upload } from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { deleteMeeting, stopMeeting, updateMeeting } from '../api/meetings'
import { useMeetingStore } from '../stores/meetingStore'
import { useFolderStore } from '../stores/folderStore'
import { usePromptTemplateStore } from '../stores/promptTemplateStore'
import { BREAKPOINTS } from '../config'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { BottomSheet } from '../components/ui/BottomSheet'
import type { Meeting } from '../api/meetings'
import type { FolderNode } from '../api/folders'
import FolderBreadcrumb from '../components/folder/FolderBreadcrumb'
import MoveMeetingDialog from '../components/folder/MoveMeetingDialog'
import EditMeetingDialog from '../components/meeting/EditMeetingDialog'
import { JoinMeetingDialog } from '../components/meeting/JoinMeetingDialog'
import { MeetingsGridSkeleton } from '../components/ui/Skeleton'
import { initDrag } from '../utils/dragState'
import { CreateMeetingModal } from '../components/meeting/CreateMeetingModal'
import { UploadAudioModal } from '../components/meeting/UploadAudioModal'
import { StatusBadge, MeetingTypeBadge, StatusFilterTabs, MeetingActionButtons } from '../components/meeting/MeetingListUI'

type ViewMode = 'card' | 'list'
type SortField = 'created_at' | 'title'
type SortDirection = 'asc' | 'desc'

const VIEW_MODE_KEY = 'meetings-view-mode'

function getStoredViewMode(): ViewMode {
  const stored = localStorage.getItem(VIEW_MODE_KEY)
  return stored === 'list' ? 'list' : 'card'
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function folderName(folders: FolderNode[], id: number): string | null {
  for (const f of folders) {
    if (f.id === id) return f.name
    const found = folderName(f.children, id)
    if (found) return found
  }
  return null
}

export default function MeetingsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)
  const {
    meetings,
    meta,
    searchQuery,
    statusFilter,
    dateFrom,
    dateTo,
    folderId,
    isLoading,
    error,
    setSearchQuery,
    setStatusFilter,
    setDateFrom,
    setDateTo,
    fetchMeetings,
    addMeeting,
  } = useMeetingStore()

  const { folders, selectedFolderId } = useFolderStore()

  const [showModal, setShowModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showJoinDialog, setShowJoinDialog] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [movingMeeting, setMovingMeeting] = useState<Meeting | null>(null)
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode)
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    localStorage.setItem(VIEW_MODE_KEY, mode)
  }, [])

  const handleSort = useCallback((field: SortField) => {
    setSortDirection((prev) => (sortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'desc'))
    setSortField(field)
  }, [sortField])

  const sortedMeetings = useMemo(() => {
    if (viewMode !== 'list') return meetings
    return [...meetings].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1
      if (sortField === 'title') return dir * a.title.localeCompare(b.title, 'ko')
      return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    })
  }, [meetings, viewMode, sortField, sortDirection])

  const meetingTypeList = usePromptTemplateStore((s) => s.meetingTypeList)
  const meetingTypeMap = usePromptTemplateStore((s) => s.meetingTypeMap)

  // 현재 폴더 ID (number | null), 'all'일 때는 null
  const currentFolderId = typeof folderId === 'number' ? folderId : null

  // 동적 페이지 제목
  const pageTitle = useMemo(() => {
    if (selectedFolderId === 'all') return '전체 회의'
    if (selectedFolderId === null) return '폴더'
    return folderName(folders, selectedFolderId) ?? '회의 목록'
  }, [folders, selectedFolderId])

  // 하위 폴더 목록: '전체'/'폴더(null)'면 루트 폴더, 특정 폴더면 하위 폴더
  const childFolders = useMemo(() => {
    if (selectedFolderId === null) return folders
    if (selectedFolderId === 'all') return folders
    const find = (nodes: FolderNode[]): FolderNode[] => {
      for (const f of nodes) {
        if (f.id === selectedFolderId) return f.children
        const found = find(f.children)
        if (found.length > 0) return found
      }
      return []
    }
    return find(folders)
  }, [folders, selectedFolderId])

  // URL의 status 파라미터를 스토어에 반영
  useEffect(() => {
    const urlStatus = searchParams.get('status') || ''
    if (urlStatus !== statusFilter) {
      setStatusFilter(urlStatus)
    }
  }, [searchParams, setStatusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // 필터 변경 시 디바운스 후 fetch (folderId는 클릭 핸들러에서 직접 fetch하므로 제외)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMeetings(1)
      setCurrentPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, statusFilter, dateFrom, dateTo, fetchMeetings]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const prev = currentPage - 1
      setCurrentPage(prev)
      fetchMeetings(prev)
    }
  }

  const handleNextPage = () => {
    if (meta && currentPage < Math.ceil(meta.total / meta.per)) {
      const next = currentPage + 1
      setCurrentPage(next)
      fetchMeetings(next)
    }
  }

  const handleMoveMeeting = async (newFolderId: number | null) => {
    if (!movingMeeting) return
    await updateMeeting(movingMeeting.id, { folder_id: newFolderId })
    setMovingMeeting(null)
    fetchMeetings(currentPage)
  }

  const handleEditMeeting = async (data: { title: string; meeting_type: string; tag_ids: number[]; brief_summary: string | null; attendees: string | null }) => {
    if (!editingMeeting) return
    await updateMeeting(editingMeeting.id, data)
    setEditingMeeting(null)
    fetchMeetings(currentPage)
  }

  const handleStatusFilterSelect = useCallback((value: string) => {
    setStatusFilter(value)
    setSearchParams(value ? { status: value } : {}, { replace: true })
  }, [setStatusFilter, setSearchParams])

  const handleStopMeeting = useCallback(async (meeting: Meeting) => {
    await stopMeeting(meeting.id)
    fetchMeetings(currentPage)
  }, [fetchMeetings, currentPage])

  const handleDeleteMeeting = useCallback(async (meeting: Meeting) => {
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    const ok = await confirm(`"${meeting.title}" 회의를 삭제하시겠습니까?`, { title: '회의 삭제', kind: 'warning' })
    if (!ok) return
    await deleteMeeting(meeting.id)
    fetchMeetings(currentPage)
  }, [fetchMeetings, currentPage])

  const totalPages = meta ? Math.ceil(meta.total / meta.per) : 0

  return (
    <div className={`min-h-screen bg-background ${isDesktop ? 'p-8' : 'p-4'}`}>
      {/* 모바일 검색 바 확장 */}
      {!isDesktop && searchExpanded ? (
        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="회의 검색"
            className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
          <button
            data-testid="mobile-search-close"
            onClick={() => { setSearchExpanded(false); setSearchQuery('') }}
            className="p-2 rounded-md hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-4">
          <h1 className={`${isDesktop ? 'text-2xl' : 'text-xl'} font-bold`}>{pageTitle}</h1>
          <div className="flex items-center gap-2">
            {!isDesktop && (
              <>
                <button
                  data-testid="mobile-search-toggle"
                  onClick={() => setSearchExpanded(true)}
                  className="p-2 rounded-md hover:bg-muted transition-colors"
                >
                  <Search className="w-5 h-5" />
                </button>
                <button
                  data-testid="mobile-filter-toggle"
                  onClick={() => setFilterSheetOpen(true)}
                  className="p-2 rounded-md hover:bg-muted transition-colors"
                >
                  <Filter className="w-5 h-5" />
                </button>
                <button
                  data-testid="mobile-join-meeting"
                  onClick={() => setShowJoinDialog(true)}
                  className="p-2 rounded-md hover:bg-muted transition-colors"
                  title="회의 참여 (공유 코드)"
                  aria-label="회의 참여"
                >
                  <UserPlus className="w-5 h-5" />
                </button>
                <button
                  data-testid="mobile-upload-audio"
                  onClick={() => setShowUploadModal(true)}
                  className="p-2 rounded-md hover:bg-muted transition-colors"
                  title="오디오 파일 업로드"
                  aria-label="오디오 업로드"
                >
                  <Upload className="w-5 h-5" />
                </button>
              </>
            )}
            {isDesktop && (
              <>
                <button
                  onClick={() => setShowJoinDialog(true)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  회의 참여
                </button>
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  오디오 업로드
                </button>
                <button
                  onClick={() => setShowModal(true)}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
                >
                  새 회의
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 폴더 경로 */}
      <FolderBreadcrumb />

      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {/* 하위 폴더 — 회의 카드와 같은 그리드에 표시되도록 아래 그리드에 통합 */}

      {/* 상태 필터 탭 (데스크톱만) */}
      {isDesktop && (
        <div className="flex items-center gap-1 mb-4">
          <StatusFilterTabs statusFilter={statusFilter} onSelect={handleStatusFilterSelect} />
        </div>
      )}

      {/* 뷰 모드 토글 + 필터 영역 */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center rounded-md border bg-muted/30 p-0.5">
          <Tooltip text="카드 뷰">
            <button
              onClick={() => handleViewModeChange('card')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'card' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip text="리스트 뷰">
            <button
              onClick={() => handleViewModeChange('list')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'list' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 검색 + 날짜 필터 (데스크톱만) */}
      {isDesktop && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="회의 검색"
            className="flex-1 min-w-[200px] rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground">~</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo('') }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              날짜 초기화
            </button>
          )}
        </div>
      )}

      {/* 모바일 필터 BottomSheet */}
      {!isDesktop && (
        <BottomSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="필터">
          <div className="space-y-4">
            {/* 상태 필터 */}
            <div>
              <h3 className="text-sm font-medium mb-2">상태</h3>
              <div className="flex flex-wrap gap-2">
                <StatusFilterTabs statusFilter={statusFilter} onSelect={handleStatusFilterSelect} />
              </div>
            </div>

            {/* 날짜 필터 */}
            <div>
              <h3 className="text-sm font-medium mb-2">날짜</h3>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-sm text-muted-foreground">~</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {/* 초기화 버튼 */}
            <button
              onClick={() => {
                setStatusFilter('')
                setDateFrom('')
                setDateTo('')
                setSearchParams({}, { replace: true })
              }}
              className="w-full rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              초기화
            </button>
          </div>
        </BottomSheet>
      )}

      {/* 폴더 + 회의 목록 */}
      {isLoading && meetings.length === 0 ? (
        <MeetingsGridSkeleton />
      ) : childFolders.length === 0 && meetings.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">회의가 없습니다.</div>
      ) : viewMode === 'card' ? (
        /* ─── 카드 뷰 ─── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* 폴더 카드 (검색 중에는 숨김) */}
          {!searchQuery && childFolders.map((child) => (
            <div
              key={`folder-${child.id}`}
              data-drop-folder-id={child.id}
              onPointerDown={(e) => initDrag('folder', child.id, e)}
              onClick={() => {
                useFolderStore.getState().setSelectedFolder(child.id)
                useMeetingStore.getState().setFolderId(child.id)
                fetchMeetings(1)
              }}
              className="group rounded-lg border bg-card p-4 cursor-pointer hover:bg-muted/50 hover:shadow-sm transition-all flex flex-col"
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
              onClick={() => navigate(`/meetings/${meeting.id}`)}
              className="group rounded-lg border bg-card p-4 cursor-pointer hover:bg-muted/50 hover:shadow-sm transition-all flex flex-col min-h-[180px]"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-medium text-sm line-clamp-2">{meeting.title}</h3>
                  <StatusBadge status={meeting.status} />
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  <MeetingTypeBadge type={meeting.meeting_type} typeMap={meetingTypeMap} />
                  {meeting.folder_id && selectedFolderId === 'all' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 flex items-center gap-1">
                      <FolderClosed className="w-3 h-3" />
                      {folderName(folders, meeting.folder_id) ?? '폴더'}
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
                  <span>{formatDate(meeting.created_at)}</span>
                  {meeting.created_by?.name && (
                    <span className="truncate max-w-[100px]">{meeting.created_by.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-1" data-testid="card-actions">
                  <MeetingActionButtons
                    meeting={meeting}
                    isDesktop={isDesktop}
                    onEdit={setEditingMeeting}
                    onMove={setMovingMeeting}
                    onDelete={handleDeleteMeeting}
                    onStop={handleStopMeeting}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ─── 리스트 뷰 ─── */
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* 폴더 리스트 (검색 중에는 숨김) */}
          {!searchQuery && childFolders.length > 0 && (
            <div className="border-b">
              {childFolders.map((child, idx) => (
                <div
                  key={`folder-${child.id}`}
                  data-drop-folder-id={child.id}
                  onPointerDown={(e) => initDrag('folder', child.id, e)}
                  onClick={() => {
                    useFolderStore.getState().setSelectedFolder(child.id)
                    useMeetingStore.getState().setFolderId(child.id)
                    fetchMeetings(1)
                  }}
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
          {sortedMeetings.length > 0 && (
            <>
              <div className="grid grid-cols-[1fr_80px_120px_80px_100px_140px] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/20">
                <button
                  onClick={() => handleSort('title')}
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
                  onClick={() => handleSort('created_at')}
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
              {sortedMeetings.map((meeting, idx) => (
                <div
                  key={meeting.id}
                  onPointerDown={(e) => initDrag('meeting', meeting.id, e)}
                  onClick={() => navigate(`/meetings/${meeting.id}`)}
                  className={`group grid grid-cols-[1fr_80px_120px_80px_100px_140px] gap-2 items-center px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${
                    idx < sortedMeetings.length - 1 ? 'border-b border-border/50' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{meeting.title}</span>
                      {meeting.folder_id && selectedFolderId === 'all' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 flex items-center gap-0.5 shrink-0">
                          <FolderClosed className="w-2.5 h-2.5" />
                          {folderName(folders, meeting.folder_id) ?? '폴더'}
                        </span>
                      )}
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
                      onEdit={setEditingMeeting}
                      onMove={setMovingMeeting}
                      onDelete={handleDeleteMeeting}
                      onStop={handleStopMeeting}
                      forceHoverOpacity
                    />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            이전
          </button>
          <span className="text-sm text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={handleNextPage}
            disabled={currentPage >= totalPages}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            다음
          </button>
        </div>
      )}

      {/* 회의 생성 모달 */}
      {showModal && (
        <CreateMeetingModal
          folderId={currentFolderId}
          meetingTypeList={meetingTypeList}
          onClose={() => setShowModal(false)}
          onCreated={(meeting) => {
            addMeeting(meeting)
            navigate(`/meetings/${meeting.id}/live`)
          }}
        />
      )}

      {/* 오디오 파일 업로드 모달 */}
      {showUploadModal && (
        <UploadAudioModal
          folderId={currentFolderId}
          meetingTypeList={meetingTypeList}
          onClose={() => setShowUploadModal(false)}
          onCreated={(meeting) => {
            addMeeting(meeting)
            navigate(`/meetings/${meeting.id}`)
          }}
        />
      )}

      {/* 폴더 이동 다이얼로그 */}
      {movingMeeting && (
        <MoveMeetingDialog
          meetingTitle={movingMeeting.title}
          currentFolderId={movingMeeting.folder_id}
          onConfirm={handleMoveMeeting}
          onClose={() => setMovingMeeting(null)}
        />
      )}

      {/* 회의 정보 수정 다이얼로그 */}
      {editingMeeting && (
        <EditMeetingDialog
          meeting={editingMeeting}
          meetingTypeList={meetingTypeList}
          onConfirm={handleEditMeeting}
          onClose={() => setEditingMeeting(null)}
        />
      )}

      {/* 회의 참여 다이얼로그 */}
      <JoinMeetingDialog
        open={showJoinDialog}
        onClose={() => setShowJoinDialog(false)}
      />

      {/* 모바일 FAB (새 회의) */}
      {!isDesktop && (
        <button
          data-testid="fab-new-meeting"
          onClick={() => setShowModal(true)}
          className="fixed right-4 bottom-20 z-40 rounded-full bg-primary p-4 text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
          aria-label="새 회의"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}
    </div>
  )
}
