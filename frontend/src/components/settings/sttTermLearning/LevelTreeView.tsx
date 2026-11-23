import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyMoves,
  deleteTerms,
  getTerms,
  getTree,
  type LevelRef,
  type TermRow,
} from '../../../api/sttTermLearning'
import { confirmDialog } from '../../../lib/confirmDialog'
import MoveTermsDialog from './MoveTermsDialog'
import { buildLevelTree, findPath, levelKey, parentOf, type LevelNode } from './levelTree'

const SOURCE_LABEL: Record<TermRow['source'], string> = {
  auto: '자동',
  feedback: '교정 입력',
  human: '사람 작성',
  human_merged: '사람 작성+자동',
}

const GLOBAL: LevelRef = { type: 'global', id: null }

function TreeNodes({ node, depth, selected, onSelect }: {
  node: LevelNode
  depth: number
  selected: LevelRef
  onSelect: (ref: LevelRef) => void
}) {
  const on = levelKey(node.ref) === levelKey(selected)
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node.ref)}
        aria-current={on ? 'true' : undefined}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={`flex w-full items-center gap-2 py-1.5 pr-2 text-left text-sm ${on ? 'bg-blue-50 text-blue-700' : 'hover:bg-muted'}`}
      >
        <span>{node.ref.type === 'global' ? '🌐' : node.ref.type === 'Project' ? '📦' : '📁'}</span>
        <span className="flex-1 truncate">{node.name}</span>
        {node.newCount > 0 && <span className="text-xs text-green-600">+{node.newCount}</span>}
        <span className="text-xs text-muted-foreground">{node.termCount}</span>
      </button>
      {node.children.map((c) => (
        <TreeNodes key={levelKey(c.ref)} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ))}
    </>
  )
}

export default function LevelTreeView() {
  const [root, setRoot] = useState<LevelNode | null>(null)
  const [level, setLevel] = useState<LevelRef>(GLOBAL)
  const [includeDescendants, setIncludeDescendants] = useState(false)
  const [terms, setTerms] = useState<TermRow[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [moveRows, setMoveRows] = useState<TermRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadTree = useCallback(async () => {
    try {
      setRoot(buildLevelTree(await getTree()))
    } catch {
      setError('레벨 트리를 불러오지 못했습니다.')
    }
  }, [])

  const loadTerms = useCallback(async () => {
    try {
      const res = await getTerms({ level, includeDescendants })
      setTerms(res.terms)
      setChecked(new Set())
    } catch {
      setError('용어를 불러오지 못했습니다.')
    }
  }, [level, includeDescendants])

  useEffect(() => { void loadTree() }, [loadTree])
  useEffect(() => { void loadTerms() }, [loadTerms])

  const refresh = async () => {
    await Promise.all([loadTree(), loadTerms()])
  }

  const node = useMemo(() => (root ? findPath(root, level).at(-1) ?? null : null), [root, level])
  const path = useMemo(() => (root ? findPath(root, level) : []), [root, level])
  const selectedRows = terms.filter((t) => checked.has(t.row_id))
  const candidates = node?.promoteCandidates ?? []

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const moveUp = async (row: TermRow) => {
    if (!root) return
    const parent = parentOf(root, row.level)
    if (!parent) return
    setError(null)
    try {
      await applyMoves([{ domain_file_id: row.domain_file.id, term_keys: [row.key], target: parent.ref }])
      await refresh()
    } catch {
      setError('상위 레벨로 올리지 못했습니다.')
    }
  }

  const remove = async () => {
    if (selectedRows.length === 0) return
    const ok = await confirmDialog(`선택한 용어 ${selectedRows.length}건을 삭제할까요?`, { kind: 'warning' })
    if (!ok) return
    setError(null)
    try {
      await deleteTerms(selectedRows.map((r) => ({ domain_file_id: r.domain_file.id, term_key: r.key })))
      await refresh()
    } catch {
      setError('삭제하지 못했습니다.')
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="레벨 트리" className="rounded-md border border-border overflow-hidden self-start">
        {root ? (
          <TreeNodes node={root} depth={0} selected={level} onSelect={setLevel} />
        ) : (
          <p className="p-3 text-sm text-muted-foreground">불러오는 중…</p>
        )}
      </nav>

      <div className="min-w-0 space-y-3">
        <div className="text-xs text-muted-foreground">{path.map((n) => n.name).join(' › ')}</div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{node?.name ?? '전역(공용)'}</h3>
          <span className="rounded bg-muted px-2 py-0.5 text-xs">용어 {node?.termCount ?? terms.length}</span>
          {(node?.newCount ?? 0) > 0 && (
            <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">새로 등록 {node?.newCount}</span>
          )}
        </div>

        {candidates.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            <b>상위로 올릴 후보 {candidates.length}건</b>
            {' — '}
            {candidates.map((c) => `${c.term}(하위 폴더 ${c.folder_ids.length}곳)`).join(', ')}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={includeDescendants} onChange={(e) => setIncludeDescendants(e.target.checked)} />
            하위 포함
          </label>
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground">{selectedRows.length}건 선택</span>
          <button
            type="button"
            disabled={selectedRows.length === 0}
            onClick={() => setMoveRows(selectedRows)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            레벨 이동…
          </button>
          <button
            type="button"
            disabled={selectedRows.length === 0}
            onClick={remove}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            삭제
          </button>
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-8 p-2" />
                <th className="p-2">오인식 → 용어</th>
                <th className="p-2">출처</th>
                <th className="p-2">도메인 파일</th>
                <th className="p-2">레벨 이동</th>
              </tr>
            </thead>
            <tbody>
              {terms.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">등록된 용어가 없습니다.</td></tr>
              )}
              {terms.map((t) => (
                <tr key={t.row_id} className="border-t border-border">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      aria-label={`${t.term} 선택`}
                      checked={checked.has(t.row_id)}
                      onChange={() => toggle(t.row_id)}
                    />
                  </td>
                  <td className="p-2">
                    {t.mispronunciations.length > 0 ? (
                      <>
                        <span className="text-red-600">{t.mispronunciations.join(', ')}</span>
                        <span className="px-1 text-muted-foreground">→</span>
                        <span className="font-medium text-green-700">{t.term}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-green-700">{t.term}</span>
                        <span className="ml-1 text-xs text-muted-foreground">(오인식 없음)</span>
                      </>
                    )}
                    {t.is_new && <span className="ml-2 rounded bg-green-100 px-1.5 text-xs text-green-700">새</span>}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {SOURCE_LABEL[t.source]}
                    {t.meeting_ids.length > 0 && ` · #${t.meeting_ids.slice(0, 2).join(', #')}${t.meeting_ids.length > 2 ? ` 외 ${t.meeting_ids.length - 2}` : ''}`}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{t.domain_file.name}</td>
                  <td className="p-2 whitespace-nowrap">
                    <button
                      type="button"
                      aria-label={`${t.term} 상위 레벨로`}
                      title="상위 레벨로"
                      disabled={!root || !parentOf(root, t.level)}
                      onClick={() => moveUp(t)}
                      className="rounded border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-40"
                    >
                      ⬆
                    </button>
                    <button
                      type="button"
                      aria-label={`${t.term} 이동…`}
                      title="다른 레벨로"
                      onClick={() => setMoveRows([t])}
                      className="ml-1 rounded border px-2 py-0.5 text-xs hover:bg-muted"
                    >
                      ⬇ ▾
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {moveRows && root && (
        <MoveTermsDialog
          rows={moveRows}
          tree={root}
          onClose={() => setMoveRows(null)}
          onApplied={() => {
            setMoveRows(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}
