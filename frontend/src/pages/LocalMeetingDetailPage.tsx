/**
 * LocalMeetingDetailPage — 완료된 오프라인(서버 없음) 회의 상세/재생 화면.
 *
 * MeetingPage 레이아웃을 미러하되 **서버 결합을 전부 제거**한다(요약/메모/EditMeetingDialog/
 * 오타수정/북마크 미렌더). 진실원천은 localStore: getLocal(localId) → meta + segments를
 * transcriptStore에 적재(LocalMeetingLivePage의 load 패턴과 동일)하고, 본문은 검증된
 * LiveRecord(editable={false})로 렌더한다(서버 updateTranscript 차단).
 *
 * 오디오는 useLocalAudioPlayer(localId, title) → AudioPlayer/MiniAudioPlayer 재사용. seek는
 * started_at_ms 직접 사용 대신 segmentOffsetsMs[segmentIndex] 매핑(VAD 무음컷 드리프트 회피).
 *
 * 헤더: 뒤로 + 제목(인라인 rename) + 더보기 시트(전사/오디오 내보내기).
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Check, X, MoreHorizontal, FileText, FileType, AudioLines } from 'lucide-react'

import { useTranscriptStore } from '../stores/transcriptStore'
import * as localStore from '../stt/localStore'
import type { LocalMeetingMeta } from '../stt/localStore'
import type { TranscriptFinalData } from '../channels/transcription'
import { useLocalAudioPlayer } from '../hooks/useLocalAudioPlayer'
import { AudioPlayer } from '../components/meeting/AudioPlayer'
import { MiniAudioPlayer } from '../components/meeting/MiniAudioPlayer'
import { LiveRecord } from '../components/meeting/LiveRecord'
import { exportTranscript, exportAudio } from '../lib/localExport'

/** LocalMeetingLivePage와 동일한 센티넬 — LiveRecord가 서버 updateTranscript에 닿지 않게. */
const OFFLINE_SENTINEL_MEETING_ID = -1

