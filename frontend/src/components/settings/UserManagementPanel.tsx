import { useState, useEffect } from 'react'
import { HTTPError } from 'ky'
import { Trash2, Plus, KeyRound, Pencil } from 'lucide-react'
import {
  getAdminUsers,
  updateAdminUser,
  deleteAdminUser,
} from '../../api/adminUsers'
import type { AdminUser } from '../../api/adminUsers'
import { useAuthStore } from '../../stores/authStore'
import { CreateUserDialog } from './CreateUserDialog'
import { DeleteConfirmDialog } from './DeleteConfirmDialog'
import { ResetPasswordDialog } from './ResetPasswordDialog'
import { EditUserDialog } from './EditUserDialog'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

// ── 메인 패널 ──
export default function UserManagementPanel() {
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)

  const loadUsers = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAdminUsers()
      setUsers(data)
    } catch {
      setError('사용자 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const handleRoleChange = async (user: AdminUser) => {
    const newRole = user.role === 'admin' ? 'member' : 'admin'
    setUpdatingId(user.id)
    try {
      const updated = await updateAdminUser(user.id, { role: newRole })
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
    } catch {
      setError('역할 변경에 실패했습니다.')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteAdminUser(deleteTarget.id)
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id))
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = await err.response.json().catch(() => ({})) as Record<string, string>
        setError(body.error ?? '사용자 삭제에 실패했습니다.')
      } else {
        setError('사용자 삭제에 실패했습니다.')
      }
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">사용자 관리</h2>
            <p className="text-sm text-muted-foreground">시스템 사용자를 추가, 수정, 삭제합니다.</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            사용자 추가
          </button>
        </div>

        {loading && (
          <p className="text-sm text-muted-foreground py-8 text-center">불러오는 중...</p>
        )}

        {error && (
          <p className="text-sm text-red-600 mb-3">{error}</p>
        )}

        {!loading && users.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">등록된 사용자가 없습니다.</p>
        )}

        {!loading && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">이름</th>
                  <th className="pb-2 font-medium">이메일</th>
                  <th className="pb-2 font-medium">역할</th>
                  <th className="pb-2 font-medium">생성일</th>
                  <th className="pb-2 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((user) => {
                  const isSelf = currentUser?.id === user.id
                  // 로컬 관리자 계정(desktop@local): 역할 admin 고정 + 수정/삭제 불가
                  const isLocalAdmin = user.email.endsWith('@local')
                  return (
                    <tr key={user.id} className="group">
                      <td className="py-3 font-medium">
                        {user.name}
                        {isSelf && (
                          <span className="ml-1.5 text-xs text-blue-600 font-normal">(나)</span>
                        )}
                      </td>
                      <td className="py-3 text-muted-foreground">{user.email}</td>
                      <td className="py-3">
                        {(() => {
                          const roleLocked = isSelf || isLocalAdmin
                          return (
                            <button
                              onClick={() => handleRoleChange(user)}
                              disabled={roleLocked || updatingId === user.id}
                              className={`
                                inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors
                                ${user.role === 'admin'
                                  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }
                                ${roleLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                              `}
                              title={
                                isLocalAdmin
                                  ? '관리자 계정의 역할은 변경할 수 없습니다'
                                  : isSelf
                                    ? '자신의 역할은 변경할 수 없습니다'
                                    : `클릭하여 ${user.role === 'admin' ? 'member' : 'admin'}로 변경`
                              }
                            >
                              {updatingId === user.id ? '...' : user.role}
                            </button>
                          )
                        })()}
                      </td>
                      <td className="py-3 text-muted-foreground">{formatDate(user.created_at)}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-1">
                          {!user.email.endsWith('@local') && (
                            <button
                              onClick={() => setEditTarget(user)}
                              className="p-2.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                              title="이름/이메일 수정"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {!user.email.endsWith('@local') && (
                            <button
                              onClick={() => setResetTarget(user)}
                              className="p-2.5 rounded-md text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-all"
                              title="비밀번호 초기화"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>
                          )}
                          {!isSelf && !user.email.endsWith('@local') && (
                            <button
                              onClick={() => setDeleteTarget(user)}
                              className="p-2.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
                              title="사용자 삭제"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 사용자 생성 다이얼로그 */}
      {showCreate && (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onCreated={(user) => {
            setUsers((prev) => [user, ...prev])
            setShowCreate(false)
          }}
        />
      )}

      {/* 삭제 확인 다이얼로그 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}

      {resetTarget && (
        <ResetPasswordDialog
          user={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      )}

      {editTarget && (
        <EditUserDialog
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={(u) => {
            setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)))
            setEditTarget(null)
          }}
        />
      )}
    </div>
  )
}
