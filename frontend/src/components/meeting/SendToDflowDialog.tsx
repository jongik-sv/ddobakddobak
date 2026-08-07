import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Dialog } from '../ui/Dialog'
import { useAuthStore } from '../../stores/authStore'
import { confirmDialog } from '../../lib/confirmDialog'
import { httpErrorInfo } from '../../lib/errors'
import {
  detectDflowTeam,
  buildDflowTitle,
  isValidDflowUuid,
  resolveDflowLinkAction,
  dflowFolderDepthExceedsWarningLimit,
  dflowFolderPreviewPath,
} from '../../lib/dflowAutoAssign'
import {
  getDflowStatus,
  getDflowMeta,
  uploadToDflow,
  setDflowLink,
  claimDflowMinute,
  listDflowMinutes,
} from '../../api/dflow'
import type {
  DflowMeetingStatusWithExists,
  DflowMeta,
  DflowUploadResult,
  DflowMinuteItem,
  DflowMeetingItem,
  DflowMeetingUploadOption,
} from '../../api/dflow'
import type { Meeting } from '../../api/meetings'

interface SendToDflowDialogProps {
  meeting: Meeting
  onClose: () => void
  /** 전송/연결 상태를 바꾸는 mutation(전송, link 설정/해제/재발급, claim/역주입) 성공 시마다 호출.
   *  상위 페이지가 meeting을 refetch해 배지·진입점 상태 텍스트를 최신화하도록 하는 훅. */
  onChanged?: () => void
}

const UNKNOWN_USER_MESSAGE = "D'Flow에 동일 이메일 계정이 필요합니다. D'Flow 관리자에게 계정 생성을 요청하세요."
// "판정 불가 → 선택" 톤: 왜 select가 뜨는지(자동 판정 불가)와 무엇을 해야 하는지(직접 선택)를 분리해 전달한다.
const TEAM_REQUIRED_MESSAGE = 'team을 자동으로 판정할 수 없습니다 — 아래에서 대상 구분을 직접 선택해 주세요.'
const BODY_TOO_LONG_MESSAGE = '본문이 100,000자를 넘습니다. (전사 원문은 전송에서 제외됨)'
const REISSUE_CONFIRM_MESSAGE = "다음 전송 시 D'Flow에 새 회의록이 생성되고 기존 것은 남습니다. 계속할까요?"
const UNLINK_CONFIRM_MESSAGE = "D'Flow 연결을 해제하시겠습니까? 회의록의 전송 상태가 초기화됩니다."
// exists_on_dflow: false ＋ dflow_synced_at 있음 — 초기화·보관·삭제 중 원인을 단정할 수 없다(W14 §7.6).
const DFLOW_MISSING_MESSAGE = "D'Flow에서 확인되지 않습니다(초기화·보관·삭제 중 하나)"
const FORCE_SEND_CONFIRM_MESSAGE = "D'Flow에서 확인되지 않아 새 회의록으로 전송됩니다. 계속할까요?"
// exists_on_dflow: true ＋ dflow_archived: true — 원인이 보관으로 확정된 경우(dflow-W24).
const DFLOW_ARCHIVED_MESSAGE =
  "D'Flow에서 보관됨 — 재전송은 막힙니다. D'Flow에서 보관 해제 후 다시 시도하세요."
// W4 3-b: 깊이 5 초과는 D'Flow가 조용히 절단한다(400 아님) — 여기서는 차단하지 않고 사전 경고만 한다.
// W7: 아래 미리보기는 절단 전 경로다 — 절단 여부·최종 위치는 전송 후에만 확인 가능함을 덧붙인다.
const DEPTH_WARNING_MESSAGE =
  "편철 경로가 D'Flow 보존 한도(5단)를 넘습니다. 전송하면 상위 폴더로 조정되어 저장됩니다. " +
  '실제 저장 위치는 전송 후 확인해 주세요(아래 미리보기는 조정 전 경로입니다).'
// W8: 전송 후 실제 편철 결과 안내. dflow.ts#DflowUploadResult 3값 규약 그대로 — "팀 루트"라고 쓰지 말 것.
const FOLDER_UNCLASSIFIED_MESSAGE = "미분류로 들어갔습니다(D'Flow에서 편철 필요)"
const FOLDER_PATH_TRUNCATED_MESSAGE =
  "편철 경로가 D'Flow 보존 한도(5단)를 넘어 상위 폴더로 조정되어 저장되었습니다."
const FOLDER_PATH_PARTIAL_MESSAGE = '중간 폴더 생성에 실패해 상위 폴더까지만 편철되었습니다.'
// folder_path_status 배지: exact(정상)는 조용히 — 배지를 렌더하지 않는다. 키 부재도 마찬가지(렌더 안 함).
const FOLDER_PATH_STATUS_BADGE: Record<'truncated' | 'partial' | 'unclassified', { label: string; className: string }> = {
  truncated: { label: '경로 절단됨', className: 'bg-amber-100 text-amber-700' },
  partial: { label: '상위 폴더까지만', className: 'bg-amber-100 text-amber-700' },
  unclassified: { label: '미분류', className: 'bg-amber-100 text-amber-700' },
}

/** ky HTTPError → { message, code } 공통 파싱 (DflowSettingsPanel.tsx handleTest 관례). lib/errors.ts httpErrorInfo 기반. */
async function parseDflowError(err: unknown, fallback: string): Promise<{ message: string; code?: string }> {
  const info = await httpErrorInfo(err)
  if (!info) return { message: fallback }
  return { message: info.message ?? fallback, code: info.code ?? undefined }
}

// ── 회의 연결(선택) ──

/** D'Flow MEETING_CATEGORIES 6종 라벨(계약 v2.5 §1.1). 목록의 category는 외부 문자열이라
 *  이 표에 없는 값은 원문을 그대로 보여준다(meetingCategoryLabel). */
