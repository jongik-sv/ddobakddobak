import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LayoutGrid, List, Plus } from 'lucide-react'
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
import { CreateMeetingModal } from '../components/meeting/CreateMeetingModal'
import { UploadAudioModal } from '../components/meeting/UploadAudioModal'
import { StatusFilterTabs } from '../components/meeting/MeetingListUI'
import { MeetingCardGrid } from '../components/meeting/MeetingCardGrid'
import { MeetingListTable } from '../components/meeting/MeetingListTable'
import { MeetingsHeader } from '../components/meeting/MeetingsHeader'
import { folderName } from '../lib/meetingFormat'

type ViewMode = 'card' | 'list'
type SortField = 'created_at' | 'title'
type SortDirection = 'asc' | 'desc'

const VIEW_MODE_KEY = 'meetings-view-mode'

function getStoredViewMode(): ViewMode {
  const stored = localStorage.getItem(VIEW_MODE_KEY)
  return stored === 'list' ? 'list' : 'card'
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

  const handleFolderSelect = useCallback((id: number) => {
    useFolderStore.getState().setSelectedFolder(id)
    useMeetingStore.getState().setFolderId(id)
    fetchMeetings(1)
  }, [fetchMeetings])

  const handleMeetingOpen = useCallback((id: number) => {
    navigate(`/meetings/${id}`)
  }, [navigate])

  const totalPages = meta ? Math.ceil(meta.total / meta.per) : 0

  return (
    <div className={`min-h-screen bg-background ${isDesktop ? 'p-8' : 'p-4'}`}>
      <MeetingsHeader
        isDesktop={isDesktop}
        searchExpanded={searchExpanded}
        searchQuery={searchQuery}
        pageTitle={pageTitle}
        onSearchChange={setSearchQuery}
        onSearchExpand={() => setSearchExpanded(true)}
        onSearchClose={() => { setSearchExpanded(false); setSearchQuery('') }}
        onOpenFilterSheet={() => setFilterSheetOpen(true)}
        onJoinMeeting={() => setShowJoinDialog(true)}
        onUploadAudio={() => setShowUploadModal(true)}
        onCreateMeeting={() => setShowModal(true)}
      />

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
        <MeetingCardGrid
          childFolders={childFolders}
          meetings={meetings}
          searchQuery={searchQuery}
          folders={folders}
          selectedFolderId={selectedFolderId}
          isDesktop={isDesktop}
          meetingTypeMap={meetingTypeMap}
          onFolderSelect={handleFolderSelect}
          onMeetingOpen={handleMeetingOpen}
          onEdit={setEditingMeeting}
          onMove={setMovingMeeting}
          onDelete={handleDeleteMeeting}
          onStop={handleStopMeeting}
        />
      ) : (
        <MeetingListTable
          childFolders={childFolders}
          meetings={sortedMeetings}
          searchQuery={searchQuery}
          folders={folders}
          selectedFolderId={selectedFolderId}
          isDesktop={isDesktop}
          meetingTypeMap={meetingTypeMap}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          onFolderSelect={handleFolderSelect}
          onMeetingOpen={handleMeetingOpen}
          onEdit={setEditingMeeting}
          onMove={setMovingMeeting}
          onDelete={handleDeleteMeeting}
          onStop={handleStopMeeting}
        />
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
