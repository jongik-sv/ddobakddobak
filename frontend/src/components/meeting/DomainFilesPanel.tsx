import { useState } from 'react'
import { useDomainFiles, type DomainFileOwnerType } from '../../hooks/useDomainFiles'
import type { DomainFile, DomainFileSummary, InheritedDomainFile, ExtractedTerm } from '../../api/domainFiles'
import { errorToMessage } from '../../lib/errors'
import { confirmDialog } from '../../lib/confirmDialog'
import { Dialog } from '../ui/Dialog'
import DomainFileViewerModal from './DomainFileViewerModal'
import ExtractTermsModal from './ExtractTermsModal'

interface DomainFilesPanelProps {
  /** 이 패널이 어느 레벨(회의/폴더/프로젝트)의 도메인 파일 링크를 다루는지 */
  ownerType: DomainFileOwnerType
  ownerId: number
  /** 신규 작성·업로드 시 기본 project_id 및 "선택 가능한 파일" 목록 스코프 */
  projectId: number | null
  canEdit: boolean
  /**
   * true(기본)면 회의 하단 접이식(details) 패널로 렌더.
   * false면 다이얼로그 등 다른 컨테이너 안에 바로 삽입할 콘텐츠만 렌더(제목 없음).
   */
  collapsible?: boolean
}

/**
 * 도메인 파일(용어집) 패널 — 프로젝트/폴더/회의 3레벨 공용. 링크된 파일 선택/조회 + 업로드·작성·삭제.
 * 회의(meeting) 변형만 상속분(inherited: 폴더·프로젝트에서 내려온 파일, 읽기전용)과
 * "요약에서 용어 추출" 기능을 갖는다. 기존 오타 사전(GlossaryPanel)과 완전 별개 기능.
 */