const DFLOW_MEETING_CATEGORY_LABELS: Record<string, string> = {
  routine: '정례',
  general: '일반',
  kickoff: '킥오프',
  review: '리뷰',
  report: '보고',
  external: '외부',
}
type DflowMeetingCategory = 'routine' | 'general' | 'kickoff' | 'review' | 'report' | 'external'
const DFLOW_MEETING_CATEGORY_OPTIONS: DflowMeetingCategory[] = [
  'general',
  'routine',
  'kickoff',
  'review',
  'report',
  'external',
]

function meetingCategoryLabel(category: string): string {
  return DFLOW_MEETING_CATEGORY_LABELS[category] ?? category
}

/** "➕ 신규 회의 등록" 옵션의 select value 센티널 — 실제 D'Flow uuid와 겹치지 않는다. */
const NEW_MEETING_OPTION_VALUE = '__new__'
const NO_PROJECT_OPTION_VALUE = ''

/** 회의 날짜(ISO, UTC) → KST(Asia/Seoul) YYYY-MM-DD. en-CA 로케일이 ISO 순서(YYYY-MM-DD)를 그대로 준다. */
function toKstDateString(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
}

/** 두 YYYY-MM-DD 문자열의 절대 일수 차이. 정렬 기준(|meeting.date − 회의록 날짜| 오름차순)에만 쓴다. */
function absDaysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  return Math.abs(da - db)
}

const NO_DFLOW_PROJECTS_MESSAGE = "D'Flow 프로젝트가 없습니다 — 연결 없이 전송해 주세요."
const MEETING_LIST_ERROR_MESSAGE = '회의 목록을 불러오지 못했습니다.'

interface UseDflowMeetingLinkArgs {
  meeting: Meeting
  meetingDateStr: string
  meta: DflowMeta | null
  status: DflowMeetingStatusWithExists | null
}

/** 회의 연결(선택) 상태·파생값·핸들러 — 커스텀 hook으로 뺐을 뿐 상태 소유는 그대로
 *  SendToDflowDialog 렌더 안에 있다(값이 handleSend의 meetingSelectionInvalid 체크·전송 버튼
 *  disabled·MeetingLinkSection JSX 세 곳에서 매 렌더 읽혀야 해서 상태 자체를 자식 컴포넌트로
 *  내리면 부모 리렌더가 어긋난다 — WP-F5 결정 사항). */
function useDflowMeetingLink({ meeting, meetingDateStr, meta, status }: UseDflowMeetingLinkArgs) {
  // 'unlink'는 §3.2 스니펫에 없지만 [연결 해제] 액션(§0)을 표현할 상태가
  // 필요해 이 파일 안에서만 추가했다(설계와 다른 결정 — 최종 보고 참조).
  const [meetingMode, setMeetingMode] = useState<'keep' | 'none' | 'link' | 'create' | 'unlink'>('none')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectMeetings, setProjectMeetings] = useState<DflowMeetingItem[] | null>(null)
  const [projectMeetingsLoading, setProjectMeetingsLoading] = useState(false)
  const [projectMeetingsError, setProjectMeetingsError] = useState<string | null>(null)
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [newMeeting, setNewMeeting] = useState<{ title: string; date: string; category: DflowMeetingCategory }>(
    () => ({ title: buildDflowTitle(meeting.title), date: toKstDateString(meeting.started_at ?? meeting.created_at), category: 'general' })
  )

  const sortedProjectMeetings = useMemo(() => {
    if (!projectMeetings) return []
    return [...projectMeetings].sort(
      (a, b) => absDaysBetween(a.date, meetingDateStr) - absDaysBetween(b.date, meetingDateStr)
    )
  }, [projectMeetings, meetingDateStr])
  const selectedProject = meta?.projects.find((p) => p.id === selectedProjectId) ?? null
  const isNewMeetingTitleValid = newMeeting.title.trim().length > 0 && newMeeting.title.length <= 200
  const isNewMeetingDateValid = /^\d{4}-\d{2}-\d{2}$/.test(newMeeting.date)
  const meetingSelectionInvalid =
    (meetingMode === 'link' && !selectedMeetingId) ||
    (meetingMode === 'create' && !(isNewMeetingTitleValid && isNewMeetingDateValid))

  /** 회의 연결 옵션(브리프 §2.2 구조 그대로) — keep/none은 undefined(meeting 키 자체를 생략). */
  function buildMeetingOption(): DflowMeetingUploadOption | undefined {
    if (meetingMode === 'link' && selectedMeetingId) {
      const picked = sortedProjectMeetings.find((m) => m.id === selectedMeetingId)
      return {
        mode: 'link',
        meeting_id: selectedMeetingId,
        display: { meeting_title: picked?.title ?? '', project_name: selectedProject?.name ?? '' },
      }
    }
    if (meetingMode === 'create') {
      return {
        mode: 'create',
        project_id: selectedProjectId ?? undefined,
        title: newMeeting.title.trim(),
        date: newMeeting.date,
        category: newMeeting.category,
        display: { meeting_title: newMeeting.title.trim(), project_name: selectedProject?.name ?? '' },
      }
    }
    if (meetingMode === 'unlink') {
      return { mode: 'unlink' }
    }
    return undefined
  }

  async function handleProjectChange(projectId: string) {
    setSelectedProjectId(projectId || null)
    setSelectedMeetingId(null)
    setProjectMeetings(null)
    setProjectMeetingsError(null)
    if (!projectId) {
      setMeetingMode('none')
      return
    }
    setMeetingMode('none')
    setProjectMeetingsLoading(true)
    try {
      const m = await getDflowMeta(projectId)
      setProjectMeetings(m.meetings ?? [])
    } catch {
      setProjectMeetingsError(MEETING_LIST_ERROR_MESSAGE)
    } finally {
      setProjectMeetingsLoading(false)
    }
  }

  function handleMeetingSelect(value: string) {
    if (value === NO_PROJECT_OPTION_VALUE) {
      setSelectedMeetingId(null)
      setMeetingMode('none')
      return
    }
    if (value === NEW_MEETING_OPTION_VALUE) {
      setSelectedMeetingId(null)
      setMeetingMode('create')
      setNewMeeting({ title: buildDflowTitle(meeting.title), date: meetingDateStr, category: 'general' })
      return
    }
    setSelectedMeetingId(value)
    setMeetingMode('link')
  }

  /** [변경] — 현재 연결 스냅샷을 접고 프로젝트/회의 재선택 UI로 전환한다. */
  function handleChangeMeeting() {
    setMeetingMode('none')
    setSelectedProjectId(null)
    setSelectedMeetingId(null)
    setProjectMeetings(null)
    setProjectMeetingsError(null)
  }

  /** [연결 해제] — 로컬 상태만 바꾼다(전송 시 meeting_id: null이 실려 나감). API 즉시호출 없음. */
  function handleMarkUnlink() {
    setMeetingMode('unlink')
  }

  /** 선택 UI에서 원래 연결(keep) 상태로 되돌아간다. */
  function handleCancelMeetingEdit() {
    setMeetingMode(status?.dflow_meeting_id ? 'keep' : 'none')
    setSelectedProjectId(null)
    setSelectedMeetingId(null)
    setProjectMeetings(null)
    setProjectMeetingsError(null)
  }

  return {
    meetingMode,
    setMeetingMode,
    selectedProjectId,
    projectMeetingsLoading,
    projectMeetingsError,
    selectedMeetingId,
    newMeeting,
    setNewMeeting,
    sortedProjectMeetings,
    meetingSelectionInvalid,
    handleProjectChange,
    handleMeetingSelect,
    handleChangeMeeting,
    handleMarkUnlink,
    handleCancelMeetingEdit,
    buildMeetingOption,
  }
}

