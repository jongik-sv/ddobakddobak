import { useEffect, useState } from 'react'
import { Plus, Trash2, Download } from 'lucide-react'
import { listApiTokens, deleteApiToken, downloadSkillPackage, type ApiToken, type ApiTokenScope } from '../../api/apiTokens'
import { confirmDialog } from '../../lib/confirmDialog'
import { errorToMessage } from '../../lib/errors'
import { formatDate } from '../../lib/meetingFormat'
import { CreateApiTokenDialog } from './CreateApiTokenDialog'

const SCOPE_LABELS: Record<ApiTokenScope, string> = {
  'meetings:read': '회의 조회',
  'transcripts:read': '전사 조회',
  'summaries:read': '요약 조회',
  'search:read': '검색',
  'meetings:write': '회의 쓰기',
}

/** 설정 화면 "API 토큰" 섹션. PAT 발급·목록·폐기 + LLM 스킬 패키지 다운로드. */
export default function ApiTokensPanel() {
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const loadTokens = async () => {
    setLoading(true)
    setError(null)
    try {
      setTokens(await listApiTokens())
    } catch {
      setError('토큰 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTokens()
  }, [])

  const handleRevoke = async (t: ApiToken) => {
    if (!(await confirmDialog(`'${t.name}' 토큰을 폐기할까요? 이 토큰을 쓰는 연동은 즉시 인증에 실패합니다.`))) return
    try {
      await deleteApiToken(t.id)
      await loadTokens()
    } catch (err) {
      setError(await errorToMessage(err, '토큰 폐기에 실패했습니다.'))
    }
  }

  const handleDownloadSkill = async () => {
    setDownloading(true)
    setError(null)
    try {
      await downloadSkillPackage()
    } catch {
      setError('LLM 스킬 패키지를 내려받지 못했습니다.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between mb-4 gap-x-4 gap-y-3">
        <div className="min-w-[14rem] flex-1">
          <h2 className="text-lg font-semibold">API 토큰</h2>
          <p className="text-sm text-muted-foreground">
            외부 도구·에이전트가 내 회의 데이터에 접근할 때 쓸 개인 액세스 토큰을 발급·관리합니다.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownloadSkill}
            disabled={downloading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border hover:bg-accent transition-colors disabled:opacity-50 min-h-[44px]"
          >
            <Download className="w-4 h-4" />
            {downloading ? '내려받는 중...' : 'LLM 스킬 다운로드'}
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            토큰 발급
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground py-8 text-center">불러오는 중...</p>}

      {error && (
        <p className="text-sm text-red-600 mb-3" role="alert">{error}</p>
      )}

      {!loading && tokens.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">발급된 토큰이 없습니다.</p>
      )}

      {!loading && tokens.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 font-medium">이름</th>
                <th className="pb-2 font-medium">토큰</th>
                <th className="pb-2 font-medium">스코프</th>
                <th className="pb-2 font-medium">만료일</th>
                <th className="pb-2 font-medium">마지막 사용</th>
                <th className="pb-2 font-medium">상태</th>
                <th className="pb-2 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td className="py-3 font-medium">{t.name}</td>
                  <td className="py-3 font-mono text-xs text-muted-foreground">{t.token_prefix}••••••••</td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <span key={s} className="rounded bg-accent px-1.5 py-0.5 text-xs">
                          {SCOPE_LABELS[s] ?? s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 text-muted-foreground">{t.expires_at ? formatDate(t.expires_at) : '없음'}</td>
                  <td className="py-3 text-muted-foreground">
                    {t.last_used_at ? formatDate(t.last_used_at) : '사용 안 함'}
                  </td>
                  <td className="py-3">
                    {t.revoked_at ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                        폐기됨
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        활성
                      </span>
                    )}
                  </td>
                  <td className="py-3">
                    {!t.revoked_at && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(t)}
                        aria-label={`${t.name} 폐기`}
                        title="토큰 폐기"
                        className="p-2.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateApiTokenDialog
          onClose={() => setShowCreate(false)}
          onCreated={(token) => setTokens((prev) => [token, ...prev])}
        />
      )}
    </div>
  )
}
