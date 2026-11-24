import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '../../ui/Dialog'
import { applyMoves, getImpact, type LevelRef, type MoveRequest, type TermRow } from '../../../api/sttTermLearning'
import { levelKey, relationTo, type LevelNode, type LevelRelation } from './levelTree'

interface Props {
  rows: TermRow[]
  tree: LevelNode
  initialTarget?: LevelRef
  onClose: () => void
  onApplied: () => void
}

const REL_LABEL: Record<LevelRelation, string> = {
  up: '⬆ 위로',
  down: '⬇ 아래로',
  other: '다른 가지',
  current: '현재',
}

const VERB: Record<LevelRelation, string> = { up: '올리기', down: '내리기', other: '옮기기', current: '옮기기' }

function flatten(node: LevelNode, depth = 0): { node: LevelNode; depth: number }[] {
  return [{ node, depth }, ...node.children.flatMap((c) => flatten(c, depth + 1))]
}

async function errorMessage(err: unknown): Promise<string> {
  const fallback = '이동하지 못했습니다.'
  try {
    const res = (err as { response?: Response }).response
    if (res) {
      const body = await res.json()
      const msg = body?.error ?? body?.message
      if (typeof msg === 'string' && msg) return msg
    }
  } catch {
    /* 본문 없음 */
  }
  return fallback
}

export default function MoveTermsDialog({ rows, tree, initialTarget, onClose, onApplied }: Props) {
  const source = rows[0].level
  const [target, setTarget] = useState<LevelRef | null>(initialTarget ?? null)
  const [mergeDescendants, setMergeDescendants] = useState(false)
  const [copy, setCopy] = useState(false)
  const [impact, setImpact] = useState<{ before: number; after: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nodes = useMemo(() => flatten(tree), [tree])
  const targetNode = target ? nodes.find((n) => levelKey(n.node.ref) === levelKey(target))?.node : undefined
  const multiLevel = rows.some((r) => levelKey(r.level) !== levelKey(source))
  const relation: LevelRelation | null = target ? (multiLevel ? 'other' : relationTo(tree, source, target)) : null

  useEffect(() => {
    setImpact(null)
    if (!target || multiLevel) return
    let cancelled = false
    getImpact([
      { level: { type: source.type, id: source.id }, domain_file_id: rows[0].domain_file.id },
      { level: target },
    ])
      .then(([before, after]) => {
        if (!cancelled) setImpact({ before, after })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target && levelKey(target)])

  const sourcePath = source.path.join(' › ') || source.name

  const submit = async () => {
    if (!target || busy) return
    setBusy(true)
    setError(null)
    const byFile = new Map<number, string[]>()
    for (const r of rows) {
      const keys = byFile.get(r.domain_file.id) ?? []
      keys.push(r.key)
      byFile.set(r.domain_file.id, keys)
    }
    const moves: MoveRequest[] = [...byFile.entries()].map(([domain_file_id, term_keys]) => ({
      domain_file_id,
      term_keys,
      target,
      copy,
      merge_descendants: relation === 'up' ? mergeDescendants : false,
    }))
    try {
      await applyMoves(moves)
      onApplied()
    } catch (err) {
      setError(await errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog onClose={onClose} ariaLabel="레벨 이동" className="w-full max-w-2xl rounded-xl bg-card p-6 shadow-2xl border border-border max-h-[90vh] overflow-y-auto">
      <h2 className="text-base font-semibold text-foreground">용어 {rows.length}건을 다른 레벨로 이동</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {rows.map((r) => r.term).join(', ')} · 현재 위치: {sourcePath}
      </p>

      <div role="tree" className="mt-4 rounded-md border border-border max-h-60 overflow-y-auto">
        {nodes.map(({ node, depth }) => {
          const rel = relationTo(tree, source, node.ref)
          const selected = target && levelKey(target) === levelKey(node.ref)
          return (
            <button
              key={levelKey(node.ref)}
              type="button"
              role="treeitem"
              aria-selected={!!selected}
              disabled={rel === 'current'}
              onClick={() => setTarget(node.ref)}
              style={{ paddingLeft: 8 + depth * 16 }}
              className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm disabled:opacity-60 ${
                selected ? 'bg-blue-50 text-blue-700' : 'hover:bg-muted'
              }`}
            >
              <span>{node.ref.type === 'global' ? '🌐' : node.ref.type === 'Project' ? '📦' : '📁'}</span>
              <span className="flex-1 truncate">{node.name}{rel === 'current' ? ' · 현재' : ''}</span>
              <span className="text-xs text-muted-foreground">{REL_LABEL[rel]}</span>
            </button>
          )
        })}
      </div>

      {target && (
        <div className="mt-3 rounded-md bg-muted/50 p-3 text-sm" data-testid="move-impact">
          <b>이동하면</b>
          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
            <li>대상: <b>{targetNode?.name}</b>의 "STT 오인식(자동)" 파일 (없으면 새로 만들어 연결)</li>
            <li>
              {multiLevel ? (
                '여러 레벨 선택됨 — 적용 회의 수는 표시하지 않습니다'
              ) : (
                <>
                  영향: 적용 회의{' '}
                  {impact ? <b>{impact.before}건 → {impact.after}건</b> : '집계 중…'}
                  의 다음 요약부터 반영
                </>
              )}
            </li>
            <li>같은 용어가 대상에 이미 있으면 오인식 표기를 합친다</li>
          </ul>
        </div>
      )}

      {relation === 'up' && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mergeDescendants} onChange={(e) => setMergeDescendants(e.target.checked)} />
          하위 폴더에 있는 같은 용어도 함께 올려 합치기
        </label>
      )}
      <label className="mt-1 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        원래 레벨에도 남겨 두기(복사)
      </label>

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">취소</button>
        <button
          type="button"
          disabled={!target || !targetNode || busy}
          onClick={submit}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {targetNode && relation ? `${targetNode.name}로 ${VERB[relation]}` : '이동'}
        </button>
      </div>
    </Dialog>
  )
}
