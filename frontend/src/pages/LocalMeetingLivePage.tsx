/**
 * LocalMeetingLivePage — 완전 오프라인(서버 없음) 온디바이스 회의 녹음 화면.
 *
 * 서버 모바일 셸 3종(MobileRecordControls + MobileTabLayout + LiveStatusBar)을 재사용해
 * 서버 회의 라이브 UI와 동일한 모양으로 통일한다(전략 §0 직교분리 실증). 전사 본문은
 * 서버 경로와 같은 LiveRecord(transcriptStore 기반)로 렌더된다.
 *
 * 설계: docs/superpowers/specs/2026-06-01-ondevice-stt-g1-offline-ui-parity-design.md
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { FileText } from 'lucide-react'

import { useLocalRecording } from '../hooks/useLocalRecording'
import { getLanguageSettings } from '../api/settings'
import { localSttLanguage } from '../stt/cohereLang'
import { IS_TAURI } from '../config'
import { MobileRecordControls } from '../components/meeting/MobileRecordControls'
import { LiveStatusBar } from '../components/meeting/LiveStatusBar'
import MobileTabLayout, { type Tab } from '../components/layout/MobileTabLayout'
import { LiveRecord } from '../components/meeting/LiveRecord'
import ModelManager from '../components/stt/ModelManager'

/** 오프라인 회의엔 서버 회의가 없다. LiveRecord에 닿지 않는 센티넬 meetingId를 쓰고
 *  editable={false}와 결합해 인라인 편집(서버 updateTranscript)을 원천 차단(설계 §4). */
const OFFLINE_SENTINEL_MEETING_ID = -1

export default function LocalMeetingLivePage() {
  const { localId } = useParams<{ localId: string }>()
  const navigate = useNavigate()

  const [language, setLanguage] = useState('ko')
  const [modelDir, setModelDir] = useState<string | null>(null)
  const [resolving, setResolving] = useState(true)
  const [resolveErr, setResolveErr] = useState<string | null>(null)
  // ModelManager 다운로드 완료 시 bump → 모델 경로 재해석(녹음 게이트 해제).
  const [reloadKey, setReloadKey] = useState(0)
  const [isStopping, setIsStopping] = useState(false)

  // 모델 경로 + 언어 결정. 모델 미설치면 modelDir=null(에러 아님) → 기록 탭이 ModelManager 노출.
  useEffect(() => {
    let cancelled = false
    setResolving(true)
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
        setResolveErr(null)
      } catch (e) {
        if (!cancelled) setResolveErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setResolving(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const rec = useLocalRecording(localId ?? '', language, modelDir)

  // 시작 버튼을 모델 준비 전에 눌렀을 때: 하드에러 대신 "로딩 중"으로 두고 준비되면 자동 시작.
  // (모델 경로 해석 resolve_model_paths + stt_load 콜드로드가 끝나기 전 탭 가능.)
  const [pendingStart, setPendingStart] = useState(false)
  const [startHint, setStartHint] = useState<string | null>(null)

  const handleStart = useCallback(() => {
    setStartHint(null)
    if (resolving) {
      // 모델 경로 해석 중 — 큐에 넣고 effect가 준비되면 자동 시작.
      setPendingStart(true)
      return
    }
    if (!modelDir) {
      // 해석 끝났는데 모델 없음(미다운로드) — 기록 탭의 다운로드 안내로 유도.
      setStartHint('온디바이스 모델을 먼저 받아주세요. (아래 기록 탭)')
      return
    }
    // 모델 준비됨. rec.start가 stt_load 콜드로드를 await하며 starting 스피너를 띄운다.
    rec.start()
  }, [resolving, modelDir, rec])

  // pendingStart 후 해석이 끝나면 자동 시작(모델 있으면) 또는 안내(없으면).
  useEffect(() => {
    if (!pendingStart || resolving) return
    setPendingStart(false)
    if (modelDir) {
      rec.start()
    } else {
      setStartHint('온디바이스 모델을 먼저 받아주세요. (아래 기록 탭)')
    }
  }, [pendingStart, resolving, modelDir, rec])

  // 단일 상태/에러 surface(설계 §2-③). 우선순위: 해석실패 > 시작안내 > 녹음에러 > 준비중.
  const preparing = resolving || pendingStart || rec.modelLoading || rec.starting
  const statusMessage =
    resolveErr ??
    startHint ??
    rec.error ??
    (preparing ? '모델 로딩 중...' : null)

  const handleStop = async () => {
    setIsStopping(true)
    try {
      await rec.stop()
    } finally {
      setIsStopping(false)
    }
  }

  // 뒤로 = 자동 종료(설계 결정 A-T). 녹음/일시정지 중이면 finalize(stop)해서 status='completed'로
  // 만든 뒤 나간다. 안 그러면 status='recording'으로 남아 다음 진입이 플레이어 없는 라이브
  // 페이지로 가고(마이크/AudioContext도 누수), 미리보기에 플레이어가 안 보인다(bug4).
  const handleBack = async () => {
    if (rec.isRecording) {
      await handleStop()
    }
    navigate('/local-meetings')
  }

  // 기록 탭: 모델 있으면 LiveRecord(읽기전용), 없으면 ModelManager 게이트.
  const tabs: Tab[] = useMemo(
    () => [
      {
        id: 'transcript',
        label: '기록',
        icon: FileText,
        content: modelDir ? (
          <LiveRecord meetingId={OFFLINE_SENTINEL_MEETING_ID} editable={false} />
        ) : (
          <div className="p-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              오프라인 전사를 시작하려면 먼저 온디바이스 모델을 받아야 합니다.
            </p>
            <ModelManager onChanged={() => setReloadKey((k) => k + 1)} />
          </div>
        ),
      },
    ],
    [modelDir],
  )

  if (!localId) {
    navigate('/local-meetings', { replace: true })
    return null
  }

  return (
    <div className="flex flex-col h-full">
      <MobileRecordControls
        title={rec.meta?.title ?? '오프라인 회의'}
        isRecording={rec.isRecording}
        isPaused={rec.isPaused}
        elapsedSeconds={rec.elapsedSeconds}
        onBack={handleBack}
        onStart={handleStart}
        onPause={rec.pause}
        onResume={rec.resume}
        onStop={handleStop}
        isStopping={isStopping}
        isStarting={rec.modelLoading || rec.starting || pendingStart}
      />

      <div className="flex-1 min-h-0">
        <MobileTabLayout tabs={tabs} />
      </div>

      <LiveStatusBar
        isActive={rec.isRecording}
        isSystemCapturing={false}
        meetingApiStatus={null}
        statusMessage={statusMessage}
        sttEngine="온디바이스"
      />
    </div>
  )
}
