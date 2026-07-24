import { useState } from 'react'
import { useCollaborators, type CollaboratorOwnerType } from '../../hooks/useCollaborators'
import { errorToMessage } from '../../lib/errors'

interface CollaboratorsPanelProps {
  /** 이 패널이 회의/폴더 중 어느 레벨의 협업자를 다루는지 */
  ownerType: CollaboratorOwnerType
  ownerId: number
  /** 추가 대상(프로젝트 멤버) 조회 범위 */
  projectId: number | null
  /** 추가/제거 UI 노출 여부 (서버 403이 최종 방어선 — 프론트는 UX용) */
  canManage: boolean
}

/**
 * 협업자(직접 지정 + 폴더 상속) 관리 패널 — 회의/폴더 공용(DomainFilesPanel과 동형 책임 분담).
 * idea 44: 폴더 협업자는 하위 회의에 실시간 상속되므로 상속분은 읽기전용 뱃지로만 표시한다.
 */
export default function CollaboratorsPanel({ ownerType, ownerId, projectId, canManage }: CollaboratorsPanelProps) {
  const { direct, inherited, projectMembers, error: loadError, add, remove } = useCollaborators(ownerType, ownerId, projectId)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)

  const directIds = new Set(direct.map((c) => c.user_id))
  const inheritedIds = new Set(inherited.map((c) => c.user_id))
  const addableMembers = projectMembers.filter((m) => !directIds.has(m.user_id) && !inheritedIds.has(m.user_id))

  const handleAdd = async () => {
    if (!selectedUserId) return
    setError('')
    setAdding(true)
    try {
      await add(Number(selectedUserId))
      setSelectedUserId('')
    } catch (err) {
      setError(await errorToMessage(err, '협업자 추가 실패'))
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (userId: number) => {
    setError('')
    try {
      await remove(userId)
    } catch (err) {
      setError(await errorToMessage(err, '협업자 제거 실패'))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {direct.length === 0 && inherited.length === 0 && (
        <span className="text-xs text-muted-foreground">지정된 협업자가 없습니다</span>
      )}

      {direct.length > 0 && (
        <ul className="flex flex-col gap-1">
          {direct.map((c) => (
            <li key={c.user_id} className="flex items-center justify-between gap-2 text-sm">
              <span>{c.name} <span className="text-xs text-muted-foreground">({c.email})</span></span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleRemove(c.user_id)}
                  aria-label={`${c.name} 제거`}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  제거
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {inherited.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">폴더에서 상속된 협업자 (읽기전용)</span>
          <ul className="flex flex-col gap-1">
            {inherited.map((c) => (
              <li key={c.user_id} className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{c.name} <span className="text-xs">({c.email})</span></span>
                <span className="text-[10px]">폴더 &quot;{c.folder_name}&quot;에서 상속됨</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage && (
        <div className="flex items-center gap-2">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            <option value="">협업자로 추가할 멤버 선택</option>
            {addableMembers.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name} ({m.email})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!selectedUserId || adding}
            className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            추가
          </button>
        </div>
      )}

      {(error || loadError) && <div className="text-[11px] text-red-500">{error || loadError}</div>}
    </div>
  )
}
