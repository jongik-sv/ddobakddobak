/**
 * LocalMeetingLivePage — 완전 오프라인(서버 없음) 온디바이스 회의 녹음 화면.
 *
 * /local-meetings/:localId/live 라우트. useLocalRecording으로 서버 lifecycle 없이
 * 녹음→온디바이스 전사→로컬 영속을 수행한다. 전사 줄은 transcriptStore.finals를
 * 그대로 렌더(서버 모드와 동일 shape).
 *
 * 축소 기능 안내: AI 요약/공유/refine은 업로드(프로모트) 후 서버에서. 설계 §2.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { Mic, Square, ArrowLeft, WifiOff } from 'lucide-react'

import { useLocalRecording } from '../hooks/useLocalRecording'
import { useTranscriptStore } from '../stores/transcriptStore'
import { getLanguageSettings } from '../api/settings'
import { localSttLanguage } from '../stt/cohereLang'
import { IS_TAURI } from '../config'

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function LocalMeetingLivePage() {
  const { localId } = useParams<{ localId: string }>()
  const navigate = useNavigate()

  const [language, setLanguage] = useState('ko')
  const [modelDir, setModelDir] = useState<string | null>(null)
  const [resolving, setResolving] = useState(true)
  const [resolveErr, setResolveErr] = useState<string | null>(null)

  // 모델 경로 + 언어 결정(creator 권위 = 현재 사용자, 오프라인이면 기본 ko).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await getLanguageSettings().catch(
          () => ({ mode: 'single' as const, languages: ['ko'] }),
        )
        const lang = localSttLanguage(cfg) ?? 'ko'
        let dir: string | null = null
        if (IS_TAURI) {
          const paths = await invoke<{ dir: string }>('resolve_model_paths').catch(() => null)
          dir = paths?.dir ?? null
        }
        if (cancelled) return
        setLanguage(lang)
        setModelDir(dir)
        if (!dir) setResolveErr('온디바이스 모델이 아직 준비되지 않았습니다. 설정에서 모델을 받아주세요.')
      } catch (e) {
        if (!cancelled) setResolveErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setResolving(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const rec = useLocalRecording(localId ?? '', language, modelDir)
  const finals = useTranscriptStore((s) => s.finals)

  if (!localId) {
    navigate('/meetings', { replace: true })
    return null
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white">
        <button
          onClick={() => navigate('/meetings')}
          className="p-2 -ml-2 rounded-md hover:bg-accent"
          aria-label="뒤로"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{rec.meta?.title ?? '오프라인 회의'}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <WifiOff className="w-3 h-3" /> 온디바이스 · 기기 저장 · {language.toUpperCase()}
          </p>
        </div>
        {rec.isRecording && (
          <span className="text-sm font-mono tabular-nums text-red-600">
            {fmtElapsed(rec.elapsedSeconds)}
          </span>
        )}
      </div>

      {/* 축소 기능 안내 */}
      <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
        오프라인 회의입니다. 기록은 기기에 저장되며, AI 요약·공유·검색은 설정에서
        "로컬 회의 서버로 전송"을 켜고 업로드한 뒤 사용할 수 있습니다.
      </div>

      {/* 전사 영역 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
        {resolving && <p className="text-sm text-muted-foreground">준비 중...</p>}
        {resolveErr && <p className="text-sm text-red-600">{resolveErr}</p>}
        {rec.error && <p className="text-sm text-red-600">{rec.error}</p>}
        {!resolving && finals.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {rec.isRecording ? '말씀하시면 여기에 전사됩니다...' : '녹음을 시작하세요.'}
          </p>
        )}
        {finals.map((f) => (
          <div key={f.id} className="p-3 rounded bg-gray-50">
            <span className="text-[10px] text-gray-400 tabular-nums mr-2">
              {fmtElapsed(Math.floor(f.started_at_ms / 1000))}
            </span>
            <span className="text-sm text-gray-800">{f.content}</span>
          </div>
        ))}
      </div>

      {/* 녹음 컨트롤 */}
      <div className="px-4 py-4 border-t bg-white flex justify-center pb-safe">
        {rec.status === 'stopped' ? (
          <button
            onClick={() => navigate('/meetings')}
            className="px-6 py-3 rounded-full bg-gray-200 text-gray-800 font-medium min-h-[44px]"
          >
            완료
          </button>
        ) : rec.isRecording ? (
          <button
            onClick={() => rec.stop()}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-600 text-white font-medium min-h-[44px]"
          >
            <Square className="w-4 h-4 fill-current" /> 종료
          </button>
        ) : (
          <button
            onClick={() => rec.start()}
            disabled={resolving || !modelDir}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium min-h-[44px] disabled:opacity-50"
          >
            <Mic className="w-4 h-4" /> 녹음 시작
          </button>
        )}
      </div>
    </div>
  )
}
