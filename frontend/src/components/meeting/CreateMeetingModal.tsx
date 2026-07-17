import { useState, useEffect, useMemo } from 'react'
import { createMeeting, getMeetings } from '../../api/meetings'
import type { Meeting } from '../../api/meetings'
import { useProjectStore } from '../../stores/projectStore'
import { useFolderStore } from '../../stores/folderStore'
import { useMeetingTemplateStore } from '../../stores/meetingTemplateStore'
import { useToastStore } from '../../stores/toastStore'
import { Dialog } from '../ui/Dialog'
import { MeetingTypeSelector } from './MeetingListUI'
import { ScheduleFields } from './ScheduleFields'
import { emptyScheduleState, scheduleToPayload, formatMeetingDateLabel, type ScheduleFormState } from '../../lib/schedulePayload'
import { folderName } from '../../lib/meetingFormat'
import {
  listDomainFiles, getFolderDomainFiles, getProjectDomainFiles, setMeetingDomainFiles,
} from '../../api/domainFiles'
import type { DomainFile, DomainFileSummary, InheritedDomainFile } from '../../api/domainFiles'
import { SelectDomainFilesModal } from './DomainFilesPanel'

interface CreateMeetingModalProps {
  folderId: number | null
  meetingTypeList: { value: string; label: string }[]
  onClose: () => void
  onCreated: (meeting: Meeting) => void
}

