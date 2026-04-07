import { useState, useEffect } from 'react'
import { Monitor, Globe, CheckCircle, XCircle, Loader2 } from 'lucide-react'

type Mode = 'local' | 'server'
type HealthStatus = 'idle' | 'checking' | 'success' | 'error'

function isValidMode(value: string | null): value is Mode {
  return value === 'local' || value === 'server'
}

const DEFAULT_PORT = '13323'

/** URL을 정규화한다: 스킴 없으면 http 추가, 포트 없으면 기본 포트 추가, 후행 슬래시 제거. */
function normalizeUrl(url: string): string {
  let u = url.trim()
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  try {
    const parsed = new URL(u)
    if (!parsed.port) parsed.port = DEFAULT_PORT
    return parsed.origin
  } catch {
    return u.replace(/\/+$/, '')
  }
}

interface ServerSetupProps {
  onComplete: () => void
  onCancel?: () => void
}

export function ServerSetup({ onComplete, onCancel }: ServerSetupProps) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('idle')
  const [healthError, setHealthError] = useState<string | null>(null)

  useEffect(() => {
    const savedMode = localStorage.getItem('mode')
    const savedUrl = localStorage.getItem('server_url')
    if (isValidMode(savedMode)) setMode(savedMode)
    if (savedUrl) setServerUrl(savedUrl)
  }, [])

  const handleUrlChange = (value: string) => {
    setServerUrl(value)
    if (healthStatus !== 'idle') {
      setHealthStatus('idle')
      setHealthError(null)
    }
  }

  const checkHealth = async () => {
    setHealthStatus('checking')
    setHealthError(null)

    try {
      const normalizedUrl = normalizeUrl(serverUrl)

      const response = await fetch(`${normalizedUrl}/api/v1/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      if (response.ok) {
        setHealthStatus('success')
      } else {
        setHealthStatus('error')
        setHealthError(`서버 응답 오류 (HTTP ${response.status})`)
      }
    } catch (err) {
      setHealthStatus('error')
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        setHealthError('서버 응답 시간이 초과되었습니다 (5초)')
      } else {
        setHealthError('서버에 연결할 수 없습니다. URL을 확인해주세요.')
      }
    }
  }

  const handleComplete = () => {
    if (mode === 'local') {
      localStorage.setItem('mode', 'local')
      localStorage.removeItem('server_url')
    } else if (mode === 'server') {
      localStorage.setItem('mode', 'server')
      localStorage.setItem('server_url', normalizeUrl(serverUrl))
    }
    onComplete()
  }

  const isStartEnabled =
    mode === 'local' || (mode === 'server' && healthStatus === 'success')

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-800 mb-2">또박또박</h1>
          <p className="text-slate-500">AI 회의록 - 실행 모드를 선택하세요</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            type="button"
            aria-pressed={mode === 'local'}
            onClick={() => {
              setMode('local')
              setHealthStatus('idle')
              setHealthError(null)
            }}
            className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all cursor-pointer ${
              mode === 'local'
                ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <Monitor className="w-8 h-8 text-slate-600" />
            <span className="font-semibold text-slate-800">로컬 실행</span>
            <span className="text-sm text-slate-500 text-center">
              이 컴퓨터에서 직접 실행합니다
            </span>
          </button>

          <button
            type="button"
            aria-pressed={mode === 'server'}
            onClick={() => setMode('server')}
            className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all cursor-pointer ${
              mode === 'server'
                ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <Globe className="w-8 h-8 text-slate-600" />
            <span className="font-semibold text-slate-800">서버 연결</span>
            <span className="text-sm text-slate-500 text-center">
              원격 서버에 연결하여 사용합니다
            </span>
          </button>
        </div>

        {mode === 'server' && (
          <div className="mb-6 space-y-4">
            <div>
              <label
                htmlFor="server-url"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                서버 URL
              </label>
              <div className="flex gap-2">
                <input
                  id="server-url"
                  type="url"
                  value={serverUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="192.168.0.10 또는 http://example.com:13323"
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
                <button
                  type="button"
                  onClick={checkHealth}
                  disabled={!serverUrl.trim() || healthStatus === 'checking'}
                  className="px-4 py-2 bg-slate-600 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {healthStatus === 'checking' ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      확인 중
                    </span>
                  ) : (
                    '연결 확인'
                  )}
                </button>
              </div>
            </div>

            <div role="status" aria-live="polite">
              {healthStatus === 'checking' && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>서버에 연결 중...</span>
                </div>
              )}
              {healthStatus === 'success' && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  <span>서버 연결 성공</span>
                </div>
              )}
              {healthStatus === 'error' && healthError && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <XCircle className="w-4 h-4" />
                  <span>{healthError}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleComplete}
          disabled={!isStartEnabled}
          className="w-full py-3 rounded-xl text-white font-semibold text-base transition-all bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          시작하기
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full mt-3 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
          >
            취소
          </button>
        )}
      </div>
    </div>
  )
}
