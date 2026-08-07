import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { PanelRightOpen } from 'lucide-react'
import { useMeetingStore } from '../stores/meetingStore'
import { useProjectStore } from '../stores/projectStore'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef } from 'react-resizable-panels'
import { Tooltip } from '../components/ui/Tooltip'
import { useMeeting } from '../hooks/useMeeting'
import { useMeetingAccess } from '../hooks/useMeetingAccess'
import { useFileTranscriptionProgress } from '../hooks/useFileTranscriptionProgress'
import { useMemoEditor } from '../hooks/useMemoEditor'
import type { Transcript } from '../api/meetings'
import { getTranscripts, reopenMeeting, updateNotes, canEditMeeting, canRedactMeeting } from '../api/meetings'
import type { RedactTranscriptsResponse } from '../api/meetings'
import { useToastStore } from '../stores/toastStore'
import { applyLocalRedaction } from '../lib/applyLocalRedaction'
import { useAuthStore } from '../stores/authStore'
import { usePromptTemplateStore } from '../stores/promptTemplateStore'
import { MeetingPageSkeleton } from '../components/ui/Skeleton'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { AudioPlayer } from '../components/meeting/AudioPlayer'
import { MiniAudioPlayer } from '../components/meeting/MiniAudioPlayer'
import { TranscriptPanel } from '../components/meeting/TranscriptPanel'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SummaryOptionsControl } from '../components/meeting/SummaryOptionsControl'
import { useUiStore } from '../stores/uiStore'
import EditMeetingDialog from '../components/meeting/EditMeetingDialog'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { AttachmentSection } from '../components/meeting/AttachmentSection'
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery'
import MobileTabLayout from '../components/layout/MobileTabLayout'
import { BookmarkList } from '../components/meeting/BookmarkList'
import { BookmarkPopover } from '../components/meeting/BookmarkPopover'
import { MemoEditorPanel } from '../components/meeting/MemoEditorPanel'
import { RightTabsPanel } from '../components/meeting/RightTabsPanel'
import { TranscribingProgress } from '../components/meeting/TranscribingProgress'
import { TermCorrectionDetails } from '../components/meeting/TermCorrectionDetails'
import { GlossaryPanel } from '../components/meeting/GlossaryPanel'
import { MeetingActionHeader } from '../components/meeting/MeetingActionHeader'
import { MeetingActions } from '../components/meeting/MeetingActions'
import { MeetingDetailTopBar } from '../components/meeting/MeetingDetailTopBar'
import { buildMeetingDetailTabs } from '../components/meeting/meetingDetailTabs'
import { MeetingSearchBar } from '../components/meeting/MeetingSearchBar'
import { useMeetingSearch } from '../hooks/useMeetingSearch'
import { mapTranscriptsToFinals } from '../lib/transcriptMapper'
import { folderPath } from '../lib/folderNav'
import { useTermCorrections } from '../hooks/useTermCorrections'
import { useNotesRegeneration } from '../hooks/useNotesRegeneration'
import { useBookmarks } from '../hooks/useBookmarks'

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
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)

  const { isLoading: accessLoading, error: accessError } = useMeetingAccess(meetingId)

  const { meeting, summary, isLoading, error: meetingError, updateTitle, updateMeetingInfo, deleteMeeting, refetch } =
    useMeeting(meetingId)
  const [showEditDialog, setShowEditDialog] = useState(false)
  // 제목 인라인 편집 중이면 탑바의 주변 아이콘(검색/첨부/정보수정/북마크)을 접어 입력창에 폭을 몰아준다.
  const [isEditingTitle, setIsEditingTitle] = useState(false)

  // 소유권 게이팅: 수정 어포던스는 소유자/admin에게만 노출 (서버는 403으로 강제).
  const me = useAuthStore((s) => s.user)
  const canEdit = canEditMeeting(meeting, me)

  // 회의 잠금/해제 — store 액션(목록 동기화) 호출 후 상세도 refetch.
  const storeLockMeeting = useMeetingStore((s) => s.lockMeeting)
  const storeUnlockMeeting = useMeetingStore((s) => s.unlockMeeting)
  const [isTogglingLock, setIsTogglingLock] = useState(false)
  const locked = !!meeting?.locked
  const handleToggleLock = useCallback(async () => {
    if (!meeting || isTogglingLock) return
    setIsTogglingLock(true)
    try {
      if (meeting.locked) {
        await storeUnlockMeeting(meeting.id)
      } else {
        await storeLockMeeting(meeting.id)
      }
      await refetch()
    } catch (e) {
      console.error('[toggleLock] 실패:', e)
      const { message } = await import('@tauri-apps/plugin-dialog')
        .then((m) => ({ message: m.message }))
        .catch(() => ({ message: (msg: string) => window.alert(msg) }))
      message('잠금 상태 변경에 실패했습니다. 권한을 확인하세요.')
    } finally {
      setIsTogglingLock(false)
    }
  }, [meeting, isTogglingLock, storeLockMeeting, storeUnlockMeeting, refetch])

  const meetingTypeList = usePromptTemplateStore((s) => s.meetingTypeList)
  const meetingTypeMap = usePromptTemplateStore((s) => s.meetingTypeMap)

  const meetingTypeLabel = meeting ? (meetingTypeMap[meeting.meeting_type] ?? meeting.meeting_type) : ''

  // 파일 변환 진행률 (transcribing 상태일 때만 구독)
  const isTranscribing = meeting?.status === 'transcribing'
  const fileProgress = useFileTranscriptionProgress(isTranscribing ? meetingId : null)

  useEffect(() => {
    if (fileProgress.status === 'complete') {
      // 변환 완료 → 데이터 리페치
      refetch()
    }
  }, [fileProgress.status, refetch])

  // 폴링 fallback: ActionCable의 file_transcription_complete 브로드캐스트는
  // fire-and-forget이라 브라우저 미연결 순간 유실되면 카드가 'transcribing'에
  // 영구 멈춘다. transcribing 동안 주기적으로 refetch해 status가 completed로
  // 바뀌면(=서버는 끝남) 카드를 빠져나오게 한다.
  useEffect(() => {
    if (!isTranscribing) return
    const id = setInterval(() => { refetch() }, 10000)
    return () => clearInterval(id)
  }, [isTranscribing, refetch])

  // 기존 AI 회의록을 transcriptStore에 로드 (AiSummaryPanel이 읽음)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)
  const resetTranscriptStore = useTranscriptStore((s) => s.reset)
  const markUserEdit = useTranscriptStore((s) => s.markUserEdit)
  const clientId = useTranscriptStore((s) => s.clientId)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
  // 로컬 절단이 오디오 토큰을 직접 올린다 — MeetingPage 는 전사 채널을 구독하지 않아
  // 브로드캐스트 경로가 발화하지 않는다(설계 §V4-b). 올리지 않으면 절단 후에도 캐시된
  // 옛 blob(=기밀)이 계속 재생된다.
  const markAudioChanged = useTranscriptStore((s) => s.markAudioChanged)
  const setSummaryError = useTranscriptStore((s) => s.setSummaryError)
  // 원격(다른 클라이언트) 전사 구조 변경 신호(split·redact). 채널 경로에서만 증가 — 로컬 조작
  // (handleTranscriptSplit 등)은 이 값을 건드리지 않는다.
  const remoteStructureRevision = useTranscriptStore((s) => s.remoteStructureRevision)
  // 오디오 파일 교체 신호(절단). useAudioPlayer 의 URL·deps 에 넣어야 캐시된 옛 오디오를 버린다.
  const audioRevision = useTranscriptStore((s) => s.audioRevision)
  // null = "아래 reset 이펙트가 아직 기준선을 안 잡음"이라는 방어적 표식이다. 실제로는 이 값이
  // null인 채로 재조회 이펙트(아래, 319행 부근)가 실행되는 경우가 없다 — React는 같은 컴포넌트의
  // 이펙트를 선언 순서대로 실행하고, 마운트/회의전환 시 항상 이 reset 이펙트(선언이 더 앞)가
  // 먼저 실행되어 같은 커밋에서 0을 채워 넣기 때문이다. 그래도 두 이펙트의 선언 순서가 나중에
  // 바뀌거나 이 로직이 커스텀 훅으로 추출되는 리팩토링에도 안전하도록 가드는 남겨둔다.
  const remoteStructureRevisionSeenRef = useRef<number | null>(null)
  useEffect(() => {
    resetTranscriptStore()
    remoteStructureRevisionSeenRef.current = 0
  }, [meetingId, resetTranscriptStore])
  useEffect(() => {
    if (summary?.notes_markdown) {
      setMeetingNotes(summary.notes_markdown)
    }
  }, [summary?.notes_markdown, setMeetingNotes])

  // 영속 실패 필드 주입: 새로고침·정지 후에도 final 요약 실패가 레포트되도록
  // 서버가 내려준 meeting.summary_error_message를 store에 반영한다(AiSummaryPanel 배지 재사용).
  // 실시간 broadcast로 이미 배지가 떠 있으면 덮어쓰지 않는다.
  // 주의: 위 resetTranscriptStore effect(선언 순서상 먼저 실행)가 store를 비운 뒤에 주입되며,
  // 회의 전환 중 meeting이 이전 회의 데이터인 동안(id 불일치)은 stale 주입을 막는다.
  useEffect(() => {
    if (!meeting || meeting.id !== meetingId) return
    if (!meeting.summary_error_message) return
    if (useTranscriptStore.getState().summaryError) return
    setSummaryError({ kind: 'final', message: meeting.summary_error_message })
  }, [meetingId, meeting, setSummaryError])

  // 영속 "요약중" 상태 주입: 서버가 내려준 meeting.summarizing 을 store 에 반영해
  // AiSummaryPanel 의 기존 isSummarizing 배지를 새로고침·페이지 진입 직후에도 띄운다.
  // ActionCable(summarization_started/finished)이 오면 그것이 덮어쓴다(더 정확한 kind 포함).
  // kind 추정: recording 중이면 realtime 틱, 그 외(completed 재생성 등)는 final 로 폴백.
  const setSummarizing = useTranscriptStore((s) => s.setSummarizing)
  useEffect(() => {
    if (!meeting || meeting.id !== meetingId) return
    if (!meeting.summarizing) {
      // 서버가 이미 종료(summarizing=false)를 알림 — 잔류 배지가 있으면 해제.
      if (useTranscriptStore.getState().isSummarizing) setSummarizing(null)
      return
    }
    // broadcast 가 먼저 활성화한 상태면 그 kind 를 존중(덮어쓰지 않음).
    if (useTranscriptStore.getState().isSummarizing) return
    setSummarizing(meeting.status === 'recording' ? 'realtime' : 'final')
  }, [meetingId, meeting, setSummarizing])

  // 메모 에디터 + 토글
  const memoVisible = useUiStore((s) => s.memoVisible)
  const toggleMemo = useUiStore((s) => s.toggleMemo)
  const attachmentsVisible = useUiStore((s) => s.attachmentsVisible)
  const toggleAttachments = useUiStore((s) => s.toggleAttachments)
  const { memoEditorRef, onEditorReady: onMemoEditorReady, isSavingMemo, handleSaveMemo } = useMemoEditor(meetingId, meeting?.memo)

  // 우측(메모·AI챗) 패널은 항상 마운트해두고 collapse/expand로만 크기를 바꾼다.
  // 패널을 통째로 언마운트하면 react-resizable-panels가 남은 패널들의 flex 비율을
  // 재정규화(renormalize)해 트랜스크립트↔AI회의록 경계가 같이 움직인다 — 그래서
  // 이 방식 대신 패널 개수를 고정하고 우측 패널만 0으로 접어 AI회의록이 그 폭을 흡수하게 한다.
  const rightPanelRef = usePanelRef()
  useEffect(() => {
    const panel = rightPanelRef.current
    if (!panel) return
    if (memoVisible) panel.expand()
    else panel.collapse()
  }, [memoVisible, rightPanelRef])

  const handleNotesChange = useCallback(
    (markdown: string) => {
      markUserEdit()
      updateNotes(meetingId, markdown, clientId).catch((e) => console.error('[updateNotes] 저장 실패:', e))
    },
    [meetingId, clientId, markUserEdit]
  )

  // 오디오 상태 (AudioPlayer ↔ MiniAudioPlayer ↔ TranscriptPanel 공유)
  const audio = useAudioPlayer(meetingId, audioRevision)
  const [seekMs, setSeekMs] = useState<number | null>(null)
  // 동일 ms로 재-seek(마커 재클릭 등)해도 React state는 동일 값 setState를 bail-out하므로,
  // 값과 무관하게 "seek이 발생했다"는 사실만 전달하는 별도 트리거가 필요하다.
  // TranscriptPanel의 강제 스크롤 추적(#43)이 이를 사용한다.
  const [seekTick, setSeekTick] = useState(0)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [showFullPlayer, setShowFullPlayer] = useState(false)
  const [transcripts, setTranscripts] = useState<Transcript[]>([])

  // god 분해: 오타수정 / 회의록 재생성 / 북마크 로직을 전용 훅으로 분리 (동작 무변경)
  const {
    corrections,
    isApplyingCorrections,
    correctionStatus,
    handleApplyCorrections,
    updateCorrection,
    addCorrectionRow,
    removeCorrectionRow,
  } = useTermCorrections(meetingId, { setTranscripts, refetch })
  const {
    isRegeneratingNotes,
    showSttConfirm,
    setShowSttConfirm,
    showReDiarizeConfirm,
    setShowReDiarizeConfirm,
    showNotesConfirm,
    setShowNotesConfirm,
    handleRegenerateStt,
    handleReDiarize,
    handleRegenerateNotes,
  } = useNotesRegeneration(meetingId, { pauseAudio: () => audio.pause(), refetch })
  const {
    bookmarks,
    showBookmarkPopover,
    setShowBookmarkPopover,
    bookmarkLabel,
    setBookmarkLabel,
    bookmarkTs,
    handleDeleteBookmark,
    handleEditBookmark,
    handleOpenBookmark,
    handleSaveBookmark,
  } = useBookmarks(meetingId, { transcripts, currentTimeMs })

  // 북마크 표시 토글 (uiStore) — 데이터/CRUD/팝오버는 useBookmarks 훅
  const bookmarksVisible = useUiStore((s) => s.bookmarksVisible)
  const toggleBookmarks = useUiStore((s) => s.toggleBookmarks)

  // 페이지 내 검색 (전사 + AI요약)
  const search = useMeetingSearch(transcripts)
  const activeTranscriptSearch =
    search.current?.type === 'transcript'
      ? { transcriptId: search.current.transcriptId, occurrence: search.current.occurrence }
      : null

  // 모바일 탭 — 검색 매치 위치에 따라 기록/요약 탭 자동 전환 (controlled)
  const [mobileTab, setMobileTab] = useState('summary')
  const currentMatchType = search.current?.type
  useEffect(() => {
    if (isDesktop || !currentMatchType || !search.effectiveQuery) return
    setMobileTab(currentMatchType === 'transcript' ? 'transcript' : 'summary')
  }, [isDesktop, currentMatchType, search.currentIndex, search.effectiveQuery])

  // 전역 검색에서 넘어온 경우(?q=) 회의내 검색을 자동 실행 — 1회만.
  // URL의 q는 적용 후 제거(replace)해 새로고침/뒤로가기 시 재발동·재포커스 방지.
  const [searchParams, setSearchParams] = useSearchParams()
  const appliedSearchQ = useRef(false)
  useEffect(() => {
    if (appliedSearchQ.current) return
    const q = searchParams.get('q')
    if (!q) return
    appliedSearchQ.current = true
    search.open()
    search.setQuery(q)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('q')
        return next
      },
      { replace: true }
    )
  }, [searchParams, search, setSearchParams])

  // 폴더/프로젝트 챗 인용 클릭으로 ?t=<ms> 와 함께 진입한 경우 — 오디오 준비 후 1회 자동 seek.
  // audioLoaded(=canplay)가 떠야 seekTo+자동재생이 실제로 먹는다. 적용 후 t 파라미터 제거(새로고침/뒤로가기 재발동 방지).
  const appliedSeekT = useRef(false)
  useEffect(() => {
    if (appliedSeekT.current) return
    const t = Number(searchParams.get('t'))
    if (!(t > 0)) return
    if (!audio.audioLoaded) return
    appliedSeekT.current = true
    setSeekMs(t)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('t')
        return next
      },
      { replace: true }
    )
  }, [searchParams, audio.audioLoaded, setSearchParams])

  // meeting 상태가 completed로 바뀌면 트랜스크립트도 리로드 (파일 업로드 완료 시)
  useEffect(() => {
    if (meeting?.status === 'transcribing') return
    getTranscripts(meetingId).then((data) => {
      setTranscripts(data)
      // EditableTranscriptText의 낙관적 갱신이 즉시 화면에 반영되도록 store에도 적재.
      // TranscriptPanel은 store.finals를 override로 우선 조회한다.
      loadFinals(mapTranscriptsToFinals(data, true))
    })
  }, [meetingId, meeting?.status, loadFinals])

  // 원격 구조 변경(split·redact) 재조회: TranscriptPanel은 transcripts prop(구조) 기반이라
  // store.applySplit/removeFinals만으론 다른 클라이언트가 만든 삽입·삭제 행이 화면에 안 나타난다.
  // remoteStructureRevision이 실제로 증가할 때만 전체 재조회로 채운다. 로컬 조작은
  // handleTranscriptSplit 등이 이미 배열을 직접 갱신하고 이 카운터를 건드리지 않으므로 여기서
  // 중복 재조회가 발생하지 않는다.
  //
  // 비교는 반드시 store의 "지금 값"(getState())으로 한다 — 위 reset 이펙트가 같은 커밋의 effect
  // flush에서 먼저 실행되어(선언 순서상 앞) remoteStructureRevision을 이미 0으로 되돌렸을 수 있는데,
  // 이 이펙트의 클로저가 들고 있는 reactive 값(파라미터 remoteStructureRevision)은 여전히 "이번 렌더가
  // 시작될 때의" 값(리셋 전 잔여치)이라 getState()와 어긋난다. getState()로 항상 최신값을 읽어야
  // reset 직후 커밋에서 잔여치 vs 0을 오비교해 스퓨리어스 재조회가 나가는 걸 막을 수 있다.
  useEffect(() => {
    // 방어적 가드일 뿐 실제로는 여기서 걸리지 않는다 — 위 reset 이펙트(선언이 이 이펙트보다
    // 앞)가 마운트/회의전환 시 항상 먼저 실행되어 같은 커밋에서 ref를 0으로 채우므로, 이 이펙트가
    // 실행되는 시점엔 ref.current가 이미 null이 아니다.
    if (remoteStructureRevisionSeenRef.current === null) return
    const current = useTranscriptStore.getState().remoteStructureRevision
    if (current === remoteStructureRevisionSeenRef.current) return
    remoteStructureRevisionSeenRef.current = current
    getTranscripts(meetingId).then((data) => {
      setTranscripts(data)
      loadFinals(mapTranscriptsToFinals(data, true))
    })
  }, [remoteStructureRevision, meetingId, loadFinals])

  function handleSeek(ms: number) {
    setSeekMs(ms)
    setSeekTick((t) => t + 1)
    // 낙관적 갱신: AudioPlayer의 onTimeUpdate(실제 오디오 timeupdate 경유)를 기다리면
    // highlightedIndex/스크롤 갱신이 한 박자 늦는다 — seek 즉시 반영해 전사 하이라이트가 따라가게 한다.
    setCurrentTimeMs(ms)
  }

  // 전사 분할: TranscriptPanel/store는 content override만 아는 것과 달리, 이 페이지가 들고 있는
  // transcripts 배열은 구조(행 수)까지 바꿔야 한다 — updated로 기존 행을 교체하고 그 바로 뒤에
  // inserted를 끼운다. store 쪽 반영(store.applySplit)은 TranscriptPanel이 이미 수행했다.
  //
  // 트레일링 sequence_number 미러링: 백엔드는 분할 대상 뒤의 모든 행을 sequence_number+1로
  // 재번호한다(transcripts_controller.rb split — Transcript.where(...).update_all("sequence_number
  // = sequence_number + 1")). 응답 {updated, inserted}엔 그 정보가 없고, 로컬 split은(원격 split과
  // 달리) 재조회를 하지 않으므로 여기서 재번호를 흉내내지 않으면 트레일링 행들의 클라 상태
  // sequence_number가 서버 실제값보다 1 작게 남는다. 재조회를 추가하는 대신 서버가 한 연산을
  // 그대로 미러링한다: updated.sequence_number보다 큰 행 전부 +1.
  function handleTranscriptSplit(updated: Transcript, inserted: Transcript) {
    setTranscripts((prev) => {
      const idx = prev.findIndex((t) => t.id === updated.id)
      if (idx === -1) return prev
      const next = prev.map((t) =>
        t.sequence_number > updated.sequence_number
          ? { ...t, sequence_number: t.sequence_number + 1 }
          : t
      )
      next[idx] = updated
      next.splice(idx + 1, 0, inserted)
      return next
    })
  }

  // 전사 절단 로컬 반영 — 본체는 applyLocalRedaction(lib/applyLocalRedaction.ts)에 있고
  // 여기서는 클로저 값만 주입하는 얇은 래퍼다. 본체를 이 안에 두면 markAudioChanged·
  // clearMeetingNotes 호출을 자동 검증할 방법이 없는데, 그건 절단한 본인 화면이 옛 오디오
  // (= 기밀)를 계속 재생하거나 파기된 회의록을 계속 보여주지 않게 하는 유일한 장치다
  // (이 페이지는 전사 채널을 구독하지 않는다).
  // 원격 브로드캐스트는 client_id 에코 가드에 걸리므로 중복 재조회가 나가지 않는다.
  function handleTranscriptRedact(result: RedactTranscriptsResponse) {
    void applyLocalRedaction(
      {
        reloadTranscripts: async () => {
          const data = await getTranscripts(meetingId)
          setTranscripts(data)
          loadFinals(mapTranscriptsToFinals(data, true))
        },
        // useMeeting().refetch — meeting.transcripts_redacted 배지·brief_summary 등
        // meeting 파생 필드를 최신화한다.
        refetchMeeting: refetch,
        markAudioChanged,
        // AiSummaryPanel이 회의록을 읽는 유일한 소스(useTranscriptStore.meetingNotes)를
        // 즉시 지운다 — summaries.destroy_all 후에도 이걸 안 하면 새로고침 전까지
        // 파기됐어야 할 회의록 텍스트가 화면에 그대로 남는다.
        clearMeetingNotes: () => setMeetingNotes(null),
        notify: (message, durationMs) => useToastStore.getState().showStatus(message, durationMs),
      },
      result,
    )
  }

  // 뒤로가기: 원래 폴더 목록으로 복귀. 크로스 프로젝트 진입(딥링크·전역검색)이면
  // 대상 폴더가 현재 프로젝트 밖이므로, 먼저 프로젝트 컨텍스트를 회의의 프로젝트로
  // 동기화해야 빈 회의 목록에 떨어지지 않는다.
  function handleBack() {
    if (!meeting) {
      navigate('/meetings')
      return
    }
    const { currentProjectId, setCurrentProject } = useProjectStore.getState()
    if (meeting.project_id != null && meeting.project_id !== currentProjectId) {
      setCurrentProject(meeting.project_id)
    }
    navigate(folderPath(meeting.folder_id ?? null))
  }

  // 폴더/프로젝트 스코프 챗의 크로스회의 인용 클릭 → 현재 회의면 in-place seek, 아니면 해당 회의로 네비.
  function handleSeekMeeting(mid: number, ms: number) {
    if (mid === meetingId) {
      handleSeek(ms)
      return
    }
    navigate(`/meetings/${mid}?t=${ms}`)
  }

  // 권한 에러 처리
  if (!accessLoading && accessError === 'forbidden') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <h2 className="text-lg font-semibold text-foreground">접근 권한이 없습니다</h2>
        <p className="text-sm text-muted-foreground text-center">
          이 회의록은 같은 팀 소속 멤버만 볼 수 있습니다.
        </p>
      </div>
    )
  }

  if (!accessLoading && accessError === 'not_found') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <h2 className="text-lg font-semibold text-foreground">회의록을 찾을 수 없습니다</h2>
        <p className="text-sm text-muted-foreground">삭제되었거나 존재하지 않는 회의입니다.</p>
      </div>
    )
  }

  if (accessLoading || isLoading) {
    return <MeetingPageSkeleton />
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
      <TranscribingProgress
        title={meeting?.title ?? '오디오 파일 변환 중'}
        progressPercent={progressPercent}
        message={progressMessage}
        isError={fileProgress.status === 'error'}
        error={fileProgress.error}
        queuePosition={meeting?.transcription_queue_position}
      />
    )
  }

  // 요약 옵션(압축율·재구조화) 컨트롤 — 소유자/admin 만. 데스크톱 패널·모바일 탭 공용.
  const summaryOptionsControl = meeting && canEdit ? (
    <SummaryOptionsControl meeting={meeting} onSave={updateMeetingInfo} />
  ) : undefined

  // 오타수정·오타사전 — AI 회의록 아래에 배치(데스크톱 패널 + 모바일 요약 탭 공통).
  // 잠금 또는 편집 권한 없음(비소유자·비협업자) 시 숨김 — 서버 authorize_meeting_control!이
  // 최종 방어선이지만 UI도 편집 불가능한 사람에게는 열지 않는다(idea 44 readOnly 배선).
  const typoSections = !locked && canEdit ? (
    <div className="shrink-0 max-h-[45%] overflow-y-auto">
      <TermCorrectionDetails
        corrections={corrections}
        status={correctionStatus}
        isApplying={isApplyingCorrections}
        onUpdate={updateCorrection}
        onAdd={addCorrectionRow}
        onRemove={removeCorrectionRow}
        onApply={handleApplyCorrections}
      />
      {meeting?.id && <GlossaryPanel meetingId={meeting.id} />}
    </div>
  ) : null

  // 모바일 탭 정의
  const mobileTabs = buildMeetingDetailTabs({
    meetingId,
    bookmarksVisible,
    bookmarks,
    transcripts,
    currentTimeMs,
    isPlaying: audio.isPlaying,
    onSeek: handleSeek,
    onDeleteBookmark: handleDeleteBookmark,
    onAddBookmark: handleOpenBookmark,
    onEditBookmark: handleEditBookmark,
    onNotesChange: handleNotesChange,
    memoEditorRef,
    onMemoEditorReady,
    onSaveMemo: handleSaveMemo,
    isSavingMemo,
    summaryOptions: summaryOptionsControl,
    searchQuery: search.effectiveQuery,
    activeSearch: activeTranscriptSearch,
    suppressAutoScroll: !!search.effectiveQuery,
    locked,
    canEdit,
    belowSummary: typoSections,
    seekTick,
    onSplit: handleTranscriptSplit,
    canRedact: canRedactMeeting(meeting, me) && !locked,
    dflowSynced: !!meeting?.dflow_synced_at,
    onRedacted: handleTranscriptRedact,
  })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 상단 툴바 */}
      <MeetingDetailTopBar
        isDesktop={isDesktop}
        hasMeeting={!!meeting}
        titleArea={meeting ? (
          <MeetingActionHeader
            meeting={meeting}
            isDesktop={isDesktop}
            meetingTypeLabel={meetingTypeLabel}
            onUpdateTitle={updateTitle}
            canEdit={canEdit}
            onToggleLock={handleToggleLock}
            isTogglingLock={isTogglingLock}
            onEditingChange={setIsEditingTitle}
          />
        ) : undefined}
        isEditingTitle={isEditingTitle}
        projectName={meeting?.project_name}
        folderPath={meeting?.folder_path}
        attachmentsVisible={attachmentsVisible}
        bookmarksVisible={bookmarksVisible}
        searchOpen={search.isOpen}
        canEdit={canEdit}
        locked={locked}
        onBack={handleBack}
        onToggleAttachments={toggleAttachments}
        onShowEdit={() => setShowEditDialog(true)}
        onToggleBookmarks={toggleBookmarks}
        onToggleSearch={() => (search.isOpen ? search.close() : search.open())}
        actions={meeting ? (
          <MeetingActions
            meeting={meeting}
            meetingId={meetingId}
            isDesktop={isDesktop}
            transcriptsCount={transcripts.length}
            isRegeneratingNotes={isRegeneratingNotes}
            onShowSttConfirm={() => setShowSttConfirm(true)}
            onShowReDiarizeConfirm={() => setShowReDiarizeConfirm(true)}
            onShowNotesConfirm={() => setShowNotesConfirm(true)}
            onReopen={async () => {
              await reopenMeeting(meetingId)
              navigate(`/meetings/${meetingId}/live`)
            }}
            onGoLive={() => navigate(`/meetings/${meetingId}/live`)}
            onDelete={deleteMeeting}
            canEdit={canEdit}
            onChanged={refetch}
          />
        ) : undefined}
      />

      {/* 페이지 내 검색 바 (전사 + AI요약) */}
      {search.isOpen && (
        <MeetingSearchBar
          query={search.query}
          onQueryChange={search.setQuery}
          matchCount={search.matches.length}
          currentIndex={search.currentIndex}
          onNext={search.next}
          onPrev={search.prev}
          onClose={search.close}
          focusTick={search.focusTick}
        />
      )}

      {/* 오디오 플레이어 (데스크톱) */}
      <div className="hidden lg:block">
        <AudioPlayer
          audio={audio}
          onTimeUpdate={setCurrentTimeMs}
          seekMs={seekMs}
          autoPlayOnSeek
        />
      </div>

      {/* 풀사이즈 플레이어 바텀 시트 (모바일) */}
      {showFullPlayer && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setShowFullPlayer(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute bottom-0 left-0 right-0 bg-card border-t shadow-lg rounded-t-xl p-3 pb-safe" onClick={(e) => e.stopPropagation()}>
            <AudioPlayer
              audio={audio}
              onTimeUpdate={setCurrentTimeMs}
              seekMs={seekMs}
              autoPlayOnSeek
            />
          </div>
        </div>
      )}

      {/* 미니 오디오 플레이어 (모바일) */}
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

      {/* 첨부 파일/링크 섹션 (명함 탭 선택 시 참석자 패널은 섹션 내부에서 표시) */}
      {attachmentsVisible && <AttachmentSection meetingId={meetingId} readOnly={locked} />}

      {/* 패널 레이아웃: 데스크톱(PanelGroup) / 모바일(MobileTabLayout) */}
      {isDesktop ? (
        <div className="flex-1 flex min-h-0 overflow-hidden">
        <PanelGroup orientation="horizontal" className="flex-1 min-w-0">
          {/* 트랜스크립트 + 북마크 패널 — 기본 22% */}
          <Panel id="transcript" defaultSize={22} minSize={15}>
            <div className="h-full flex flex-col overflow-hidden">
              {bookmarksVisible && (
                <BookmarkList bookmarks={bookmarks} onSeek={handleSeek} onDelete={handleDeleteBookmark} onAdd={handleOpenBookmark} onEdit={handleEditBookmark} readOnly={locked || !canEdit} collapsible />
              )}
              <div className="flex-1 overflow-y-auto">
                <TranscriptPanel
                  meetingId={meetingId}
                  transcripts={transcripts}
                  currentTimeMs={currentTimeMs}
                  onSeek={handleSeek}
                  searchQuery={search.effectiveQuery}
                  activeSearch={activeTranscriptSearch}
                  suppressAutoScroll={!!search.effectiveQuery}
                  readOnly={locked || !canEdit}
                  seekTick={seekTick}
                  onSplit={handleTranscriptSplit}
                  canRedact={canRedactMeeting(meeting, me) && !locked}
                  dflowSynced={!!meeting?.dflow_synced_at}
                  onRedacted={handleTranscriptRedact}
                />
              </div>
              {/* 배치 화자분리 결과 이름 변경/초기화 (MeetingViewerPage 데스크톱과 동일 패턴) */}
              <div className="border-t shrink-0">
                <SpeakerPanel meetingId={meetingId} isRecording={false} collapsible readOnly={locked || !canEdit} currentTimeMs={currentTimeMs} isPlaying={audio.isPlaying} onSpeakerSeek={handleSeek} />
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-blue-400 transition-colors cursor-col-resize" />

          {/* AI 회의록 — 기본 48%. 우측 패널 접힘/펼침으로 해제·회수되는 폭을 흡수하는 쪽 */}
          <Panel id="summary" defaultSize={48} minSize={20}>
            <div data-search-region="summary" className="h-full bg-muted overflow-hidden flex flex-col min-h-0">
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <AiSummaryPanel
                  meetingId={meetingId}
                  isRecording={false}
                  editable={!locked && canEdit}
                  onNotesChange={handleNotesChange}
                  headerExtra={summaryOptionsControl}
                  onSeek={handleSeek}
                />
              </div>
              {typoSections}
            </div>
          </Panel>

          {/* 우측(메모·AI챗) 리사이즈 핸들 — memoVisible과 무관하게 항상 마운트(패널 개수 고정).
              숨김 상태에서는 드래그로 열 수 없게 disabled 처리하고 시각적으로도 숨긴다(레이아웃 계산엔 영향 없음). */}
          <PanelResizeHandle
            disabled={!memoVisible}
            className={`w-1 bg-border hover:bg-blue-400 transition-colors cursor-col-resize ${memoVisible ? '' : 'invisible pointer-events-none'}`}
          />

          {/* 메모 + AI 챗 탭 — 기본 30%. 토글은 이 패널만 collapse(0)/expand하며,
              해제된 폭은 항상 AI 회의록(가운데) 패널이 흡수한다 — 트랜스크립트 폭 고정. */}
          <Panel id="right-tabs" defaultSize={30} minSize={15} collapsible collapsedSize={0} panelRef={rightPanelRef}>
            {memoVisible && (
              <RightTabsPanel
                meetingId={meetingId}
                memo={
                  <MemoEditorPanel
                    meetingId={meetingId}
                    editorRef={memoEditorRef}
                    onEditorReady={onMemoEditorReady}
                    onSave={handleSaveMemo}
                    isSaving={isSavingMemo}
                    readOnly={locked || !canEdit}
                  />
                }
                onSeek={handleSeek}
                folderId={meeting?.folder_id ?? null}
                projectId={meeting?.project_id ?? null}
                onSeekMeeting={handleSeekMeeting}
                onCollapse={toggleMemo}
              />
            )}
          </Panel>
        </PanelGroup>
        {/* 우측 패널이 접혔을 때 다시 펼칠 방법 — 사이드바 접힘 상태(AppLayout.tsx)와 동일한
            엣지 어포던스 패턴(w-10 슬림 스트립 + 상단 고정 버튼). Panel 안에 넣으면 PanelGroup의
            overflow:hidden에 잘려 안 보이므로 PanelGroup 밖의 flex 형제로 둔다. */}
        {!memoVisible && (
          <div className="flex flex-col items-center w-10 border-l border-border bg-card shrink-0 pt-3">
            <Tooltip text="패널 펼치기" position="left">
              <button
                onClick={toggleMemo}
                aria-label="패널 펼치기"
                className="p-2.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <PanelRightOpen className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        )}
        </div>
      ) : (
        <MobileTabLayout
          tabs={mobileTabs}
          activeTab={mobileTab}
          onTabChange={setMobileTab}
        />
      )}

      {/* 미니 오디오 플레이어(fixed bottom)가 하단 콘텐츠를 가리지 않도록 스페이서 (모바일) */}
      {audio.hasAudio && audio.isReady && (
        <div aria-hidden className="lg:hidden shrink-0 h-[calc(3rem+env(safe-area-inset-bottom))]" />
      )}

      {/* STT 재생성 확인 다이얼로그 */}
      {showSttConfirm && (
        <ConfirmDialog
          title="STT 재생성"
          message="기존 트랜스크립트와 회의록이 모두 삭제되고, 저장된 오디오로 처음부터 다시 생성됩니다. 계속하시겠습니까?"
          confirmLabel="재생성"
          onConfirm={handleRegenerateStt}
          onCancel={() => setShowSttConfirm(false)}
        />
      )}

      {/* 화자분리만 재실행 확인 다이얼로그 (전사 텍스트는 유지, 화자만 재배정) */}
      {showReDiarizeConfirm && (
        <ConfirmDialog
          title="화자분리만 재실행"
          message="전사 텍스트는 그대로 두고, 현재 민감도 설정으로 화자만 다시 분리합니다. 화자 이름은 초기화됩니다. 다시 전사하지는 않으며 1~2분 정도 걸립니다. 계속하시겠습니까?"
          confirmLabel="재실행"
          onConfirm={handleReDiarize}
          onCancel={() => setShowReDiarizeConfirm(false)}
        />
      )}

      {/* 회의록 재생성 확인 다이얼로그 */}
      {showNotesConfirm && (
        <ConfirmDialog
          title="회의록 재생성"
          message="기존 회의록을 삭제하고 전체 트랜스크립트를 바탕으로 처음부터 다시 생성합니다. 계속하시겠습니까?"
          confirmLabel="재생성"
          onConfirm={handleRegenerateNotes}
          onCancel={() => setShowNotesConfirm(false)}
        />
      )}

      {/* 회의 정보 수정 다이얼로그 */}
      {showEditDialog && meeting && (
        <EditMeetingDialog
          meeting={meeting}
          meetingTypeList={meetingTypeList}
          onConfirm={async (data) => {
            await updateMeetingInfo(data)
            setShowEditDialog(false)
          }}
          onClose={() => setShowEditDialog(false)}
        />
      )}

      {/* 북마크 추가 팝오버 (현재 재생 위치) */}
      {showBookmarkPopover && (
        <BookmarkPopover
          timestampMs={bookmarkTs}
          label={bookmarkLabel}
          onLabelChange={setBookmarkLabel}
          onSave={handleSaveBookmark}
          onClose={() => setShowBookmarkPopover(false)}
        />
      )}
    </div>
  )
}
