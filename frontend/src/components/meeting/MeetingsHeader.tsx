import { Search, X, Filter, UserPlus, Upload, MessagesSquare } from 'lucide-react'

interface MeetingsHeaderProps {
  isDesktop: boolean
  searchExpanded: boolean
  searchQuery: string
  pageTitle: string
  onSearchChange: (value: string) => void
  onSearchExpand: () => void
  onSearchClose: () => void
  onOpenFilterSheet: () => void
  onJoinMeeting: () => void
  onUploadAudio: () => void
  onCreateMeeting: () => void
  /** "폴더에게 묻기" 진입점 — 폴더/프로젝트가 선택됐을 때만 노출. */
  onAskFolder?: () => void
  canAsk?: boolean
}

/** MeetingsPage 상단 헤더 (제목 + 모바일/데스크톱 액션 버튼, 모바일 검색 바). */
export function MeetingsHeader({
  isDesktop,
  searchExpanded,
  searchQuery,
  pageTitle,
  onSearchChange,
  onSearchExpand,
  onSearchClose,
  onOpenFilterSheet,
  onJoinMeeting,
  onUploadAudio,
  onCreateMeeting,
  onAskFolder,
  canAsk,
}: MeetingsHeaderProps) {
  if (!isDesktop && searchExpanded) {
    return (
      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="제목·요약·전사 내용 검색"
          className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
        <button
          data-testid="mobile-search-close"
          onClick={onSearchClose}
          className="p-2 rounded-md hover:bg-muted transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between mb-4">
      <h1 className={`${isDesktop ? 'text-2xl' : 'text-xl'} font-bold`}>{pageTitle}</h1>
      <div className="flex items-center gap-2">
        {!isDesktop && (
          <>
            <button
              data-testid="mobile-search-toggle"
              onClick={onSearchExpand}
              className="p-2 rounded-md hover:bg-muted transition-colors"
            >
              <Search className="w-5 h-5" />
            </button>
            <button
              data-testid="mobile-filter-toggle"
              onClick={onOpenFilterSheet}
              className="p-2 rounded-md hover:bg-muted transition-colors"
            >
              <Filter className="w-5 h-5" />
            </button>
            <button
              data-testid="mobile-join-meeting"
              onClick={onJoinMeeting}
              className="p-2 rounded-md hover:bg-muted transition-colors"
              title="회의 참여 (공유 코드)"
              aria-label="회의 참여"
            >
              <UserPlus className="w-5 h-5" />
            </button>
            <button
              data-testid="mobile-upload-audio"
              onClick={onUploadAudio}
              className="p-2 rounded-md hover:bg-muted transition-colors"
              title="오디오 파일 업로드"
              aria-label="오디오 업로드"
            >
              <Upload className="w-5 h-5" />
            </button>
            {canAsk && (
              <button
                data-testid="mobile-ask-folder"
                type="button"
                onClick={onAskFolder}
                className="p-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                title="폴더에게 묻기"
                aria-label="폴더에게 묻기"
              >
                <MessagesSquare className="w-5 h-5" />
              </button>
            )}
          </>
        )}
        {isDesktop && (
          <>
            {canAsk && (
              <button
                type="button"
                onClick={onAskFolder}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                <MessagesSquare size={16} /> 폴더에게 묻기
              </button>
            )}
            <button
              onClick={onJoinMeeting}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              회의 참여
            </button>
            <button
              onClick={onUploadAudio}
              className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              오디오 업로드
            </button>
            <button
              onClick={onCreateMeeting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              새 회의
            </button>
          </>
        )}
      </div>
    </div>
  )
}
