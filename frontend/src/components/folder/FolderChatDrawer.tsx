import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { AiChatPanel } from '../meeting/AiChatPanel'
import type { ChatScopeType } from '../../api/chat'

// 우측 슬라이드오버 폴더/프로젝트 챗. 스코프 셀렉터로 '이 폴더' ↔ '프로젝트 전체' 전환.
export function FolderChatDrawer({
  open, onClose, folderId, projectId, folderName,
}: {
  open: boolean
  onClose: () => void
  folderId?: number | null
  projectId?: number | null
  folderName?: string
}) {
  const navigate = useNavigate()
  const [scope, setScope] = useState<'folder' | 'project'>(folderId ? 'folder' : 'project')

  if (!open) return null

  const scopeType: ChatScopeType = scope
  const scopeId = scope === 'folder' ? folderId : projectId
  if (!scopeId) return null

  // cross-meeting 인용 클릭 → 해당 회의 페이지로 이동(+seek 파라미터). 자동 seek는 Task 12.
  const onSeekMeeting = (meetingId: number, ms: number) => {
    navigate(`/meetings/${meetingId}?t=${ms}`)
    onClose()
  }

  const tabBtn = (val: 'folder' | 'project', label: string, disabled?: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setScope(val)}
      className={`px-2 py-1 text-xs rounded ${scope === val ? 'bg-blue-600 text-white' : 'text-gray-600'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-1">
            {tabBtn('folder', folderName ? `이 폴더: ${folderName}` : '이 폴더', !folderId)}
            {tabBtn('project', '프로젝트 전체', !projectId)}
          </div>
          <button type="button" aria-label="닫기" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0">
          <AiChatPanel
            key={`${scopeType}:${scopeId}`}
            scopeType={scopeType}
            scopeId={scopeId}
            onSeekMeeting={onSeekMeeting}
            emptyHint={scope === 'folder' ? '이 폴더의 회의들에 대해 물어보세요.' : '이 프로젝트의 회의들에 대해 물어보세요.'}
          />
        </div>
      </div>
    </div>
  )
}
