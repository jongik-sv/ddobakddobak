import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMeeting } from '../hooks/useMeeting'
import { useMeetingAccess } from '../hooks/useMeetingAccess'
import { useFileTranscriptionProgress } from '../hooks/useFileTranscriptionProgress'
import type { Transcript } from '../api/meetings'
import { getTranscripts, reopenMeeting } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { AudioPlayer } from '../components/meeting/AudioPlayer'
import { TranscriptPanel } from '../components/meeting/TranscriptPanel'
import { ExportButton } from '../components/meeting/ExportButton'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'

// ──────────────────────────────────────────────
// 회의 상세 페이지
// ──────────────────────────────────────────────

/**
 * 회의 상세 페이지 — 2컬럼 레이아웃 (에디터 + AI요약 + ActionItems)
 */
export default function MeetingPage() {
  const { id } = useParams<{ id: string }>()
  const meetingId = Number(id)
  const navigate = useNavigate()

  const { isLoading: accessLoading, error: accessError } = useMeetingAccess(meetingId)

  const { meeting, summary, isLoading, error: meetingError, updateTitle, deleteMeeting, refetch } =
    useMeeting(meetingId)

  // 파일 변환 진행률 (transcribing 상태일 때만 구독)
  const isTranscribing = meeting?.status === 'transcribing'
  const fileProgress = useFileTranscriptionProgress(isTranscribing ? meetingId : null)

  useEffect(() => {
    if (fileProgress.status === 'complete') {
      // 변환 완료 → 데이터 리페치
      refetch()
    }
  }, [fileProgress.status, refetch])

  // 기존 AI 회의록을 transcriptStore에 로드 (AiSummaryPanel이 읽음)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)
  useEffect(() => {
    if (summary?.notes_markdown) {
      setMeetingNotes(summary.notes_markdown)
    }
  }, [summary?.notes_markdown, setMeetingNotes])

  // 오디오 seek 상태 (AudioPlayer ↔ TranscriptPanel 공유)
  const [seekMs, setSeekMs] = useState<number | null>(null)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [transcripts, setTranscripts] = useState<Transcript[]>([])

  // meeting 상태가 completed로 바뀌면 트랜스크립트도 리로드 (파일 업로드 완료 시)
  useEffect(() => {
    if (meeting?.status === 'transcribing') return
    getTranscripts(meetingId).then(setTranscripts)
  }, [meetingId, meeting?.status])

  function handleSeek(ms: number) {
    setSeekMs(ms)
  }

  // 제목 인라인 편집 상태
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitleValue, setEditingTitleValue] = useState('')

  function handleTitleClick() {
    if (meeting) {
      setEditingTitleValue(meeting.title)
      setIsEditingTitle(true)
    }
  }

  async function handleTitleSubmit() {
    if (editingTitleValue.trim()) {
      await updateTitle(editingTitleValue.trim())
    }
    setIsEditingTitle(false)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleTitleSubmit()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
    }
  }

  // 권한 에러 처리
  if (!accessLoading && accessError === 'forbidden') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <h2 className="text-lg font-semibold text-gray-800">접근 권한이 없습니다</h2>
        <p className="text-sm text-gray-500 text-center">
          이 회의록은 같은 팀 소속 멤버만 볼 수 있습니다.
        </p>
      </div>
    )
  }

  if (!accessLoading && accessError === 'not_found') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <h2 className="text-lg font-semibold text-gray-800">회의록을 찾을 수 없습니다</h2>
        <p className="text-sm text-gray-500">삭제되었거나 존재하지 않는 회의입니다.</p>
      </div>
    )
  }

  if (accessLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-gray-500 text-sm">불러오는 중...</div>
      </div>
    )
  }

  if (meetingError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-red-500 text-sm">오류: {meetingError}</div>
      </div>
    )
  }

  // 파일 변환 중 → 진행률 표시
  if (isTranscribing) {
    const progressPercent = fileProgress.progress
    const progressMessage = fileProgress.message || (
      progressPercent < 10 ? '오디오 파일 처리 준비 중...' :
      progressPercent < 70 ? '음성 인식 중...' :
      progressPercent < 95 ? 'AI 회의록 생성 중...' :
      '마무리 중...'
    )

    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center gap-4 p-8 rounded-xl bg-white border shadow-sm">
            <svg className="w-12 h-12 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <h2 className="text-lg font-semibold text-gray-900">
              {meeting?.title ?? '오디오 파일 변환 중'}
            </h2>
            <p className="text-sm text-gray-500">{progressMessage}</p>

            {/* 진행률 바 */}
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs text-gray-400">{progressPercent}%</p>

            {fileProgress.status === 'error' && (
              <div className="mt-2 p-3 rounded-md bg-red-50 text-sm text-red-600 w-full">
                오류: {fileProgress.error}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 오디오 플레이어 */}
      <AudioPlayer
        meetingId={meetingId}
        onTimeUpdate={setCurrentTimeMs}
        seekMs={seekMs}
        autoPlayOnSeek
      />

      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white shrink-0">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium shrink-0">회의록 보기</span>
          {isEditingTitle ? (
            <input
              type="text"
              value={editingTitleValue}
              onChange={(e) => setEditingTitleValue(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={handleTitleKeyDown}
              className="text-lg font-semibold text-gray-900 border-b-2 border-blue-500 outline-none bg-transparent flex-1 min-w-0"
              autoFocus
            />
          ) : (
            <h1
              className="text-lg font-semibold text-gray-900 truncate cursor-pointer hover:text-blue-700"
              onClick={handleTitleClick}
              title="클릭하여 제목 편집"
            >
              {meeting?.title ?? '회의'}
            </h1>
          )}
          {meeting?.status && (
            <span className="shrink-0 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
              {meeting.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {meeting?.status === 'completed' && (
            <button
              onClick={async () => {
                await reopenMeeting(meetingId)
                navigate(`/meetings/${meetingId}/live`)
              }}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors"
            >
              회의 재개
            </button>
          )}
          {(meeting?.status === 'pending' || meeting?.status === 'recording') && (
            <button
              onClick={() => navigate(`/meetings/${meetingId}/live`)}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              회의 진행
            </button>
          )}
          <ExportButton
            meetingId={meetingId}
            meetingDate={meeting?.started_at ?? meeting?.created_at}
          />
          <button
            onClick={deleteMeeting}
            className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
          >
            삭제
          </button>
        </div>
      </div>

      {/* 2컬럼 본문: 자막 30% / 요약 70% */}
      <div className="flex flex-1 overflow-hidden">
        {/* 좌측: 트랜스크립트 패널 (30%) */}
        <div className="w-[30%] border-r overflow-y-auto shrink-0">
          <TranscriptPanel
            transcripts={transcripts}
            currentTimeMs={currentTimeMs}
            onSeek={handleSeek}
          />
        </div>

        {/* 우측: AI 회의록 (70%) */}
        <div className="w-[70%] bg-gray-50 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-hidden flex flex-col">
            <AiSummaryPanel meetingId={meetingId} isRecording={false} editable={false} />
          </div>
        </div>
      </div>
    </div>
  )
}
