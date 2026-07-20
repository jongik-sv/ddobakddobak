import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { AiChatPanel } from '../meeting/AiChatPanel'
import type { ChatScopeType } from '../../api/chat'
import { getUserLlmSettings } from '../../api/userLlmSettings'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { BREAKPOINTS } from '../../config'
import { useUiStore } from '../../stores/uiStore'

// 우측 슬라이드오버 폴더/프로젝트 챗. 스코프 셀렉터로 '이 폴더' ↔ '프로젝트 전체' 전환.
// App.tsx(GatedApp)의 Routes와 형제인 글로벌 영역에 단일 마운트 — 라우트 전환(회의 상세로
// 이동 등)해도 드로어가 언마운트되지 않는다(idea.md #35 2단계). 열림/스코프는 uiStore가 들고
// 세션만 유지(localStorage 미영속) → 새로고침엔 닫힌 상태로 시작.
export function FolderChatDrawer() {
  const navigate = useNavigate()
  const open = useUiStore((s) => s.folderChatOpen)
  const scope = useUiStore((s) => s.folderChatScope)
  const closeFolderChat = useUiStore((s) => s.closeFolderChat)
  const folderId = scope?.folderId ?? null
  const projectId = scope?.projectId ?? null
  const folderName = scope?.folderName

  const [scopeTab, setScopeTab] = useState<'folder' | 'project'>(folderId ? 'folder' : 'project')
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)
  const folderChatWidth = useUiStore((s) => s.folderChatWidth)
  const setFolderChatWidth = useUiStore((s) => s.setFolderChatWidth)

  // 좌측 경계 드래그로 드로어 폭 조절(데스크톱). 우측 고정 슬라이드오버라 방향이 사이드바와 반대:
  // 왼쪽으로 끌수록 폭이 커진다 → 폭 = startW - (현재X - 시작X). 폭은 uiStore가 localStorage에 영속.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = useUiStore.getState().folderChatWidth
    const onMove = (ev: MouseEvent) => setFolderChatWidth(startW - (ev.clientX - startX))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [setFolderChatWidth])

  // 열릴 때 한 번, 실제 답변할 모델 표시명을 가져와 헤더에 미리보기. fetch 실패는 무시(드로어는 그대로).
  const [chatModel, setChatModel] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let alive = true
    getUserLlmSettings()
      .then((res) => { if (alive) setChatModel(res.llm_settings?.effective_chat_model ?? null) })
      .catch(() => { /* 미리보기는 부가 정보 — 실패해도 챗은 동작 */ })
    return () => { alive = false }
  }, [open])

  if (!open) return null

  // scope는 폴더/프로젝트 중 실제 id가 있는 쪽으로 폴백 → 빈 드로어로 안 뜨는 버그 방지.
  const effectiveScope: 'folder' | 'project' =
    scopeTab === 'folder' && folderId ? 'folder'
      : scopeTab === 'project' && projectId ? 'project'
        : folderId ? 'folder' : 'project'
  const scopeType: ChatScopeType = effectiveScope
  const scopeId = effectiveScope === 'folder' ? folderId : projectId
  if (!scopeId) return null

  // cross-meeting 인용 클릭 → 해당 회의 페이지로 이동(+seek 파라미터). 드로어는 닫지 않고 유지 —
  // 회의 상세를 보면서 드로어의 다른 질문을 이어할 수 있다(idea.md #35 2단계 핵심).
  const onSeekMeeting = (meetingId: number, ms: number) => {
    navigate(`/meetings/${meetingId}?t=${ms}`)
  }

  const tabBtn = (val: 'folder' | 'project', label: string, disabled?: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setScopeTab(val)}
      className={`px-2 py-1 text-xs rounded ${effectiveScope === val ? 'bg-blue-600 text-white' : 'text-muted-foreground'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {label}
    </button>
  )

  // 데스크톱(lg+)=우측 슬라이드오버, 모바일=설정 모달처럼 전체화면(safe-area 하단 패딩 유지).
  const containerClass = isDesktop
    ? 'relative bg-card shadow-xl flex flex-col h-full pb-0'
    : 'fixed inset-0 w-full h-dvh bg-card flex flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))]'

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={closeFolderChat} />
      <div className={containerClass} style={isDesktop ? { width: folderChatWidth } : undefined}>
        {isDesktop && (
          <div
            onMouseDown={startResize}
            className="absolute top-0 left-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
            title="드래그하여 폭 조절"
          />
        )}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-1">
            {tabBtn('folder', folderName ? `이 폴더: ${folderName}` : '이 폴더', !folderId)}
            {tabBtn('project', '프로젝트 전체', !projectId)}
          </div>
          <div className="flex items-center gap-2">
            {chatModel && (
              <span className="text-[11px] text-muted-foreground whitespace-nowrap" title={`AI 답변 모델: ${chatModel}`}>
                🤖 {chatModel}
              </span>
            )}
            <button type="button" aria-label="닫기" onClick={closeFolderChat}><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <AiChatPanel
            key={`${scopeType}:${scopeId}`}
            scopeType={scopeType}
            scopeId={scopeId}
            onSeekMeeting={onSeekMeeting}
            emptyHint={effectiveScope === 'folder' ? '이 폴더의 회의들에 대해 물어보세요.' : '이 프로젝트의 회의들에 대해 물어보세요.'}
          />
        </div>
      </div>
    </div>
  )
}
