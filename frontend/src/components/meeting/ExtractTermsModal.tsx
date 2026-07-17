import { useState } from 'react'
import { createDomainFile, mergeDomainTerms } from '../../api/domainFiles'
import type { DomainFile, ExtractedTerm } from '../../api/domainFiles'
import { errorToMessage } from '../../lib/errors'
import { Dialog } from '../ui/Dialog'
import AddTypoCorrectionDialog from './AddTypoCorrectionDialog'

interface ExtractTermsModalProps {
  meetingId: number
  terms: ExtractedTerm[]
  files: DomainFile[]
  onClose: () => void
  onMerged: () => void
}

interface TermRow extends ExtractedTerm {
  checked: boolean
  /** 오인식 변형 편집용 원문(쉼표 구분). 저장 시 parseMispronunciations로 분리 */
  mispronunciationsText: string
}

/** 쉼표로 구분된 오인식 변형 입력값을 trim·빈 항목 제거해 배열로 변환 */
function parseMispronunciations(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean)
}

/** 용어 라인 규약(§3, 하위호환 확장): `- **용어** [분류] (오인식: 변형1, 변형2): 설명` */
function formatTermLine(term: string, category: string, definition: string, mispronunciations: string[]): string {
  const cat = category.trim()
  const mis = mispronunciations.map((s) => s.trim()).filter(Boolean)
  const catPart = cat ? ` [${cat}]` : ''
  const misPart = mis.length > 0 ? ` (오인식: ${mis.join(', ')})` : ''
  return `- **${term}**${catPart}${misPart}: ${definition}`
}

/** 요약에서 추출된 도메인 용어 프리뷰 — 체크 선택 + 분류/설명/오인식 인라인 수정 후 신규 파일 생성 또는 기존 파일 병합 */
export default function ExtractTermsModal({ meetingId, terms, files, onClose, onMerged }: ExtractTermsModalProps) {
  const [rows, setRows] = useState<TermRow[]>(
    terms.map((t) => ({ ...t, checked: true, mispronunciationsText: (t.mispronunciations ?? []).join(', ') })),
  )
  const [target, setTarget] = useState<'new' | number>(files.length > 0 ? files[0].id : 'new')
  const [newFileName, setNewFileName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [correctionTarget, setCorrectionTarget] = useState<{ term: string; mispronunciations: string[] } | null>(null)

  const updateRow = (i: number, patch: Partial<TermRow>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const selectedRows = rows.filter((r) => r.checked && r.term.trim())

  const submit = async () => {
    if (selectedRows.length === 0) return
    setSaving(true)
    setError('')
    try {
      if (target === 'new') {
        if (!newFileName.trim()) {
          setError('새 파일 이름을 입력하세요')
          return
        }
        const content = selectedRows
          .map((r) => formatTermLine(r.term, r.category, r.definition, parseMispronunciations(r.mispronunciationsText)))
          .join('\n')
        await createDomainFile({ name: newFileName.trim(), content })
      } else {
        await mergeDomainTerms(
          target,
          selectedRows.map((r) => ({
            term: r.term,
            category: r.category,
            definition: r.definition,
            mispronunciations: parseMispronunciations(r.mispronunciationsText),
          })),
        )
      }
      onMerged()
    } catch (err) {
      setError(await errorToMessage(err, '저장 실패'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onClose={onClose} className="w-full max-w-2xl rounded-xl bg-card p-6 shadow-2xl border border-border max-h-[90vh] overflow-y-auto">
      <h2 className="text-lg font-semibold mb-4">추출된 도메인 용어</h2>

      <div className="flex flex-col gap-2 mb-4 max-h-80 overflow-y-auto">
        {rows.map((r, i) => (
          <div key={i} className="flex items-start gap-2 py-1.5 border-b border-border/50">
            <input
              type="checkbox"
              checked={r.checked}
              onChange={(e) => updateRow(i, { checked: e.target.checked })}
              className="mt-2"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{r.term}</div>
              <div className="flex gap-1 mt-1">
                <input
                  type="text"
                  value={r.category}
                  onChange={(e) => updateRow(i, { category: e.target.value })}
                  placeholder="분류"
                  className="w-24 shrink-0 rounded-md border border-border px-2 py-1 text-xs"
                />
                <input
                  type="text"
                  value={r.definition}
                  onChange={(e) => updateRow(i, { definition: e.target.value })}
                  placeholder="설명"
                  className="flex-1 min-w-0 rounded-md border border-border px-2 py-1 text-xs"
                />
              </div>
              <input
                type="text"
                value={r.mispronunciationsText}
                onChange={(e) => updateRow(i, { mispronunciationsText: e.target.value })}
                placeholder="오인식 변형(쉼표로 구분, 예: 씨지엘, 시지엘)"
                className="mt-1 w-full rounded-md border border-border px-2 py-1 text-xs"
              />
            </div>
            <button
              type="button"
              onClick={() => setCorrectionTarget({ term: r.term, mispronunciations: parseMispronunciations(r.mispronunciationsText) })}
              className="shrink-0 text-xs text-blue-500 hover:text-blue-700 mt-2"
            >
              교정 추가
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={target === 'new'} onChange={() => setTarget('new')} />
          새 파일로 저장
        </label>
        {target === 'new' && (
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="새 파일 이름"
            className="ml-6 rounded-md border border-border px-3 py-2 text-sm"
          />
        )}

        {files.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={target !== 'new'}
              onChange={() => setTarget(files[0].id)}
            />
            기존 파일에 병합
          </label>
        )}
        {target !== 'new' && files.length > 0 && (
          <select
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="ml-6 rounded-md border border-border px-3 py-2 text-sm"
          >
            {files.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="text-[11px] text-red-500 mb-2">{error}</div>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving || selectedRows.length === 0}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      {correctionTarget != null && (
        <AddTypoCorrectionDialog
          meetingId={meetingId}
          term={correctionTarget.term}
          mispronunciations={correctionTarget.mispronunciations}
          onClose={() => setCorrectionTarget(null)}
        />
      )}
    </Dialog>
  )
}
