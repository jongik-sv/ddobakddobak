import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyMoves,
  getMisrecognitions,
  getTree,
  updateMisrecognition,
  type Misrecognition,
} from '../../../api/sttTermLearning'
import { apiErrorMessage } from './apiError'
import { confirmDialog } from '../../../lib/confirmDialog'
import { buildLevelTree, moveUpConfirmMessage, parentOf, type LevelNode } from './levelTree'

const FILTERS = [
  { id: '', label: '전체' },
  { id: 'confirmed', label: '확정' },
  { id: 'undecided', label: '미정' },
  { id: 'excluded', label: '제외됨' },
] as const

const STATUS_LABEL: Record<string, string> = { confirmed: '확정', undecided: '미정', excluded: '제외됨' }

export default function MisrecognitionsView() {
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const ticket = useRef(0)
  const [list, setList] = useState<Misrecognition[]>([])
  const [counts, setCounts] = useState({ total: 0, undecided: 0 })
  const [root, setRoot] = useState<LevelNode | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const mine = ++ticket.current
    try {
      const res = await getMisrecognitions({ status: status || undefined, q: debouncedQ.trim() || undefined })
      if (mine !== ticket.current) return
      setList(res.misrecognitions)
      setCounts(res.counts)
      setError(null)
    } catch {
      if (mine === ticket.current) setError('오인식 기록을 불러오지 못했습니다.')
    }
  }, [status, debouncedQ])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    getTree().then((t) => setRoot(buildLevelTree(t))).catch(() => {})
  }, [])


  const setMisStatus = async (m: Misrecognition, next: string) => {
    try {
      await updateMisrecognition(m.id, { status: next })
      await load()
    } catch (err) {
      setError(await apiErrorMessage(err, '상태를 바꾸지 못했습니다.'))
    }
  }

  const moveUp = async (m: Misrecognition) => {
    if (!m.registered || !root) return
    const parent = parentOf(root, m.registered.level)
    if (!parent) return
    const ask = moveUpConfirmMessage(m.correct || m.registered.term_key, parent, m.registered.auto === false)
    if (ask && !(await confirmDialog(ask, { title: '상위 레벨로', kind: 'warning' }))) return
    try {
      await applyMoves([
        { domain_file_id: m.registered.domain_file_id, term_keys: [m.registered.term_key], target: parent.ref },
      ])
      await load()
    } catch (err) {
      setError(await apiErrorMessage(err, '이동하지 못했습니다.'))
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        오인식 표기 {counts.total} · 올바른 용어 미정 {counts.undecided}. STT 가 잘못 받아 적은 표기를 등록 여부와 상관없이 모아 둡니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="상태 필터" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={status === f.id}
              onClick={() => setStatus(f.id)}
              className={`rounded-full border px-3 py-1 text-xs ${status === f.id ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-muted'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="오인식 검색"
          placeholder="표기·용어 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">기록이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-2">오인식 표기</th>
                <th className="p-2">올바른 용어</th>
                <th className="p-2">상태</th>
                <th className="p-2">나온 횟수</th>
                <th className="p-2">회의</th>
                <th className="p-2">등록 위치</th>
                <th className="p-2">마지막</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className="border-b">
                  <td className="p-2 text-red-600">{m.wrong}</td>
                  <td className="p-2">{m.correct || '—'}</td>
                  <td className="p-2 text-xs">
                    {STATUS_LABEL[m.status] ?? m.status}
                    {m.registered && ' · 도메인 등록'}
                  </td>
                  <td className="p-2">{m.hit_count}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {m.meeting_ids.slice(0, 2).map((id) => `#${id}`).join(', ')}
                    {m.meeting_ids.length > 2 && ` 외 ${m.meeting_ids.length - 2}`}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{m.registered ? m.registered.level.name : '—'}</td>
                  <td className="p-2 text-xs text-muted-foreground">{m.last_seen_at ? m.last_seen_at.slice(5, 10) : ''}</td>
                  <td className="p-2 whitespace-nowrap">
                    {m.registered && (
                      <button
                        type="button"
                        aria-label={`${m.wrong} 상위 레벨로`}
                        title="상위 레벨로"
                        disabled={!root || !parentOf(root, m.registered.level)}
                        onClick={() => moveUp(m)}
                        className="rounded border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-40"
                      >
                        ⬆
                      </button>
                    )}
                    {m.status !== 'confirmed' && (
                      <button type="button" aria-label={`${m.wrong} 확정`} onClick={() => setMisStatus(m, 'confirmed')} className="ml-1 rounded border px-2 py-0.5 text-xs hover:bg-muted">
                        확정
                      </button>
                    )}
                    {m.status !== 'undecided' && (
                      <button type="button" aria-label={`${m.wrong} 미정`} onClick={() => setMisStatus(m, 'undecided')} className="ml-1 rounded border px-2 py-0.5 text-xs hover:bg-muted">
                        미정
                      </button>
                    )}
                    {m.status !== 'excluded' && (
                      <button type="button" aria-label={`${m.wrong} 제외`} onClick={() => setMisStatus(m, 'excluded')} className="ml-1 rounded border px-2 py-0.5 text-xs hover:bg-muted">
                        제외
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
