import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LayoutGrid, List, Plus, Eye, EyeOff } from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { deleteMeeting, stopMeeting, updateMeeting, setMeetingImportant } from '../api/meetings'
import { useMeetingStore } from '../stores/meetingStore'
import { useFolderStore } from '../stores/folderStore'
import { paramToFolder } from '../lib/folderNav'
import { usePromptTemplateStore } from '../stores/promptTemplateStore'
import { BREAKPOINTS, IS_TAURI } from '../config'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useMeetingsFolderView } from '../hooks/useMeetingsFolderView'
import { BottomSheet } from '../components/ui/BottomSheet'
import type { Meeting } from '../api/meetings'
import FolderBreadcrumb from '../components/folder/FolderBreadcrumb'
import MoveMeetingDialog from '../components/folder/MoveMeetingDialog'
import MoveToProjectModal from '../components/project/MoveToProjectModal'
import { useProjectStore } from '../stores/projectStore'
import EditMeetingDialog, { type EditMeetingData } from '../components/meeting/EditMeetingDialog'
import ExportMeetingDialog from '../components/meeting/ExportMeetingDialog'
import { MeetingsGridSkeleton } from '../components/ui/Skeleton'
import { CreateMeetingModal } from '../components/meeting/CreateMeetingModal'
import { UploadAudioModal } from '../components/meeting/UploadAudioModal'
import { StatusFilterTabs } from '../components/meeting/MeetingListUI'
import { MeetingCardGrid } from '../components/meeting/MeetingCardGrid'
import { MeetingListTable } from '../components/meeting/MeetingListTable'
import { MeetingsHeader } from '../components/meeting/MeetingsHeader'
import ImportTransferButton from '../components/transfer/ImportTransferButton'
import { folderName } from '../lib/meetingFormat'
import { useUiStore } from '../stores/uiStore'
import { VIEW_MODE_KEY, getStoredViewMode, type ViewMode, type SortField, type SortDirection } from './meetings/types'

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
    showAll,
    isLoading,
    isRefreshing,
    error,
    setSearchQuery,
    setStatusFilter,
    setDateFrom,
    setDateTo,
    toggleShowAll,
    fetchMeetings,
    addMeeting,
    setFolderId,
  } = useMeetingStore()

  const { folders, selectedFolderId, setSelectedFolder } = useFolderStore()

  const { pageTitle, childFolders, handleFolderSelect, handleMeetingOpen } = useMeetingsFolderView({ folders, selectedFolderId, navigate })

  const [showModal, setShowModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [movingMeeting, setMovingMeeting] = useState<Meeting | null>(null)
  const [movingProjectMeeting, setMovingProjectMeeting] = useState<Meeting | null>(null)
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null)
  const [exportingMeeting, setExportingMeeting] = useState<Meeting | null>(null)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const openFolderChat = useUiStore((s) => s.openFolderChat)

  // "폴더에게 묻기" 대상 폴더 id — selectedFolderId가 'all'/null이면 폴더 스코프 없음(프로젝트 전체).
  const askFolderId = typeof selectedFolderId === 'number' ? selectedFolderId : null
  const canAsk = !!(askFolderId || currentProjectId)

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

  // URL의 status 파라미터를 스토어에 반영
  useEffect(() => {
    const urlStatus = searchParams.get('status') || ''
    if (urlStatus !== statusFilter) {
      setStatusFilter(urlStatus)
    }
  }, [searchParams, setStatusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // URL의 folder 파라미터를 폴더 선택 상태에 반영(단일 소스).
  // 브라우저 뒤로/앞으로가기 시 react-router가 searchParams를 갱신 → 부모 폴더로 복원.
  // 실제 fetch는 아래 디바운스 effect(folderId 의존)가 담당한다.
  useEffect(() => {
    const target = paramToFolder(searchParams.get('folder'))
    if (selectedFolderId !== target) setSelectedFolder(target)
    if (folderId !== target) setFolderId(target)
  }, [searchParams, selectedFolderId, folderId, setSelectedFolder, setFolderId])

  // 이전 folderId를 기억 — 폴더 전환은 지연 없이 즉시 fetch(깜빡임 방지),
  // 검색어/상태/날짜 필터 변경은 기존 300ms 디바운스를 유지한다.
  const prevFolderIdRef = useRef(folderId)

  // 필터 변경 시 디바운스 후 fetch (folderId 포함 — 폴더 선택은 URL→folderId로 반영됨)
  useEffect(() => {
    const folderChanged = prevFolderIdRef.current !== folderId
    prevFolderIdRef.current = folderId
    const delay = folderChanged ? 0 : 300
    const timer = setTimeout(() => {
      fetchMeetings(1)
      setCurrentPage(1)
    }, delay)
    return () => clearTimeout(timer)
  }, [searchQuery, statusFilter, dateFrom, dateTo, folderId, fetchMeetings]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleEditMeeting = async (data: EditMeetingData) => {
    if (!editingMeeting) return
    // EditMeetingData 는 예약 트리플(pending 시)을 포함 → updateMeeting(PATCH)에 그대로 전달.
    await updateMeeting(editingMeeting.id, data)
    setEditingMeeting(null)
    // 목록 재조회 → 예약 배지/시각이 새로고침 없이 갱신된다.
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
    let ok: boolean
    if (IS_TAURI) {
      const { confirm } = await import('@tauri-apps/plugin-dialog')
      ok = await confirm(`"${meeting.title}" 회의를 휴지통으로 이동합니다. 계속할까요?`, { title: '회의 삭제', kind: 'warning' })
    } else {
      ok = window.confirm(`"${meeting.title}" 회의를 휴지통으로 이동합니다. 계속할까요?`)
    }
    if (!ok) return
    try {
      await deleteMeeting(meeting.id)
      fetchMeetings(currentPage)
    } catch (e) {
      console.error('[deleteMeeting] 실패:', e)
    }
  }, [fetchMeetings, currentPage])

  // 중요 표시 토글: setMeetingImportant(update 경유) 후 목록 갱신.
  const handleToggleImportant = useCallback(async (meeting: Meeting) => {
    try {
      await setMeetingImportant(meeting.id, !meeting.important)
    } catch (e) {
      console.error('[toggleImportant] 실패:', e)
    }
    fetchMeetings(currentPage)
  }, [fetchMeetings, currentPage])

  // 전체 보기 토글: showAll 켜면 important=false 회의도 노출 → 1페이지부터 재조회.
  const handleToggleShowAll = useCallback(() => {
    toggleShowAll()
    setCurrentPage(1)
    fetchMeetings(1)
  }, [toggleShowAll, fetchMeetings])

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
        onUploadAudio={() => setShowUploadModal(true)}
        onCreateMeeting={() => setShowModal(true)}
        onAskFolder={() => openFolderChat({
          folderId: askFolderId,
          projectId: currentProjectId,
          folderName: askFolderId != null ? folderName(folders, askFolderId) ?? undefined : undefined,
        })}
        canAsk={canAsk}
      />

      {/* 폴더 경로 */}
      <FolderBreadcrumb />

      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {/* 하위 폴더 — 회의 카드와 같은 그리드에 표시되도록 아래 그리드에 통합 */}

      {/* 상태 필터 탭 + 전체 보기 토글 (데스크톱만) */}
      {isDesktop && (
        <div className="flex items-center gap-1 mb-4">
          <StatusFilterTabs statusFilter={statusFilter} onSelect={handleStatusFilterSelect} />
          <Tooltip text={showAll ? '중요 회의만 보기' : '전체 회의 보기'}>
            <button
              type="button"
              onClick={handleToggleShowAll}
              aria-pressed={showAll}
              className={`ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                showAll
                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                  : 'bg-card text-foreground border-border hover:bg-muted'
              }`}
            >
              {showAll ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              전체 보기
            </button>
          </Tooltip>
        </div>
      )}

      {/* 뷰 모드 토글 + 가져오기 버튼 */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center rounded-md border bg-muted/30 p-0.5">
          <Tooltip text="카드 뷰">
            <button
              onClick={() => handleViewModeChange('card')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'card' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip text="리스트 뷰">
            <button
              onClick={() => handleViewModeChange('list')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'list' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
        {/* 회의·폴더 가져오기(.tgz) — 현재 프로젝트에만 표시 */}
        {currentProjectId != null && (
          <ImportTransferButton
            projectId={currentProjectId}
            folderId={currentFolderId ?? undefined}
            onImported={() => {
              useFolderStore.getState().fetchFolders()
              fetchMeetings(currentPage)
            }}
          />
        )}
      </div>

      {/* 검색 + 날짜 필터 (데스크톱만) */}
      {isDesktop && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="제목·요약·전사 내용 검색"
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

            {/* 전체 보기 토글 */}
            <div>
              <h3 className="text-sm font-medium mb-2">표시 범위</h3>
              <button
                type="button"
                onClick={handleToggleShowAll}
                aria-pressed={showAll}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                  showAll
                    ? 'bg-amber-50 text-amber-700 border-amber-300'
                    : 'bg-card text-foreground border-border'
                }`}
              >
                {showAll ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                {showAll ? '전체 회의 표시 중' : '중요 회의만 표시'}
              </button>
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
        <div
          aria-hidden={isRefreshing}
          className={
            isRefreshing
              ? 'text-center py-8 text-muted-foreground opacity-0 transition-opacity duration-200 delay-150'
              : 'text-center py-8 text-muted-foreground opacity-100 transition-opacity duration-200'
          }
        >
          회의가 없습니다.
        </div>
      ) : (
        <div
          className={
            isRefreshing
              ? 'opacity-60 transition-opacity duration-200 delay-150'
              : 'opacity-100 transition-opacity duration-200'
          }
        >
          {viewMode === 'card' ? (
            <MeetingCardGrid
              childFolders={childFolders}
              meetings={meetings}
              searchQuery={searchQuery}
              folders={folders}
              isDesktop={isDesktop}
              meetingTypeMap={meetingTypeMap}
              onFolderSelect={handleFolderSelect}
              onMeetingOpen={handleMeetingOpen}
              onEdit={setEditingMeeting}
              onMove={setMovingMeeting}
              onMoveProject={setMovingProjectMeeting}
              onDelete={handleDeleteMeeting}
              onStop={handleStopMeeting}
              onExport={setExportingMeeting}
              onToggleImportant={handleToggleImportant}
            />
          ) : (
            <MeetingListTable
              childFolders={childFolders}
              meetings={sortedMeetings}
              searchQuery={searchQuery}
              folders={folders}
              isDesktop={isDesktop}
              meetingTypeMap={meetingTypeMap}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              onFolderSelect={handleFolderSelect}
              onMeetingOpen={handleMeetingOpen}
              onEdit={setEditingMeeting}
              onMove={setMovingMeeting}
              onMoveProject={setMovingProjectMeeting}
              onDelete={handleDeleteMeeting}
              onStop={handleStopMeeting}
              onExport={setExportingMeeting}
              onToggleImportant={handleToggleImportant}
            />
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
            // 예약 회의는 라이브로 점프하지 않고 목록에 추가만(스케줄러가 예약 시각에 시작).
            if (!meeting.scheduled_start_time) navigate(`/meetings/${meeting.id}/live`)
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

      {/* 프로젝트 이동 모달 */}
      {movingProjectMeeting && currentProjectId != null && (
        <MoveToProjectModal
          mode="meetings"
          meetingIds={[movingProjectMeeting.id]}
          sourceProjectId={currentProjectId}
          title={movingProjectMeeting.title}
          onClose={() => setMovingProjectMeeting(null)}
          onMoved={() => fetchMeetings(currentPage)}
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

      {/* 회의 내보내기(.tgz) 다이얼로그 */}
      {exportingMeeting && (
        <ExportMeetingDialog meeting={exportingMeeting} onClose={() => setExportingMeeting(null)} />
      )}

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
