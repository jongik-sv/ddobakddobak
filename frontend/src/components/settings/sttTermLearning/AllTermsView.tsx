import { useCallback, useEffect, useMemo, useState } from 'react'
import { applyMoves, getImpact, getTerms, getTree, type LevelRef, type TermRow } from '../../../api/sttTermLearning'
import { buildLevelTree, levelKey, relationTo, type LevelNode } from './levelTree'
import { stageChange, toMoveRequests, type StagedChange } from './stagedChanges'

type SourceFilter = 'all' | 'auto' | 'human'
type Impact = { toKey: string; before: number; after: number }

const SOURCE_LABEL: Record<TermRow['source'], string> = {
  auto: '자동',
  feedback: '교정 입력',
  human: '사람 작성',
  human_merged: '사람 + 자동 병합',
}
const ARROW = { up: '⬆', down: '⬇', other: '→', current: '→' } as const

function flatten(node: LevelNode, depth = 0): { node: LevelNode; depth: number }[] {
  return [{ node, depth }, ...node.children.flatMap((c) => flatten(c, depth + 1))]
}
const icon = (t: LevelRef['type']) => (t === 'global' ? '🌐' : t === 'Project' ? '📦' : '📁')

async function errorMessage(err: unknown): Promise<string> {
  try {
    const res = (err as { response?: { json: () => Promise<{ error?: string; message?: string }> } }).response
    if (res) {
      const body = await res.json()
      const msg = body?.error ?? body?.message
      if (typeof msg === 'string' && msg) return msg
    }
  } catch {
    /* 본문 없음 */
  }
  return '변경을 적용하지 못했습니다.'
}

function Toggle({ on, label, ariaLabel, onClick }: { on: boolean; label: string; ariaLabel?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={on}
      onClick={onClick}
      className={`px-2.5 py-1 text-xs border-r last:border-r-0 border-border ${on ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-muted'}`}
    >
      {label}
    </button>
  )
}

