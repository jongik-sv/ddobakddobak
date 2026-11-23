import type { RunSummary, RunDetail, RunItem, Misrecognition, LevelInfo } from '../../../api/sttTermLearning'

export const lvl: LevelInfo = { type: 'Folder', id: 10, name: '생산회의', path: ['제강', '생산회의'] }

export function runSummary(o: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 1,
    meeting: { id: 219, title: '주간 회의', level: lvl },
    trigger: 'idle',
    status: 'done',
    registered_count: 2,
    skipped_count: 1,
    no_change: false,
    error: null,
    llm_skipped_reason: null,
    created_at: '2026-11-23T01:00:00Z',
    finished_at: '2026-11-23T01:01:00Z',
    ...o,
  }
}

export function runItem(o: Partial<RunItem> = {}): RunItem {
  return {
    id: 11,
    wrong: '우판',
    correct: '후판',
    source: 'llm_diff',
    verdict: 'registered',
    reason: '전사에 있음',
    domain_file: { id: 101, name: 'STT 오인식(자동)' },
    level: lvl,
    revert_result: null,
    ...o,
  }
}

export function runDetail(o: Partial<RunDetail> = {}): RunDetail {
  return {
    ...runSummary(),
    ai_generated_at: null,
    human_edited_at: null,
    diff: [
      { op: 'delete', text: '우판 생산' },
      { op: 'insert', text: '후판 생산' },
    ],
    items: [runItem(), runItem({ id: 12, wrong: '후반', verdict: 'skipped_not_in_transcript', domain_file: null, level: null })],
    ...o,
  }
}

export function mis(o: Partial<Misrecognition> = {}): Misrecognition {
  return {
    id: 1,
    wrong: '우판',
    correct: '후판',
    status: 'confirmed',
    hit_count: 14,
    meeting_ids: [219, 214, 198],
    registered: { domain_file_id: 101, term_key: 'k1', level: lvl },
    last_seen_at: '2026-11-22T00:00:00Z',
    ...o,
  }
}

export function httpError(status: number, body: unknown) {
  return Object.assign(new Error('http'), { response: { status, json: async () => body } })
}
