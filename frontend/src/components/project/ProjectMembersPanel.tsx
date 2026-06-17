import { useCallback, useEffect, useState } from 'react'
import { getShareBaseUrl } from '../../lib/shareUrl'
import { Copy, Check, Trash2, X } from 'lucide-react'
import { HTTPError } from 'ky'
import { Dialog } from '../ui/Dialog'
import {
  getProjectMembers,
  removeProjectMember,
  addProjectMember,
  getProjectInvites,
  createProjectInvite,
  revokeProjectInvite,
} from '../../api/projects'
import type { Project, ProjectMember, ProjectInvite } from '../../api/projects'

interface ProjectMembersPanelProps {
  project: Project
  onClose: () => void
}

export default function ProjectMembersPanel({ project, onClose }: ProjectMembersPanelProps) {
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [invites, setInvites] = useState<ProjectInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [creating, setCreating] = useState(false)
  const [shareBase, setShareBase] = useState(window.location.origin)
  const [addEmail, setAddEmail] = useState('')
  const [adding, setAdding] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [m, i] = await Promise.all([
        getProjectMembers(project.id),
        getProjectInvites(project.id),
      ])
      setMembers(m)
      setInvites(i)
    } catch {
      setError('멤버 정보를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => { getShareBaseUrl().then(setShareBase) }, [])

  const handleAddByEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addEmail.trim()) return
    setAdding(true)
    setError('')
    try {
      await addProjectMember(project.id, addEmail.trim())
      setAddEmail('')
      await reload()
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 404) {
        setError('해당 이메일의 사용자를 찾을 수 없습니다.')
      } else {
        setError('추가에 실패했습니다.')
      }
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (userId: number) => {
    try {
      await removeProjectMember(project.id, userId)
      setMembers((prev) => prev.filter((m) => m.user_id !== userId))
    } catch {
      setError('멤버 제거에 실패했습니다.')
    }
  }

  const handleCreateInvite = async () => {
    setCreating(true)
    setError('')
    try {
      const invite = await createProjectInvite(project.id, {
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        max_uses: maxUses ? Number(maxUses) : null,
      })
      setInvites((prev) => [invite, ...prev])
      setExpiresAt('')
      setMaxUses('')
    } catch {
      setError('초대 링크 생성에 실패했습니다.')
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (inviteId: number) => {
    try {
      await revokeProjectInvite(project.id, inviteId)
      setInvites((prev) => prev.filter((i) => i.id !== inviteId))
    } catch {
      setError('초대 취소에 실패했습니다.')
    }
  }

  const inviteUrl = (code: string) => `${shareBase}/invite/${code}`

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(code))
      setCopied(code)
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500)
    } catch {
      /* clipboard 거부 시 무시 */
    }
  }

  return (
    <Dialog
      onClose={onClose}
      backdropClassName="bg-black/20 backdrop-blur-sm"
      className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">{project.name} · 멤버 관리</h2>
        <button onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100" aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-6 text-center text-sm text-zinc-500">불러오는 중…</p>
      ) : (
        <>
          <section className="mb-6">
            <h3 className="mb-2 text-sm font-medium text-zinc-700">멤버 ({members.length})</h3>
            <ul className="space-y-1">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-100">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">{m.name}</p>
                    <p className="truncate text-xs text-zinc-500">{m.email}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      m.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-zinc-100 text-zinc-600'
                    }`}
                  >
                    {m.role === 'admin' ? '관리자' : '멤버'}
                  </span>
                  {m.role !== 'admin' && (
                    <button
                      onClick={() => handleRemove(m.user_id)}
                      className="rounded-md p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600"
                      aria-label="멤버 제거"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="mb-6">
            <h3 className="mb-2 text-sm font-medium text-zinc-700">이메일로 멤버 추가</h3>
            <form onSubmit={handleAddByEmail} className="flex gap-2">
              <input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="이메일 주소"
                className="flex-1 rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={adding || !addEmail.trim()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-indigo-700 disabled:opacity-50"
              >
                추가
              </button>
            </form>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-zinc-700">초대 링크</h3>
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-xs text-zinc-500">
                만료 (선택)
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="mt-1 rounded-md border border-zinc-200 px-2 py-1 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
              <label className="flex flex-col text-xs text-zinc-500">
                최대 사용 (선택)
                <input
                  type="number"
                  min={1}
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder="무제한"
                  className="mt-1 w-24 rounded-md border border-zinc-200 px-2 py-1 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
              <button
                onClick={handleCreateInvite}
                disabled={creating}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-indigo-700 disabled:opacity-50"
              >
                링크 생성
              </button>
            </div>

            <ul className="space-y-1">
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-zinc-900">{inviteUrl(inv.code)}</p>
                    <p className="text-xs text-zinc-500">
                      {inv.use_count}
                      {inv.max_uses != null ? `/${inv.max_uses}` : ''}회 사용
                      {inv.expires_at ? ` · ~${new Date(inv.expires_at).toLocaleDateString()}` : ''}
                      {!inv.redeemable ? ' · 만료됨' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => copy(inv.code)}
                    className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
                    aria-label="링크 복사"
                  >
                    {copied === inv.code ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => handleRevoke(inv.id)}
                    className="rounded-md p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600"
                    aria-label="초대 취소"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {invites.length === 0 && (
                <li className="py-2 text-center text-xs text-zinc-500">활성 초대 링크가 없습니다.</li>
              )}
            </ul>
          </section>
        </>
      )}
    </Dialog>
  )
}
