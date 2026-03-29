import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FolderClosed, FolderInput, Pencil } from 'lucide-react'
import { getTeams } from '../api/teams'
import { createMeeting, stopMeeting, updateMeeting, uploadAudioFile } from '../api/meetings'
import { getPromptTemplates } from '../api/promptTemplates'
import type { PromptTemplate } from '../api/promptTemplates'
import { useMeetingStore } from '../stores/meetingStore'
import { useFolderStore } from '../stores/folderStore'
import { MEETING_TYPES, IS_TAURI } from '../config'
import type { Meeting } from '../api/meetings'
import type { FolderNode } from '../api/folders'
import FolderBreadcrumb from '../components/folder/FolderBreadcrumb'
import MoveMeetingDialog from '../components/folder/MoveMeetingDialog'
import EditMeetingDialog from '../components/meeting/EditMeetingDialog'
import { initDrag } from '../utils/dragState'

const STATIC_TYPE_MAP: Record<string, string> = Object.fromEntries(
  MEETING_TYPES.map((t) => [t.value, t.label]),
)

function StatusBadge({ status }: { status: Meeting['status'] }) {
  if (status === 'pending') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
        대기중
      </span>
    )
  }
  if (status === 'recording') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1">
        <span className="inline-block w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
        녹음중
      </span>
    )
  }
  if (status === 'transcribing') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1">
        <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
        변환중
      </span>
    )
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
      완료
    </span>
  )
}

function MeetingTypeBadge({ type, typeMap }: { type: string; typeMap: Record<string, string> }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
      {typeMap[type] ?? type}
    </span>
  )
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

interface CreateMeetingModalProps {
  defaultTeamId: number
  folderId: number | null
  meetingTypeList: { value: string; label: string }[]
  onClose: () => void
  onCreated: (meeting: Meeting) => void
}

