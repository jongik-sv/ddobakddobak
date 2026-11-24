import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn()
const post = vi.fn()
const put = vi.fn()
const patch = vi.fn()
vi.mock('./client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
}))

import {
  applyMoves, getTerms, getAiOriginal, getTree, getImpact, deleteTerms, getSettings, updateSettings,
  getRuns, getRun, revertRun, rerunRun, analyzeMeeting, registerItem, getMisrecognitions, updateMisrecognition,
} from './sttTermLearning'

const ok = (v: unknown) => ({ json: () => Promise.resolve(v) })

beforeEach(() => {
  ;[get, post, put, patch].forEach((m) => m.mockReset())
})

describe('sttTermLearning api', () => {
  it('applyMoves 는 admin/stt_term_learning/moves 로 POST', async () => {
    post.mockReturnValue(ok({ moved: 1, merged: 0 }))
    const moves = [{ domain_file_id: 3, term_keys: ['후판'], target: { type: 'Project' as const, id: 1 } }]
    const r = await applyMoves(moves)
    expect(post).toHaveBeenCalledWith('admin/stt_term_learning/moves', { json: { moves } })
    expect(r).toEqual({ moved: 1, merged: 0 })
  })

  it('getTerms 는 level 을 level_type/level_id/include_descendants searchParams 로', async () => {
    get.mockReturnValue(ok({ terms: [] }))
    await getTerms({ level: { type: 'Folder', id: 7 }, includeDescendants: true })
    expect(get).toHaveBeenCalledWith('admin/stt_term_learning/terms', {
      searchParams: { level_type: 'Folder', level_id: '7', include_descendants: '1' },
    })
  })

  it('getTerms 는 인자 없으면 searchParams 비어 있음, global 은 level_id 생략', async () => {
    get.mockReturnValue(ok({ terms: [] }))
    await getTerms()
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/terms', { searchParams: {} })
    await getTerms({ level: { type: 'global', id: null } })
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/terms', { searchParams: { level_type: 'global' } })
  })

  it('getAiOriginal 은 meetings/:id/ai_original GET', async () => {
    get.mockReturnValue(ok({ available: false, ai_generated_at: null, human_edited_at: null, diff: [] }))
    const r = await getAiOriginal(12)
    expect(get).toHaveBeenCalledWith('meetings/12/ai_original')
    expect(r.available).toBe(false)
  })

  it('나머지 엔드포인트 경로·메서드', async () => {
    get.mockReturnValue(ok({ runs: [], run: {}, misrecognitions: [], enabled: true }))
    post.mockReturnValue(ok({ counts: [], deleted: 0, run: {}, item: {} }))
    put.mockReturnValue(ok({ enabled: true, idle_minutes: 30, min_confidence: 0.6 }))
    patch.mockReturnValue(ok({ misrecognition: {} }))

    await getTree()
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/tree')
    await getImpact([{ level: { type: 'global', id: null } }])
    expect(post).toHaveBeenLastCalledWith('admin/stt_term_learning/impact', { json: { targets: [{ level: { type: 'global', id: null } }] } })
    await deleteTerms([{ domain_file_id: 1, term_key: 'a' }])
    expect(post).toHaveBeenLastCalledWith('admin/stt_term_learning/terms/delete', { json: { items: [{ domain_file_id: 1, term_key: 'a' }] } })
    await getSettings()
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/settings')
    await updateSettings({ enabled: true, idle_minutes: 30, min_confidence: 0.6 })
    expect(put).toHaveBeenLastCalledWith('admin/stt_term_learning/settings', { json: { enabled: true, idle_minutes: 30, min_confidence: 0.6 } })
    await getRuns('failed')
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/runs', { searchParams: { status: 'failed' } })
    await getRuns()
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/runs', { searchParams: {} })
    await getRun(5)
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/runs/5')
    await revertRun(5)
    expect(post).toHaveBeenLastCalledWith('admin/stt_term_learning/runs/5/revert')
    await rerunRun(5)
    expect(post).toHaveBeenLastCalledWith('admin/stt_term_learning/runs/5/rerun')
    await analyzeMeeting(9)
    expect(post).toHaveBeenLastCalledWith('admin/stt_term_learning/meetings/9/analyze')
    await registerItem(5, 8)
    expect(post).toHaveBeenLastCalledWith('admin/stt_term_learning/runs/5/items/8/register')
    await getMisrecognitions({ status: 'undecided', q: '100%' })
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/misrecognitions', { searchParams: { status: 'undecided', q: '100%' } })
    await updateMisrecognition(3, { status: 'confirmed', correct: '후판' })
    expect(patch).toHaveBeenLastCalledWith('admin/stt_term_learning/misrecognitions/3', { json: { status: 'confirmed', correct: '후판' } })
  })
})

describe('sttTermLearning api project_id', () => {
  it('tree·terms·runs·misrecognitions 가 project_id 를 실어 보내고, 없으면 싣지 않는다', async () => {
    get.mockReturnValue(ok({}))
    await getTree(5)
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/tree', { searchParams: { project_id: '5' } })
    await getTree()
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/tree')
    await getTerms({ projectId: 5 })
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/terms', { searchParams: { project_id: '5' } })
    await getRuns('done', 5)
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/runs', { searchParams: { status: 'done', project_id: '5' } })
    await getMisrecognitions({ projectId: 5 })
    expect(get).toHaveBeenLastCalledWith('admin/stt_term_learning/misrecognitions', { searchParams: { project_id: '5' } })
  })
})
