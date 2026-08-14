import { describe, it, expect, vi, afterEach } from 'vitest'
import { sortAudioFilesByName, encodeWavPcm16, concatFloat32, mergeAudioFiles } from './audioMerge'

describe('sortAudioFilesByName', () => {
  it('파일명을 자연 정렬(natural sort) 순서로 정렬한다', () => {
    const files = [
      new File(['x'], 'part2.wav'),
      new File(['x'], 'part10.wav'),
      new File(['x'], 'part1.wav'),
    ]
    const sorted = sortAudioFilesByName(files)
    expect(sorted.map((f) => f.name)).toEqual(['part1.wav', 'part2.wav', 'part10.wav'])
  })

  it('원본 배열을 변경하지 않는다', () => {
    const files = [new File(['x'], 'b.wav'), new File(['x'], 'a.wav')]
    const original = [...files]
    sortAudioFilesByName(files)
    expect(files.map((f) => f.name)).toEqual(original.map((f) => f.name))
  })

  it('대소문자를 무시하고 정렬한다', () => {
    const files = [new File(['x'], 'B.wav'), new File(['x'], 'a.wav'), new File(['x'], 'C.wav')]
    const sorted = sortAudioFilesByName(files)
    expect(sorted.map((f) => f.name)).toEqual(['a.wav', 'B.wav', 'C.wav'])
  })
})

describe('concatFloat32', () => {
  it('여러 Float32Array를 순서대로 이어붙인다', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([4, 5])
    const c = new Float32Array([6])
    const result = concatFloat32([a, b, c])
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('빈 배열 목록에 대해 길이 0을 반환한다', () => {
    expect(concatFloat32([]).length).toBe(0)
  })
})

describe('encodeWavPcm16', () => {
  function readHeader(blob: Blob) {
    return blob.arrayBuffer().then((buf) => new DataView(buf))
  }

  it('RIFF/WAVE/fmt/data 매직 바이트와 필드를 정확히 쓴다', async () => {
    const samples = new Float32Array([0, 0.5, -0.5])
    const sampleRate = 16000
    const blob = encodeWavPcm16(samples, sampleRate)
    const view = await readHeader(blob)
    const decoder = new TextDecoder('ascii')

    expect(decoder.decode(new Uint8Array(view.buffer, 0, 4))).toBe('RIFF')
    expect(decoder.decode(new Uint8Array(view.buffer, 8, 4))).toBe('WAVE')
    expect(decoder.decode(new Uint8Array(view.buffer, 12, 4))).toBe('fmt ')
    expect(decoder.decode(new Uint8Array(view.buffer, 36, 4))).toBe('data')

    const dataSize = samples.length * 2
    expect(view.getUint32(4, true)).toBe(36 + dataSize) // RIFF chunk size
    expect(view.getUint32(16, true)).toBe(16) // fmt chunk size (PCM)
    expect(view.getUint16(20, true)).toBe(1) // PCM format
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(sampleRate)
    expect(view.getUint32(28, true)).toBe(sampleRate * 2) // byteRate = sampleRate * blockAlign
    expect(view.getUint16(32, true)).toBe(2) // blockAlign
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(view.getUint32(40, true)).toBe(dataSize)
  })

  it('샘플 N개에 대해 data 청크 길이가 2N 바이트다', async () => {
    const samples = new Float32Array(100).fill(0.1)
    const blob = encodeWavPcm16(samples, 16000)
    expect(blob.size).toBe(44 + 100 * 2)
  })

  it('범위를 벗어난 값(±1.5)을 int16 ±32767로 클램핑한다', async () => {
    const samples = new Float32Array([1.5, -1.5])
    const blob = encodeWavPcm16(samples, 16000)
    const buf = await blob.arrayBuffer()
    const view = new DataView(buf)
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32767)
  })

  it('왕복 값 검증: 인코딩한 샘플을 다시 읽으면 원래 값에 근접한다', async () => {
    const samples = new Float32Array([0, 0.25, -0.25, 1, -1])
    const blob = encodeWavPcm16(samples, 16000)
    const buf = await blob.arrayBuffer()
    const view = new DataView(buf)
    for (let i = 0; i < samples.length; i++) {
      const decoded = view.getInt16(44 + i * 2, true) / 0x7fff
      expect(decoded).toBeCloseTo(samples[i], 3)
    }
  })
})