function CreateMeetingModal({ defaultTeamId, folderId, meetingTypeList, onClose, onCreated }: CreateMeetingModalProps) {
  const [title, setTitle] = useState('')
  const [meetingType, setMeetingType] = useState('general')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    setError('')
    try {
      const meeting = await createMeeting({
        title: title.trim(),
        team_id: defaultTeamId,
        meeting_type: meetingType,
        folder_id: folderId,
      })
      onCreated(meeting)
      onClose()
    } catch {
      setError('회의 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-gray-100">
        <h2 className="text-lg font-semibold mb-4">새 회의 만들기</h2>

        {error && (
          <div role="alert" className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">회의 제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="회의 제목을 입력하세요"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">회의 유형</label>
            <div className="flex flex-wrap gap-2">
              {meetingTypeList.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setMeetingType(t.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    meetingType === t.value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              생성
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const ACCEPTED_AUDIO_TYPES = '.mp3,.wav,.m4a,.webm,.ogg,.flac,.aac,.mp4'

interface UploadAudioModalProps {
  defaultTeamId: number
  folderId: number | null
  meetingTypeList: { value: string; label: string }[]
  onClose: () => void
  onCreated: (meeting: Meeting) => void
}

function UploadAudioModal({ defaultTeamId, folderId, meetingTypeList, onClose, onCreated }: UploadAudioModalProps) {
  const [title, setTitle] = useState('')
  const [meetingType, setMeetingType] = useState('general')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const handleFile = (f: File) => {
    setFile(f)
    if (!title.trim()) {
      const name = f.name.replace(/\.[^.]+$/, '')
      setTitle(name)
    }
  }

  const handleTauriFileSelect = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'flac', 'aac', 'mp4'] }],
    })
    if (!selected || typeof selected !== 'string') return
    const filePath = selected
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(filePath)
    const name = filePath.split('/').pop() ?? 'audio'
    const ext = name.split('.').pop()?.toLowerCase() ?? 'webm'
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
      webm: 'audio/webm', ogg: 'audio/ogg', flac: 'audio/flac',
      aac: 'audio/aac', mp4: 'audio/mp4',
    }
    const blob = new Blob([bytes], { type: mimeMap[ext] ?? 'audio/webm' })
    const nativeFile = new File([blob], name, { type: blob.type })
    handleFile(nativeFile)
  }

  const handleDropZoneClick = () => {
    if (IS_TAURI) {
      handleTauriFileSelect()
    } else {
      document.getElementById('audio-file-input')?.click()
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !title.trim()) return
    setLoading(true)
    setError('')
    try {
      const meeting = await uploadAudioFile({
        title: title.trim(),
        team_id: defaultTeamId,
        meeting_type: meetingType,
        audio: file,
      })
      // 폴더가 있으면 이동
      if (folderId) {
        await updateMeeting(meeting.id, { folder_id: folderId })
        meeting.folder_id = folderId
      }
      onCreated(meeting)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '업로드에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-gray-100">
        <h2 className="text-lg font-semibold mb-4">오디오 파일로 회의록 작성</h2>

        {error && (
          <div role="alert" className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 파일 드롭존 */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
            }`}
            onClick={handleDropZoneClick}
          >
            <input
              id="audio-file-input"
              type="file"
              accept={ACCEPTED_AUDIO_TYPES}
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-900 truncate max-w-[250px]">{file.name}</p>
                  <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFile(null) }}
                  className="ml-2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div>
                <svg className="w-8 h-8 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-gray-600">오디오 파일을 드래그하거나 클릭하여 선택</p>
                <p className="text-xs text-gray-400 mt-1">MP3, WAV, M4A, WebM, OGG, FLAC</p>
              </div>
            )}
          </div>

          {/* 제목 */}
          <div>
            <label className="block text-sm font-medium mb-1">회의 제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="회의 제목을 입력하세요"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* 회의 유형 */}
          <div>
            <label className="block text-sm font-medium mb-2">회의 유형</label>
            <div className="flex flex-wrap gap-2">
              {meetingTypeList.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setMeetingType(t.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    meetingType === t.value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading || !file || !title.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? '업로드 중...' : '업로드 및 변환'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
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

  const [defaultTeamId, setDefaultTeamId] = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [movingMeeting, setMovingMeeting] = useState<Meeting | null>(null)
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null)
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([])

  // 현재 폴더 ID (number | null), 'all'일 때는 null
  const currentFolderId = typeof folderId === 'number' ? folderId : null

  // 동적 페이지 제목
  const pageTitle = useMemo(() => {
    if (selectedFolderId === 'all') return '전체 회의'
    if (selectedFolderId === null) return '미분류'
    const find = (nodes: FolderNode[]): string | null => {
      for (const f of nodes) {
        if (f.id === selectedFolderId) return f.name
        const found = find(f.children)
        if (found) return found
      }
      return null
    }
    return find(folders) ?? '회의 목록'
  }, [folders, selectedFolderId])

  // 하위 폴더 목록: '전체'면 루트 폴더, 특정 폴더면 하위 폴더
  const childFolders = useMemo(() => {
    if (selectedFolderId === null) return []
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

  // API에서 프롬프트 템플릿(회의 유형 목록) 로드
  useEffect(() => {
    getPromptTemplates()
      .then(setPromptTemplates)
      .catch(() => {})
  }, [])

  // 회의 유형 목록: API 데이터 우선, 없으면 config.yaml fallback
  const meetingTypeList = useMemo(() => {
    if (promptTemplates.length > 0) {
      return promptTemplates.map((t) => ({ value: t.meeting_type, label: t.label }))
    }
    return MEETING_TYPES
  }, [promptTemplates])

  const meetingTypeMap = useMemo<Record<string, string>>(() => {
    if (promptTemplates.length > 0) {
      return Object.fromEntries(promptTemplates.map((t) => [t.meeting_type, t.label]))
    }
    return STATIC_TYPE_MAP
  }, [promptTemplates])

  // URL의 status 파라미터를 스토어에 반영
  useEffect(() => {
    const urlStatus = searchParams.get('status') || ''
    if (urlStatus !== statusFilter) {
      setStatusFilter(urlStatus)
    }
  }, [searchParams, setStatusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // 팀 ID 자동 확보
  useEffect(() => {
    getTeams()
      .then((data) => {
        if (data.length > 0) setDefaultTeamId(data[0].id)
      })
      .catch(() => {})
  }, [])

  // 필터 변경 시 디바운스 후 fetch
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMeetings(1)
      setCurrentPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, statusFilter, dateFrom, dateTo, folderId, fetchMeetings])

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

  const handleEditMeeting = async (data: { title: string; meeting_type: string; tag_ids: number[] }) => {
    if (!editingMeeting) return
    await updateMeeting(editingMeeting.id, data)
    setEditingMeeting(null)
    fetchMeetings(currentPage)
  }

  const totalPages = meta ? Math.ceil(meta.total / meta.per) : 0

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{pageTitle}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowUploadModal(true)}
            disabled={defaultTeamId === null}
            className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            파일 업로드
          </button>
          <button
            onClick={() => setShowModal(true)}
            disabled={defaultTeamId === null}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            새 회의
          </button>
        </div>
      </div>

      {/* 폴더 경로 */}
      <FolderBreadcrumb />

      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {/* 하위 폴더 — 회의 카드와 같은 그리드에 표시되도록 아래 그리드에 통합 */}

      {/* 상태 필터 탭 */}
      <div className="flex items-center gap-1 mb-4">
        {([
          { value: '', label: '전체' },
          { value: 'recording', label: '녹음중' },
          { value: 'completed', label: '완료' },
          { value: 'pending', label: '대기중' },
        ] as const).map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setStatusFilter(tab.value)
              setSearchParams(tab.value ? { status: tab.value } : {}, { replace: true })
            }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 필터 영역 */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="제목 검색"
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

      {/* 폴더 + 회의 목록 */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">불러오는 중...</div>
      ) : childFolders.length === 0 && meetings.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">회의가 없습니다.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* 폴더 카드 */}
          {childFolders.map((child) => (
            <div
              key={`folder-${child.id}`}
              data-drop-folder-id={child.id}
              onPointerDown={(e) => initDrag('folder', child.id, child.name, e)}
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
              onPointerDown={(e) => initDrag('meeting', meeting.id, meeting.title, e)}
              onClick={() => navigate(`/meetings/${meeting.id}`)}
              className="group rounded-lg border bg-card p-4 cursor-pointer hover:bg-muted/50 hover:shadow-sm transition-all flex flex-col"
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
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2 leading-relaxed">
                    {meeting.brief_summary}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50">
                <p className="text-xs text-muted-foreground">
                  {formatDate(meeting.created_at)}
                </p>
                <div className="flex items-center gap-1">
                  {meeting.status === 'recording' && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        await stopMeeting(meeting.id)
                        fetchMeetings(currentPage)
                      }}
                      className="px-2 py-0.5 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      종료
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingMeeting(meeting)
                    }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-black/5 transition-opacity"
                    title="정보 수정"
                  >
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setMovingMeeting(meeting)
                    }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-black/5 transition-opacity"
                    title="폴더로 이동"
                  >
                    <FolderInput className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              </div>
            </div>
          ))}
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
      {showModal && defaultTeamId && (
        <CreateMeetingModal
          defaultTeamId={defaultTeamId}
          folderId={currentFolderId}
          meetingTypeList={meetingTypeList}
          onClose={() => setShowModal(false)}
          onCreated={addMeeting}
        />
      )}

      {/* 오디오 파일 업로드 모달 */}
      {showUploadModal && defaultTeamId && (
        <UploadAudioModal
          defaultTeamId={defaultTeamId}
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
    </div>
  )
}
