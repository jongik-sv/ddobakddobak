import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TranscriptFinalData } from '../channels/transcription'
import { enqueue, flush, flushAll } from './syncQueue'
import {
  getLocal,
  setServerId,
  markPendingSync,
  listLocal,
  mergeLocalAudio,
} from './localStore'
import { createMeeting, getMeeting, bulkCreateTranscripts, promoteAudio } from '../api/meetings'

vi.mock('./localStore', () => ({
  getLocal: vi.fn(),
  setServerId: vi.fn(),
  markPendingSync: vi.fn(),
  listLocal: vi.fn(),
  mergeLocalAudio: vi.fn(),
}))

vi.mock('../api/meetings', () => ({
  createMeeting: vi.fn(),
  getMeeting: vi.fn(),
  bulkCreateTranscripts: vi.fn(),
  promoteAudio: vi.fn(),
}))

const mGetLocal = vi.mocked(getLocal)
const mSetServerId = vi.mocked(setServerId)
const mMarkPendingSync = vi.mocked(markPendingSync)
const mListLocal = vi.mocked(listLocal)
const mMergeAudio = vi.mocked(mergeLocalAudio)
const mCreateMeeting = vi.mocked(createMeeting)
const mGetMeeting = vi.mocked(getMeeting)
const mBulkCreate = vi.mocked(bulkCreateTranscripts)
const mPromoteAudio = vi.mocked(promoteAudio)

// --- localStore가 반환하는 형태(계약 가정). 모킹이므로 여기서 형태만 맞춘다. ---
interface LocalMeta {
  localId: string
  title: string
  lang: string
  status: string
  pendingSync: boolean
  created_at: string
  serverId?: number
}
interface LocalRecord {
  meta: LocalMeta
  segments: TranscriptFinalData[]
}

function makeSegment(over: Partial<TranscriptFinalData> = {}): TranscriptFinalData {
  return {
    id: 1,
    content: '안녕하세요',
    speaker_label: '',
    started_at_ms: 0,
    ended_at_ms: 1000,
    sequence_number: 1,
    applied: false,
    ...over,
  }
}

function makeRecord(over: Partial<LocalMeta> = {}): LocalRecord {
  return {
    meta: {
      localId: 'local-abc',
      title: '로컬 회의',
      lang: 'ko',
      status: 'completed',
      pendingSync: true,
      created_at: '2026-06-01T00:00:00.000Z',
      ...over,
    },
    segments: [
      makeSegment({ id: 1, sequence_number: 1, content: '첫째' }),
      makeSegment({ id: 2, sequence_number: 2, content: '둘째' }),
    ],
  }
}

// createMeeting은 Meeting을 반환하지만 syncQueue는 .id만 읽으므로 최소 형태로 캐스팅
function fakeMeeting(id: number) {
  return { id } as Awaited<ReturnType<typeof createMeeting>>
}

beforeEach(() => {
  vi.clearAllMocks()
  // getLocal/listLocal/setServerId/markPendingSync은 Promise 반환 — 모킹 타입을 느슨히 처리
  mSetServerId.mockResolvedValue(undefined as never)
  mMarkPendingSync.mockResolvedValue(undefined as never)
  mBulkCreate.mockResolvedValue(undefined)
  // 오디오 프로모트 기본값: 오디오 없음 + 서버 미보유 → 대부분 테스트는 업로드 스킵.
  mMergeAudio.mockResolvedValue(null as never)
  mGetMeeting.mockResolvedValue({ has_audio_file: false } as never)
  mPromoteAudio.mockResolvedValue(undefined as never)
})

// getLocal/listLocal는 실제 반환 타입이 이 테스트의 LocalRecord/LocalMeta와 정확히
// 일치하지 않을 수 있으므로(타입은 sibling localStore 소유) 모킹 시 캐스팅한다.
function resolveGetLocal(rec: LocalRecord) {
  mGetLocal.mockResolvedValue(rec as never)
}
function resolveListLocal(metas: LocalMeta[]) {
  mListLocal.mockResolvedValue(metas as never)
}

describe('enqueue', () => {
  it('pendingSync=true 로 마킹한다', () => {
    enqueue('local-xyz')
    expect(mMarkPendingSync).toHaveBeenCalledWith('local-xyz', true)
  })
})

