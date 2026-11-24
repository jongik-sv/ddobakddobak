import { describe, it, expect } from 'vitest'
import { stageChange, toMoveRequests, type StagedChange } from './stagedChanges'

const from = { type: 'Folder' as const, id: 10, name: '생산회의', path: ['TF', '생산회의'] }
const mk = (rowId: string, fileId: number, key: string, to: StagedChange['to']): StagedChange => ({
  rowId, domainFileId: fileId, termKey: key, from, to,
})

describe('stageChange', () => {
  it('같은 행 재선택은 교체, 원래 레벨로 되돌리면 제거', () => {
    let list: StagedChange[] = []
    list = stageChange(list, mk('r1', 100, 'k1', { type: 'Project', id: 1 }))
    list = stageChange(list, mk('r2', 100, 'k2', { type: 'global', id: null }))
    expect(list).toHaveLength(2)
    list = stageChange(list, mk('r1', 100, 'k1', { type: 'global', id: null }))
    expect(list).toHaveLength(2)
    expect(list.find((c) => c.rowId === 'r1')!.to).toEqual({ type: 'global', id: null })
    list = stageChange(list, mk('r1', 100, 'k1', { type: 'Folder', id: 10 }))
    expect(list.map((c) => c.rowId)).toEqual(['r2'])
  })
})

describe('toMoveRequests', () => {
  it('같은 파일·같은 대상끼리 term_keys 묶음', () => {
    const P = { type: 'Project' as const, id: 1 }
    const list = [
      mk('r1', 100, 'k1', P),
      mk('r2', 100, 'k2', P),
      mk('r3', 101, 'k3', P),
      mk('r4', 100, 'k4', { type: 'global', id: null }),
    ]
    expect(toMoveRequests(list)).toEqual([
      { domain_file_id: 100, term_keys: ['k1', 'k2'], target: P },
      { domain_file_id: 101, term_keys: ['k3'], target: P },
      { domain_file_id: 100, term_keys: ['k4'], target: { type: 'global', id: null } },
    ])
  })
})
