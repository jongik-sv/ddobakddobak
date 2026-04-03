import { useState, useEffect } from 'react'
import { HTTPError } from 'ky'
import { Trash2, Plus, UserPlus } from 'lucide-react'
import {
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
} from '../../api/adminUsers'
import type { AdminUser } from '../../api/adminUsers'
import { useAuthStore } from '../../stores/authStore'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

// ── 사용자 생성 다이얼로그 ──
function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (user: AdminUser) => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const user = await createAdminUser({ email, name, password, role })
      onCreated(user)
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = await err.response.json().catch(() => ({})) as Record<string, string[]>
        setError(body.errors?.join(', ') ?? '사용자 생성에 실패했습니다.')
      } else {
        setError('사용자 생성에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-gray-100 p-6 mx-4"
      >
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <UserPlus className="w-5 h-5" />
          사용자 추가
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">이메일</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">이름</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">비밀번호</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6자 이상"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">역할</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? '생성 중...' : '생성'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── 삭제 확인 다이얼로그 ──
function DeleteConfirmDialog({
  user,
  onClose,
  onConfirm,
}: {
  user: AdminUser
  onClose: () => void
  onConfirm: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    await onConfirm()
    setDeleting(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl border border-gray-100 p-6 mx-4">
        <h3 className="text-lg font-semibold mb-2">사용자 삭제</h3>
        <p className="text-sm text-gray-600 mb-1">
          <strong>{user.name}</strong> ({user.email})
        </p>
        <p className="text-sm text-gray-600 mb-4">
          이 사용자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
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
                        <button
                          onClick={() => handleRoleChange(user)}
                          disabled={isSelf || updatingId === user.id}
                          className={`
                            inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors
                            ${user.role === 'admin'
                              ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }
                            ${isSelf ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                          `}
                          title={isSelf ? '자신의 역할은 변경할 수 없습니다' : `클릭하여 ${user.role === 'admin' ? 'member' : 'admin'}로 변경`}
                        >
                          {updatingId === user.id ? '...' : user.role}
                        </button>
                      </td>
                      <td className="py-3 text-muted-foreground">{formatDate(user.created_at)}</td>
                      <td className="py-3">
                        {!isSelf && (
                          <button
                            onClick={() => setDeleteTarget(user)}
                            className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                            title="사용자 삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
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
    </div>
  )
}
