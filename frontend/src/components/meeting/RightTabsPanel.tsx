import { useState } from 'react'
import type { ReactNode } from 'react'
import { AiChatPanel } from './AiChatPanel'

type Tab = 'memo' | 'corrections' | 'chat'
type ChatScope = 'meeting' | 'folder' | 'project'

export function RightTabsPanel({
  meetingId,
  memo,
  corrections,
  onSeek,
  folderId,
  projectId,
  onSeekMeeting,
}: {
  meetingId: number
  memo: ReactNode
  /** 오타수정 탭 콘텐츠. 제공 시 메모와 AI 챗 사이에 3번째 탭으로 노출. 미제공 시 2탭(AI 챗/메모). */
  corrections?: ReactNode
  onSeek?: (ms: number) => void
  folderId?: number | null
  projectId?: number | null
  onSeekMeeting?: (meetingId: number, ms: number) => void
}) {
  const [tab, setTab] = useState<Tab>('chat')
  const [chatScope, setChatScope] = useState<ChatScope>('meeting')
  const btn = (t: Tab) =>
    `px-3 py-1.5 text-sm font-medium ${
      tab === t ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
    }`

  // 선택 스코프의 id가 없으면 meeting으로 폴백(안전망 — 빈 패널 방지).
  const effectiveScope: ChatScope =
    chatScope === 'folder' && folderId ? 'folder'
      : chatScope === 'project' && projectId ? 'project'
        : 'meeting'
  const scopeId =
    effectiveScope === 'folder' ? folderId!
      : effectiveScope === 'project' ? projectId!
        : meetingId

  // 스코프 세그먼트 버튼 — FolderChatDrawer의 tabBtn 스타일을 그대로 재사용.
  const scopeBtn = (val: ChatScope, label: string, disabled?: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setChatScope(val)}
      className={`px-2 py-1 text-xs rounded ${effectiveScope === val ? 'bg-blue-600 text-white' : 'text-muted-foreground'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border shrink-0">
        <button className={btn('chat')} onClick={() => setTab('chat')}>
          AI 챗
        </button>
        {corrections != null && (
          <button className={btn('corrections')} onClick={() => setTab('corrections')}>
            오타수정
          </button>
        )}
        <button className={btn('memo')} onClick={() => setTab('memo')}>
          메모
        </button>
      </div>
      {tab === 'chat' && (
        <div className="flex items-center gap-1 border-b border-border px-3 py-2 shrink-0">
          {scopeBtn('meeting', '이 회의')}
          {scopeBtn('folder', '폴더', !folderId)}
          {scopeBtn('project', '프로젝트 전체', !projectId)}
        </div>
      )}
      <div className="flex-1 min-h-0">
        {tab === 'memo'
          ? memo
          : tab === 'corrections'
            ? corrections
            : (
              <AiChatPanel
                key={`${effectiveScope}:${scopeId}`}
                scopeType={effectiveScope}
                scopeId={scopeId}
                onSeek={effectiveScope === 'meeting' ? onSeek : undefined}
                onSeekMeeting={effectiveScope === 'meeting' ? undefined : onSeekMeeting}
                emptyHint={
                  effectiveScope === 'folder'
                    ? '이 폴더의 회의들에 대해 물어보세요.'
                    : effectiveScope === 'project'
                      ? '이 프로젝트의 회의들에 대해 물어보세요.'
                      : undefined
                }
              />
            )}
      </div>
    </div>
  )
}
