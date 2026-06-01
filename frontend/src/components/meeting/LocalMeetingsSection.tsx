/**
 * LocalMeetingsSection — 오프라인(온디바이스) 회의 진입점 + "기기 저장(미동기)" 버킷.
 *
 * 서버 numeric id와 네임스페이스를 분리(localId string)해 타입 churn 0. Android(Tauri
 * 모바일)에서만 노출. "오프라인 회의 시작"이 createLocal 후 /local-meetings/:id/live로
 * 라우팅한다(서버 lifecycle 우회 — 완전 오프라인 생성).
 *
 * 설계: docs/superpowers/specs/2026-06-01-ondevice-stt-local-mode-design.md §4.5.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, WifiOff, UploadCloud, Check } from 'lucide-react'

import * as localStore from '../../stt/localStore'
import type { LocalMeetingMeta } from '../../stt/localStore'
import { flush as syncFlush } from '../../stt/syncQueue'
import { useAppSettingsStore } from '../../stores/appSettingsStore'
import { IS_TAURI, IS_MOBILE } from '../../config'

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

export function LocalMeetingsSection() {
  const navigate = useNavigate()
  const [metas, setMetas] = useState<LocalMeetingMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const localUploadEnabled = useAppSettingsStore((s) => s.localUploadEnabled)

  const refresh = useCallback(() => {
    localStore.listLocal().then(setMetas).catch(() => setMetas([]))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Android(Tauri 모바일)에서만. 그 외 플랫폼은 온디바이스 STT 비대상.
  if (!(IS_TAURI && IS_MOBILE)) return null

  const handleCreate = async () => {
    setBusy(true)
    try {
      const title = `오프라인 회의 ${fmtDate(new Date().toISOString())}`
      const localId = await localStore.createLocal({ title, lang: 'ko' })
      navigate(`/local-meetings/${localId}/live`)
    } catch (e) {
      console.error('[LocalMeetings] 생성 실패:', e)
      setBusy(false)
    }
  }

  const handleUpload = async (localId: string) => {
    setUploadingId(localId)
    try {
      await syncFlush(localId)
      refresh()
    } catch (e) {
      console.error('[LocalMeetings] 업로드 실패:', e)
    } finally {
      setUploadingId(null)
    }
  }

  return (
    <div className="mb-6 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">기기 저장 (오프라인)</h2>
        </div>
        <button
          onClick={handleCreate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground min-h-[44px] disabled:opacity-50"
        >
          <Mic className="w-4 h-4" /> 오프라인 회의 시작
        </button>
      </div>

      {metas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          서버 없이 폰에서 녹음·전사하는 회의입니다. 기록은 기기에 저장됩니다.
        </p>
      ) : (
        <ul className="space-y-1">
          {metas.map((m) => (
            <li
              key={m.localId}
              className="flex items-center gap-2 rounded-md p-2 hover:bg-accent/50"
            >
              <button
                onClick={() => navigate(`/local-meetings/${m.localId}/live`)}
                className="flex-1 min-w-0 text-left"
              >
                <p className="text-sm font-medium truncate">{m.title}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDate(m.created_at)} · {m.lang.toUpperCase()} ·{' '}
                  {m.serverId ? '서버 동기됨' : '기기 저장'}
                </p>
              </button>
              {m.serverId ? (
                <Check className="w-4 h-4 text-green-600 shrink-0" />
              ) : (
                localUploadEnabled && (
                  <button
                    onClick={() => handleUpload(m.localId)}
                    disabled={uploadingId === m.localId}
                    className="p-2 rounded-md hover:bg-accent shrink-0 disabled:opacity-50"
                    aria-label="서버로 업로드"
                  >
                    <UploadCloud className="w-4 h-4" />
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