describe('flush — serverId 없음', () => {
  it('createMeeting 호출 + setServerId 매핑 + bulkCreateTranscripts 전송 + pendingSync 해제', async () => {
    resolveGetLocal(makeRecord({ serverId: undefined }))
    mCreateMeeting.mockResolvedValue(fakeMeeting(42))

    const res = await flush('local-abc')

    expect(mCreateMeeting).toHaveBeenCalledWith({ title: '로컬 회의' })
    expect(mSetServerId).toHaveBeenCalledWith('local-abc', 42)
    expect(mBulkCreate).toHaveBeenCalledWith(
      42,
      expect.arrayContaining([
        expect.objectContaining({ sequence_number: 1, content: '첫째' }),
        expect.objectContaining({ sequence_number: 2, content: '둘째' }),
      ]),
    )
    // 매핑 시 BulkTranscriptItem 으로 변환 — id/applied는 제외
    const sent = mBulkCreate.mock.calls[0][1]
    expect(sent[0]).not.toHaveProperty('id')
    expect(sent[0]).not.toHaveProperty('applied')
    expect(mMarkPendingSync).toHaveBeenCalledWith('local-abc', false)
    expect(res).toEqual({ ok: true, serverId: 42 })
  })
})

describe('flush — 이미 serverId 있음', () => {
  it('createMeeting 미호출, 기존 serverId 로 bulk 전송', async () => {
    resolveGetLocal(makeRecord({ serverId: 7 }))

    const res = await flush('local-abc')

    expect(mCreateMeeting).not.toHaveBeenCalled()
    expect(mSetServerId).not.toHaveBeenCalled()
    expect(mBulkCreate).toHaveBeenCalledWith(7, expect.any(Array))
    expect(mMarkPendingSync).toHaveBeenCalledWith('local-abc', false)
    expect(res).toEqual({ ok: true, serverId: 7 })
  })
})

describe('flush — 오디오 프로모트', () => {
  const fakeMerged = {
    bytes: new Uint8Array([1, 2, 3, 4]),
    segmentOffsetsMs: [0],
    durationMs: 1000,
  }

  it('서버에 오디오 없고 로컬 병합 오디오 있으면 promoteAudio(WAV)를 serverId로 1회 호출', async () => {
    resolveGetLocal(makeRecord({ serverId: 7 }))
    mGetMeeting.mockResolvedValue({ has_audio_file: false } as never)
    mMergeAudio.mockResolvedValue(fakeMerged as never)

    const res = await flush('local-abc')

    expect(mPromoteAudio).toHaveBeenCalledTimes(1)
    const [calledId, blob] = mPromoteAudio.mock.calls[0]
    expect(calledId).toBe(7)
    expect(blob).toBeInstanceOf(Blob)
    expect((blob as Blob).type).toBe('audio/wav')
    expect(mMarkPendingSync).toHaveBeenCalledWith('local-abc', false)
    expect(res).toEqual({ ok: true, serverId: 7 })
  })

  it('서버가 이미 오디오를 보유하면(has_audio_file=true) merge/업로드 둘 다 스킵(중복 방지)', async () => {
    resolveGetLocal(makeRecord({ serverId: 7 }))
    mGetMeeting.mockResolvedValue({ has_audio_file: true } as never)
    mMergeAudio.mockResolvedValue(fakeMerged as never)

    await flush('local-abc')

    expect(mMergeAudio).not.toHaveBeenCalled()
    expect(mPromoteAudio).not.toHaveBeenCalled()
  })

  it('로컬 오디오가 없으면(mergeLocalAudio=null) promoteAudio 미호출', async () => {
    resolveGetLocal(makeRecord({ serverId: 7 }))
    mGetMeeting.mockResolvedValue({ has_audio_file: false } as never)
    mMergeAudio.mockResolvedValue(null as never)

    await flush('local-abc')

    expect(mPromoteAudio).not.toHaveBeenCalled()
  })

  it('promoteAudio 실패 → pendingSync 유지(재시도) + ok:false', async () => {
    resolveGetLocal(makeRecord({ serverId: 7 }))
    mGetMeeting.mockResolvedValue({ has_audio_file: false } as never)
    mMergeAudio.mockResolvedValue(fakeMerged as never)
    mPromoteAudio.mockRejectedValue(new Error('upload failed'))

    const res = await flush('local-abc')

    expect(res).toEqual({ ok: false })
    expect(mMarkPendingSync).not.toHaveBeenCalledWith('local-abc', false)
  })

  it('두 번째 flush(서버가 오디오 보유 상태)는 재업로드하지 않는다', async () => {
    resolveGetLocal(makeRecord({ serverId: 7 }))
    mMergeAudio.mockResolvedValue(fakeMerged as never)
    mGetMeeting.mockResolvedValueOnce({ has_audio_file: false } as never)

    await flush('local-abc')
    expect(mPromoteAudio).toHaveBeenCalledTimes(1)

    // 이후 서버가 오디오 보유 → 재업로드 없음
    mGetMeeting.mockResolvedValue({ has_audio_file: true } as never)
    await flush('local-abc')
    expect(mPromoteAudio).toHaveBeenCalledTimes(1)
  })

  it('신규 회의(createMeeting) → has_audio_file 미정이라 업로드 시도', async () => {
    resolveGetLocal(makeRecord({ serverId: undefined }))
    mCreateMeeting.mockResolvedValue(fakeMeeting(99))
    mMergeAudio.mockResolvedValue(fakeMerged as never)

    await flush('local-abc')

    expect(mGetMeeting).not.toHaveBeenCalled() // 신규는 createMeeting 결과만 사용
    expect(mPromoteAudio).toHaveBeenCalledTimes(1)
    expect(mPromoteAudio.mock.calls[0][0]).toBe(99)
  })
})

