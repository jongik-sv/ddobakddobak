import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TranscriptFinalData } from '../channels/transcription'

/**
 * 인메모리 fs/path 모킹.
 *
 * vi.mock 팩토리는 호이스팅되어 파일 최상단보다 먼저 실행되므로, 팩토리가 참조하는
 * 가변 상태(files/dirs)는 vi.hoisted로 만들어야 한다(트랩 #1).
 */
const h = vi.hoisted(() => {
  /** 텍스트 파일: 절대경로 → 문자열 */
  const textFiles = new Map<string, string>()
  /** 바이너리 파일: 절대경로 → Uint8Array */
  const binFiles = new Map<string, Uint8Array>()
  /** 존재하는 디렉터리 절대경로 집합 */
  const dirs = new Set<string>()

  const APP_LOCAL = '/app-local'

  return { textFiles, binFiles, dirs, APP_LOCAL }
})

vi.mock('@tauri-apps/api/path', () => ({
  appLocalDataDir: async () => h.APP_LOCAL,
  // 실제 join은 OS 구분자를 쓰지만 테스트에선 단순 '/' 결합으로 충분
  join: async (...parts: string[]) => parts.join('/'),
}))

vi.mock('@tauri-apps/plugin-fs', () => {
  type WriteOpts = { append?: boolean }

  const isUnder = (path: string, dir: string) =>
    path === dir || path.startsWith(dir + '/')

  return {
    mkdir: async (path: string, _opts?: { recursive?: boolean }) => {
      // recursive 동작 모사: 부모 경로도 모두 등록. 이미 존재해도 no-op.
      const segs = path.split('/').filter((s) => s.length > 0)
      let acc = ''
      for (const seg of segs) {
        acc += '/' + seg
        h.dirs.add(acc)
      }
    },
    writeTextFile: async (path: string, data: string, opts?: WriteOpts) => {
      if (opts?.append) {
        h.textFiles.set(path, (h.textFiles.get(path) ?? '') + data)
      } else {
        h.textFiles.set(path, data)
      }
    },
    readTextFile: async (path: string) => {
      const v = h.textFiles.get(path)
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    },
    writeFile: async (path: string, data: Uint8Array) => {
      h.binFiles.set(path, data)
    },
    readFile: async (path: string) => {
      const v = h.binFiles.get(path)
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    },
    exists: async (path: string) =>
      h.dirs.has(path) || h.textFiles.has(path) || h.binFiles.has(path),
    readDir: async (path: string) => {
      const children = new Set<string>()
      for (const d of h.dirs) {
        if (d === path || !isUnder(d, path)) continue
        const rest = d.slice(path.length + 1)
        const name = rest.split('/')[0]
        if (name) children.add(name)
      }
      return [...children].map((name) => ({
        name,
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      }))
    },
    remove: async (path: string, _opts?: { recursive?: boolean }) => {
      for (const d of [...h.dirs]) if (isUnder(d, path)) h.dirs.delete(d)
      for (const f of [...h.textFiles.keys()]) if (isUnder(f, path)) h.textFiles.delete(f)
      for (const f of [...h.binFiles.keys()]) if (isUnder(f, path)) h.binFiles.delete(f)
    },
  }
})

import {
  appendAudio,
  appendSegment,
  createLocal,
  deleteLocal,
  getLocal,
  listLocal,
  markPendingSync,
  pcm16ToWav,
  setServerId,
} from './localStore'

beforeEach(() => {
  h.textFiles.clear()
  h.binFiles.clear()
  h.dirs.clear()
})

function seg(overrides: Partial<TranscriptFinalData> = {}): TranscriptFinalData {
  return {
    id: 1,
    content: '안녕하세요',
    speaker_label: '',
    started_at_ms: 0,
    ended_at_ms: 1000,
    sequence_number: 1,
    applied: false,
    ...overrides,
  }
}

