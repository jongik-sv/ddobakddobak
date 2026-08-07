import { type ReactNode } from 'react'
import { Pencil, ArrowLeft, Paperclip, Bookmark, Search } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { MeetingPathBreadcrumb } from './MeetingPathBreadcrumb'

interface MeetingDetailTopBarProps {
  isDesktop: boolean
  hasMeeting: boolean
  /** 제목 + 배지 영역(MeetingActionHeader). 없으면(회의 로딩 전) 고정 라벨로 대체. */
  titleArea?: ReactNode
  /** 제목 인라인 편집 중이면 true — 편집 input에 폭을 몰아주려고 주변 아이콘을 접는다. */
  isEditingTitle?: boolean
  /** breadcrumb(프로젝트 › 폴더 경로) 컴팩트 표시용. 없으면 breadcrumb 미노출. */
  projectName?: string | null
  folderPath?: { id: number; name: string }[]
  attachmentsVisible: boolean
  bookmarksVisible: boolean
  /** 페이지 내 검색(전사+요약) 바 열림 상태 */
  searchOpen: boolean
  /** 회의 정보 수정 어포던스를 노출할지 (소유자 ∨ admin). 기본 true. */
  canEdit?: boolean
  /** 잠긴 회의면 회의 정보 수정 버튼을 비활성. 기본 false. */
  locked?: boolean
  onBack: () => void
  onToggleAttachments: () => void
  onShowEdit: () => void
  onToggleBookmarks: () => void
  onToggleSearch: () => void
  /** 우측 정렬 액션 버튼 슬롯(회의 진행/내보내기/삭제 등). 자체적으로 ml-auto 정렬. */
  actions?: ReactNode
  /** 모바일 전용 — 줄1 제목 슬롯(MeetingActionHeader 렌더 prop의 title). 데스크톱(titleArea)과는 별도 슬롯. */
  mobileTitleArea?: ReactNode
  /** 모바일 전용 — 줄2 배지 스트립 슬롯(MeetingActionHeader 렌더 prop의 badges). */
  mobileBadgesArea?: ReactNode
  /** 모바일 전용 — 줄1 우측 아이콘 그룹에 끼워넣을 잠금 토글(MeetingActionHeader 렌더 prop의 lockToggle). */
  mobileLockToggle?: ReactNode
}