describe('flush — 실패 시 pendingSync 유지', () => {
  it('bulk 실패 → pendingSync 를 false 로 안 바꾸고 false 반환', async () => {
    resolveGetLocal(makeRecord({ serverId: 7 }))
    mBulkCreate.mockRejectedValue(new Error('network'))

    const res = await flush('local-abc')

    expect(res).toEqual({ ok: false })
    expect(mMarkPendingSync).not.toHaveBeenCalledWith('local-abc', false)
  })

  it('createMeeting 실패 → false 반환 + serverId 매핑/전송 없음', async () => {
    resolveGetLocal(makeRecord({ serverId: undefined }))
    mCreateMeeting.mockRejectedValue(new Error('offline'))

    const res = await flush('local-abc')

    expect(res).toEqual({ ok: false })
    expect(mSetServerId).not.toHaveBeenCalled()
    expect(mBulkCreate).not.toHaveBeenCalled()
    expect(mMarkPendingSync).not.toHaveBeenCalledWith('local-abc', false)
  })

  it('getLocal 이 reject(회의 없음) → false 반환', async () => {
    mGetLocal.mockRejectedValue(new Error('ENOENT'))
    const res = await flush('missing')
    expect(res).toEqual({ ok: false })
    expect(mCreateMeeting).not.toHaveBeenCalled()
  })
})

describe('flushAll', () => {
  it('pendingSync=true 인 회의만 flush 시도한다', async () => {
    resolveListLocal([
      { localId: 'local-1', title: 'A', lang: 'ko', status: 'completed', pendingSync: true, created_at: '2026-01-01T00:00:00.000Z', serverId: 11 },
      { localId: 'local-2', title: 'B', lang: 'ko', status: 'completed', pendingSync: false, created_at: '2026-01-02T00:00:00.000Z', serverId: 12 },
      { localId: 'local-3', title: 'C', lang: 'ko', status: 'completed', pendingSync: true, created_at: '2026-01-03T00:00:00.000Z', serverId: 13 },
    ])
    // flush 내부의 getLocal — localId 별 반환
    mGetLocal.mockImplementation(((id: string) => {
      if (id === 'local-1') return Promise.resolve(makeRecord({ localId: 'local-1', serverId: 11 }))
      if (id === 'local-3') return Promise.resolve(makeRecord({ localId: 'local-3', serverId: 13 }))
      return Promise.reject(new Error('ENOENT'))
    }) as never)

    await flushAll()

    // pendingSync=true 두 건만 전송
    expect(mBulkCreate).toHaveBeenCalledTimes(2)
    expect(mBulkCreate).toHaveBeenCalledWith(11, expect.any(Array))
    expect(mBulkCreate).toHaveBeenCalledWith(13, expect.any(Array))
    // pendingSync=false 인 local-2 는 건드리지 않음
    expect(mGetLocal).not.toHaveBeenCalledWith('local-2')
  })

  it('pending 회의가 없으면 아무 것도 안 한다', async () => {
    resolveListLocal([
      { localId: 'local-2', title: 'B', lang: 'ko', status: 'completed', pendingSync: false, created_at: '2026-01-02T00:00:00.000Z', serverId: 12 },
    ])
    await flushAll()
    expect(mGetLocal).not.toHaveBeenCalled()
    expect(mBulkCreate).not.toHaveBeenCalled()
  })
})
