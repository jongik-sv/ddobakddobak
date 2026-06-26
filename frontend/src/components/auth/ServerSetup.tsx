import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { CheckCircle, XCircle, Loader2, Search } from 'lucide-react'
import { getDefaultServerUrl, IS_MOBILE, IS_TAURI } from '../../config'
import {
  type SavedServer,
  loadSavedServers,
  upsertOnConnect,
  upsertServerMeta,
  removeSavedServer,
  displayHost,
  displayPort,
} from '../../lib/savedServers'
import { ServerRow } from './ServerRow'
import { ServerModeSelector } from './ServerModeSelector'
import { mdnsBrowse, probeUrl, setBridgeTarget } from '../../lib/bridge'

/** 디스커버리/스캔으로 찾은 서버 한 건 (이름은 mDNS만 제공, IP 스캔은 없음). */
interface FoundServer {
  name?: string
  url: string
}

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
  // 모바일은 항상 서버 모드 — 로컬/서버 선택 없이 서버 URL 입력만 받는다.
  const [mode, setMode] = useState<Mode | null>(IS_MOBILE ? 'server' : null)
  // 저장된 값이 있으면 그 값, 없으면 config.yaml의 default_server_url을 초기값으로 채운다.
  const [serverUrl, setServerUrl] = useState(() => {
    return localStorage.getItem('server_url') || getDefaultServerUrl()
  })
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('idle')
  const [healthError, setHealthError] = useState<string | null>(null)
  const [savedServers, setSavedServers] = useState<SavedServer[]>(loadSavedServers)
  const [editingUrl, setEditingUrl] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [foundServers, setFoundServers] = useState<FoundServer[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  // 스캔/최근 목록에서 마지막으로 누른 서버 — 선택 표시 + 인라인 상태 아이콘용
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)
  // 저장된 서버별 연결 가능 여부 (url → 상태). 화면 진입 시 1회 자동 확인.
  const [savedHealth, setSavedHealth] = useState<Record<string, HealthStatus>>({})

  useEffect(() => {
    if (IS_MOBILE) { setMode('server'); return }
    const savedMode = localStorage.getItem('mode')
    if (isValidMode(savedMode)) setMode(savedMode)
  }, [])

  // 저장된 서버 각각의 연결 가능 여부를 화면 진입 시 1회 병렬 확인한다.
  useEffect(() => {
    const servers = loadSavedServers()
    if (servers.length === 0) return
    setSavedHealth(Object.fromEntries(servers.map((s) => [s.url, 'checking' as HealthStatus])))
    servers.forEach(async (s) => {
      const status = await probeHealth(s.url)
      setSavedHealth((prev) => ({ ...prev, [s.url]: status }))
    })
  }, [])

  const handleUrlChange = (value: string) => {
    setServerUrl(value)
    if (healthStatus !== 'idle') {
      setHealthStatus('idle')
      setHealthError(null)
    }
  }

  const checkHealthFor = async (url: string) => {
    setHealthStatus('checking')
    setHealthError(null)

    try {
      const normalizedUrl = normalizeUrl(url)

      // 모바일(Tauri): webview에서 평문 http 호출은 mixed-content로 차단되므로
      // 네이티브 probe_url로 도달 여부만 확인한다(HTTP 상태/타임아웃 구분 없음).
      if (IS_TAURI && IS_MOBILE) {
        const reachable = await probeUrl(normalizedUrl)
        if (reachable) {
          setHealthStatus('success')
        } else {
          setHealthStatus('error')
          setHealthError('서버에 연결할 수 없습니다. URL을 확인해주세요.')
        }
        return
      }

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

  const checkHealth = () => checkHealthFor(serverUrl)

  /** 전역 상태/선택을 건드리지 않고 한 서버의 연결 가능 여부만 조용히 확인한다. */
  const probeHealth = async (url: string): Promise<HealthStatus> => {
    // 모바일(Tauri): mixed-content 회피를 위해 네이티브 probe_url 사용.
    if (IS_TAURI && IS_MOBILE) {
      return (await probeUrl(normalizeUrl(url))) ? 'success' : 'error'
    }
    try {
      const response = await fetch(`${normalizeUrl(url)}/api/v1/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      })
      return response.ok ? 'success' : 'error'
    } catch {
      return 'error'
    }
  }

  /** 스캔/최근 목록에서 서버 선택 → 선택 표시 + URL 채우고 즉시 연결 확인 */
  const pickServer = async (url: string) => {
    setSelectedUrl(url)
    setServerUrl(url)
    // 모바일: 헬스 체크 전에 브릿지 전달 대상을 먼저 맞춰둔다(이후 실제 API 호출 대비).
    if (IS_TAURI && IS_MOBILE) {
      try {
        await setBridgeTarget(normalizeUrl(url))
      } catch {
        /* ignore */
      }
    }
    void checkHealthFor(url)
  }

  const startEdit = (url: string, name?: string, location?: string) => {
    setEditingUrl(url)
    setEditName(name ?? '')
    setEditLocation(location ?? '')
  }
  const cancelEdit = () => setEditingUrl(null)
  const saveEdit = (url: string) => {
    setSavedServers(upsertServerMeta(url, { name: editName, location: editLocation }))
    setEditingUrl(null)
  }

  /** 이름/위치 인라인 편집 폼 — 저장된 서버 / 스캔 서버 양쪽에서 재사용. */
  const renderEditForm = (url: string) =>
    editingUrl === url ? (
      <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border">
        <input
          aria-label="서버 이름"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="이름 (예: 사무실 서버)"
          className="w-full px-2 py-1.5 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          aria-label="서버 위치"
          value={editLocation}
          onChange={(e) => setEditLocation(e.target.value)}
          placeholder="위치 (예: 회의실 A)"
          className="w-full px-2 py-1.5 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cancelEdit} className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground">취소</button>
          <button type="button" onClick={() => saveEdit(url)} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">저장</button>
        </div>
      </div>
    ) : null

  /** 상태값 → 인라인 아이콘 (진행/성공/실패). */
  const statusIcon = (status: HealthStatus) => {
    if (status === 'checking')
      return <Loader2 aria-label="연결 확인 중" className="w-4 h-4 shrink-0 animate-spin text-blue-500" />
    if (status === 'success')
      return <CheckCircle aria-label="연결 가능" className="w-4 h-4 shrink-0 text-green-600" />
    if (status === 'error')
      return <XCircle aria-label="연결 불가" className="w-4 h-4 shrink-0 text-red-500" />
    return null
  }

  /** 선택된 서버 줄에 표시할 인라인 상태 아이콘 (진행/성공/실패). */
  const renderRowStatus = (url: string) =>
    selectedUrl === url ? statusIcon(healthStatus) : null

  /** 저장된 서버 줄: 방금 선택해 확인 중이면 실시간 상태, 아니면 자동 확인 결과. */
  const renderSavedStatus = (url: string) =>
    selectedUrl === url && healthStatus !== 'idle'
      ? statusIcon(healthStatus)
      : statusIcon(savedHealth[url] ?? 'idle')

  /**
   * 같은 Wi-Fi에서 또박또박 서버를 찾는다 (Tauri 전용).
   * - 모바일: mDNS 브라우즈(이름 포함). webview IP 스캔은 mixed-content로 불가.
   * - 데스크톱: 기존 /24 대역 IP 스캔(이름 없음).
   */
  const handleScan = async () => {
    setScanning(true)
    setScanned(false)
    try {
      if (IS_MOBILE) {
        const list = await mdnsBrowse()
        setFoundServers(list)
      } else {
        const list = await invoke<string[]>('scan_lan_servers', {})
        setFoundServers(list.map((url) => ({ url })))
      }
    } catch {
      setFoundServers([])
    } finally {
      setScanning(false)
      setScanned(true)
    }
  }

  const handleComplete = () => {
    if (mode === 'local') {
      localStorage.setItem('mode', 'local')
      localStorage.removeItem('server_url')
    } else if (mode === 'server') {
      const normalized = normalizeUrl(serverUrl)
      localStorage.setItem('mode', 'server')
      localStorage.setItem('server_url', normalized)
      setSavedServers(upsertOnConnect(normalized))
      // 모바일: 앱 세션 동안 브릿지가 최종 선택 서버를 가리키도록 한다.
      if (IS_TAURI && IS_MOBILE) {
        void setBridgeTarget(normalized)
      }
    }
    onComplete()
  }

  const isStartEnabled =
    mode === 'local' || (mode === 'server' && healthStatus === 'success')

  // 스캔 줄에 저장된 이름/위치를 함께 보여주고, 같은 서버가 "저장된 서버" 목록에 중복되지 않게 한다.
  const foundNormalized = new Set(foundServers.map((s) => normalizeUrl(s.url)))
  const savedByUrl = new Map(savedServers.map((s) => [s.url, s]))
  const savedOnly = savedServers.filter((s) => !foundNormalized.has(s.url))

  return (
    <div className="min-h-screen bg-gradient-to-br from-muted to-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-card rounded-2xl shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">또박또박</h1>
          <p className="text-muted-foreground">{IS_MOBILE ? 'AI 회의록 - 서버 주소를 입력하세요' : 'AI 회의록 - 실행 모드를 선택하세요'}</p>
        </div>

        {!IS_MOBILE && (
          <ServerModeSelector
            mode={mode}
            onSelectLocal={() => {
              setMode('local')
              setHealthStatus('idle')
              setHealthError(null)
            }}
            onSelectServer={() => setMode('server')}
          />
        )}

        {mode === 'server' && (
          <div className="mb-6 space-y-4">
            {IS_TAURI && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={scanning}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-accent active:bg-foreground/10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
                >
                  {scanning ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> 서버 검색 중...</>
                  ) : (
                    <><Search className="w-4 h-4" /> 같은 Wi-Fi에서 서버 찾기</>
                  )}
                </button>
                {scanning && (
                  <p className="text-xs text-muted-foreground text-center">같은 네트워크를 살펴보는 중… 수 초 걸려요</p>
                )}
                {foundServers.map((found) => {
                  const url = found.url
                  const nurl = normalizeUrl(url)
                  const meta = savedByUrl.get(nurl)
                  // 표시 이름: 저장된 이름 > mDNS 이름 > URL. 이름이 있으면 URL을 보조 줄에 둔다.
                  const primary = meta?.name || found.name || url
                  const hasName = primary !== url
                  const sub = [hasName ? url : null, meta?.location]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <ServerRow
                      key={url}
                      selected={selectedUrl === url}
                      displayText={primary}
                      displayClassName={hasName ? 'truncate' : 'break-all'}
                      sub={sub || null}
                      statusNode={renderRowStatus(url)}
                      onPick={() => pickServer(url)}
                      onEdit={() => startEdit(nurl, meta?.name ?? found.name, meta?.location)}
                      editForm={renderEditForm(nurl)}
                    />
                  )
                })}
                {scanned && !scanning && foundServers.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    같은 Wi-Fi에서 서버를 찾지 못했어요. 아래에 주소를 직접 입력하세요.
                  </p>
                )}
              </div>
            )}

            {savedOnly.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">저장된 서버</p>
                {savedOnly.map((srv) => {
                  const port = displayPort(srv.url)
                  const host = displayHost(srv.url)
                  const primary = srv.name || host
                  const subParts = [
                    srv.name ? host : null,
                    port ? `포트 ${port}` : null,
                    srv.location || null,
                  ].filter(Boolean)
                  return (
                    <ServerRow
                      key={srv.url}
                      selected={selectedUrl === srv.url}
                      displayText={primary}
                      displayClassName="truncate"
                      sub={subParts.length > 0 ? subParts.join(' · ') : null}
                      statusNode={renderSavedStatus(srv.url)}
                      onPick={() => pickServer(srv.url)}
                      onEdit={() => startEdit(srv.url, srv.name, srv.location)}
                      onDelete={() => setSavedServers(removeSavedServer(srv.url))}
                      editForm={renderEditForm(srv.url)}
                    />
                  )
                })}
              </div>
            )}

            <div>
              <label
                htmlFor="server-url"
                className="block text-sm font-medium text-foreground mb-2"
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
                  className="flex-1 min-w-0 px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
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
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
            className="w-full mt-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            취소
          </button>
        )}
      </div>
    </div>
  )
}
