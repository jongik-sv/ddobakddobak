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
import { formatDate as formatDateShared } from '../../lib/meetingFormat'
import { compareText } from '../../lib/dataTable'
import type { ColumnDef, SortState } from '../../lib/dataTable'
import {
  FilterCell,
  SortableTh,
  TableSummary,
  useTableView,
} from '../common/DataTableParts'

// admin → manager → member → admin 순환
const NEXT_ROLE: Record<AdminUser['role'], AdminUser['role']> = {
  admin: 'manager',
  manager: 'member',
  member: 'admin',
}
const ROLE_LABEL: Record<AdminUser['role'], string> = {
  admin: '관리자',
  manager: '매니저',
  member: '멤버',
}
const ROLE_BADGE_CLASS: Record<AdminUser['role'], string> = {
  admin: 'bg-purple-100 text-purple-700 hover:bg-purple-200',
  manager: 'bg-blue-100 text-blue-700 hover:bg-blue-200',
  member: 'bg-muted text-foreground hover:bg-accent',
}

const ROLE_ORDER: AdminUser['role'][] = ['admin', 'manager', 'member']

const USER_COLUMNS: ColumnDef<AdminUser>[] = [
  { key: 'name', label: '이름', type: 'text', accessor: (u) => u.name },
  { key: 'email', label: '이메일', type: 'text', accessor: (u) => u.email },
  {
    key: 'role',
    label: '역할',
    type: 'select',
    accessor: (u) => u.role,
    sortValue: (u) => ROLE_ORDER.indexOf(u.role),
    options: ROLE_ORDER.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
  },
  { key: 'created_at', label: '생성일', type: 'date', accessor: (u) => u.created_at },
]
const DEFAULT_SORT: SortState = { key: 'name', dir: 'asc' }
const userTieBreak = (a: AdminUser, b: AdminUser) =>
  compareText(a.email, b.email) || a.id - b.id
const VIEW_STORAGE_KEY = 'ddobak.userMgmt.view'

function formatDate(iso: string): string {
  return formatDateShared(iso, {
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

  const { sort, filters, view, toggleSort, setFilter, reset, filtered } = useTableView({
    rows: users,
    columns: USER_COLUMNS,
    defaultSort: DEFAULT_SORT,
    tieBreak: userTieBreak,
    storageKey: VIEW_STORAGE_KEY,
  })

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
    const newRole = NEXT_ROLE[user.role]
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
    <div className="space-y-6">
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
          <>
          <TableSummary shown={view.length} total={users.length} filtered={filtered} onReset={reset} />
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-muted-foreground">
                  {USER_COLUMNS.map((c) => (
                    <SortableTh key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={toggleSort} />
                  ))}
                  <th className="w-28 px-3"><span className="sr-only">작업</span></th>
                </tr>
                <tr className="border-b">
                  {USER_COLUMNS.map((c) => (
                    <td key={c.key} className="px-3 pb-2 align-top">
                      <FilterCell column={c} filters={filters} onChange={setFilter} />
                    </td>
                  ))}
                  <td />
                </tr>
              </thead>
              <tbody className="divide-y">
                {view.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      조건에 맞는 사용자가 없습니다.
                    </td>
                  </tr>
                )}
                {view.map((user) => {
                  const isSelf = currentUser?.id === user.id
                  // 로컬 관리자 계정(desktop@local): 역할 admin 고정 + 수정/삭제 불가
                  const isLocalAdmin = user.email.endsWith('@local')
                  return (
                    <tr key={user.id} className="group">
                      <td className="px-3 py-3 font-medium">
                        {user.name}
                        {isSelf && (
                          <span className="ml-1.5 text-xs text-blue-600 font-normal">(나)</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{user.email}</td>
                      <td className="px-3 py-3">
                        {(() => {
                          const roleLocked = isSelf || isLocalAdmin
                          return (
                            <button
                              onClick={() => handleRoleChange(user)}
                              disabled={roleLocked || updatingId === user.id}
                              className={`
                                inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors
                                ${ROLE_BADGE_CLASS[user.role]}
                                ${roleLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                              `}
                              title={
                                isLocalAdmin
                                  ? '관리자 계정의 역할은 변경할 수 없습니다'
                                  : isSelf
                                    ? '자신의 역할은 변경할 수 없습니다'
                                    : `클릭하여 ${ROLE_LABEL[NEXT_ROLE[user.role]]}로 변경`
                              }
                            >
                              {updatingId === user.id ? '...' : ROLE_LABEL[user.role]}
                            </button>
                          )
                        })()}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{formatDate(user.created_at)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1">
                          {!user.email.endsWith('@local') && (
                            <button
                              onClick={() => setEditTarget(user)}
                              className="p-2.5 rounded-md text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition-all"
                              title="이름/이메일 수정"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {!user.email.endsWith('@local') && (
                            <button
                              onClick={() => setResetTarget(user)}
                              className="p-2.5 rounded-md text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-all"
                              title="비밀번호 초기화"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>
                          )}
                          {!isSelf && !user.email.endsWith('@local') && (
                            <button
                              onClick={() => setDeleteTarget(user)}
                              className="p-2.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-all"
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
          </>
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