export function CreateMeetingModal({ folderId, meetingTypeList, onClose, onCreated }: CreateMeetingModalProps) {
  const [now] = useState(() => new Date())
  const [title, setTitle] = useState(() => formatMeetingDateLabel(now))
  const [titleEdited, setTitleEdited] = useState(false)
  const [meetingType, setMeetingType] = useState('general')
  const [shared, setShared] = useState(true)
  const [previousMeetingId, setPreviousMeetingId] = useState('')
  // 예약 시작: 명시적 토글로 켜야만 예약된다(기본 OFF=즉시 회의, 기존 동작).
  // native date input 의 placeholder("2026. 06. 21.")가 입력된 것처럼 보이는 혼동을 없애려고
  // 토글을 둔다 — 토글 OFF면 어떤 예약 키도 전송하지 않는다.
  const [schedule, setSchedule] = useState<ScheduleFormState>(emptyScheduleState())
  const [recentMeetings, setRecentMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const templates = useMeetingTemplateStore((s) => s.templates)
  const fetchTemplates = useMeetingTemplateStore((s) => s.fetch)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjectStore((s) => s.projects)
  const folders = useFolderStore((s) => s.folders)

  // 도메인 파일 — 생성 전이라 meeting id가 없어 회의 owner API는 못 쓴다.
  // 대상 폴더/프로젝트에 이미 지정된 파일은 읽기전용 미리보기로, 회의 전용 추가분은 로컬 state로만 들고 있다가
  // 회의 생성 성공 후 setMeetingDomainFiles로 한 번에 반영한다.
  const [domainAvailable, setDomainAvailable] = useState<DomainFile[]>([])
  const [domainInheritedPreview, setDomainInheritedPreview] = useState<InheritedDomainFile[]>([])
  const [extraDomainFileIds, setExtraDomainFileIds] = useState<number[]>([])
  const [domainSelectOpen, setDomainSelectOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    listDomainFiles(currentProjectId ?? undefined)
      .then((res) => { if (!cancelled) setDomainAvailable(res.domain_files) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [currentProjectId])

  useEffect(() => {
    let cancelled = false
    async function loadInheritedPreview() {
      try {
        if (folderId != null) {
          const res = await getFolderDomainFiles(folderId)
          if (cancelled) return
          const thisFolderName = folderName(folders, folderId) ?? '폴더'
          const own: InheritedDomainFile[] = res.domain_files.map((f) => ({
            ...f, source: 'folder', owner_name: thisFolderName,
          }))
          setDomainInheritedPreview([...own, ...res.inherited])
        } else if (currentProjectId != null) {
          const res = await getProjectDomainFiles(currentProjectId)
          if (cancelled) return
          const thisProjectName = projects.find((p) => p.id === currentProjectId)?.name ?? '프로젝트'
          const own: InheritedDomainFile[] = res.domain_files.map((f) => ({
            ...f, source: 'project', owner_name: thisProjectName,
          }))
          setDomainInheritedPreview(own)
        } else {
          setDomainInheritedPreview([])
        }
      } catch {
        if (!cancelled) setDomainInheritedPreview([])
      }
    }
    loadInheritedPreview()
    return () => { cancelled = true }
  }, [folderId, currentProjectId, folders, projects])

  const extraDomainFiles: DomainFileSummary[] = domainAvailable
    .filter((f) => extraDomainFileIds.includes(f.id))
    .map((f) => ({ id: f.id, name: f.name, project_id: f.project_id, updated_at: f.updated_at, editable: !!f.editable }))

  // 자동 제목 날짜 라벨: 예약을 켜고 날짜가 있으면 그 예약 시각, 아니면 생성 시각.
  const autoTitle = useMemo(() => {
    if (schedule.enabled && schedule.date) {
      return formatMeetingDateLabel(new Date(`${schedule.date}T${schedule.hour}:${schedule.minute}`))
    }
    return formatMeetingDateLabel(now)
  }, [schedule.enabled, schedule.date, schedule.hour, schedule.minute, now])

  // 사용자가 제목을 직접 고치기 전까지는 자동 날짜 라벨을 따라간다.
  // 예약 시각을 넣으면 그 시각 라벨로, 예약을 끄면 생성 시각 라벨로 되돌아간다.
  useEffect(() => {
    if (!titleEdited) setTitle(autoTitle)
  }, [autoTitle, titleEdited])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  // 이전 회의 참고 셀렉터용: 같은 폴더의 회의 최근순 목록 (folderId=null이면 루트).
  // show_all: 완료된 회의도 후보로 필요하다 — 기본 목록 큐레이션(important OR !completed)이
  // 걸리면 정상 종료된 회의가 사라져 이전 회의로 고를 수 없다(중요표시 무관하게 노출).
  useEffect(() => {
    getMeetings({ folder_id: folderId, per: 100, show_all: true })
      .then((res) => setRecentMeetings(res.meetings))
      .catch(() => {})
  }, [folderId])

  const handleTemplateSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const templateId = Number(e.target.value)
    if (!templateId) return
    const tpl = templates.find((t) => t.id === templateId)
    if (!tpl) return
    if (tpl.meeting_type) setMeetingType(tpl.meeting_type)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    setError('')
    try {
      // 예약 토글이 켜져 있고 날짜가 있을 때만 예약 키를 전송 → 토글 OFF면 기존과 완전히 동일(키 없음).
      // recurrence_rule 은 null(1회성)이면 키 자체를 빼서 기존 동작(비반복 시 키 미전송)을 보존한다.
      const sched = schedule.enabled && schedule.date ? scheduleToPayload(schedule) : null
      const scheduleKeys = sched
        ? {
            scheduled_start_time: sched.scheduled_start_time,
            auto_start_mode: sched.auto_start_mode,
            ...(sched.recurrence_rule ? { recurrence_rule: sched.recurrence_rule } : {}),
          }
        : {}
      const meeting = await createMeeting({
        title: title.trim(),
        meeting_type: meetingType,
        folder_id: folderId,
        shared,
        previous_meeting_id: previousMeetingId ? Number(previousMeetingId) : null,
        project_id: useProjectStore.getState().currentProjectId,
        ...scheduleKeys,
      })
      if (extraDomainFileIds.length > 0) {
        try {
          await setMeetingDomainFiles(meeting.id, extraDomainFileIds)
        } catch (err) {
          // 회의 생성 자체는 성공 처리 — 도메인 파일 연결 실패는 경고만 남긴다.
          console.warn('도메인 파일 연결 실패', err)
          useToastStore.getState().showStatus('회의는 생성되었지만 도메인 파일 연결에 실패했습니다.')
        }
      }
      onCreated(meeting)
      onClose()
    } catch {
      setError('회의 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog onClose={onClose} backdropClassName="bg-black/10 backdrop-blur-sm" closeOnBackdrop={false} closeOnEsc={false}>
      <h2 className="text-lg font-semibold mb-4">새 회의 만들기</h2>

      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 템플릿 선택 */}
        {templates.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">템플릿</label>
            <select
              onChange={handleTemplateSelect}
              defaultValue=""
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring bg-background"
            >
              <option value="">템플릿 없이 시작</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">회의 제목</label>
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setTitleEdited(true) }}
            onFocus={(e) => e.target.select()}
            placeholder="회의 제목을 입력하세요"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">회의 유형</label>
          <MeetingTypeSelector
            meetingTypeList={meetingTypeList}
            selected={meetingType}
            onSelect={setMeetingType}
          />
        </div>

        {/* 이전 회의 참고: 선택하면 그 회의록을 시작점으로 깔고 이어서 회의록을 작성 */}
        <div>
          <label className="block text-sm font-medium mb-1">회의 연결해서 진행하기(이전 회의 선택)</label>
          <select
            value={previousMeetingId}
            onChange={(e) => setPreviousMeetingId(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring bg-background"
          >
            <option value="">없음</option>
            {recentMeetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}{m.created_at ? ` (${new Date(m.created_at).toLocaleDateString()})` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            지정하면 이전 회의록을 이어받아 그 뒤에 이번 회의 내용을 작성합니다.
          </p>
        </div>

        {/* 도메인 파일 — 대상 폴더/프로젝트 지정분은 읽기전용 미리보기, 회의 전용 추가분은 생성 후 반영 */}
        <div>
          <label className="block text-sm font-medium mb-1">도메인 파일</label>

          {domainInheritedPreview.length > 0 && (
            <div className="flex flex-col gap-1 mb-2">
              <span className="text-[11px] text-muted-foreground">상속된 도메인 파일 (읽기전용)</span>
              <div className="flex flex-wrap gap-1.5">
                {domainInheritedPreview.map((f) => (
                  <span
                    key={`${f.source}-${f.id}`}
                    className="inline-flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border"
                  >
                    <span className="truncate max-w-[12rem]">{f.name}</span>
                    <span className="text-[10px] opacity-80">
                      {f.source === 'project' ? `프로젝트: ${f.owner_name}` : `폴더: ${f.owner_name}`}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 mb-2">
            {extraDomainFiles.length === 0 && domainInheritedPreview.length === 0 && (
              <span className="text-xs text-muted-foreground">선택된 도메인 파일이 없습니다</span>
            )}
            {extraDomainFiles.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
              >
                <span className="truncate max-w-[16rem]">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setExtraDomainFileIds((prev) => prev.filter((id) => id !== f.id))}
                  className="shrink-0 w-4 h-4 leading-none text-blue-400 hover:text-red-600"
                  title="제거"
                  aria-label={`${f.name} 제거`}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setDomainSelectOpen(true)}
            className="text-xs text-blue-500 hover:text-blue-700"
          >
            파일 선택
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            회의 생성 후 자동으로 연결됩니다. 폴더·프로젝트에서 상속된 파일은 따로 선택하지 않아도 됩니다.
          </p>
        </div>

        {/* 예약 시작: 명시적 토글. 켜야만 날짜/시각/시작방식/반복이 나타나고 예약 키가 전송된다. */}
        <ScheduleFields value={schedule} onChange={setSchedule} />

        <div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-blue-600"
              aria-label="이 회의를 모든 사용자에게 공유"
            />
            <span className="text-sm font-medium">이 회의를 모든 사용자에게 공유</span>
          </label>
          <p className="mt-1 ml-6 text-xs text-muted-foreground">
            끄면 작성자와 관리자만 이 회의를 볼 수 있습니다.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={loading || !title.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            생성
          </button>
        </div>
      </form>

      {domainSelectOpen && (
        <SelectDomainFilesModal
          available={domainAvailable}
          selected={extraDomainFiles}
          inherited={domainInheritedPreview}
          canDelete={false}
          onDeleteFile={async () => {}}
          onClose={() => setDomainSelectOpen(false)}
          onConfirm={async (ids) => {
            setExtraDomainFileIds(ids)
            setDomainSelectOpen(false)
          }}
        />
      )}
    </Dialog>
  )
}
