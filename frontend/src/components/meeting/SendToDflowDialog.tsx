import { useState, useEffect, useCallback } from 'react'
import { HTTPError } from 'ky'
import { Dialog } from '../ui/Dialog'
import { useAuthStore } from '../../stores/authStore'
import { confirmDialog } from '../../lib/confirmDialog'
import {
  detectDflowTeam,
  buildDflowTitle,
  isValidDflowUuid,
  resolveDflowLinkAction,
  dflowFolderDepthExceedsWarningLimit,
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
  DflowMeetingStatus,
  DflowMinuteItem,
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
const TEAM_REQUIRED_MESSAGE = 'team을 자동으로 판정할 수 없습니다. 아래에서 구분을 선택해 주세요.'
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
const DEPTH_WARNING_MESSAGE =
  "편철 경로가 D'Flow 보존 한도(5단)를 넘습니다. 전송하면 상위 폴더로 조정되어 저장됩니다."

/** ky HTTPError → { message, code } 공통 파싱 (DflowSettingsPanel.tsx handleTest 관례). */
async function parseDflowError(err: unknown, fallback: string): Promise<{ message: string; code?: string }> {
  if (err instanceof HTTPError) {
    const body = (await err.response.json().catch(() => ({}))) as { error?: string; code?: string }
    return { message: body.error ?? fallback, code: body.code }
  }
  return { message: fallback }
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
  const [sendResult, setSendResult] = useState<DflowMeetingStatus | null>(null)

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

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

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
    Promise.all([refreshStatus(), loadMeta()]).finally(() => setLoading(false))
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
    setSending(true)
    setSendError(null)
    try {
      const result = await uploadToDflow(meeting.id, {
        titleOverride: title,
        ...(needsTeamSelect ? { teamOverride: selectedTeam } : {}),
      })
      setSendResult(result)
      setStatus({ ...result, exists_on_dflow: true })
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
      await setDflowLink(meeting.id, null)
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
      await setDflowLink(meeting.id, null)
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
      await setDflowLink(meeting.id, normalized)
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
    setShowSearch(false)
    onChanged?.()
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
                  disabled={sending || bodyTooLong || (needsTeamSelect && !selectedTeam)}
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
              </div>
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
                disabled={sending || bodyTooLong || sendBlocked || (needsTeamSelect && !selectedTeam)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {sending ? '전송 중…' : '전송'}
              </button>
            </div>
          )}

          {/* 연결 관리 */}
          <details
            open={detailsOpen}
            onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
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
                      onClick={() => setShowSearch((v) => !v)}
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
                      meetingId={meeting.id}
                      teams={meta?.teams ?? []}
                      onLinked={handleMinuteLinked}
                    />
                  )}
                </>
              )}
            </div>
          </details>
        </div>
      )}
    </Dialog>
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
