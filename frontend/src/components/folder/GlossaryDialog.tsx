import { useState, useEffect, useCallback } from 'react'
import { Dialog } from '../ui/Dialog'
import {
  getFolderGlossaryEntries, createFolderGlossaryEntry,
  updateGlossaryEntry, deleteGlossaryEntry,
} from '../../api/glossary'
import type { GlossaryEntry, GlossaryEntryInput } from '../../api/glossary'

export default function GlossaryDialog({ folderId, folderName, onClose }: { folderId: number; folderName: string; onClose: () => void }) {
  const [entries, setEntries] = useState<GlossaryEntry[]>([])
  const [draft, setDraft] = useState<GlossaryEntryInput>({ from_text: '', to_text: '', match_type: 'literal' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getFolderGlossaryEntries(folderId)
      setEntries(r.entries)
    } catch {
      setError('목록을 불러오지 못했습니다 (편집 권한이 없을 수 있습니다)')
    } finally {
      setLoading(false)
    }
  }, [folderId])

  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!draft.from_text.trim() || !draft.to_text.trim()) return
    setError('')
    try {
      await createFolderGlossaryEntry(folderId, draft)
      setDraft({ from_text: '', to_text: '', match_type: 'literal' })
      await load()
    } catch {
      setError('추가 실패 (정규식이 올바른지 확인하세요)')
    }
  }

  const toggle = async (e: GlossaryEntry) => {
    await updateGlossaryEntry(e.id, { enabled: !e.enabled })
    await load()
  }

  const remove = async (id: number) => {
    await deleteGlossaryEntry(id)
    await load()
  }

  return (
    <Dialog onClose={onClose} backdropClassName="bg-black/10 backdrop-blur-sm" className="w-full max-w-lg rounded-xl bg-card p-6 shadow-2xl border border-border">
      <h2 className="text-lg font-semibold mb-1">오타 사전 — {folderName}</h2>
      <p className="text-xs text-muted-foreground mb-4">이 폴더의 사전은 하위 모든 회의에 적용됩니다.</p>

      <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center gap-1 text-sm">
            <span className="flex-1 min-w-0 truncate">{e.from_text}</span>
            <span className="text-muted-foreground text-xs">&rarr;</span>
            <span className="flex-1 min-w-0 truncate">{e.to_text}</span>
            <span className="text-[10px] text-muted-foreground">{e.match_type === 'regex' ? '정규식' : ''}</span>
            <label className="text-[11px] flex items-center gap-1">
              <input type="checkbox" checked={e.enabled} onChange={() => toggle(e)} /> 사용
            </label>
            <button onClick={() => remove(e.id)} className="w-6 h-6 text-muted-foreground hover:text-red-500" title="삭제">&times;</button>
          </div>
        ))}
        {!loading && entries.length === 0 && <div className="text-xs text-muted-foreground">등록된 항목이 없습니다.</div>}
      </div>

      <div className="flex items-center gap-1 mt-3">
        <input type="text" value={draft.from_text} placeholder="잘못된 용어"
          onChange={(e) => setDraft({ ...draft, from_text: e.target.value })}
          className="flex-1 min-w-0 rounded-md border border-border px-2 py-1 text-sm" />
        <span className="text-muted-foreground text-xs">&rarr;</span>
        <input type="text" value={draft.to_text} placeholder="올바른 용어"
          onChange={(e) => setDraft({ ...draft, to_text: e.target.value })}
          className="flex-1 min-w-0 rounded-md border border-border px-2 py-1 text-sm" />
        <select value={draft.match_type}
          onChange={(e) => setDraft({ ...draft, match_type: e.target.value as 'literal' | 'regex' })}
          className="text-xs rounded-md border border-border px-1 py-1">
          <option value="literal">리터럴</option>
          <option value="regex">정규식</option>
        </select>
        <button onClick={add} className="text-xs text-blue-600 hover:text-blue-800 shrink-0">추가</button>
      </div>
      {error && <div className="text-[11px] text-red-500 mt-1">{error}</div>}

      <div className="flex justify-end mt-4">
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">닫기</button>
      </div>
    </Dialog>
  )
}