export default function DomainFilesPanel({ ownerType, ownerId, projectId, canEdit, collapsible = true }: DomainFilesPanelProps) {
  const {
    selected, inherited, excluded, available, status, reload,
    select, excludeInherited, restoreInherited, createFile, uploadFile, removeFile, extract,
  } = useDomainFiles(ownerType, ownerId, projectId)

  const [viewerFile, setViewerFile] = useState<{ id: number; editable: boolean; readOnly: boolean } | null>(null)
  const [selectOpen, setSelectOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [extractTerms, setExtractTerms] = useState<ExtractedTerm[] | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState('')

  const isMeeting = ownerType === 'meeting'

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      await uploadFile(file, { project_id: projectId })
    } catch (err) {
      setError(await errorToMessage(err, '업로드 실패'))
    }
  }

  const handleExtract = async () => {
    setError('')
    setExtracting(true)
    try {
      const terms = await extract()
      if (terms.length === 0) {
        setError('추출된 도메인 용어가 없습니다')
      } else {
        setExtractTerms(terms)
      }
    } catch (err) {
      setError(await errorToMessage(err, '용어 추출 실패'))
    } finally {
      setExtracting(false)
    }
  }

  /** 도메인 파일 자체 삭제 — 선택 칩과 선택 모달 양쪽에서 공용으로 사용 */
  const handleDeleteFile = async (f: { id: number; name: string }) => {
    if (
      !(await confirmDialog(
        `'${f.name}' 파일을 삭제합니다. 프로젝트·폴더·회의 등 모든 곳에 연결된 링크도 함께 사라집니다. 계속할까요?`,
        { title: '도메인 파일 삭제', kind: 'warning' },
      ))
    ) {
      return
    }
    setError('')
    try {
      await removeFile(f.id)
    } catch (err) {
      setError(await errorToMessage(err, '삭제 실패'))
    }
  }

  const handleExclude = async (f: InheritedDomainFile) => {
    setError('')
    try {
      await excludeInherited(f.id)
    } catch (err) {
      setError(await errorToMessage(err, '제외 실패'))
    }
  }

  const handleRestore = async (f: DomainFileSummary) => {
    setError('')
    try {
      await restoreInherited(f.id)
    } catch (err) {
      setError(await errorToMessage(err, '복원 실패'))
    }
  }

  const content = (
    <div className="flex flex-col gap-2 max-w-2xl">
      <div className="flex flex-wrap gap-1.5">
        {selected.length === 0 && inherited.length === 0 && (
          <span className="text-xs text-muted-foreground">선택된 도메인 파일이 없습니다</span>
        )}
        {selected.map((f) => (
          <span
            key={f.id}
            className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:border-blue-400 transition-colors"
          >
            <button
              type="button"
              onClick={() => setViewerFile({ id: f.id, editable: f.editable, readOnly: false })}
              className="truncate max-w-[16rem]"
            >
              {f.name}
            </button>
            {canEdit && f.editable && (
              <button
                type="button"
                onClick={() => handleDeleteFile(f)}
                className="shrink-0 w-4 h-4 leading-none text-blue-400 hover:text-red-600"
                title="삭제"
                aria-label={`${f.name} 삭제`}
              >
                &times;
              </button>
            )}
          </span>
        ))}
      </div>

      {isMeeting && inherited.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">상속된 도메인 파일 (읽기전용)</span>
          <div className="flex flex-wrap gap-1.5">
            {inherited.map((f) => (
              <span
                key={`${f.source}-${f.id}`}
                className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border"
              >
                <button
                  type="button"
                  onClick={() => setViewerFile({ id: f.id, editable: false, readOnly: true })}
                  className="truncate max-w-[12rem]"
                >
                  {f.name}
                </button>
                <span className="text-[10px] opacity-80">
                  {f.source === 'project' ? `프로젝트: ${f.owner_name}` : `폴더: ${f.owner_name}`}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleExclude(f)}
                    className="shrink-0 w-4 h-4 leading-none text-muted-foreground hover:text-red-600"
                    title="이 회의에서 제외"
                    aria-label={`${f.name} 이 회의에서 제외`}
                  >
                    &times;
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {isMeeting && excluded.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">제외된 상속 파일</span>
          <div className="flex flex-wrap gap-1.5">
            {excluded.map((f) => (
              <span
                key={`excluded-${f.id}`}
                className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border/50"
              >
                <span className="truncate max-w-[12rem] line-through opacity-70">{f.name}</span>
                <span className="text-[10px] opacity-80">제외됨</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleRestore(f)}
                    className="shrink-0 text-[10px] text-blue-500 hover:text-blue-700"
                    aria-label={`${f.name} 복원`}
                  >
                    복원
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setSelectOpen(true)} className="text-xs text-blue-500 hover:text-blue-700">
            파일 선택
          </button>
          <label className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer">
            업로드 (.md/.txt)
            <input type="file" accept=".md,.txt" className="hidden" onChange={handleUpload} />
          </label>
          <button type="button" onClick={() => setCreateOpen(true)} className="text-xs text-blue-500 hover:text-blue-700">
            새 파일 작성
          </button>
          {isMeeting && (
            <button
              type="button"
              onClick={handleExtract}
              disabled={extracting}
              className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
            >
              {extracting ? '추출 중...' : '요약에서 용어 추출'}
            </button>
          )}
        </div>
      )}

      {error && <div className="text-[11px] text-red-500">{error}</div>}
    </div>
  )

  return (
    <>
      {collapsible ? (
        <div className="border-t bg-card px-6 py-3 shrink-0">
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-muted-foreground select-none flex items-center gap-2">
              <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
              도메인 파일
              {status && <span className="text-xs font-normal text-blue-500 ml-2">{status}</span>}
            </summary>
            <div className="mt-2">{content}</div>
          </details>
        </div>
      ) : (
        content
      )}

      {selectOpen && (
        <SelectDomainFilesModal
          available={available}
          selected={selected}
          inherited={inherited}
          canDelete={canEdit}
          onDeleteFile={handleDeleteFile}
          onClose={() => setSelectOpen(false)}
          onConfirm={async (ids) => {
            await select(ids)
            setSelectOpen(false)
          }}
        />
      )}

      {createOpen && (
        <CreateDomainFileModal
          projectId={projectId}
          createFile={createFile}
          onClose={() => setCreateOpen(false)}
          onCreated={async (fileId) => {
            await select([...selected.map((f) => f.id), fileId])
            setCreateOpen(false)
          }}
        />
      )}

      {viewerFile != null && (
        <DomainFileViewerModal
          fileId={viewerFile.id}
          meetingId={isMeeting ? ownerId : undefined}
          canEdit={viewerFile.readOnly ? false : canEdit}
          editable={viewerFile.editable}
          onClose={() => setViewerFile(null)}
          onSaved={() => reload()}
          onDeleted={
            viewerFile.readOnly
              ? undefined
              : () => {
                  setViewerFile(null)
                  reload()
                }
          }
        />
      )}

      {isMeeting && extractTerms && (
        <ExtractTermsModal
          meetingId={ownerId}
          terms={extractTerms}
          files={available}
          onClose={() => setExtractTerms(null)}
          onMerged={async () => {
            await reload()
            setExtractTerms(null)
          }}
        />
      )}
    </>
  )
}

/**
 * owner에 링크할 도메인 파일 다중 선택 모달 — 전체 교체(PUT) 방식.
 * 회의 생성 전(meeting id 없음) 화면에서도 재사용하기 위해 export한다 — CreateMeetingModal 참고.
 */
export function SelectDomainFilesModal({
  available, selected, inherited, canDelete, onDeleteFile, onClose, onConfirm,
}: {
  available: DomainFile[]
  selected: DomainFileSummary[]
  /** 상위 레벨(프로젝트/폴더)에서 이미 상속(비제외) 적용된 파일 — 중복 선택 방지용으로 체크 비활성화 */
  inherited: InheritedDomainFile[]
  /** editable인 파일에 삭제 버튼을 노출할지 (캔버스의 canEdit) */
  canDelete: boolean
  onDeleteFile: (f: { id: number; name: string }) => Promise<void>
  onClose: () => void
  onConfirm: (ids: number[]) => Promise<void>
}) {
  // 이미 선택된 파일이 목록 스코프(project_id 변경 등)로 available에 없을 수 있어 병합해 보존
  const merged = [
    ...available,
    ...selected
      .filter((s) => !available.some((a) => a.id === s.id))
      .map((s) => ({
        id: s.id, name: s.name, project_id: s.project_id, created_by_id: 0, content_chars: 0,
        updated_at: s.updated_at, editable: s.editable,
      })),
  ]
  const inheritedIds = new Set(inherited.map((f) => f.id))
  const [checked, setChecked] = useState<Set<number>>(new Set(selected.map((f) => f.id)))
  const [saving, setSaving] = useState(false)

  const toggle = (id: number) => {
    if (inheritedIds.has(id)) return
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async () => {
    setSaving(true)
    try {
      // 삭제 등으로 목록에서 사라진 id는 제외하고 제출
      const validIds = new Set(merged.map((f) => f.id))
      await onConfirm(Array.from(checked).filter((id) => validIds.has(id)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onClose={onClose}>
      <h2 className="text-lg font-semibold mb-4">도메인 파일 선택</h2>
      <div className="max-h-72 overflow-y-auto flex flex-col gap-1 mb-4">
        {merged.length === 0 && <p className="text-sm text-muted-foreground">사용 가능한 도메인 파일이 없습니다</p>}
        {merged.map((f) => {
          const isInherited = inheritedIds.has(f.id)
          return (
            <div key={f.id} className="flex items-center gap-2 text-sm py-1">
              <label className="flex items-center gap-2 flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={isInherited || checked.has(f.id)}
                  disabled={isInherited}
                  onChange={() => toggle(f.id)}
                  aria-label={f.name}
                />
                <span className="flex-1 min-w-0 truncate">{f.name}</span>
                {f.project_id == null && <span className="text-[10px] text-muted-foreground shrink-0">전역</span>}
                {isInherited && (
                  <span className="text-[10px] text-muted-foreground shrink-0">프로젝트/폴더에서 이미 적용됨</span>
                )}
              </label>
              {canDelete && f.editable && (
                <button
                  type="button"
                  onClick={() => onDeleteFile({ id: f.id, name: f.name })}
                  className="shrink-0 text-xs text-red-500 hover:text-red-700"
                  aria-label={`${f.name} 파일 삭제`}
                  title="삭제"
                >
                  삭제
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? '저장 중...' : '확인'}
        </button>
      </div>
    </Dialog>
  )
}

/** 새 도메인 파일 작성 모달 — 이름 + 내용 직접 입력 */
function CreateDomainFileModal({
  projectId, createFile, onClose, onCreated,
}: {
  projectId: number | null
  createFile: (d: { name: string; content: string; project_id?: number | null }) => Promise<{ id: number }>
  onClose: () => void
  onCreated: (fileId: number) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const file = await createFile({ name: name.trim(), content, project_id: projectId })
      await onCreated(file.id)
    } catch (err) {
      setError(await errorToMessage(err, '생성 실패'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onClose={onClose}>
      <h2 className="text-lg font-semibold mb-4">새 도메인 파일 작성</h2>
      <div className="flex flex-col gap-2 mb-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="파일 이름"
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={'- **용어** [분류]: 설명'}
          rows={10}
          className="rounded-md border border-border px-3 py-2 text-sm font-mono"
        />
      </div>
      {error && <div className="text-[11px] text-red-500 mb-2">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving || !name.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? '저장 중...' : '작성'}
        </button>
      </div>
    </Dialog>
  )
}
