import { useState, useEffect, useCallback } from 'react'
import { getDomainFile, updateDomainFile } from '../../api/domainFiles'
import type { DomainFileDetail } from '../../api/domainFiles'
import { errorToMessage } from '../../lib/errors'
import { Dialog } from '../ui/Dialog'
import AddTypoCorrectionDialog from './AddTypoCorrectionDialog'

interface DomainFileViewerModalProps {
  fileId: number
  meetingId: number
  canEdit: boolean
  onClose: () => void
  onSaved: (f: DomainFileDetail) => void
}

interface ParsedLine {
  raw: string
  term?: string
  category?: string
  definition?: string
}

/** 용어 라인 규약: `- **용어** [분류]: 설명` (분류 없으면 `- **용어**: 설명`). 비매치 라인은 자유 텍스트로 보존. */
const TERM_LINE_RE = /^-\s*\*\*(.+?)\*\*(?:\s*\[([^\]]*)\])?\s*:\s*(.*)$/

function parseLines(content: string): ParsedLine[] {
  return content.split('\n').map((raw) => {
    const m = raw.match(TERM_LINE_RE)
    if (!m) return { raw }
    return { raw, term: m[1], category: m[2] ?? '', definition: m[3] }
  })
}

/** 도메인 파일 뷰어 + 편집 모달 — 용어 라인은 구조화 표시, 나머지는 원문 그대로. 용어별 오타교정 등록 연동. */
export default function DomainFileViewerModal({ fileId, meetingId, canEdit, onClose, onSaved }: DomainFileViewerModalProps) {
  const [file, setFile] = useState<DomainFileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  const [correctionTerm, setCorrectionTerm] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await getDomainFile(fileId)
      setFile(res.domain_file)
    } catch (err) {
      setLoadError(await errorToMessage(err, '불러오기 실패'))
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => { load() }, [load])

  const startEdit = () => {
    if (!file) return
    setDraftName(file.name)
    setDraftContent(file.content)
    setSaveMessage('')
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    setSaveMessage('')
    try {
      const res = await updateDomainFile(fileId, { name: draftName, content: draftContent })
      setFile(res.domain_file)
      setSaveMessage('저장되었습니다')
      setEditing(false)
      onSaved(res.domain_file)
    } catch (err) {
      setSaveMessage(await errorToMessage(err, '저장 실패'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onClose={onClose} className="w-full max-w-2xl rounded-xl bg-card p-6 shadow-2xl border border-border max-h-[90vh] overflow-y-auto">
      {loading && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
      {loadError && <p className="text-sm text-red-500">{loadError}</p>}

      {file && !editing && (
        <>
          <div className="flex items-center justify-between mb-4 gap-2">
            <h2 className="text-lg font-semibold truncate">{file.name}</h2>
            {canEdit && (
              <button
                type="button"
                onClick={startEdit}
                className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                편집
              </button>
            )}
          </div>

          {saveMessage && <p className="text-xs text-blue-600 mb-2">{saveMessage}</p>}

          <div className="flex flex-col gap-1.5 text-sm">
            {parseLines(file.content).map((line, i) =>
              line.term !== undefined ? (
                <div key={i} className="flex items-start gap-2 py-1 border-b border-border/50">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold">{line.term}</span>
                    {line.category && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">[{line.category}]</span>
                    )}
                    <span className="text-muted-foreground">: </span>
                    <span>{line.definition}</span>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setCorrectionTerm(line.term!)}
                      className="shrink-0 text-xs text-blue-500 hover:text-blue-700"
                    >
                      교정 추가
                    </button>
                  )}
                </div>
              ) : (
                <div key={i} className="whitespace-pre-wrap text-muted-foreground">{line.raw}</div>
              ),
            )}
          </div>
        </>
      )}

      {file && editing && (
        <>
          <h2 className="text-lg font-semibold mb-4">도메인 파일 편집</h2>
          <div className="flex flex-col gap-2 mb-4">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="rounded-md border border-border px-3 py-2 text-sm"
            />
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={16}
              className="rounded-md border border-border px-3 py-2 text-sm font-mono"
            />
          </div>
          {saveMessage && <p className="text-xs text-red-500 mb-2">{saveMessage}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !draftName.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </>
      )}

      {!editing && (
        <div className="flex justify-end mt-4">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
            닫기
          </button>
        </div>
      )}

      {correctionTerm != null && (
        <AddTypoCorrectionDialog
          meetingId={meetingId}
          term={correctionTerm}
          onClose={() => setCorrectionTerm(null)}
        />
      )}
    </Dialog>
  )
}