export default function AllTermsView() {
  const [terms, setTerms] = useState<TermRow[]>([])
  const [tree, setTree] = useState<LevelNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [project, setProject] = useState<string | null>(null)
  const [source, setSource] = useState<SourceFilter>('all')
  const [dupOnly, setDupOnly] = useState(false)
  const [promoteOnly, setPromoteOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [staged, setStaged] = useState<StagedChange[]>([])
  const [impacts, setImpacts] = useState<Record<string, Impact>>({})
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([getTree(), getTerms()])
      setTree(buildLevelTree(t))
      setTerms(r.terms)
      setLoadError(null)
    } catch {
      setLoadError('전체 용어를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const nodes = useMemo(() => (tree ? flatten(tree) : []), [tree])
  const nameOf = (ref: LevelRef) => nodes.find((n) => levelKey(n.node.ref) === levelKey(ref))?.node.name ?? '?'
  const stagedBy = useMemo(() => new Map(staged.map((c) => [c.rowId, c])), [staged])
  const dupGroups = new Set(terms.filter((t) => t.duplicate_group).map((t) => t.duplicate_group)).size

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return terms.filter((t) => {
      if (project && t.level.path[0] !== project) return false
      if (source === 'auto' && t.source !== 'auto' && t.source !== 'feedback') return false
      if (source === 'human' && t.source !== 'human' && t.source !== 'human_merged') return false
      if (dupOnly && t.duplicate_group === null) return false
      if (promoteOnly && t.duplicate_group === null) return false
      if (q && !t.term.toLowerCase().includes(q) && !t.mispronunciations.some((w) => w.toLowerCase().includes(q))) return false
      return true
    })
  }, [terms, project, source, dupOnly, promoteOnly, query])

  const stage = (r: TermRow, to: LevelRef) => {
    const change: StagedChange = { rowId: r.row_id, domainFileId: r.domain_file.id, termKey: r.key, from: r.level, to }
    setStaged((prev) => stageChange(prev, change))
    setImpacts((prev) => {
      const { [r.row_id]: _drop, ...rest } = prev
      return rest
    })
    if (levelKey(to) === levelKey(r.level)) return
    const toKey = levelKey(to)
    getImpact([
      { level: { type: r.level.type, id: r.level.id }, domain_file_id: r.domain_file.id },
      { level: { type: to.type, id: to.id } },
    ])
      .then(([before, after]) => setImpacts((prev) => ({ ...prev, [r.row_id]: { toKey, before, after } })))
      .catch(() => {})
  }

  const pick = (r: TermRow, to: LevelRef) => {
    setOpenRow(null)
    stage(r, to)
  }

  const mergeGroup = (r: TermRow) => {
    if (!r.merge_target) return
    const target: LevelRef = { type: r.merge_target.type, id: r.merge_target.id }
    for (const g of terms.filter((t) => t.duplicate_group === r.duplicate_group)) stage(g, target)
  }

  const apply = async () => {
    if (busy || !staged.length) return
    setBusy(true)
    setError(null)
    try {
      await applyMoves(toMoveRequests(staged))
      setStaged([])
      setImpacts({})
      await load()
    } catch (err) {
      setError(await errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const cancelAll = () => {
    setStaged([])
    setImpacts({})
    setError(null)
  }

  if (loading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  if (loadError || !tree) return <p role="alert" className="text-sm text-red-600">{loadError ?? '불러오지 못했습니다.'}</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">전체 용어</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{terms.length}개</span>
        {dupGroups > 0 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">여러 레벨에 중복 {dupGroups}</span>
        )}
        <span className="flex-1" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="용어·오인식 검색"
          aria-label="용어 검색"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm min-w-[200px]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="프로젝트 필터">
          <Toggle on={project === null} label="전체" ariaLabel="프로젝트 전체" onClick={() => setProject(null)} />
          {tree.children.map((p) => (
            <Toggle key={p.name} on={project === p.name} label={p.name} onClick={() => setProject(p.name)} />
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="출처 필터">
          <Toggle on={source === 'all'} label="전체" ariaLabel="출처 전체" onClick={() => setSource('all')} />
          <Toggle on={source === 'auto'} label="자동" onClick={() => setSource('auto')} />
          <Toggle on={source === 'human'} label="사람 작성" onClick={() => setSource('human')} />
        </div>
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="상태 필터">
          <Toggle on={dupOnly} label="중복만" onClick={() => setDupOnly((v) => !v)} />
          <Toggle on={promoteOnly} label="올릴 후보만" onClick={() => setPromoteOnly((v) => !v)} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">용어</th>
              <th className="px-3 py-2">오인식 표기</th>
              <th className="px-3 py-2">레벨 (바꾸려면 클릭)</th>
              <th className="px-3 py-2">적용 회의</th>
              <th className="px-3 py-2">출처</th>
              <th className="px-3 py-2">상태</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">표시할 용어가 없습니다.</td></tr>
            )}
            {visible.map((r) => {
              const ch = stagedBy.get(r.row_id)
              const imp = ch && impacts[r.row_id]?.toKey === levelKey(ch.to) ? impacts[r.row_id] : null
              const dup = r.duplicate_group !== null
              return (
                <RowFragment key={r.row_id}>
                  <tr className={`border-t border-border ${ch ? 'bg-blue-50/50' : dup ? 'bg-red-50/50' : ''}`}>
                    <td className="px-3 py-2 font-medium">{r.term}</td>
                    <td className="px-3 py-2">{r.mispronunciations.join(', ')}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-label={`${r.term} 레벨 변경`}
                        onClick={() => setOpenRow(openRow === r.row_id ? null : r.row_id)}
                        className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                      >
                        {ch ? (
                          <>
                            <span className="text-muted-foreground line-through">{icon(r.level.type)} {r.level.name}</span>
                            {' → '}
                            {icon(ch.to.type)} {nameOf(ch.to)} ▾
                          </>
                        ) : (
                          <>{icon(r.level.type)} {r.level.name} ▾</>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {imp ? `${imp.before} → ${imp.after}` : r.applied_meeting_count}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {SOURCE_LABEL[r.source]}{!r.domain_file.auto ? ` · ${r.domain_file.name}` : ''}
                    </td>
                    <td className="px-3 py-2 space-x-1">
                      {ch && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">변경 예정</span>}
                      {dup && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">중복</span>}
                      {dup && r.merge_target && (
                        <button
                          type="button"
                          onClick={() => mergeGroup(r)}
                          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                        >
                          {r.merge_target.name}로 합치기
                        </button>
                      )}
                    </td>
                  </tr>
                  {openRow === r.row_id && (
                    <tr>
                      <td />
                      <td colSpan={5} className="px-3 pb-3">
                        <div role="menu" aria-label={`${r.term} 레벨 선택`} className="max-w-sm rounded-md border border-border bg-card shadow max-h-60 overflow-y-auto">
                          <div className="px-3 py-1.5 text-xs text-muted-foreground">{r.term} → 어느 레벨에 둘까요?</div>
                          {nodes.map(({ node, depth }) => {
                            const rel = relationTo(tree, r.level, node.ref)
                            return (
                              <button
                                key={levelKey(node.ref)}
                                type="button"
                                role="menuitem"
                                disabled={rel === 'current' && !ch}
                                onClick={() => pick(r, node.ref)}
                                style={{ paddingLeft: 12 + depth * 16 }}
                                className="flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-muted disabled:opacity-60"
                              >
                                <span>{icon(node.ref.type)}</span>
                                <span className="flex-1 truncate">{node.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {rel === 'current' ? '현재' : rel === 'other' ? '다른 가지' : ARROW[rel]}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </RowFragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {staged.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <span>
            {`변경 ${staged.length}건 — ` + staged
              .map((c) => {
                const term = terms.find((t) => t.row_id === c.rowId)?.term ?? c.termKey
                const imp = impacts[c.rowId]?.toKey === levelKey(c.to) ? impacts[c.rowId] : null
                return `${term} ${ARROW[relationTo(tree, c.from, c.to)]} ${nameOf(c.to)}${imp ? ` (적용 회의 ${imp.before}→${imp.after})` : ''}`
              })
              .join(', ')}
          </span>
          <span className="flex-1" />
          <button type="button" onClick={cancelAll} disabled={busy} className="rounded-md border px-3 py-1 text-sm hover:bg-muted">모두 취소</button>
          <button type="button" onClick={apply} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">변경 적용</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <p className="text-xs text-muted-foreground">
        레벨 칸을 누르면 트리가 펼쳐져 위·아래 어느 레벨이든 고를 수 있습니다. 바로 반영하지 않고 "변경 예정"으로 모았다가 한 번에 적용합니다.
        같은 용어가 여러 레벨에 있으면 "중복"으로 표시하고 공통 상위 레벨로 합치기를 제안합니다.
      </p>
    </div>
  )
}

function RowFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
