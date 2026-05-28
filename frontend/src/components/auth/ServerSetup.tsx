import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Monitor, Globe, CheckCircle, XCircle, Loader2, Search, Pencil, Trash2 } from 'lucide-react'
import { getDefaultServerUrl, IS_MOBILE, IS_TAURI } from '../../config'
import {
  type SavedServer,
  loadSavedServers,
  upsertOnConnect,
  updateSavedServer,
  removeSavedServer,
  displayHost,
  displayPort,
} from '../../lib/savedServers'

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
  const [foundServers, setFoundServers] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  // 스캔/최근 목록에서 마지막으로 누른 서버 — 선택 표시 + 인라인 상태 아이콘용
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)

  useEffect(() => {
    if (IS_MOBILE) { setMode('server'); return }
    const savedMode = localStorage.getItem('mode')
    if (isValidMode(savedMode)) setMode(savedMode)
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

  /** 스캔/최근 목록에서 서버 선택 → 선택 표시 + URL 채우고 즉시 연결 확인 */
  const pickServer = (url: string) => {
    setSelectedUrl(url)
    setServerUrl(url)
    void checkHealthFor(url)
  }

  const startEdit = (srv: SavedServer) => {
    setEditingUrl(srv.url)
    setEditName(srv.name ?? '')
    setEditLocation(srv.location ?? '')
  }
  const cancelEdit = () => setEditingUrl(null)
  const saveEdit = (url: string) => {
    setSavedServers(updateSavedServer(url, { name: editName, location: editLocation }))
    setEditingUrl(null)
  }

  /** 선택된 서버 줄에 표시할 인라인 상태 아이콘 (진행/성공/실패). */
  const renderRowStatus = (url: string) => {
    if (selectedUrl !== url) return null
    if (healthStatus === 'checking')
      return <Loader2 className="w-4 h-4 shrink-0 animate-spin text-blue-500" />
    if (healthStatus === 'success')
      return <CheckCircle className="w-4 h-4 shrink-0 text-green-600" />
    if (healthStatus === 'error')
      return <XCircle className="w-4 h-4 shrink-0 text-red-500" />
    return null
  }

  /** 같은 Wi-Fi(/24) 대역에서 또박또박 서버를 스캔한다 (Tauri 전용). */
  const handleScan = async () => {
    setScanning(true)
    setScanned(false)
    try {
      const list = await invoke<string[]>('scan_lan_servers', {})
      setFoundServers(list)
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
          <p className="text-slate-500">{IS_MOBILE ? 'AI 회의록 - 서버 주소를 입력하세요' : 'AI 회의록 - 실행 모드를 선택하세요'}</p>
        </div>

        {!IS_MOBILE && (
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
        )}

        {mode === 'server' && (
          <div className="mb-6 space-y-4">
            {IS_TAURI && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={scanning}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
                >
                  {scanning ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> 서버 검색 중...</>
                  ) : (
                    <><Search className="w-4 h-4" /> 같은 Wi-Fi에서 서버 찾기</>
                  )}
                </button>
                {scanning && (
                  <p className="text-xs text-slate-400 text-center">같은 네트워크를 살펴보는 중… 수 초 걸려요</p>
                )}
                {foundServers.map((url) => {
                  const isSelected = selectedUrl === url
                  return (
                    <button
                      key={url}
                      type="button"
                      onClick={() => pickServer(url)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm break-all text-left transition-all active:scale-[0.99] ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500 text-blue-700 font-medium'
                          : 'border-slate-200 text-slate-700 hover:border-blue-400 hover:bg-blue-50 active:bg-blue-100'
                      }`}
                    >
                      <Globe className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-500' : 'text-slate-500'}`} />
                      <span className="truncate flex-1">{url}</span>
                      {renderRowStatus(url)}
                    </button>
                  )
                })}
                {scanned && !scanning && foundServers.length === 0 && (
                  <p className="text-xs text-slate-400">
                    같은 Wi-Fi에서 서버를 찾지 못했어요. 아래에 주소를 직접 입력하세요.
                  </p>
                )}
              </div>
            )}

            {savedServers.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">저장된 서버</p>
                {savedServers.map((srv) => {
                  const isSelected = selectedUrl === srv.url
                  const port = displayPort(srv.url)
                  const host = displayHost(srv.url)
                  const primary = srv.name || host
                  const subParts = [
                    srv.name ? host : null,
                    port ? `포트 ${port}` : null,
                    srv.location || null,
                  ].filter(Boolean)
                  return (
                    <div
                      key={srv.url}
                      className={`rounded-lg border transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                          : 'border-slate-200 hover:border-blue-400'
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => pickServer(srv.url)}
                          className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-sm text-left rounded-lg active:scale-[0.99] transition-transform"
                        >
                          <Globe className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-500' : 'text-slate-500'}`} />
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate ${isSelected ? 'text-blue-700 font-medium' : 'text-slate-700'}`}>{primary}</span>
                            {subParts.length > 0 && (
                              <span className="block truncate text-xs text-slate-400">{subParts.join(' · ')}</span>
                            )}
                          </span>
                          {renderRowStatus(srv.url)}
                        </button>
                        <button
                          type="button"
                          aria-label="편집"
                          onClick={(e) => { e.stopPropagation(); startEdit(srv) }}
                          className="p-2 text-slate-400 hover:text-slate-600 active:scale-90 transition-transform"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="삭제"
                          onClick={(e) => { e.stopPropagation(); setSavedServers(removeSavedServer(srv.url)) }}
                          className="p-2 mr-1 text-slate-400 hover:text-red-500 active:scale-90 transition-transform"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {editingUrl === srv.url && (
                        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-100">
                          <input
                            aria-label="서버 이름"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="이름 (예: 사무실 서버)"
                            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <input
                            aria-label="서버 위치"
                            value={editLocation}
                            onChange={(e) => setEditLocation(e.target.value)}
                            placeholder="위치 (예: 회의실 A)"
                            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={cancelEdit} className="px-3 py-1 text-sm text-slate-500 hover:text-slate-700">취소</button>
                            <button type="button" onClick={() => saveEdit(srv.url)} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">저장</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

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
                  className="flex-1 min-w-0 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
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
