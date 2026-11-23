import type { LevelRef, TreeResponse, FolderNode, PromoteCandidate } from '../../../api/sttTermLearning'

export type LevelNode = {
  ref: LevelRef
  name: string
  termCount: number
  newCount: number
  children: LevelNode[]
  promoteCandidates: PromoteCandidate[]
}

export type LevelRelation = 'up' | 'current' | 'down' | 'other'

export function levelKey(ref: LevelRef): string {
  return `${ref.type}:${ref.id ?? ''}`
}

function folderNodes(folders: FolderNode[], parentId: number | null): LevelNode[] {
  return folders
    .filter((f) => f.parent_id === parentId)
    .map((f) => ({
      ref: { type: 'Folder' as const, id: f.id },
      name: f.name,
      termCount: f.term_count,
      newCount: f.new_count,
      promoteCandidates: f.promote_candidates,
      children: folderNodes(folders, f.id),
    }))
}

/** 루트 = 전역(global). 하위: 프로젝트 → 최상위 폴더 → 중첩 폴더. */
export function buildLevelTree(tree: TreeResponse): LevelNode {
  return {
    ref: { type: 'global', id: null },
    name: '전역(공용)',
    termCount: tree.global.term_count,
    newCount: tree.global.new_count,
    promoteCandidates: [],
    children: tree.projects.map((p) => ({
      ref: { type: 'Project' as const, id: p.id },
      name: p.name,
      termCount: p.term_count,
      newCount: p.new_count,
      promoteCandidates: p.promote_candidates,
      children: folderNodes(p.folders, null),
    })),
  }
}

/** 루트에서 ref 까지의 경로(루트 포함). 없으면 빈 배열. */
export function findPath(root: LevelNode, ref: LevelRef): LevelNode[] {
  const key = levelKey(ref)
  const walk = (node: LevelNode, acc: LevelNode[]): LevelNode[] | null => {
    const next = [...acc, node]
    if (levelKey(node.ref) === key) return next
    for (const c of node.children) {
      const hit = walk(c, next)
      if (hit) return hit
    }
    return null
  }
  return walk(root, []) ?? []
}

export function parentOf(root: LevelNode, ref: LevelRef): LevelNode | null {
  const path = findPath(root, ref)
  return path.length >= 2 ? path[path.length - 2] : null
}

export function childrenOf(root: LevelNode, ref: LevelRef): LevelNode[] {
  const path = findPath(root, ref)
  return path.length ? path[path.length - 1].children : []
}

/** candidate 가 current 기준으로 조상(up)·자기(current)·자손(down)·다른 가지(other)인지. */
export function relationTo(root: LevelNode, current: LevelRef, candidate: LevelRef): LevelRelation {
  const cur = levelKey(current)
  const cand = levelKey(candidate)
  if (cur === cand) return 'current'
  const curPath = findPath(root, current)
  if (curPath.some((n) => levelKey(n.ref) === cand)) return 'up'
  const candPath = findPath(root, candidate)
  if (candPath.some((n) => levelKey(n.ref) === cur)) return 'down'
  return 'other'
}

/**
 * 한 번 클릭 ⬆ 전에 물어야 하면 확인 문구, 아니면 null.
 * 전역으로 올리면 모든 프로젝트 회의에 퍼지고, 사람 파일 줄은 사람이 쓴 파일에서 빠지므로 묻는다.
 */
export function moveUpConfirmMessage(term: string, parent: LevelNode, fromHumanFile: boolean): string | null {
  const reasons: string[] = []
  if (parent.ref.type === 'global') reasons.push('전역(모든 프로젝트)으로 올리면 모든 회의 프롬프트에 들어갑니다.')
  if (fromHumanFile) reasons.push('사람이 작성한 도메인 파일의 용어라 그 파일에서 빠집니다.')
  if (reasons.length === 0) return null
  return `'${term}'을(를) '${parent.name}' 레벨로 올릴까요?\n${reasons.join('\n')}`
}
