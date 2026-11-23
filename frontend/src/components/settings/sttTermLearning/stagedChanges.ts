import type { LevelInfo, LevelRef, MoveRequest } from '../../../api/sttTermLearning'
import { levelKey } from './levelTree'

export type StagedChange = {
  rowId: string
  domainFileId: number
  termKey: string
  from: LevelInfo
  to: LevelRef
}

/** 같은 rowId 는 교체, to 가 원래 레벨(from)과 같으면 제거. */
export function stageChange(list: StagedChange[], change: StagedChange): StagedChange[] {
  const idx = list.findIndex((c) => c.rowId === change.rowId)
  if (levelKey(change.to) === levelKey(change.from)) return list.filter((c) => c.rowId !== change.rowId)
  if (idx < 0) return [...list, change]
  const next = list.slice()
  next[idx] = change
  return next
}

/** domain_file_id 와 to 가 같은 것끼리 term_keys 를 묶는다(처음 등장 순서 유지). */
export function toMoveRequests(list: StagedChange[]): MoveRequest[] {
  const groups = new Map<string, MoveRequest>()
  for (const c of list) {
    const key = `${c.domainFileId}|${levelKey(c.to)}`
    const g = groups.get(key)
    if (g) g.term_keys!.push(c.termKey)
    else groups.set(key, { domain_file_id: c.domainFileId, term_keys: [c.termKey], target: { type: c.to.type, id: c.to.id } })
  }
  return [...groups.values()]
}
