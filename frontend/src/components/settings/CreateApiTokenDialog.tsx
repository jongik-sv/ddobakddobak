import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import {
  createApiToken,
  API_TOKEN_SCOPES,
  type ApiToken,
  type ApiTokenScope,
  type ApiTokenCreateResult,
} from '../../api/apiTokens'
import { confirmDialog } from '../../lib/confirmDialog'
import { errorToMessage } from '../../lib/errors'
import { downloadText } from '../../lib/download'
import { getApiOrigin } from '../../config'

const SCOPE_LABELS: Record<ApiTokenScope, string> = {
  'meetings:read': '회의 조회',
  'transcripts:read': '전사 조회',
  'summaries:read': '요약 조회',
  'search:read': '검색',
  'meetings:write': '회의 쓰기',
}

const DEFAULT_SCOPES: ApiTokenScope[] = ['meetings:read', 'transcripts:read', 'summaries:read', 'search:read']

function defaultExpiry(): string {
  const d = new Date()
  d.setDate(d.getDate() + 90)
  return d.toISOString().slice(0, 10)
}

/** API 토큰 발급 다이얼로그 — 발급 폼과, 발급 직후 평문 1회 표시 화면을 하나로 관리한다. */
export function CreateApiTokenDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (token: ApiToken) => void
}) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Set<ApiTokenScope>>(new Set(DEFAULT_SCOPES))
  const [expiresAt, setExpiresAt] = useState(defaultExpiry())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ApiTokenCreateResult | null>(null)
  const [copied, setCopied] = useState(false)

  const toggleScope = (s: ApiTokenScope) => {
    setScopes((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const canSubmit = name.trim().length > 0 && scopes.size > 0 && expiresAt.length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      const res = await createApiToken({
        name: name.trim(),
        scopes: Array.from(scopes),
        expires_at: expiresAt,
      })
      setResult(res)
      onCreated(res.token)
    } catch (err) {
      setError(await errorToMessage(err, '토큰 발급에 실패했습니다.'))
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result.plaintext)
    setCopied(true)
  }

  const handleDownloadEnvFile = async () => {
    if (!result) return
    // window.location.origin은 Tauri 데스크톱 앱에서 http://tauri.localhost로 고정돼
    // 있어 실제 API 서버 주소가 아니다(reference_android_cors_origin과 동일 함정).
    // getApiOrigin()이 웹/로컬/서버 모드별 실제 접속 origin을 계산해 준다.
    const apiOrigin = getApiOrigin() || window.location.origin
    const content = [
      `DDOBAK_API_URL=${apiOrigin}`,
      `DDOBAK_API_TOKEN=${result.plaintext}`,
      '# DDOBAK_API_INSECURE=1   ← 자체 서명 인증서일 때만 주석 해제',
      '',
    ].join('\n')
    await downloadText(content, '.env.ddobak', 'text/plain;charset=utf-8')
  }

  const handleCloseReveal = async () => {
    if (!(await confirmDialog('닫으면 이 토큰 값을 다시 볼 수 없습니다. 안전한 곳에 복사해 두셨나요?'))) return
    onClose()
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
        <div className="w-full max-w-md rounded-xl bg-card shadow-2xl border border-border p-6 mx-4">
          <h3 className="text-lg font-semibold mb-2">토큰이 발급되었습니다</h3>
          <p className="text-sm text-muted-foreground mb-3">
            이 토큰 값은 지금만 표시됩니다. 창을 닫으면 다시 볼 수 없으니 안전한 곳에 복사해 두세요.
          </p>
          <div className="flex items-center gap-2 mb-4">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono break-all">
              {result.plaintext}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2 rounded-md text-sm font-medium border border-border hover:bg-accent min-h-[44px]"
            >
              {copied ? '복사됨' : '복사'}
            </button>
          </div>

          <div className="mb-4">
            <button
              type="button"
              onClick={handleDownloadEnvFile}
              className="w-full px-3 py-2 rounded-md text-sm font-medium border border-border hover:bg-accent min-h-[44px]"
            >
              설정 파일(.env.ddobak) 다운로드
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              압축을 푼 스킬 폴더 루트(SKILL.md와 같은 위치)에 넣으세요. Claude Code 기본
              설치 경로 예시:
            </p>
            <code className="mt-1 block rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
              ~/.claude/skills/ddobak-meetings/.env.ddobak
            </code>
            <code className="mt-1 block rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
              %USERPROFILE%\.claude\skills\ddobak-meetings\.env.ddobak
            </code>
            <p className="mt-2 text-xs text-muted-foreground">
              브라우저에 따라 <code className="font-mono">env.ddobak</code>(점 없음)으로
              저장될 수 있는데, 이름을 바꾸지 않아도 그대로 동작합니다.
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCloseReveal}
              className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 min-h-[44px]"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl bg-card shadow-2xl border border-border p-6 mx-4"
      >
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <KeyRound className="w-5 h-5" />
          API 토큰 발급
        </h3>

        <div className="space-y-3">
          <div>
            <label htmlFor="token-name" className="block text-sm font-medium mb-1">이름</label>
            <input
              id="token-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: Claude Code 연동"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
            />
          </div>

          <fieldset>
            <legend className="block text-sm font-medium mb-1">스코프</legend>
            <div className="space-y-1.5">
              {API_TOKEN_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scopes.has(s)}
                    onChange={() => toggleScope(s)}
                    className="rounded border-border"
                  />
                  {SCOPE_LABELS[s]}
                  <span className="text-xs text-muted-foreground font-mono">{s}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="token-expires" className="block text-sm font-medium mb-1">만료일</label>
            <input
              id="token-expires"
              type="date"
              required
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium border border-border text-foreground hover:bg-accent transition-colors min-h-[44px]"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving || !canSubmit}
            className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {saving ? '발급 중...' : '발급'}
          </button>
        </div>
      </form>
    </div>
  )
}