describe('createLocal', () => {
  it('localId 형식이 local-<uuid> 이고 meta.json을 기록한다', async () => {
    const id = await createLocal({ title: '테스트 회의', lang: 'ko' })
    expect(id).toMatch(/^local-[0-9a-f-]{36}$/)

    const { meta } = await getLocal(id)
    expect(meta).toMatchObject({
      localId: id,
      title: '테스트 회의',
      lang: 'ko',
      status: 'recording',
      pendingSync: false,
    })
    expect(typeof meta.created_at).toBe('string')
    expect(new Date(meta.created_at).toISOString()).toBe(meta.created_at)
    expect(meta.serverId).toBeUndefined()
  })

  it('audio 디렉터리를 생성한다', async () => {
    const id = await createLocal({ title: 't', lang: 'ko' })
    expect(h.dirs.has(`${h.APP_LOCAL}/local-meetings/${id}/audio`)).toBe(true)
  })
})

describe('appendSegment / getLocal round-trip', () => {
  it('N개 세그먼트 append 후 순서대로 읽힌다', async () => {
    const id = await createLocal({ title: 't', lang: 'ko' })
    const segs = [
      seg({ id: 1, sequence_number: 1, content: '첫째' }),
      seg({ id: 2, sequence_number: 2, content: '둘째' }),
      seg({ id: 3, sequence_number: 3, content: '셋째' }),
    ]
    for (const s of segs) await appendSegment(id, s)

    const { segments } = await getLocal(id)
    expect(segments).toHaveLength(3)
    expect(segments.map((s) => s.content)).toEqual(['첫째', '둘째', '셋째'])
    expect(segments[0]).toEqual(segs[0])
    expect(segments[1].sequence_number).toBe(2)
  })

  it('jsonl이 줄 단위로 누적된다(덮어쓰기 아님)', async () => {
    const id = await createLocal({ title: 't', lang: 'ko' })
    await appendSegment(id, seg({ id: 1, sequence_number: 1 }))
    await appendSegment(id, seg({ id: 2, sequence_number: 2 }))

    const raw = h.textFiles.get(`${h.APP_LOCAL}/local-meetings/${id}/segments.jsonl`)
    expect(raw).toBeDefined()
    const lines = raw!.split('\n').filter((l: string) => l.length > 0)
    expect(lines).toHaveLength(2)
    // 각 줄이 독립 JSON
    expect(JSON.parse(lines[0]).sequence_number).toBe(1)
    expect(JSON.parse(lines[1]).sequence_number).toBe(2)
  })

  it('세그먼트가 없으면 빈 배열을 반환한다', async () => {
    const id = await createLocal({ title: 't', lang: 'ko' })
    const { segments } = await getLocal(id)
    expect(segments).toEqual([])
  })

  it('마지막 줄이 torn write(부분 기록)면 그 줄만 버리고 나머지는 보존(크래시 내성)', async () => {
    const id = await createLocal({ title: 't', lang: 'ko' })
    await appendSegment(id, seg({ id: 1, sequence_number: 1, content: '온전한 줄' }))
    // 부분 기록된 마지막 줄 직접 주입(개행 없는 깨진 JSON)
    const path = `${h.APP_LOCAL}/local-meetings/${id}/segments.jsonl`
    h.textFiles.set(path, h.textFiles.get(path)! + '{"id":2,"content":"잘린')

    const { segments } = await getLocal(id)
    expect(segments).toHaveLength(1)
    expect(segments[0].content).toBe('온전한 줄')
  })
})

describe('setServerId / markPendingSync', () => {
  it('setServerId가 serverId 기록 + pendingSync 해제', async () => {
    const id = await createLocal({ title: 't', lang: 'ko' })
    await markPendingSync(id, true)
    expect((await getLocal(id)).meta.pendingSync).toBe(true)

    await setServerId(id, 4242)
    const { meta } = await getLocal(id)
    expect(meta.serverId).toBe(4242)
    expect(meta.pendingSync).toBe(false)
  })

  it('markPendingSync 토글', async () => {
    const id = await createLocal({ title: 't', lang: 'ko' })
    await markPendingSync(id, true)
    expect((await getLocal(id)).meta.pendingSync).toBe(true)
    await markPendingSync(id, false)
    expect((await getLocal(id)).meta.pendingSync).toBe(false)
  })
})