export default function LocalMeetingDetailPage() {
  const { localId } = useParams<{ localId: string }>()
  const navigate = useNavigate()

  const reset = useTranscriptStore((s) => s.reset)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)

  const [meta, setMeta] = useState<LocalMeetingMeta | null>(null)
  const [segments, setSegments] = useState<TranscriptFinalData[]>([])
  const [seekMs, setSeekMs] = useState<number | null>(null)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [showFullPlayer, setShowFullPlayer] = useState(false)
  const [showMore, setShowMore] = useState(false)

  // 인라인 rename 상태.
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  const audio = useLocalAudioPlayer(localId ?? '', meta?.title ?? '오프라인 회의')

  // 메타 + 세그먼트 로드 → transcriptStore에 적재(LiveRecord가 읽음).
  useEffect(() => {
    if (!localId) return
    let cancelled = false
    reset()
    localStore
      .getLocal(localId)
      .then(({ meta: m, segments: segs }) => {
        if (cancelled) return
        setMeta(m)
        setSegments(segs)
        loadFinals(segs)
      })
      .catch(() => {
        if (!cancelled) navigate('/meetings', { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [localId, reset, loadFinals, navigate])

  // started_at_ms → finals 인덱스 → segmentOffsetsMs[index] 매핑(드리프트 회피).
  // 매핑 실패 시 started_at_ms 폴백 금지: 그 값은 VAD 무음 갭을 포함한 원본 타임라인이라
  // 무음 제거된 병합 오디오와 어긋나 시크가 드리프트한다 → 시크를 무시(no-op)한다.
  const handleSeek = (startedAtMs: number) => {
    const idx = segments.findIndex((s) => s.started_at_ms === startedAtMs)
    if (idx >= 0 && audio.segmentOffsetsMs[idx] != null) {
      setSeekMs(audio.segmentOffsetsMs[idx])
    }
  }

  const startRename = () => {
    setTitleDraft(meta?.title ?? '')
    setEditingTitle(true)
  }
  const submitRename = async () => {
    const next = titleDraft.trim()
    if (!localId || !next || next === meta?.title) {
      setEditingTitle(false)
      return
    }
    await localStore.renameLocal(localId, next)
    setMeta((m) => (m ? { ...m, title: next } : m))
    setEditingTitle(false)
  }

  const moreActions = useMemo(
    () => [
      {
        key: 'export-txt',
        icon: FileText,
        label: '텍스트(.txt) 내보내기',
        onClick: () => meta && exportTranscript(meta, segments, 'txt'),
      },
      {
        key: 'export-md',
        icon: FileType,
        label: '마크다운(.md) 내보내기',
        onClick: () => meta && exportTranscript(meta, segments, 'md'),
      },
      {
        key: 'export-audio',
        icon: AudioLines,
        label: '오디오 내보내기',
        onClick: () => localId && meta && exportAudio(localId, meta),
        disabled: !audio.hasAudio,
      },
    ],
    [meta, segments, localId, audio.hasAudio],
  )

  if (!localId) {
    navigate('/meetings', { replace: true })
    return null
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 헤더: 뒤로 + 제목(인라인 rename) + 더보기 */}
      <div className="sticky top-0 z-20 flex items-center gap-2 px-2 py-1.5 border-b bg-white shadow-sm">
        <button
          onClick={() => navigate('/meetings')}
          aria-label="뒤로"
          className="p-1 rounded-md hover:bg-black/5 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-gray-600" />
        </button>

        {editingTitle ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              aria-label="제목"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              autoFocus
              className="flex-1 min-w-0 text-sm border rounded px-2 py-1"
            />
            <button
              onClick={submitRename}
              aria-label="저장"
              className="p-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={() => setEditingTitle(false)}
              aria-label="취소"
              className="p-1.5 rounded-md text-gray-500 hover:bg-black/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <span className="text-sm font-medium text-gray-900 truncate flex-1 min-w-0">
              {meta?.title ?? '오프라인 회의'}
            </span>
            <button
              onClick={startRename}
              aria-label="이름 수정"
              className="p-1.5 rounded-md text-gray-500 hover:bg-black/5 transition-colors shrink-0"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </>
        )}

        <button
          onClick={() => setShowMore(true)}
          aria-label="더보기"
          className="p-1.5 rounded-md text-gray-600 hover:bg-black/5 transition-colors shrink-0"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* 오디오 플레이어 (데스크톱) */}
      <div className="hidden lg:block">
        <AudioPlayer audio={audio} onTimeUpdate={setCurrentTimeMs} seekMs={seekMs} autoPlayOnSeek />
      </div>

      {/* 풀사이즈 플레이어 (모바일) */}
      {showFullPlayer && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setShowFullPlayer(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-white border-t shadow-lg rounded-t-xl p-3 pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <AudioPlayer audio={audio} onTimeUpdate={setCurrentTimeMs} seekMs={seekMs} autoPlayOnSeek />
          </div>
        </div>
      )}

      {/* 미니 플레이어 (모바일) */}
      {audio.hasAudio && audio.isReady && (
        <MiniAudioPlayer
          isPlaying={audio.isPlaying}
          currentTimeMs={audio.currentTimeMs}
          durationMs={audio.durationMs}
          onPlay={audio.play}
          onPause={audio.pause}
          onSeek={audio.seekTo}
          onExpand={() => setShowFullPlayer(true)}
        />
      )}

      {/* 본문: 읽기전용 전사(서버 쓰기 없음) */}
      <div className="flex-1 min-h-0">
        <LiveRecord
          meetingId={OFFLINE_SENTINEL_MEETING_ID}
          editable={false}
          currentTimeMs={currentTimeMs}
          onSeek={handleSeek}
        />
      </div>

      {/* 미니 플레이어가 하단을 가리지 않도록 스페이서 (모바일) */}
      {audio.hasAudio && audio.isReady && (
        <div aria-hidden className="lg:hidden shrink-0 h-[calc(3rem+env(safe-area-inset-bottom))]" />
      )}

      {/* 더보기 바텀 시트: 내보내기 */}
      {showMore && (
        <div
          data-testid="detail-more-options"
          className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40"
          onClick={() => setShowMore(false)}
        >
          <div
            className="bg-white rounded-t-2xl px-4 pt-5 pb-8 max-h-[70vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">내보내기</h3>
              <button
                onClick={() => setShowMore(false)}
                aria-label="닫기"
                className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {moreActions.map((a) => (
                <button
                  key={a.key}
                  onClick={() => {
                    a.onClick()
                    setShowMore(false)
                  }}
                  disabled={a.disabled}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm text-gray-800 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed text-left"
                >
                  <a.icon className="w-4 h-4 text-gray-500" />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
