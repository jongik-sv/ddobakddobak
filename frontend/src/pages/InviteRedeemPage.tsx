import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { HTTPError } from 'ky'
import { useAuthStore } from '../stores/authStore'
import { useProjectStore } from '../stores/projectStore'
import { getInvitePreview, redeemInvite } from '../api/projects'
import type { Project } from '../api/projects'
import { loginWithCredentials } from '../api/auth'
import ProjectIcon from '../components/project/ProjectIcon'
import { PasswordInput } from '../components/ui/PasswordInput'

export default function InviteRedeemPage() {
  const { code = '' } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const setTokens = useAuthStore((s) => s.setTokens)
  const setUser = useAuthStore((s) => s.setUser)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)

  const [preview, setPreview] = useState<Partial<Project> | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  // 회원가입 / 로그인 폼
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const isAuthed = Boolean(accessToken)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getInvitePreview(code)
      .then((res) => {
        if (cancelled) return
        if (res.valid === false) {
          setLoadError('만료되었거나 유효하지 않은 초대 링크입니다.')
        } else {
          setPreview(res.project)
        }
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof HTTPError && (err.response.status === 404 || err.response.status === 410)) {
          setLoadError('만료되었거나 유효하지 않은 초대 링크입니다.')
        } else {
          setLoadError('초대 정보를 불러오지 못했습니다.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [code])

  const afterJoin = (projectId?: number) => {
    if (projectId) setCurrentProject(projectId)
    navigate('/meetings')
  }

  const handleJoin = async () => {
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await redeemInvite(code)
      afterJoin(res.project?.id)
    } catch {
      setSubmitError('합류에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !password) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await redeemInvite(code, { name: name.trim(), email: email.trim(), password })
      if (res.access_token && res.refresh_token) {
        setTokens(res.access_token, res.refresh_token)
        if (res.user) setUser(res.user)
      }
      afterJoin(res.project?.id)
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 422) {
        setSubmitError('이미 사용 중인 이메일이거나 입력값을 확인해 주세요.')
      } else {
        setSubmitError('가입에 실패했습니다. 다시 시도해 주세요.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await loginWithCredentials(email.trim(), password)
      setTokens(res.access_token, res.refresh_token)
      setUser(res.user)
      await handleJoin()
    } catch {
      setSubmitError('로그인에 실패했습니다. 이메일·비밀번호를 확인해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</p>
        ) : loadError ? (
          <div className="py-6 text-center">
            <p className="text-sm text-red-600">{loadError}</p>
            <button
              onClick={() => navigate('/meetings')}
              className="mt-4 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              홈으로
            </button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-col items-center gap-2 text-center">
              {preview && (
                <ProjectIcon
                  project={{
                    name: preview.name ?? '프로젝트',
                    icon_type: preview.icon_type ?? null,
                    icon_value: preview.icon_value ?? null,
                    color: preview.color ?? null,
                  }}
                  size={48}
                />
              )}
              <h1 className="text-lg font-bold text-foreground">
                {preview?.name ?? '프로젝트'}
              </h1>
              <p className="text-sm text-muted-foreground">프로젝트에 초대되었습니다.</p>
            </div>

            {submitError && (
              <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
                {submitError}
              </div>
            )}

            {isAuthed ? (
              <button
                onClick={handleJoin}
                disabled={submitting}
                className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-indigo-700 disabled:opacity-50"
              >
                합류하기
              </button>
            ) : authMode === 'signup' ? (
              <>
                <form onSubmit={handleSignup} className="space-y-3">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="이름"
                    className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-indigo-500"
                    autoFocus
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="이메일"
                    className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호"
                    className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={submitting || !name.trim() || !email.trim() || !password}
                    className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-indigo-700 disabled:opacity-50"
                  >
                    가입하고 합류하기
                  </button>
                </form>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  이미 계정이 있으신가요?{' '}
                  <button
                    type="button"
                    onClick={() => { setAuthMode('login'); setSubmitError('') }}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    로그인
                  </button>
                </p>
              </>
            ) : (
              <>
                <form onSubmit={handleLogin} className="space-y-3">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="이메일"
                    className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-indigo-500"
                    autoFocus
                  />
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호"
                    className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={submitting || !email.trim() || !password}
                    className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-indigo-700 disabled:opacity-50"
                  >
                    로그인하고 합류하기
                  </button>
                </form>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  계정이 없으신가요?{' '}
                  <button
                    type="button"
                    onClick={() => { setAuthMode('signup'); setSubmitError('') }}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    가입
                  </button>
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
