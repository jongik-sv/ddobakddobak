import { useState } from 'react'
import { useGlossary } from '../../hooks/useGlossary'
import type { GlossaryEntry, GlossaryLevel, GlossaryEntryInput } from '../../api/glossary'

/** 폴더별 오타사전 패널 — 상위폴더들 → 현재폴더 → 현재회의 3단 테이블 (회의 상세 하단) */
export function GlossaryPanel({ meetingId }: { meetingId: number }) {
  const { view, status, addMeetingEntry, addFolderEntry, editEntry, removeEntry, reapply, applyEntry } = useGlossary(meetingId)

  if (!view) return null

  return (
    <div className="border-t bg-white px-6 py-3 shrink-0">
      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold text-gray-500 select-none flex items-center gap-2">
          <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
          오타 사전
          {status && <span className="text-xs font-normal text-blue-500 ml-2">{status}</span>}
        </summary>

        <div className="mt-2 flex flex-col gap-4 max-w-2xl">
          {view.ancestors.map((lvl) => (
            <GlossaryLevelTable
              key={`a-${lvl.folder.id}`}
              title={`상위폴더: ${lvl.folder.name}`}
              level={lvl}
              warnMeetings
              onAdd={(d) => addFolderEntry(lvl.folder.id, d)}
              onEdit={editEntry}
              onRemove={removeEntry}
              onApply={applyEntry}
            />
          ))}

          {view.folder && (
            <GlossaryLevelTable
              title={`현재 폴더: ${view.folder.folder.name}`}
              level={view.folder}
              warnMeetings
              onAdd={(d) => addFolderEntry(view.folder!.folder.id, d)}
              onEdit={editEntry}
              onRemove={removeEntry}
              onApply={applyEntry}
            />
          )}

          <GlossaryLevelTable
            title="현재 회의"
            level={{ folder: { id: 0, name: '' }, entries: view.meeting.entries }}
            onAdd={(d) => addMeetingEntry(d)}
            onEdit={editEntry}
            onRemove={removeEntry}
            onApply={applyEntry}
          />

          <button
            onClick={() => reapply()}
            className="self-end px-4 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            사전 재적용
          </button>
        </div>
      </details>
    </div>
  )
}

function GlossaryLevelTable({
  title, level, warnMeetings, onAdd, onEdit, onRemove, onApply,
}: {
  title: string
  level: GlossaryLevel
  warnMeetings?: boolean
  onAdd: (d: GlossaryEntryInput) => Promise<void>
  onEdit: (id: number, d: Partial<GlossaryEntryInput>) => void
  onRemove: (id: number) => void
  onApply: (id: number) => Promise<void>
}) {
  const [draft, setDraft] = useState<GlossaryEntryInput>({ from_text: '', to_text: '', match_type: 'literal' })
  const [error, setError] = useState('')

  const submit = async () => {
    if (!draft.from_text.trim() || !draft.to_text.trim()) return
    setError('')
    try {
      await onAdd(draft)
      setDraft({ from_text: '', to_text: '', match_type: 'literal' })
    } catch {
      setError('추가 실패 (정규식이 올바른지 확인하세요)')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold text-gray-600">{title}</div>
      {warnMeetings && level.entries.length > 0 && (
        <div className="text-[11px] text-amber-600">이 폴더의 사전은 하위 모든 회의에 영향을 줍니다.</div>
      )}
      {level.entries.map((e: GlossaryEntry) => (
        <div key={e.id} className="flex items-center gap-1 text-sm">
          <span className="flex-1 min-w-0 truncate">{e.from_text}</span>
          <span className="text-gray-400 text-xs">&rarr;</span>
          <span className="flex-1 min-w-0 truncate">{e.to_text}</span>
          <span className="text-[10px] text-gray-400">{e.match_type === 'regex' ? '정규식' : ''}</span>
          <label className="text-[11px] flex items-center gap-1">
            <input type="checkbox" checked={e.enabled} onChange={(ev) => onEdit(e.id, { enabled: ev.target.checked })} />
            사용
          </label>
          <button onClick={() => onApply(e.id)} className="px-3 py-1 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors shrink-0" title="이 항목만 적용">적용</button>
          <button onClick={() => onRemove(e.id)} className="w-6 h-6 text-gray-400 hover:text-red-500" title="삭제">&times;</button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input
          type="text" value={draft.from_text} placeholder="잘못된 용어"
          onChange={(e) => setDraft({ ...draft, from_text: e.target.value })}
          className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <span className="text-gray-400 text-xs">&rarr;</span>
        <input
          type="text" value={draft.to_text} placeholder="올바른 용어"
          onChange={(e) => setDraft({ ...draft, to_text: e.target.value })}
          className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <select
          value={draft.match_type}
          onChange={(e) => setDraft({ ...draft, match_type: e.target.value as 'literal' | 'regex' })}
          className="text-xs rounded-md border border-gray-300 px-1 py-1"
        >
          <option value="literal">리터럴</option>
          <option value="regex">정규식</option>
        </select>
        <button onClick={submit} className="text-xs text-blue-500 hover:text-blue-700 shrink-0">추가</button>
      </div>
      {error && <div className="text-[11px] text-red-500">{error}</div>}
    </div>
  )
}
