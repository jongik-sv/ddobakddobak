/**
 * 다중 음성 파일을 하나의 WAV(16kHz mono, 16-bit PCM)로 병합하는 유틸리티.
 */

const MERGE_SAMPLE_RATE = 16000

/** 파일명을 자연 정렬(natural sort) 기준으로 정렬한다. 원본 배열은 변경하지 않는다. */
export function sortAudioFilesByName(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

/** Float32 샘플 배열들을 순서대로 이어붙인다. */
export function concatFloat32(arrays: Float32Array[]): Float32Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Float32Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

function writeWavHeader(view: DataView, sampleRate: number, dataSize: number): void {
  const numChannels = 1
  const bitsPerSample = 16
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size (PCM)
  view.setUint16(20, 1, true) // audio format = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)
}

/** Float32 샘플(mono, [-1, 1])을 view의 byteOffset 위치부터 16-bit PCM으로 순서대로 기록한다. */
function writeInt16Samples(view: DataView, byteOffset: number, samples: Float32Array): void {
  let offset = byteOffset
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, Math.round(clamped * 0x7fff), true)
    offset += 2
  }
}

/** Float32 PCM 샘플(mono, [-1, 1])을 16-bit PCM WAV Blob으로 인코딩한다. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  writeWavHeader(view, sampleRate, dataSize)
  writeInt16Samples(view, 44, samples)
  return new Blob([buffer], { type: 'audio/wav' })
}

function formatTimestamp(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}${mm}${dd}-${hh}${min}`
}

/** 오디오 파일 배열을 디코딩·리샘플링(16kHz mono)·연결하여 하나의 WAV 파일로 병합한다. */
export async function mergeAudioFiles(
  files: File[],
  opts?: { onProgress?: (done: number, total: number) => void; gapSeconds?: number },
): Promise<File> {
  const total = files.length
  const gapSamples = Math.max(0, Math.round((opts?.gapSeconds ?? 3) * MERGE_SAMPLE_RATE))
  const AudioContextCtor =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioContext = new AudioContextCtor()

  try {
    // 파일별로 리샘플 직후 16-bit PCM 바이트로 즉시 변환해 float 중간 산출물을 최소화한다.
    // (float 전체 concat + WAV 버퍼가 동시에 상주하면 장시간 녹음에서 메모리 피크가 커짐)
    // 파일 사이 무음 구간은 실제 바이트를 만들지 않고 최종 버퍼 기록 시 오프셋만 건너뛴다
    // (ArrayBuffer는 0으로 초기화되므로 그 구간이 곧 무음이다).
    const pcmChunks: Array<{ leadingGapSamples: number; bytes: Uint8Array }> = []
    let totalSamples = 0
    let hasValidFile = false

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      let decoded: AudioBuffer
      try {
        const arrayBuffer = await file.arrayBuffer()
        decoded = await audioContext.decodeAudioData(arrayBuffer)
      } catch (err) {
        throw new Error(
          `오디오 파일을 디코딩하지 못했습니다: ${file.name} (${err instanceof Error ? err.message : String(err)})`,
        )
      }

      if (decoded.length === 0) {
        // 빈 녹음(0샘플)은 무음이라 손실 없이 건너뛴다. 스킵된 파일은 무음 구간 계산에서도 제외된다.
        opts?.onProgress?.(i + 1, total)
        continue
      }

      try {
        const targetLength = Math.round((decoded.length * MERGE_SAMPLE_RATE) / decoded.sampleRate)
        const offlineContext = new OfflineAudioContext(1, targetLength, MERGE_SAMPLE_RATE)
        const source = offlineContext.createBufferSource()
        source.buffer = decoded
        source.connect(offlineContext.destination)
        source.start()
        const rendered = await offlineContext.startRendering()
        const resampled = rendered.getChannelData(0)

        const bytes = new Uint8Array(resampled.length * 2)
        writeInt16Samples(new DataView(bytes.buffer), 0, resampled)

        // 유효 파일 사이에만 무음 구간을 둔다 (첫 유효 파일 앞에는 없음, N개 유효 파일 → N-1개 구간).
        const leadingGapSamples = hasValidFile ? gapSamples : 0
        pcmChunks.push({ leadingGapSamples, bytes })
        totalSamples += leadingGapSamples + resampled.length
        hasValidFile = true
      } catch (err) {
        throw new Error(
          `오디오 파일을 리샘플링하지 못했습니다: ${file.name} (${err instanceof Error ? err.message : String(err)})`,
        )
      }

      opts?.onProgress?.(i + 1, total)
    }

    if (totalSamples === 0) {
      throw new Error('모든 파일이 비어 있습니다.')
    }

    const dataSize = totalSamples * 2
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)
    writeWavHeader(view, MERGE_SAMPLE_RATE, dataSize)
    const bytesView = new Uint8Array(buffer)
    let byteOffset = 44
    for (const chunk of pcmChunks) {
      byteOffset += chunk.leadingGapSamples * 2 // 이미 0으로 초기화된 구간이므로 건너뛰기만 하면 된다
      bytesView.set(chunk.bytes, byteOffset)
      byteOffset += chunk.bytes.length
    }

    const wavBlob = new Blob([buffer], { type: 'audio/wav' })
    const name = `merged_${total}files_${formatTimestamp(new Date())}.wav`
    return new File([wavBlob], name, { type: 'audio/wav' })
  } finally {
    await audioContext.close()
  }
}