/**
 * D'Flow(회의록 아카이브) 전송 모달. 열릴 때 상태(getDflowStatus)·구분 목록(getDflowMeta)을
 * 조회해 team 자동 판정·제목 자동 조립을 미리보기로 재현하고, 전송/연결 관리(수동 입력·해제·재발급·
 * D'Flow에서 찾기)를 제공한다. ExportButton 드롭다운의 "D'Flow로 전송" 항목에서 연다.
 */
export default function SendToDflowDialog({ meeting, onClose, onChanged }: SendToDflowDialogProps) {
  const user = useAuthStore((s) => s.user)

  const [status, setStatus] = useState<DflowMeetingStatusWithExists | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [meta, setMeta] = useState<DflowMeta | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [title, setTitle] = useState(() => buildDflowTitle(meeting.title))
  const [selectedTeam, setSelectedTeam] = useState('')
  const [forceTeamSelect, setForceTeamSelect] = useState(false)

  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [bodyTooLong, setBodyTooLong] = useState(false)
  const [sendResult, setSendResult] = useState<DflowUploadResult | null>(null)

  // 연결 관리(복사·해제·재발급·수동 입력·D'Flow에서 찾기) 상태·핸들러는 LinkManagementSection으로
  // 옮겼다. detailsOpen/showSearch만 여기 남는다 — dflowMissing 안내의 [D'Flow에서 찾기로 재연결]
  // (handleOpenSearchFromNotice)이 그 섹션 밖에서 열어야 하기 때문(컴포넌트 경계를 건너는 유일한 상태).
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  // 회의 연결(선택) 파생값 — meeting.date와의 근접순 정렬(§0) 기준. useDflowMeetingLink(meetingMode 등)
  // 보다 먼저 계산해 hook에 전달한다.
  const meetingDateStr = useMemo(
    () => toKstDateString(meeting.started_at ?? meeting.created_at),
    [meeting.started_at, meeting.created_at]
  )
  const meetingLink = useDflowMeetingLink({ meeting, meetingDateStr, meta, status })

  const loadMeta = useCallback(async () => {
    try {
      const m = await getDflowMeta()
      setMeta(m)
      setMetaError(null)
      return m
    } catch {
      setMetaError('구분(team) 목록을 불러오지 못했습니다.')
      return null
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getDflowStatus(meeting.id)
      setStatus(s)
      setStatusError(null)
      return s
    } catch {
      setStatusError('연결 상태를 불러오지 못했습니다.')
      return null
    }
  }, [meeting.id])

  useEffect(() => {
    setLoading(true)
    Promise.all([refreshStatus(), loadMeta()]).then(([s]) => {
      // §3.2: 초기값은 status에 dflow_meeting_id 있으면 'keep', 없으면 'none'. 이후 useEffect
      // 재실행 없이(빈 deps) 1회만 판정 — refreshStatus가 이후 전송 성공으로 다시 불려도
      // meetingMode를 덮어쓰지 않는다(사용자가 고른 모드가 전송 결과로 리셋되면 안 됨).
      meetingLink.setMeetingMode(s?.dflow_meeting_id ? 'keep' : 'none')
    }).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열릴 때 1회만 조회
  }, [])

  const detectedTeam = meta ? detectDflowTeam(meeting.folder_path, meta.teams) : null
  const needsTeamSelect = forceTeamSelect || detectedTeam === null
  // §2-C: "경고는 teamOverride 확정 이후 재평가" — 이번 전송에서 실제로 보낼 team(자동 판정값
  // 또는 select 확정값)을 root와 비교해야 한다. detectedTeam만 쓰면 team_required 재시도로
  // selectedTeam이 root와 다른 team으로 확정된 경우를 놓친다(root는 meta.teams에 있지만 이번
  // 전송은 다른 team으로 나가는 경우). select 미확정(''）이면 null — 보수적으로 +1 쪽으로 평가한다.
  const resolvedTeam = needsTeamSelect ? (selectedTeam.trim() || null) : detectedTeam
  const depthWarning = meta ? dflowFolderDepthExceedsWarningLimit(meeting.folder_path, resolvedTeam) : false
  // W7: "MES / 품질 / 주간정례" 형태의 편철 경로 미리보기. dflowEffectiveFolderDepth(위 depthWarning)와
  // 판정 기준(dflowRootIsResolvedTeamRoot)을 공유한다 — 사본을 두지 않는다(브리프 경고).
  const previewPath = meta ? dflowFolderPreviewPath(meeting.folder_path, resolvedTeam) : []

  // 전송 이력(dflow_synced_at)은 있는데 D'Flow에서 확인되지 않음 — 원인(초기화·보관·삭제)을
  // 단정할 수 없다. dflow_synced_at이 없으면(수동 입력 직후 등) 정상 상태이므로 띄우지 않는다.
  const dflowMissing = !sendResult && status?.exists_on_dflow === false && !!status?.dflow_synced_at
  // R1 이후 D'Flow가 보관 상태를 명시적으로 알려준 경우 — dflow_archived === true로만 판정한다.
  // undefined는 "모름"이지 "아님"이 아니다.
  const dflowArchived = !sendResult && status?.exists_on_dflow === true && status?.dflow_archived === true
  // [전송] 차단은 원인을 단정할 수 없는 dflowMissing에만 건다(브리프 §W14 요건 2 문구 그대로).
  // dflowArchived는 "권하지 말 것"이지 차단 대상이 아니다 — 클라이언트가 보는 archived 플래그는
  // stale할 수 있고(예: 방금 D'Flow에서 보관 해제), 막으면 D'Flow가 실제로 주는 정확한 409
  // 안내("보관된 회의록입니다. 복원 후 다시 시도하세요.")로 갈 길이 없어진다.
  const sendBlocked = dflowMissing

  async function handleSend() {
    if (needsTeamSelect && !selectedTeam) return
    if (meetingLink.meetingSelectionInvalid) return
    setSending(true)
    setSendError(null)
    try {
      const meetingOption = meetingLink.buildMeetingOption()
      const result = await uploadToDflow(meeting.id, {
        titleOverride: title,
        ...(needsTeamSelect ? { teamOverride: selectedTeam } : {}),
        ...(meetingOption ? { meeting: meetingOption } : {}),
      })
      setSendResult(result)
      // status는 DflowMeetingStatusWithExists 4필드 + exists_on_dflow 만 담는다 — result(DflowUploadResult)의
      // folder_id/folder_path/folder_path_status 는 status로 새지 않게 필드를 명시적으로 골라 담는다
      // (W19 의 DflowUploadResult/DflowMeetingStatus 타입 분리를 런타임에서도 지킨다).
      // dflow_meeting_*는 3값 규약(undefined=응답에 안 실림→keep이므로 기존 값 유지 / null=해제 /
      // 값=연결) — keep 모드 응답은 이 키를 안 실어 보낼 수 있어 prev 값을 폴백으로 둔다.
      setStatus((prev) => ({
        public_uid: result.public_uid,
        dflow_synced_at: result.dflow_synced_at,
        dflow_url: result.dflow_url,
        needs_resync: result.needs_resync,
        exists_on_dflow: true,
        dflow_meeting_id: result.dflow_meeting_id !== undefined ? result.dflow_meeting_id : (prev?.dflow_meeting_id ?? null),
        dflow_meeting_title:
          result.dflow_meeting_title !== undefined ? result.dflow_meeting_title : (prev?.dflow_meeting_title ?? null),
        dflow_project_name:
          result.dflow_project_name !== undefined ? result.dflow_project_name : (prev?.dflow_project_name ?? null),
      }))
      onChanged?.()
    } catch (err) {
      const { message, code } = await parseDflowError(err, '전송에 실패했습니다.')
      if (code === 'dflow_unknown_user') {
        setSendError(UNKNOWN_USER_MESSAGE)
      } else if (code === 'team_required') {
        setForceTeamSelect(true)
        if (!meta) await loadMeta()
        setSendError(TEAM_REQUIRED_MESSAGE)
      } else if (code === 'body_too_long') {
        setBodyTooLong(true)
        setSendError(BODY_TOO_LONG_MESSAGE)
      } else {
        setSendError(message)
      }
    } finally {
      setSending(false)
    }
  }

  /** W14 차단 안내의 "새로 전송" — 확인 후에만 handleSend를 실제로 호출한다(중복 회의록 생성 인지). */
  async function handleForceSend() {
    const ok = await confirmDialog(FORCE_SEND_CONFIRM_MESSAGE)
    if (!ok) return
    await handleSend()
  }

  /** W14 차단 안내의 "[D'Flow에서 찾기]로 재연결" — 연결 관리를 펼치고 검색 패널을 바로 연다. */
  function handleOpenSearchFromNotice() {
    setDetailsOpen(true)
    setShowSearch(true)
  }

  return (
    <Dialog
      onClose={onClose}
      backdropClassName="bg-black/20 backdrop-blur-sm"
      className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl"
      ariaLabel="D'Flow로 전송"
    >
      <h2 className="mb-1 text-lg font-semibold text-foreground">D'Flow로 전송</h2>
      <p className="mb-4 truncate text-sm text-muted-foreground">{meeting.title}</p>

      {loading && <p role="status" className="text-sm text-muted-foreground">불러오는 중...</p>}

      {!loading && (
        <div className="space-y-4">
          {/* 미리보기 */}
          <div className="space-y-3 rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">전송 사용자</span>
              <span className="text-foreground">{user?.email ?? '-'}</span>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">대상 구분(team)</label>
              {needsTeamSelect ? (
                <>
                  <select
                    aria-label="대상 구분"
                    value={selectedTeam}
                    onChange={(e) => setSelectedTeam(e.target.value)}
                    disabled={sending}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring bg-background"
                  >
                    <option value="">선택하세요</option>
                    {meta?.teams.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {metaError && <p className="mt-1 text-xs text-red-600">{metaError}</p>}
                </>
              ) : (
                <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                  {detectedTeam}
                </p>
              )}
            </div>

            {previewPath.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">편철 경로 미리보기</label>
                <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                  {previewPath.join(' / ')}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="dflow-title-input" className="mb-1 block text-xs font-medium text-muted-foreground">
                전송 제목
              </label>
              <input
                id="dflow-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={sending}
                maxLength={200}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {depthWarning && <p className="text-xs text-amber-600">{DEPTH_WARNING_MESSAGE}</p>}
          </div>

          {/* 회의 연결(선택) — §0. keep(재전송 기본, 연결 있음) / none(신규 전송 기본, 미연결) /
              link·create(선택 중) / unlink(해제 예정, [연결 해제] 클릭 후). meeting 옵션은 전송
              시에만 buildMeetingOption()으로 조립되어 나간다 — 여기서는 API를 즉시 호출하지 않는다. */}
          <MeetingLinkSection
            status={status}
            meta={meta}
            sending={sending}
            meetingMode={meetingLink.meetingMode}
            selectedProjectId={meetingLink.selectedProjectId}
            projectMeetingsLoading={meetingLink.projectMeetingsLoading}
            projectMeetingsError={meetingLink.projectMeetingsError}
            selectedMeetingId={meetingLink.selectedMeetingId}
            sortedProjectMeetings={meetingLink.sortedProjectMeetings}
            newMeeting={meetingLink.newMeeting}
            onNewMeetingChange={meetingLink.setNewMeeting}
            onProjectChange={meetingLink.handleProjectChange}
            onMeetingSelect={meetingLink.handleMeetingSelect}
            onChangeMeeting={meetingLink.handleChangeMeeting}
            onMarkUnlink={meetingLink.handleMarkUnlink}
            onCancelMeetingEdit={meetingLink.handleCancelMeetingEdit}
          />

          {sendError && (
            <div role="alert" className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
              {sendError}
            </div>
          )}

          {!sendResult && status?.exists_on_dflow && status.dflow_title && status.dflow_archived !== true && (
            <p className="text-xs text-amber-600">
              D'Flow의 "{status.dflow_title}"({status.dflow_date})을 덮어씁니다.
            </p>
          )}

          {dflowArchived && (
            <div role="alert" className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-700">
              {DFLOW_ARCHIVED_MESSAGE}
            </div>
          )}

          {dflowMissing && (
            <div role="alert" className="space-y-2 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-700">
              <p>{DFLOW_MISSING_MESSAGE}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleOpenSearchFromNotice}
                  className="rounded-md border border-amber-600 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                >
                  D'Flow에서 찾기로 재연결
                </button>
                <button
                  type="button"
                  onClick={handleForceSend}
                  disabled={sending || bodyTooLong || (needsTeamSelect && !selectedTeam) || meetingLink.meetingSelectionInvalid}
                  className="rounded-md border border-amber-600 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                >
                  새로 전송
                </button>
              </div>
            </div>
          )}

          {sendResult ? (
            <>
              <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                전송됨
                {sendResult.dflow_url && (
                  <>
                    {' · '}
                    <a href={sendResult.dflow_url} target="_blank" rel="noopener noreferrer" className="underline">
                      D'Flow에서 보기
                    </a>
                  </>
                )}
                {sendResult.folder_path_status && sendResult.folder_path_status !== 'exact' && (
                  <span
                    className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${FOLDER_PATH_STATUS_BADGE[sendResult.folder_path_status].className}`}
                  >
                    {FOLDER_PATH_STATUS_BADGE[sendResult.folder_path_status].label}
                  </span>
                )}
                {sendResult.dflow_meeting_id && (
                  <span className="ml-2 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    회의 연결됨
                  </span>
                )}
                {sendResult.meeting_created && (
                  <span className="ml-2 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    새 회의 등록됨
                  </span>
                )}
              </div>

              {/* W8: 전송 후 실제 편철 위치 — W7 미리보기(전송 전 예측)와 구분되는 실제 결과. */}
              {sendResult.folder_id !== undefined && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">편철 결과 경로</span>{' '}
                  {sendResult.folder_id === null
                    ? FOLDER_UNCLASSIFIED_MESSAGE
                    : sendResult.folder_path && sendResult.folder_path.length > 0
                      ? sendResult.folder_path.join(' / ')
                      : '(최상위 폴더)'}
                </p>
              )}

              {sendResult.folder_path_status === 'truncated' && (
                <p role="alert" className="text-xs text-amber-600">{FOLDER_PATH_TRUNCATED_MESSAGE}</p>
              )}
              {sendResult.folder_path_status === 'partial' && (
                <p role="alert" className="text-xs text-amber-600">{FOLDER_PATH_PARTIAL_MESSAGE}</p>
              )}
              {/* folder_id가 없어(구버전 D'Flow 등) 위 "편철 결과 경로"에 미분류 문구가 안 뜨는 경우를
                  대비한 보강 — folder_id: null이면 이미 그 줄에서 같은 문구가 뜨므로 중복 렌더하지 않는다. */}
              {sendResult.folder_path_status === 'unclassified' && sendResult.folder_id === undefined && (
                <p role="alert" className="text-xs text-amber-600">{FOLDER_UNCLASSIFIED_MESSAGE}</p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  닫기
                </button>
              </div>
            </>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={
                  sending ||
                  bodyTooLong ||
                  sendBlocked ||
                  (needsTeamSelect && !selectedTeam) ||
                  meetingLink.meetingSelectionInvalid
                }
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {sending ? '전송 중…' : '전송'}
              </button>
            </div>
          )}

          {/* 연결 관리 */}
          <LinkManagementSection
            meetingId={meeting.id}
            status={status}
            statusError={statusError}
            teams={meta?.teams ?? []}
            detailsOpen={detailsOpen}
            onDetailsOpenChange={setDetailsOpen}
            showSearch={showSearch}
            onShowSearchChange={setShowSearch}
            refreshStatus={refreshStatus}
            onChanged={onChanged}
          />
        </div>
      )}
    </Dialog>
  )
}

interface MeetingLinkSectionProps {
  status: DflowMeetingStatusWithExists | null
  meta: DflowMeta | null
  sending: boolean
  meetingMode: 'keep' | 'none' | 'link' | 'create' | 'unlink'
  selectedProjectId: string | null
  projectMeetingsLoading: boolean
  projectMeetingsError: string | null
  selectedMeetingId: string | null
  sortedProjectMeetings: DflowMeetingItem[]
  newMeeting: { title: string; date: string; category: DflowMeetingCategory }
  onNewMeetingChange: Dispatch<SetStateAction<{ title: string; date: string; category: DflowMeetingCategory }>>
  onProjectChange: (projectId: string) => void
  onMeetingSelect: (value: string) => void
  onChangeMeeting: () => void
  onMarkUnlink: () => void
  onCancelMeetingEdit: () => void
}

/** '회의 연결(선택)' 섹션 — §0. keep(재전송 기본, 연결 있음) / none(신규 전송 기본, 미연결) /
 *  link·create(선택 중) / unlink(해제 예정, [연결 해제] 클릭 후). 상태·파생값은 useDflowMeetingLink가
 *  부모에서 소유하고(전송 버튼 disabled·handleSend가 매 렌더 읽어야 해서), 이 컴포넌트는 순수 표시만 맡는다. */
function MeetingLinkSection({
  status,
  meta,
  sending,
  meetingMode,
  selectedProjectId,
  projectMeetingsLoading,
  projectMeetingsError,
  selectedMeetingId,
  sortedProjectMeetings,
  newMeeting,
  onNewMeetingChange,
  onProjectChange,
  onMeetingSelect,
  onChangeMeeting,
  onMarkUnlink,
  onCancelMeetingEdit,
}: MeetingLinkSectionProps) {
  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm">
      <label className="block text-xs font-medium text-muted-foreground">회의 연결 (선택)</label>

      {meetingMode === 'keep' && status?.dflow_meeting_id && (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-foreground">
            {status.dflow_project_name ?? '-'} / {status.dflow_meeting_title ?? '-'}
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onChangeMeeting}
              disabled={sending}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50"
            >
              변경
            </button>
            <button
              type="button"
              onClick={onMarkUnlink}
              disabled={sending}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50"
            >
              연결 해제
            </button>
          </div>
        </div>
      )}

      {meetingMode === 'unlink' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-amber-600">연결 해제 예정 — 전송하면 D'Flow 연결이 해제됩니다.</span>
          <button
            type="button"
            onClick={onCancelMeetingEdit}
            disabled={sending}
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50"
          >
            취소
          </button>
        </div>
      )}

      {(meetingMode === 'none' || meetingMode === 'link' || meetingMode === 'create') && (
        <div className="space-y-2">
          {meta && meta.projects.length === 0 ? (
            <p className="text-xs text-muted-foreground">{NO_DFLOW_PROJECTS_MESSAGE}</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <select
                  aria-label="D'Flow 프로젝트"
                  value={selectedProjectId ?? NO_PROJECT_OPTION_VALUE}
                  onChange={(e) => onProjectChange(e.target.value)}
                  disabled={sending}
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring bg-background"
                >
                  <option value={NO_PROJECT_OPTION_VALUE}>연결 안 함</option>
                  {meta?.projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {status?.dflow_meeting_id && (
                  <button
                    type="button"
                    onClick={onCancelMeetingEdit}
                    disabled={sending}
                    className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    취소
                  </button>
                )}
              </div>

              {selectedProjectId && (
                <>
                  {projectMeetingsLoading && (
                    <p role="status" className="text-xs text-muted-foreground">회의 목록 불러오는 중...</p>
                  )}
                  {projectMeetingsError && (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-red-600">{projectMeetingsError}</p>
                      <button
                        type="button"
                        onClick={() => onProjectChange(selectedProjectId)}
                        className="shrink-0 text-xs text-blue-600 hover:underline"
                      >
                        재시도
                      </button>
                    </div>
                  )}
                  {!projectMeetingsLoading && !projectMeetingsError && (
                    <select
                      aria-label="D'Flow 회의"
                      value={selectedMeetingId ?? NO_PROJECT_OPTION_VALUE}
                      onChange={(e) => onMeetingSelect(e.target.value)}
                      disabled={sending}
                      className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring bg-background"
                    >
                      <option value={NO_PROJECT_OPTION_VALUE}>선택하세요</option>
                      <option value={NEW_MEETING_OPTION_VALUE}>➕ 신규 회의 등록</option>
                      {sortedProjectMeetings.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title} · {m.date} · {meetingCategoryLabel(m.category)}
                          {m.recurrence !== 'none' ? ' · 반복' : ''}
                        </option>
                      ))}
                    </select>
                  )}

                  {meetingMode === 'create' && (
                    <div className="space-y-2 rounded-md border border-border p-2.5">
                      <div>
                        <label htmlFor="dflow-new-meeting-title" className="mb-1 block text-xs font-medium text-muted-foreground">
                          제목
                        </label>
                        <input
                          id="dflow-new-meeting-title"
                          type="text"
                          value={newMeeting.title}
                          onChange={(e) => onNewMeetingChange((v) => ({ ...v, title: e.target.value }))}
                          disabled={sending}
                          maxLength={200}
                          className="w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div>
                        <label htmlFor="dflow-new-meeting-date" className="mb-1 block text-xs font-medium text-muted-foreground">
                          날짜
                        </label>
                        <input
                          id="dflow-new-meeting-date"
                          type="date"
                          value={newMeeting.date}
                          onChange={(e) => onNewMeetingChange((v) => ({ ...v, date: e.target.value }))}
                          disabled={sending}
                          className="w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring bg-background"
                        />
                      </div>
                      <div>
                        <label htmlFor="dflow-new-meeting-category" className="mb-1 block text-xs font-medium text-muted-foreground">
                          구분
                        </label>
                        <select
                          id="dflow-new-meeting-category"
                          value={newMeeting.category}
                          onChange={(e) =>
                            onNewMeetingChange((v) => ({ ...v, category: e.target.value as DflowMeetingCategory }))
                          }
                          disabled={sending}
                          className="w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring bg-background"
                        >
                          {DFLOW_MEETING_CATEGORY_OPTIONS.map((c) => (
                            <option key={c} value={c}>{DFLOW_MEETING_CATEGORY_LABELS[c]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface LinkManagementSectionProps {
  meetingId: number
  status: DflowMeetingStatusWithExists | null
  statusError: string | null
  teams: string[]
  detailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
  showSearch: boolean
  onShowSearchChange: Dispatch<SetStateAction<boolean>>
  refreshStatus: () => Promise<DflowMeetingStatusWithExists | null>
  onChanged?: () => void
}

/** '연결 관리' 접이 섹션: public_uid 복사·해제·재발급·수동 입력·[D'Flow에서 찾기]. detailsOpen/showSearch만
 *  부모가 소유(dflowMissing 안내의 [D'Flow에서 찾기로 재연결]이 이 섹션 밖에서 열어야 해서) — 나머지 9개
 *  상태는 이 컴포넌트 안에서만 쓰인다. DflowMinuteSearchPanel과 같은 파일 하단 배치 패턴을 따른다. */
function LinkManagementSection({
  meetingId,
  status,
  statusError,
  teams,
  detailsOpen,
  onDetailsOpenChange,
  showSearch,
  onShowSearchChange,
  refreshStatus,
  onChanged,
}: LinkManagementSectionProps) {
  const [copied, setCopied] = useState(false)
  const [reissueNotice, setReissueNotice] = useState(false)
  const [linkActionBusy, setLinkActionBusy] = useState(false)
  const [linkActionError, setLinkActionError] = useState<string | null>(null)

  const [showManualInput, setShowManualInput] = useState(false)
  const [manualUid, setManualUid] = useState('')
  const [manualUidError, setManualUidError] = useState<string | null>(null)
  // false=경고 없음, 'missing'=D'Flow에 없음, 'archived'=D'Flow에서 보관됨 — 두 원인의 문구가 다르다.
  const [manualMissingWarning, setManualMissingWarning] = useState<false | 'missing' | 'archived'>(false)
  const [manualSaving, setManualSaving] = useState(false)

  async function handleCopyUid() {
    if (!status?.public_uid) return
    try {
      await navigator.clipboard.writeText(status.public_uid)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard 미지원 환경 — 표시 전용으로 동작 (MeetingIdBadge.tsx 관례)
    }
  }

  async function handleUnlink() {
    const ok = await confirmDialog(UNLINK_CONFIRM_MESSAGE)
    if (!ok) return
    setLinkActionBusy(true)
    setLinkActionError(null)
    try {
      await setDflowLink(meetingId, null)
      await refreshStatus()
      setReissueNotice(false)
      onChanged?.()
    } catch (err) {
      const { message } = await parseDflowError(err, '연결 해제에 실패했습니다.')
      setLinkActionError(message)
    } finally {
      setLinkActionBusy(false)
    }
  }

  async function handleReissue() {
    const ok = await confirmDialog(REISSUE_CONFIRM_MESSAGE)
    if (!ok) return
    setLinkActionBusy(true)
    setLinkActionError(null)
    try {
      await setDflowLink(meetingId, null)
      await refreshStatus()
      setReissueNotice(true)
      onChanged?.()
    } catch (err) {
      const { message } = await parseDflowError(err, '재발급 준비에 실패했습니다.')
      setLinkActionError(message)
    } finally {
      setLinkActionBusy(false)
    }
  }

  async function handleManualSave() {
    setManualUidError(null)
    setManualMissingWarning(false)
    // 서버 link는 소문자 UUID만 허용 — 대문자 붙여넣기도 통과시키기 위해 정규화 후 검증·전송.
    const normalized = manualUid.trim().toLowerCase()
    if (!isValidDflowUuid(normalized)) {
      setManualUidError('올바른 UUID 형식이 아닙니다.')
      return
    }
    setManualSaving(true)
    try {
      await setDflowLink(meetingId, normalized)
      const fresh = await refreshStatus()
      if (fresh?.exists_on_dflow === false) {
        setManualMissingWarning('missing')
      } else if (fresh?.dflow_archived === true) {
        setManualMissingWarning('archived')
      }
      setManualUid('')
      onChanged?.()
    } catch (err) {
      const { message } = await parseDflowError(err, '연결 저장에 실패했습니다.')
      setManualUidError(message)
    } finally {
      setManualSaving(false)
    }
  }

  async function handleMinuteLinked() {
    await refreshStatus()
    onShowSearchChange(false)
    onChanged?.()
  }

  return (
    <details
      open={detailsOpen}
      onToggle={(e) => onDetailsOpenChange(e.currentTarget.open)}
      className="group border-t border-border pt-3"
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-semibold text-muted-foreground">
        <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
        연결 관리
      </summary>

      <div className="mt-3 space-y-3">
        {statusError && <p className="text-sm text-red-600">{statusError}</p>}

        {!statusError && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">public_uid</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-foreground">{status?.public_uid ?? '미발급'}</span>
                {status?.public_uid && (
                  <button
                    type="button"
                    onClick={handleCopyUid}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {copied ? '복사됨' : '복사'}
                  </button>
                )}
              </div>
            </div>

            {status?.public_uid && (
              <p className="text-xs text-muted-foreground">
                D'Flow 존재 확인:{' '}
                {status.exists_on_dflow === undefined
                  ? '알 수 없음'
                  : status.exists_on_dflow
                    ? status.dflow_archived === true
                      ? '존재함(보관됨)'
                      : '존재함'
                    : '존재하지 않음(다음 전송 시 새로 생성됩니다)'}
              </p>
            )}

            {reissueNotice && (
              <p className="text-xs text-blue-600">다음 전송 시 새 식별자가 자동 발급됩니다.</p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowManualInput((v) => !v)}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-accent"
              >
                수동 입력
              </button>
              <button
                type="button"
                onClick={handleUnlink}
                disabled={!status?.public_uid || linkActionBusy}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
              >
                해제
              </button>
              <button
                type="button"
                onClick={handleReissue}
                disabled={!status?.public_uid || linkActionBusy}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
              >
                재발급
              </button>
              <button
                type="button"
                onClick={() => onShowSearchChange((v) => !v)}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-accent"
              >
                D'Flow에서 찾기
              </button>
            </div>

            {linkActionError && <p className="text-xs text-red-600">{linkActionError}</p>}

            {showManualInput && (
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <input
                    type="text"
                    value={manualUid}
                    onChange={(e) => setManualUid(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    aria-label="D'Flow public_uid 수동 입력"
                    disabled={manualSaving}
                    className="w-full rounded-md border px-3 py-1.5 text-xs font-mono outline-none focus:ring-2 focus:ring-ring"
                  />
                  {manualUidError && <p className="mt-1 text-xs text-red-600">{manualUidError}</p>}
                  {manualMissingWarning === 'missing' && (
                    <p className="mt-1 text-xs text-amber-600">
                      D'Flow에 해당 회의록이 없습니다. 연결은 저장되었습니다.
                    </p>
                  )}
                  {manualMissingWarning === 'archived' && (
                    <p className="mt-1 text-xs text-amber-600">
                      D'Flow에서 보관된 회의록입니다. 연결은 저장되었습니다.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleManualSave}
                  disabled={manualSaving}
                  className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {manualSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            )}

            {showSearch && (
              <DflowMinuteSearchPanel
                meetingId={meetingId}
                teams={teams}
                onLinked={handleMinuteLinked}
              />
            )}
          </>
        )}
      </div>
    </details>
  )
}

interface DflowMinuteSearchPanelProps {
  meetingId: number
  teams: string[]
  onLinked: () => void | Promise<void>
}

/** 연결 관리 > [D'Flow에서 찾기] 하위 목록 뷰: 기간·구분 필터 + 미연결만 토글 → 목록 → 행 선택 시 A/B 분기. */
function DflowMinuteSearchPanel({ meetingId, teams, onLinked }: DflowMinuteSearchPanelProps) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [team, setTeam] = useState('')
  const [unlinkedOnly, setUnlinkedOnly] = useState(false)
  const [items, setItems] = useState<DflowMinuteItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  async function handleSearch() {
    setSearching(true)
    setSearchError(null)
    try {
      const res = await listDflowMinutes({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        team: team || undefined,
        linked: unlinkedOnly ? false : undefined,
      })
      setItems(res.items)
    } catch {
      setSearchError('검색에 실패했습니다.')
    } finally {
      setSearching(false)
    }
  }

  async function handleLink(item: DflowMinuteItem) {
    setLinkingId(item.id)
    setLinkError(null)
    try {
      const action = resolveDflowLinkAction(item.external_id)
      if (action.type === 'link') {
        await setDflowLink(meetingId, action.publicUid)
      } else {
        await claimDflowMinute(meetingId, item.id)
      }
      await onLinked()
    } catch (err) {
      const { message, code } = await parseDflowError(err, '연결에 실패했습니다.')
      setLinkError(code === 'dflow_link_conflict' ? '이미 다른 회의에 연결된 항목입니다.' : message)
    } finally {
      setLinkingId(null)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="검색 시작일"
          className="rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring bg-background"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="검색 종료일"
          className="rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring bg-background"
        />
      </div>
      <select
        aria-label="검색 구분"
        value={team}
        onChange={(e) => setTeam(e.target.value)}
        className="w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring bg-background"
      >
        <option value="">전체 구분</option>
        {teams.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={unlinkedOnly}
          onChange={(e) => setUnlinkedOnly(e.target.checked)}
          className="rounded"
        />
        미연결만
      </label>
      <button
        type="button"
        onClick={handleSearch}
        disabled={searching}
        className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {searching ? '검색 중…' : '검색'}
      </button>

      {searchError && <p className="text-xs text-red-600">{searchError}</p>}
      {linkError && <p className="text-xs text-red-600">{linkError}</p>}

      {items && (
        items.length === 0 ? (
          <p className="text-xs text-muted-foreground">검색 결과가 없습니다.</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{item.title}</p>
                  <p className="truncate text-muted-foreground">
                    {item.date} · {item.team} · {item.created_by_name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleLink(item)}
                  disabled={linkingId === item.id}
                  className="shrink-0 rounded-md border border-blue-600 px-2 py-1 text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                >
                  {linkingId === item.id ? '연결 중…' : '연결'}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
