import type { TermRow, TreeResponse } from '../../../api/sttTermLearning'

export const treeFixture: TreeResponse = {
  global: { term_count: 5, new_count: 0 },
  projects: [{
    id: 1, name: 'TF', term_count: 9, new_count: 0, promote_candidates: [],
    folders: [
      { id: 10, name: '생산회의', parent_id: null, term_count: 3, new_count: 1, promote_candidates: [{ term: '산세라인', folder_ids: [11, 12] }] },
      { id: 11, name: '주간', parent_id: 10, term_count: 2, new_count: 0, promote_candidates: [] },
    ],
  }],
}

export function row(over: Partial<TermRow> & { n: number }): TermRow {
  const { n, ...rest } = over
  return {
    row_id: `r${n}`, term: `용어${n}`, key: `k${n}`, category: null, definition: null,
    mispronunciations: [`오${n}`],
    domain_file: { id: 100 + (n % 2), name: 'STT 오인식(자동)', auto: true },
    level: { type: 'Folder', id: 10, name: '생산회의', path: ['TF', '생산회의'] },
    source: 'auto', meeting_ids: [219], is_new: false, applied_meeting_count: 3,
    duplicate_group: null, merge_target: null, ...rest,
  }
}
