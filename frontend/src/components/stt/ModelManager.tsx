/**
 * ModelManager — 온디바이스 STT 모델(Cohere int8 ~2.7GB) 다운로드·관리 UI.
 *
 * 한 컴포넌트에서: 상태(준비됨/용량·미설치) + 다운로드(진행률 %) + 삭제를 처리한다.
 * 설정(SttSettingsPanel)과 오프라인 경로(LocalMeetingsHome / LocalMeetingLivePage 게이트)
 * 양쪽에서 재사용한다 — 오프라인 사용자가 설정에 도달 못해 모델을 못 받던 갭(A21) 해소.
 *
 * 획득 경로(handleDownload): ① adb 스테이징(ensure_cohere_model, 네트워크 불필요) 우선 시도
 * → 없으면 ② 회의 서버에서 스트리밍 다운로드(download_cohere_model). 완전 오프라인(서버 0)
 * 에선 2.7GB를 만들어낼 수 없으므로 "서버 연결 필요"를 정직하게 안내한다(자동결정 A19).
 *
 * Android(Tauri 모바일)에서만 의미가 있어 그 외 플랫폼에선 null.
 */
import { useEffect, useState } from 'react'
import { Download, Trash2, CheckCircle2, Loader2 } from 'lucide-react'

import {
  cohereModelStatus,
  downloadCohereModel,
  ensureCohereModel,
  deleteCohereModel,
  type ModelDownloadProgress,
} from '../../stt/modelDownloader'
import { IS_TAURI, IS_MOBILE, getApiBaseUrl } from '../../config'

/** 바이트 → 사람이 읽는 용량(GB/MB). */
function fmtSize(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`
}

interface Props {
  /** 다운로드/삭제 후 호출 — 호출자가 모델 경로를 재해석(녹음 게이트 갱신)하도록. */
  onChanged?: () => void
  className?: string
}

export default function ModelManager({ onChanged, className }: Props) {
  const [status, setStatus] = useState<{ present: boolean; bytes: number } | null>(null)
  const [busy, setBusy] = useState<'idle' | 'downloading' | 'deleting'>('idle')
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refresh = () =>
    cohereModelStatus()
      .then((s) => setStatus({ present: s.present, bytes: s.bytes }))
      .catch(() => setStatus({ present: false, bytes: 0 }))

  useEffect(() => {
    if (!(IS_TAURI && IS_MOBILE)) return
    refresh()
  }, [])

  // 온디바이스 모델은 Android(Tauri 모바일)에서만 가능.
  if (!(IS_TAURI && IS_MOBILE)) return null

  const handleDownload = async () => {
    setBusy('downloading')
    setError(null)
    setProgress(null)
    try {
      // ① adb 스테이징이 있으면 즉시 복사(네트워크 불필요 — 개발/사전적재 기기).
      let staged = false
      try {
        await ensureCohereModel()
        staged = true
      } catch {
        /* 스테이징 없음 → 네트워크 다운로드로 폴백 */
      }
      // ② 회의 서버에서 스트리밍 다운로드.
      if (!staged) {
        if (!getApiBaseUrl()) {
          throw new Error(
            '서버에 연결되어 있어야 모델을 받을 수 있습니다. Wi-Fi로 회의 서버에 연결한 뒤 다시 시도하세요.',
          )
        }
        await downloadCohereModel((p) => setProgress(p))
      }
      await refresh()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('idle')
      setProgress(null)
    }
  }

  const handleDelete = async () => {
    setBusy('deleting')
    setError(null)
    try {
      await deleteCohereModel()
      await refresh()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('idle')
      setConfirmDelete(false)
    }
  }

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.received / progress.total) * 100)
      : 0

  return (
    <div className={`rounded-md border p-3 ${className ?? ''}`}>
      <p className="text-sm font-semibold mb-1">온디바이스 모델</p>

      {status === null && <p className="text-xs text-muted-foreground">상태 확인 중...</p>}

      {/* 다운로드 중 — 진행률 % */}
      {busy === 'downloading' && (
        <div>
          <p className="flex items-center gap-1 text-sm font-medium mb-1">
            <Loader2 className="w-4 h-4 animate-spin" />
            모델 다운로드 중...
            {progress ? ` (${progress.fileIndex + 1}/${progress.fileCount})` : ''}
          </p>
          <div className="h-2 w-full rounded bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">{pct}%</p>
        </div>
      )}

      {/* 준비됨 — 용량 + 삭제 */}
      {busy !== 'downloading' && status?.present && (
        <div>
          <p className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle2 className="w-4 h-4" />
            준비됨 · {fmtSize(status.bytes)} (오프라인 전사 가능)
          </p>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy !== 'idle'}
              className="mt-2 inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm text-red-600 min-h-[44px] disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" /> 모델 삭제
            </button>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-red-600">{fmtSize(status.bytes)} 삭제할까요?</span>
              <button
                onClick={handleDelete}
                disabled={busy === 'deleting'}
                className="inline-flex items-center rounded-md bg-red-600 px-3 py-2 text-sm text-white min-h-[44px] disabled:opacity-50"
              >
                {busy === 'deleting' ? '삭제 중...' : '삭제'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={busy === 'deleting'}
                className="rounded-md border px-3 py-2 text-sm min-h-[44px]"
              >
                취소
              </button>
            </div>
          )}
        </div>
      )}

      {/* 미설치 — 다운로드 */}
      {busy !== 'downloading' && status && !status.present && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            오프라인 전사를 쓰려면 모델(~2.7GB)을 한 번 받아야 합니다. Wi-Fi + 충분한 저장공간 권장.
            {!getApiBaseUrl() && ' 서버에 연결되어 있어야 다운로드할 수 있습니다.'}
          </p>
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground min-h-[44px]"
          >
            <Download className="w-4 h-4" /> 모델 다운로드
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