describe('mergeAudioFiles', () => {
  type MockDecoded = { length: number; sampleRate: number; samples: Float32Array }
  let decodeScript: Array<MockDecoded | Error> = []
  let decodeCallIndex = 0

  function mockDecoded(samples: Float32Array, sampleRate = 16000): MockDecoded {
    return { length: samples.length, sampleRate, samples }
  }

  class MockAudioContext {
    async decodeAudioData(_buf: ArrayBuffer) {
      const result = decodeScript[decodeCallIndex++]
      if (result instanceof Error) throw result
      return {
        length: result.length,
        sampleRate: result.sampleRate,
        __samples: result.samples,
      } as unknown as AudioBuffer
    }
    async close() {}
  }

  type MockBufferSourceNode = {
    buffer: (AudioBuffer & { __samples: Float32Array }) | null
    connected: boolean
    started: boolean
    connect(this: MockBufferSourceNode, _dest?: unknown): void
    start(this: MockBufferSourceNode): void
  }

  class MockOfflineAudioContext {
    static constructorCalls: Array<{ channels: number; length: number; sampleRate: number }> = []
    private node: MockBufferSourceNode | null = null
    channels: number
    length: number
    sampleRate: number
    constructor(channels: number, length: number, sampleRate: number) {
      this.channels = channels
      this.length = length
      this.sampleRate = sampleRate
      MockOfflineAudioContext.constructorCalls.push({ channels, length, sampleRate })
    }
    createBufferSource(): MockBufferSourceNode {
      const node: MockBufferSourceNode = {
        buffer: null,
        connected: false,
        started: false,
        connect() {
          this.connected = true
        },
        start() {
          this.started = true
        },
      }
      this.node = node
      return node
    }
    async startRendering() {
      // 프로덕션 코드가 connect()·start()를 호출하지 않으면 렌더링이 실패해야 한다.
      if (!this.node || !this.node.connected || !this.node.started) {
        throw new Error('connect()/start()가 호출되지 않은 상태에서 startRendering() 호출됨')
      }
      const samples = this.node.buffer?.__samples ?? new Float32Array(0)
      return { getChannelData: (_ch: number) => samples }
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    decodeScript = []
    decodeCallIndex = 0
    MockOfflineAudioContext.constructorCalls = []
  })

  function stubWebAudio() {
    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext)
  }

  it('여러 파일을 순서대로 디코딩·연결하여 하나의 WAV File을 반환한다 (gapSeconds:0)', async () => {
    decodeScript = [
      mockDecoded(new Float32Array([0.1, 0.2, 0.3])),
      mockDecoded(new Float32Array([0.4, 0.5])),
    ]
    stubWebAudio()

    const files = [new File(['a'], 'a.wav'), new File(['b'], 'b.wav')]
    const result = await mergeAudioFiles(files, { gapSeconds: 0 })

    expect(result).toBeInstanceOf(File)
    expect(result.type).toBe('audio/wav')
    expect(result.name).toMatch(/^merged_2files_\d{8}-\d{4}\.wav$/)

    const buf = await result.arrayBuffer()
    const view = new DataView(buf)
    // data chunk에 5개 샘플(3+2)이 순서대로 들어있는지 확인
    const expected = [0.1, 0.2, 0.3, 0.4, 0.5].map((v) => Math.round(v * 32767))
    for (let i = 0; i < 5; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(expected[i])
    }
  })

  it('OfflineAudioContext 생성 인자(channels=1, sampleRate=16000, 리샘플 길이)를 검증한다', async () => {
    // 44100Hz 1초(44100 샘플) → 16000Hz 기준 targetLength = round(44100*16000/44100) = 16000
    decodeScript = [mockDecoded(new Float32Array(44100).fill(0.1), 44100)]
    stubWebAudio()

    await mergeAudioFiles([new File(['a'], 'a.wav')])

    expect(MockOfflineAudioContext.constructorCalls).toEqual([{ channels: 1, length: 16000, sampleRate: 16000 }])
  })

  it('부동소수 오차 없이 length/sampleRate 기반으로 targetLength를 반올림 계산한다', async () => {
    // length=1, sampleRate=3 → round(1*16000/3) = round(5333.33..) = 5333
    decodeScript = [mockDecoded(new Float32Array([0.1]), 3)]
    stubWebAudio()

    await mergeAudioFiles([new File(['a'], 'a.wav')])

    expect(MockOfflineAudioContext.constructorCalls[0]).toEqual({ channels: 1, length: 5333, sampleRate: 16000 })
  })

  it('각 파일 처리가 끝날 때마다 onProgress를 호출한다', async () => {
    decodeScript = [
      mockDecoded(new Float32Array([0.1])),
      mockDecoded(new Float32Array([0.2])),
      mockDecoded(new Float32Array([0.3])),
    ]
    stubWebAudio()

    const onProgress = vi.fn()
    const files = [new File(['a'], 'a.wav'), new File(['b'], 'b.wav'), new File(['c'], 'c.wav')]
    await mergeAudioFiles(files, { onProgress })

    expect(onProgress).toHaveBeenCalledTimes(3)
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3)
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3)
    expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3)
  })

  it('디코딩 실패 시 실패한 파일명을 포함한 에러를 던진다', async () => {
    decodeScript = [mockDecoded(new Float32Array([0.1])), new Error('bad data')]
    stubWebAudio()

    const files = [new File(['a'], 'good.wav'), new File(['b'], 'broken.wav')]
    await expect(mergeAudioFiles(files)).rejects.toThrow(/broken\.wav/)
  })

  it('리샘플링(OfflineAudioContext) 실패 시 실패한 파일명을 포함한 에러를 던진다', async () => {
    decodeScript = [mockDecoded(new Float32Array([0.1]))]
    stubWebAudio()

    class ThrowingOfflineAudioContext extends MockOfflineAudioContext {
      createBufferSource(): MockBufferSourceNode {
        throw new Error('offline context boom')
      }
    }
    vi.stubGlobal('OfflineAudioContext', ThrowingOfflineAudioContext)

    const files = [new File(['a'], 'resample-fail.wav')]
    await expect(mergeAudioFiles(files)).rejects.toThrow(/resample-fail\.wav/)
  })

  it('빈 녹음(0샘플) 파일은 스킵하고 나머지 파일만으로 병합한다', async () => {
    decodeScript = [
      mockDecoded(new Float32Array([0.1, 0.2])),
      { length: 0, sampleRate: 16000, samples: new Float32Array(0) },
      mockDecoded(new Float32Array([0.3])),
    ]
    stubWebAudio()

    const onProgress = vi.fn()
    const files = [new File(['a'], 'a.wav'), new File(['b'], 'empty.wav'), new File(['c'], 'c.wav')]
    const result = await mergeAudioFiles(files, { onProgress, gapSeconds: 0 })

    // 빈 파일도 onProgress는 호출되지만, OfflineAudioContext는 생성되지 않는다.
    expect(onProgress).toHaveBeenCalledTimes(3)
    expect(MockOfflineAudioContext.constructorCalls).toHaveLength(2)

    const buf = await result.arrayBuffer()
    const view = new DataView(buf)
    const dataSize = view.getUint32(40, true)
    expect(dataSize).toBe(3 * 2) // 0.1, 0.2, 0.3 → 빈 파일 샘플은 제외
    const expected = [0.1, 0.2, 0.3].map((v) => Math.round(v * 32767))
    for (let i = 0; i < 3; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(expected[i])
    }
  })

  it('모든 파일이 비어 있으면(0샘플) 에러를 던진다', async () => {
    decodeScript = [
      { length: 0, sampleRate: 16000, samples: new Float32Array(0) },
      { length: 0, sampleRate: 16000, samples: new Float32Array(0) },
    ]
    stubWebAudio()

    const files = [new File(['a'], 'empty1.wav'), new File(['b'], 'empty2.wav')]
    await expect(mergeAudioFiles(files)).rejects.toThrow(/비어/)
  })

  it('빈 배열이 주어지면 모든 파일이 비어 있는 경우와 동일한 에러를 던진다', async () => {
    stubWebAudio()
    await expect(mergeAudioFiles([])).rejects.toThrow(/비어/)
  })

  describe('gapSeconds (파일 사이 무음 구간)', () => {
    it('기본값(3초)만큼 두 파일 사이에 무음 구간을 삽입한다', async () => {
      const a = new Float32Array([0.1, 0.2])
      const b = new Float32Array([0.3, 0.4, 0.5])
      decodeScript = [mockDecoded(a), mockDecoded(b)]
      stubWebAudio()

      const files = [new File(['a'], 'a.wav'), new File(['b'], 'b.wav')]
      const result = await mergeAudioFiles(files) // gapSeconds 옵션 생략 → 기본값 3

      const buf = await result.arrayBuffer()
      const view = new DataView(buf)
      const gapSamples = 3 * 16000
      const dataSize = view.getUint32(40, true)
      expect(dataSize).toBe((a.length + gapSamples + b.length) * 2) // 총 샘플수 = a + gap*16000 + b

      // a의 샘플들이 먼저 그대로 기록된다
      expect(view.getInt16(44, true)).toBe(Math.round(0.1 * 32767))
      expect(view.getInt16(46, true)).toBe(Math.round(0.2 * 32767))
      // 무음 구간 경계값(첫·마지막 샘플)이 0인지 확인
      const gapStartByte = 44 + a.length * 2
      const gapEndByte = 44 + (a.length + gapSamples - 1) * 2
      expect(view.getInt16(gapStartByte, true)).toBe(0)
      expect(view.getInt16(gapEndByte, true)).toBe(0)
      // b의 샘플들이 무음 구간 다음에 그대로 이어진다
      const bStartByte = 44 + (a.length + gapSamples) * 2
      expect(view.getInt16(bStartByte, true)).toBe(Math.round(0.3 * 32767))
      expect(view.getInt16(bStartByte + 2, true)).toBe(Math.round(0.4 * 32767))
      expect(view.getInt16(bStartByte + 4, true)).toBe(Math.round(0.5 * 32767))
    })

    it('gapSeconds 옵션으로 무음 구간 길이를 조절할 수 있다', async () => {
      const a = new Float32Array([0.1])
      const b = new Float32Array([0.2])
      decodeScript = [mockDecoded(a), mockDecoded(b)]
      stubWebAudio()

      const gapSeconds = 0.5 // 8000 샘플
      const result = await mergeAudioFiles([new File(['a'], 'a.wav'), new File(['b'], 'b.wav')], { gapSeconds })

      const buf = await result.arrayBuffer()
      const view = new DataView(buf)
      const gapSamples = gapSeconds * 16000
      expect(view.getUint32(40, true)).toBe((1 + gapSamples + 1) * 2)
      expect(view.getInt16(44 + a.length * 2 + gapSamples * 2, true)).toBe(Math.round(0.2 * 32767))
    })

    it('gapSeconds=0이면 무음 구간 없이 기존처럼 바로 이어붙인다', async () => {
      const a = new Float32Array([0.1, 0.2])
      const b = new Float32Array([0.3])
      decodeScript = [mockDecoded(a), mockDecoded(b)]
      stubWebAudio()

      const result = await mergeAudioFiles([new File(['a'], 'a.wav'), new File(['b'], 'b.wav')], { gapSeconds: 0 })

      const buf = await result.arrayBuffer()
      const view = new DataView(buf)
      expect(view.getUint32(40, true)).toBe((a.length + b.length) * 2)
      expect(view.getInt16(44 + a.length * 2, true)).toBe(Math.round(0.3 * 32767))
    })

    it('N개 유효 파일에 대해 N-1개 무음 구간만 삽입한다 (앞뒤에는 없음)', async () => {
      const a = new Float32Array([0.1])
      const b = new Float32Array([0.2])
      const c = new Float32Array([0.3])
      decodeScript = [mockDecoded(a), mockDecoded(b), mockDecoded(c)]
      stubWebAudio()

      const gapSeconds = 1 // 16000 샘플
      const files = [new File(['a'], 'a.wav'), new File(['b'], 'b.wav'), new File(['c'], 'c.wav')]
      const result = await mergeAudioFiles(files, { gapSeconds })

      const buf = await result.arrayBuffer()
      const view = new DataView(buf)
      const gapSamples = 16000
      // 3개 파일 → 2개 구간
      expect(view.getUint32(40, true)).toBe((3 + gapSamples * 2) * 2)
    })

    it('스킵된 빈 파일은 무음 구간 계산에서 제외된다 (유효 파일 기준 N-1개)', async () => {
      const a = new Float32Array([0.1])
      const c = new Float32Array([0.3])
      decodeScript = [
        mockDecoded(a),
        { length: 0, sampleRate: 16000, samples: new Float32Array(0) }, // 스킵됨
        mockDecoded(c),
      ]
      stubWebAudio()

      const gapSeconds = 1 // 16000 샘플
      const files = [new File(['a'], 'a.wav'), new File(['b'], 'empty.wav'), new File(['c'], 'c.wav')]
      const result = await mergeAudioFiles(files, { gapSeconds })

      const buf = await result.arrayBuffer()
      const view = new DataView(buf)
      const gapSamples = 16000
      // 유효 파일은 a, c 2개 → 무음 구간은 1개만 (스킵된 파일 몫은 삽입되지 않음)
      expect(view.getUint32(40, true)).toBe((1 + gapSamples + 1) * 2)
      expect(view.getInt16(44, true)).toBe(Math.round(0.1 * 32767))
      expect(view.getInt16(44 + a.length * 2 + gapSamples * 2, true)).toBe(Math.round(0.3 * 32767))
    })
  })
})