describe('listLocal', () => {
  it('디렉터리가 없으면 빈 배열', async () => {
    expect(await listLocal()).toEqual([])
  })

  it('여러 회의를 created_at 오름차순으로 반환', async () => {
    const a = await createLocal({ title: 'A', lang: 'ko' })
    const b = await createLocal({ title: 'B', lang: 'en' })
    // created_at을 결정적으로 강제(동일 ms일 수 있으므로)
    const dirA = `${h.APP_LOCAL}/local-meetings/${a}/meta.json`
    const dirB = `${h.APP_LOCAL}/local-meetings/${b}/meta.json`
    const metaA = JSON.parse(h.textFiles.get(dirA)!)
    const metaB = JSON.parse(h.textFiles.get(dirB)!)
    metaA.created_at = '2026-01-01T00:00:00.000Z'
    metaB.created_at = '2026-02-01T00:00:00.000Z'
    h.textFiles.set(dirA, JSON.stringify(metaA))
    h.textFiles.set(dirB, JSON.stringify(metaB))

    const list = await listLocal()
    expect(list.map((m) => m.title)).toEqual(['A', 'B'])
  })
})

describe('deleteLocal', () => {
  it('회의 디렉터리/파일을 모두 제거', async () => {
    const id = await createLocal({ title: 't', lang: 'ko' })
    await appendSegment(id, seg())
    await appendAudio(id, 1, new Int16Array([1, 2, 3, 4]))
    expect((await listLocal()).length).toBe(1)

    await deleteLocal(id)
    expect(await listLocal()).toEqual([])
    expect(h.textFiles.size).toBe(0)
    expect(h.binFiles.size).toBe(0)
  })

  it('존재하지 않는 회의 삭제는 throw하지 않음', async () => {
    await expect(deleteLocal('local-nope')).resolves.toBeUndefined()
  })
})

describe('appendAudio / WAV 헤더', () => {
  it('audio/<seq>.wav 경로에 WAV 바이트를 기록한다', async () => {
    const id = await createLocal({ title: 't', lang: 'ko' })
    await appendAudio(id, 7, new Int16Array([0, 0, 0, 0]))
    const path = `${h.APP_LOCAL}/local-meetings/${id}/audio/7.wav`
    expect(h.binFiles.has(path)).toBe(true)
  })
})

describe('pcm16ToWav 헤더 바이트 정확성', () => {
  it('44바이트 캐논 헤더 + little-endian 필드', () => {
    const pcm = new Int16Array([0x0102, 0x0304, -1, 0x7fff]) // length 4 → dataSize 8
    const wav = pcm16ToWav(pcm)
    expect(wav.byteLength).toBe(44 + 8)

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    const ascii = (off: number, len: number) =>
      String.fromCharCode(...wav.subarray(off, off + len))

    expect(ascii(0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 8) // 44
    expect(ascii(8, 4)).toBe('WAVE')
    expect(ascii(12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16) // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000) // sample rate
    expect(view.getUint32(28, true)).toBe(32000) // byte rate
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(ascii(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(8) // data size
  })

  it('PCM 본문이 little-endian으로 보존된다', () => {
    const pcm = new Int16Array([0x0102, -1])
    const wav = pcm16ToWav(pcm)
    // 0x0102 → 02 01, -1(0xFFFF) → FF FF
    expect([...wav.subarray(44, 48)]).toEqual([0x02, 0x01, 0xff, 0xff])
  })

  it('subarray(뷰)도 올바른 본문을 기록한다(byteOffset 처리)', () => {
    const backing = new Int16Array([0x1111, 0x0102, 0x0304])
    const sub = backing.subarray(1) // byteOffset != 0
    const wav = pcm16ToWav(sub)
    expect(wav.byteLength).toBe(44 + 4)
    expect([...wav.subarray(44, 48)]).toEqual([0x02, 0x01, 0x04, 0x03])
  })
})
