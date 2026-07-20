import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn()
const post = vi.fn()
const put = vi.fn()
vi.mock('./client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
  },
}))

import {
  getDflowSettings,
  updateDflowSettings,
  uploadToDflow,
  getDflowStatus,
  setDflowLink,
  claimDflowMinute,
  listDflowMinutes,
  getDflowMeta,
} from './dflow'

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  put.mockReset()
})

describe('getDflowSettings/updateDflowSettings', () => {
  it('GETs settings/dflow', async () => {
    get.mockReturnValue({ json: () => Promise.resolve({ enabled: true, base_url: 'https://x', api_secret_masked: 'abcd...wxyz' }) })
    const result = await getDflowSettings()
    expect(get).toHaveBeenCalledWith('settings/dflow')
    expect(result.enabled).toBe(true)
  })

  it('PUTs only provided fields', async () => {
    put.mockReturnValue({ json: () => Promise.resolve({ enabled: true, base_url: 'https://x', api_secret_masked: 'abcd...wxyz' }) })
    await updateDflowSettings({ enabled: true })
    expect(put).toHaveBeenCalledWith('settings/dflow', { json: { enabled: true } })
  })
})

describe('uploadToDflow', () => {
  it('maps teamOverride/titleOverride to team/title body', async () => {
    post.mockReturnValue({ json: () => Promise.resolve({ public_uid: 'u1', dflow_synced_at: 't', dflow_url: 'url', needs_resync: false }) })
    await uploadToDflow(5, { teamOverride: 'PMO', titleOverride: '제목' })
    expect(post).toHaveBeenCalledWith('meetings/5/dflow/upload', { json: { team: 'PMO', title: '제목' } })
  })

  it('omits undefined overrides', async () => {
    post.mockReturnValue({ json: () => Promise.resolve({ public_uid: null, dflow_synced_at: null, dflow_url: null, needs_resync: false }) })
    await uploadToDflow(5)
    expect(post).toHaveBeenCalledWith('meetings/5/dflow/upload', { json: {} })
  })
})

describe('getDflowStatus', () => {
  it('GETs status endpoint', async () => {
    get.mockReturnValue({ json: () => Promise.resolve({ public_uid: null, dflow_synced_at: null, dflow_url: null, needs_resync: false }) })
    await getDflowStatus(5)
    expect(get).toHaveBeenCalledWith('meetings/5/dflow/status')
  })
})

describe('setDflowLink', () => {
  it('PUTs public_uid (해제 시 null)', async () => {
    put.mockReturnValue({ json: () => Promise.resolve({ public_uid: null, dflow_synced_at: null, dflow_url: null, needs_resync: false }) })
    await setDflowLink(5, null)
    expect(put).toHaveBeenCalledWith('meetings/5/dflow/link', { json: { public_uid: null } })
  })
})

describe('claimDflowMinute', () => {
  it('POSTs minute_id', async () => {
    post.mockReturnValue({ json: () => Promise.resolve({ public_uid: 'u1', dflow_synced_at: null, dflow_url: 'url', needs_resync: false }) })
    await claimDflowMinute(5, 'minute-uuid')
    expect(post).toHaveBeenCalledWith('meetings/5/dflow/claim', { json: { minute_id: 'minute-uuid' } })
  })
})

describe('listDflowMinutes', () => {
  it('builds searchParams from provided filters only', async () => {
    get.mockReturnValue({ json: () => Promise.resolve({ items: [], total: 0, page: 1, per_page: 20 }) })
    await listDflowMinutes({ team: 'PMO', linked: false })
    expect(get).toHaveBeenCalledWith('dflow/minutes', { searchParams: { team: 'PMO', linked: false } })
  })
})

describe('getDflowMeta', () => {
  it('GETs meta without project_id', async () => {
    get.mockReturnValue({ json: () => Promise.resolve({ teams: [], projects: [], limits: {} }) })
    await getDflowMeta()
    expect(get).toHaveBeenCalledWith('dflow/meta', { searchParams: {} })
  })

  it('GETs meta with project_id', async () => {
    get.mockReturnValue({ json: () => Promise.resolve({ teams: [], projects: [], limits: {} }) })
    await getDflowMeta('proj-1')
    expect(get).toHaveBeenCalledWith('dflow/meta', { searchParams: { project_id: 'proj-1' } })
  })
})
