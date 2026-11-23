import { describe, it, expect } from 'vitest'
import { buildLevelTree, findPath, parentOf, childrenOf, relationTo, levelKey } from './levelTree'
import type { TreeResponse } from '../../../api/sttTermLearning'

const tree: TreeResponse = {
  global: { term_count: 14, new_count: 0 },
  projects: [
    {
      id: 1, name: 'TF', term_count: 31, new_count: 0, promote_candidates: [],
      folders: [
        { id: 10, name: '생산회의', parent_id: null, term_count: 18, new_count: 3, promote_candidates: [{ term: '산세라인', folder_ids: [11, 12] }] },
        { id: 11, name: '주간', parent_id: 10, term_count: 9, new_count: 2, promote_candidates: [] },
        { id: 12, name: '설비', parent_id: 10, term_count: 4, new_count: 0, promote_candidates: [] },
        { id: 20, name: '품질', parent_id: null, term_count: 7, new_count: 0, promote_candidates: [] },
      ],
    },
  ],
}
const g = { type: 'global' as const, id: null }
const P = { type: 'Project' as const, id: 1 }
const F = (id: number) => ({ type: 'Folder' as const, id })

describe('levelTree', () => {
  it('folders 의 parent_id 로 중첩 트리를 만들고 루트는 global', () => {
    const root = buildLevelTree(tree)
    expect(root.ref).toEqual(g)
    expect(root.termCount).toBe(14)
    expect(root.children.map((c) => c.name)).toEqual(['TF'])
    const proj = root.children[0]
    expect(proj.children.map((c) => c.name)).toEqual(['생산회의', '품질'])
    expect(proj.children[0].children.map((c) => c.name)).toEqual(['주간', '설비'])
    expect(proj.children[0].newCount).toBe(3)
    expect(proj.children[0].promoteCandidates).toEqual([{ term: '산세라인', folder_ids: [11, 12] }])
    expect(levelKey(F(10))).toBe('Folder:10')
    expect(levelKey(g)).toBe('global:')
  })

  it('findPath·parentOf·childrenOf', () => {
    const root = buildLevelTree(tree)
    expect(findPath(root, F(11)).map((n) => n.name)).toEqual(['전역(공용)', 'TF', '생산회의', '주간'])
    expect(findPath(root, F(999))).toEqual([])
    expect(parentOf(root, F(11))?.name).toBe('생산회의')
    expect(parentOf(root, g)).toBeNull()
    expect(childrenOf(root, P).map((n) => n.name)).toEqual(['생산회의', '품질'])
  })

  it('relationTo: 조상 up, 자손 down, 형제 가지 other', () => {
    const root = buildLevelTree(tree)
    expect(relationTo(root, F(10), P)).toBe('up')
    expect(relationTo(root, F(10), g)).toBe('up')
    expect(relationTo(root, F(10), F(10))).toBe('current')
    expect(relationTo(root, F(10), F(11))).toBe('down')
    expect(relationTo(root, F(10), F(20))).toBe('other')
    expect(relationTo(root, F(11), F(12))).toBe('other')
  })
})
