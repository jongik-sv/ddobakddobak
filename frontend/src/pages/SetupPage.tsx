import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react'

interface EnvironmentStatus {
  ruby: string | null
  uv: string | null
  ffmpeg: string | null
  platform: string
  all_ready: boolean
}

interface HealthStatus {
  backend: boolean
  sidecar: boolean
}

interface SetupProgress {
  step: string
  message: string
  done: boolean
  error: string | null
}

type Phase = 'env_check' | 'setup' | 'starting' | 'health_wait' | 'ready' | 'error'

function StatusIcon({ status }: { status: 'ok' | 'fail' | 'loading' }) {
  if (status === 'ok') return <CheckCircle className="w-5 h-5 text-green-500" />
  if (status === 'fail') return <XCircle className="w-5 h-5 text-red-500" />
  return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
}

export default function SetupPage({ onReady }: { onReady: () => void }) {
  const [phase, setPhase] = useState<Phase>('env_check')
  const [envStatus, setEnvStatus] = useState<EnvironmentStatus | null>(null)
  const [progress, setProgress] = useState<SetupProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthStatus>({ backend: false, sidecar: false })

  // 셋업 진행률 이벤트 수신
  useEffect(() => {
    const unlisten = listen<SetupProgress>('setup-progress', (event) => {
      setProgress(event.payload)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  // 헬스 체크 폴링
  useEffect(() => {
    if (phase !== 'health_wait') return
    const interval = setInterval(async () => {
      try {
        const h = await invoke<HealthStatus>('check_health')
        setHealth(h)
        if (h.backend && h.sidecar) {
          clearInterval(interval)
          setPhase('ready')
          setTimeout(onReady, 800)
        }
      } catch {
        // 재시도
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [phase, onReady])

  // 1단계: 환경 확인
  useEffect(() => {
    checkEnvironment()
  }, [])

  const checkEnvironment = useCallback(async () => {
    try {
      const status = await invoke<EnvironmentStatus>('check_environment')
      setEnvStatus(status)
      if (status.all_ready) {
        await proceedAfterEnvCheck()
      }
    } catch (err) {
      setError(String(err))
      setPhase('error')
    }
  }, [])

  const proceedAfterEnvCheck = useCallback(async () => {
    try {
      const isFirstRun = await invoke<boolean>('check_first_run')
      if (isFirstRun) {
        setPhase('setup')
        await invoke('run_initial_setup')
      }
      setPhase('starting')
      await invoke('start_services')
      setPhase('health_wait')
    } catch (err) {
      setError(String(err))
      setPhase('error')
    }
  }, [])

  const [installing, setInstalling] = useState(false)

  const autoInstall = useCallback(async () => {
    setInstalling(true)
    setError(null)
    try {
      const status = await invoke<EnvironmentStatus>('install_dependencies')
      setEnvStatus(status)
      if (status.all_ready) {
        await proceedAfterEnvCheck()
      }
    } catch (err) {
      setError(String(err))
      setPhase('error')
    } finally {
      setInstalling(false)
    }
  }, [proceedAfterEnvCheck])

  const retry = useCallback(() => {
    setError(null)
    setPhase('env_check')
    checkEnvironment()
  }, [checkEnvironment])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-8">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">또박또박</h1>
          <p className="text-slate-500 mt-1">AI 회의록 서비스를 준비하고 있습니다</p>
        </div>

        {/* 환경 확인 */}
        <div className="space-y-3 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            환경 확인
          </h2>
          <EnvItem
            label="Ruby"
            version={envStatus?.ruby}
            checked={envStatus !== null}
          />
          <EnvItem
            label="uv (Python)"
            version={envStatus?.uv}
            checked={envStatus !== null}
          />
          <EnvItem
            label="ffmpeg"
            version={envStatus?.ffmpeg}
            checked={envStatus !== null}
          />
        </div>

        {/* 환경 미충족 시 안내 */}
        {envStatus && !envStatus.all_ready && phase === 'env_check' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">필수 도구가 설치되지 않았습니다</p>
                <ul className="mt-2 space-y-1 text-amber-700">
                  {!envStatus.ruby && <li>Ruby: <code>brew install ruby</code></li>}
                  {!envStatus.uv && (
                    <li>uv: <code>curl -LsSf https://astral.sh/uv/install.sh | sh</code></li>
                  )}
                  {!envStatus.ffmpeg && <li>ffmpeg: <code>brew install ffmpeg</code></li>}
                </ul>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={autoInstall}
                    disabled={installing}
                    className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {installing ? '설치 중...' : '자동 설치'}
                  </button>
                  <button
                    onClick={retry}
                    className="px-4 py-1.5 bg-amber-600 text-white text-sm rounded-md hover:bg-amber-700 transition"
                  >
                    다시 확인
                  </button>
                </div>
                {installing && progress && (
                  <p className="mt-2 text-xs text-blue-700">{progress.message}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 셋업 진행 */}
        {(phase === 'setup' || phase === 'starting' || phase === 'health_wait' || phase === 'ready') && (
          <div className="space-y-3 mb-6">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
              서비스 준비
            </h2>

            {progress && !progress.done && (
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                {progress.message}
              </div>
            )}

            {(phase === 'starting' || phase === 'health_wait') && (
              <div className="space-y-2">
                <ServiceItem label="Backend (Rails)" ready={health.backend} />
                <ServiceItem label="Sidecar (Python)" ready={health.sidecar} />
              </div>
            )}

            {phase === 'ready' && (
              <div className="flex items-center gap-2 text-green-600 font-medium">
                <CheckCircle className="w-5 h-5" />
                준비 완료!
              </div>
            )}
          </div>
        )}

        {/* 에러 */}
        {phase === 'error' && error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-2">
              <XCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
              <div className="text-sm text-red-800">
                <p className="font-medium">오류가 발생했습니다</p>
                <pre className="mt-2 text-xs bg-red-100 p-2 rounded overflow-auto max-h-32">
                  {error}
                </pre>
                <button
                  onClick={retry}
                  className="mt-3 px-4 py-1.5 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 transition"
                >
                  다시 시도
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 플랫폼 정보 */}
        {envStatus && (
          <p className="text-xs text-slate-400 text-center">
            {envStatus.platform}
          </p>
        )}
      </div>
    </div>
  )
}

function EnvItem({
  label,
  version,
  checked,
}: {
  label: string
  version: string | null | undefined
  checked: boolean
}) {
  const status = !checked ? 'loading' : version ? 'ok' : 'fail'
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
      <div className="flex items-center gap-2">
        <StatusIcon status={status} />
        <span className="text-sm font-medium text-slate-700">{label}</span>
      </div>
      {version && (
        <span className="text-xs text-slate-400 font-mono truncate max-w-48">
          {version}
        </span>
      )}
    </div>
  )
}

function ServiceItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center gap-2 py-2 px-3 bg-slate-50 rounded-lg">
      <StatusIcon status={ready ? 'ok' : 'loading'} />
      <span className="text-sm text-slate-700">{label}</span>
    </div>
  )
}
