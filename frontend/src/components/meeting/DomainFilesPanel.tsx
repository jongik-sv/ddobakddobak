import { useState } from 'react'
import { useDomainFiles } from '../../hooks/useDomainFiles'
import type { DomainFile, ExtractedTerm } from '../../api/domainFiles'
import { errorToMessage } from '../../lib/errors'
import { Dialog } from '../ui/Dialog'
import DomainFileViewerModal from './DomainFileViewerModal'
import ExtractTermsModal from './ExtractTermsModal'

interface DomainFilesPanelProps {
  meetingId: number
  projectId: number | null
  canEdit: boolean
}

/**
 * 도메인 파일(용어집) 패널 — 회의에 연결된 도메인 파일 선택/조회 + 업로드·작성 + 요약에서 용어 추출.
 * 기존 오타 사전(GlossaryPanel)과 완전 별개 기능. GlossaryPanel과 동일한 접이식 패널 패턴.
 */
export default function DomainFilesPanel({ meetingId, projectId, canEdit }: DomainFilesPanelProps) {
  const { selected, available, status, reload, select, createFile, uploadFile, extract } =
    useDomainFiles(meetingId, projectId)

  const [viewerFileId, setViewerFileId] = useState<number | null>(null)
  const [selectOpen, setSelectOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [extractTerms, setExtractTerms] = useState<ExtractedTerm[] | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState('')

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

  return (
    <div className="border-t bg-card px-6 py-3 shrink-0">
      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold text-muted-foreground select-none flex items-center gap-2">
          <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
          도메인 파일
          {status && <span className="text-xs font-normal text-blue-500 ml-2">{status}</span>}
        </summary>

        <div className="mt-2 flex flex-col gap-2 max-w-2xl">
          <div className="flex flex-wrap gap-1.5">
            {selected.length === 0 && (
              <span className="text-xs text-muted-foreground">선택된 도메인 파일이 없습니다</span>
            )}
            {selected.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setViewerFileId(f.id)}
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:border-blue-400 transition-colors"
              >
                {f.name}
              </button>
            ))}
          </div>

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
              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting}
                className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
              >
                {extracting ? '추출 중...' : '요약에서 용어 추출'}
              </button>
            </div>
          )}

          {error && <div className="text-[11px] text-red-500">{error}</div>}
        </div>
      </details>

      {selectOpen && (
        <SelectDomainFilesModal
          available={available}
          selected={selected}
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

      {viewerFileId != null && (
        <DomainFileViewerModal
          fileId={viewerFileId}
          meetingId={meetingId}
          canEdit={canEdit}
          onClose={() => setViewerFileId(null)}
          onSaved={() => reload()}
        />
      )}

      {extractTerms && (
        <ExtractTermsModal
          meetingId={meetingId}
          terms={extractTerms}
          files={available}
          onClose={() => setExtractTerms(null)}
          onMerged={async () => {
            await reload()
            setExtractTerms(null)
          }}
        />
      )}
    </div>
  )
}

/** 회의에 연결할 도메인 파일 다중 선택 모달 — 전체 교체(PUT) 방식 */
function SelectDomainFilesModal({
  available, selected, onClose, onConfirm,
}: {
  available: DomainFile[]
  selected: { id: number; name: string; project_id: number | null }[]
  onClose: () => void
  onConfirm: (ids: number[]) => Promise<void>
}) {
  // 이미 선택된 파일이 목록 스코프(project_id 변경 등)로 available에 없을 수 있어 병합해 보존
  const merged = [
    ...available,
    ...selected
      .filter((s) => !available.some((a) => a.id === s.id))
      .map((s) => ({ id: s.id, name: s.name, project_id: s.project_id, created_by_id: 0, content_chars: 0, updated_at: '' })),
  ]
  const [checked, setChecked] = useState<Set<number>>(new Set(selected.map((f) => f.id)))
  const [saving, setSaving] = useState(false)

  const toggle = (id: number) => {
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
      await onConfirm(Array.from(checked))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onClose={onClose}>
      <h2 className="text-lg font-semibold mb-4">도메인 파일 선택</h2>
      <div className="max-h-72 overflow-y-auto flex flex-col gap-1 mb-4">
        {merged.length === 0 && <p className="text-sm text-muted-foreground">사용 가능한 도메인 파일이 없습니다</p>}
        {merged.map((f) => (
          <label key={f.id} className="flex items-center gap-2 text-sm py-1">
            <input type="checkbox" checked={checked.has(f.id)} onChange={() => toggle(f.id)} />
            <span className="flex-1 min-w-0 truncate">{f.name}</span>
            {f.project_id == null && <span className="text-[10px] text-muted-foreground shrink-0">전역</span>}
          </label>
        ))}
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