/** 회의 상세 상단 툴바: 뒤로가기 + 실제 회의 제목·배지(MeetingActionHeader) + 첨부/북마크 토글. */
export function MeetingDetailTopBar({
  isDesktop,
  hasMeeting,
  titleArea,
  isEditingTitle = false,
  projectName,
  folderPath,
  attachmentsVisible,
  bookmarksVisible,
  searchOpen,
  canEdit = true,
  locked = false,
  onBack,
  onToggleAttachments,
  onShowEdit,
  onToggleBookmarks,
  onToggleSearch,
  actions,
  mobileTitleArea,
  mobileBadgesArea,
  mobileLockToggle,
}: MeetingDetailTopBarProps) {
  // 제목 편집 input이 열리면 주변 아이콘(검색/첨부/정보수정/북마크)을 접어 input에 폭을 몰아준다.
  const showPeripheralIcons = !isEditingTitle

  if (isDesktop) {
    return (
      <div className="bg-card border-b shrink-0 flex items-center px-6 py-4 gap-3">
        <Tooltip text="목록으로 돌아가기">
          <button
            aria-label="목록으로 돌아가기"
            onClick={onBack}
            className="p-1.5 rounded-md hover:bg-accent transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
        </Tooltip>
        {/* 제목 + 배지 — 데스크톱 옵션 B: 배지는 전부 상시 노출하되, 폭이 부족하면 이 영역
            안에서만 자연스럽게 다음 줄로 wrap(뒤이은 아이콘·액션 버튼 줄은 안 밀림). 회의 로딩
            전에는 고정 라벨로 폴백. */}
        <div className="flex-1 min-w-0 flex items-center flex-wrap gap-x-2 gap-y-1">
          {titleArea ?? (
            <h1 className="font-bold text-foreground min-w-0 truncate text-xl">회의 미리보기</h1>
          )}
        </div>
        {showPeripheralIcons && (
          <>
            <Tooltip text={searchOpen ? '검색 닫기' : '페이지 내 검색 (Ctrl+F)'}>
              <button
                aria-label="페이지 내 검색"
                onClick={onToggleSearch}
                className={`shrink-0 p-1.5 rounded-md transition-colors ${searchOpen ? 'text-blue-600 bg-blue-50' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
              >
                <Search className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip text={attachmentsVisible ? '첨부 숨기기' : '첨부 보기'}>
              <button
                onClick={onToggleAttachments}
                className={`shrink-0 p-1.5 rounded-md transition-colors ${attachmentsVisible ? 'text-blue-600 bg-blue-50' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </Tooltip>
            {hasMeeting && canEdit && (
              <Tooltip text={locked ? '잠긴 회의입니다' : '회의 정보 수정'}>
                <button
                  aria-label="회의 정보 수정"
                  onClick={onShowEdit}
                  disabled={locked}
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
            {/* 프로젝트 › 폴더 경로. 전체 경로는 title 툴팁 */}
            <MeetingPathBreadcrumb
              compact
              projectName={projectName}
              folderPath={folderPath}
              className="min-w-0 shrink max-w-[160px] lg:max-w-[280px]"
            />
            {/* 메모 패널 토글 버튼은 여기서 제거됨 — 우측 패널 헤더의 PanelRightClose(펼침 상태) /
                패널 접힘 시 화면 우측 엣지의 PanelRightOpen(MeetingPage.tsx)으로 이동. 사이드바
                PanelLeftClose/PanelLeft(AppLayout.tsx)와 대칭 패턴. */}
            <Tooltip text={bookmarksVisible ? '북마크 숨기기' : '북마크 보기'}>
              <button
                onClick={onToggleBookmarks}
                className={`shrink-0 p-1.5 rounded-md transition-colors ${bookmarksVisible ? 'text-amber-600 bg-amber-50' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
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

  // 모바일 2줄 레이아웃 — 줄1: 뒤로가기+제목+아이콘 그룹(검색/첨부/정보수정/잠금토글).
  // 줄2: 가로 스크롤 배지 스트립(#id·상태·유형·↩이전·D'Flow·breadcrumb) + 우측 고정 액션 버튼.
  return (
    <div className="bg-card border-b shrink-0">
      <div className="flex items-center px-3 pt-2 pb-1.5 gap-2">
        <Tooltip text="목록으로 돌아가기">
          <button
            aria-label="목록으로 돌아가기"
            onClick={onBack}
            className="p-1.5 rounded-md hover:bg-accent transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
        </Tooltip>
        <div className="flex-1 min-w-0 flex items-center">
          {mobileTitleArea ?? (
            <h1 className="text-lg font-semibold text-foreground truncate">회의 미리보기</h1>
          )}
        </div>
        {showPeripheralIcons && (
          <>
            <Tooltip text={searchOpen ? '검색 닫기' : '페이지 내 검색 (Ctrl+F)'}>
              <button
                aria-label="페이지 내 검색"
                onClick={onToggleSearch}
                className={`shrink-0 p-1.5 rounded-md transition-colors ${searchOpen ? 'text-blue-600 bg-blue-50' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
              >
                <Search className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip text={attachmentsVisible ? '첨부 숨기기' : '첨부 보기'}>
              <button
                onClick={onToggleAttachments}
                className={`shrink-0 p-1.5 rounded-md transition-colors ${attachmentsVisible ? 'text-blue-600 bg-blue-50' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </Tooltip>
            {hasMeeting && canEdit && (
              <Tooltip text={locked ? '잠긴 회의입니다' : '회의 정보 수정'}>
                <button
                  aria-label="회의 정보 수정"
                  onClick={onShowEdit}
                  disabled={locked}
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
          </>
        )}
        {/* 잠금 토글은 제목 편집 중에도 계속 노출(기존 MeetingActionHeader 동작 보존) — 접힘 그룹 밖. */}
        {mobileLockToggle}
      </div>
      {/* 줄2: 배지 전용 스트립(전체 폭) — 액션 버튼에 밀리지 않아 ↩이전·폴더명까지 보인다. 넘치면 가로 스와이프 */}
      <div
        className="flex items-center gap-1.5 px-3 pb-1 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {mobileBadgesArea}
        {/* 프로젝트 › 폴더 경로. 전체 경로는 title 툴팁 — 모바일은 배지 스트립 안(줄1 공간 확보) */}
        <MeetingPathBreadcrumb
          compact
          projectName={projectName}
          folderPath={folderPath}
          className="shrink-0 max-w-[180px]"
        />
      </div>
      {/* 줄3: 액션 버튼 우측 정렬 */}
      {actions && <div className="flex items-center justify-end px-3 pb-2">{actions}</div>}
    </div>
  )
}
