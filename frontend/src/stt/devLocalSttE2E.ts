/**
 * 온디바이스 로컬 STT 파이프라인 end-to-end 검증(에뮬/기기). 실제 모듈
 * (localStore + SileroVad + SegmentAccumulator + Tauri invoke)을 그대로 엮어
 * fixture PCM → VAD 청킹 → stt_transcribe → localStore 영속 → 읽기검증까지 한 번에 돈다.
 * 에뮬엔 마이크가 없으므로 fixture(public/ko-fixture.wav)로 파이프라인을 구동한다.
 *
 * main.tsx에서 window.__localSttE2E로 노출(TEMP, 검증 후 제거 — auto-decisions A14).
 */
import { invoke } from '@tauri-apps/api/core'

import { SegmentAccumulator } from './chunker'
import { SileroVad } from './sileroVad'
import { loadSileroVad } from './sileroVadLoader'
import { DEFAULT_AUDIO_CONFIG, chunkerOptsFromAudioConfig } from './vadConfig'
import { cutEosLeak, rms, RMS_GATE } from './postprocess'
import * as localStore from './localStore'
import type { TranscriptFinalData } from '../channels/transcription'

/** RIFF/WAVE(PCM16 mono 16k) ArrayBuffer → Float32([-1,1]). FLLR 등 패딩 청크 스킵. */
function decodeWav16kMono(buf: ArrayBuffer): Float32Array {
  const b = new Uint8Array(buf)
  const dv = new DataView(buf)
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new Error('not RIFF/WAVE')
  let pos = 12
  while (pos + 8 <= b.length) {
    const id = ascii(pos, 4)
    const sz = dv.getUint32(pos + 4, true)
    const body = pos + 8
    if (id === 'data') {
      const out = new Float32Array(sz / 2)
      for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(body + i * 2, true) / 32768
      return out
    }
    pos = body + sz + (sz & 1)
  }
  throw new Error('no data chunk')
}

export interface LocalSttE2EResult {
  ok: boolean
  localId?: string
  segments?: number
  texts?: string[]
  persisted?: number
  loadMs?: number
  transcribeMsTotal?: number
  error?: string
}

/**
 * fixture로 로컬 STT 전 파이프라인을 1회 구동한다.
 * @param fixtureUrl public 경로(예: '/ko-fixture.wav')
 * @param language Cohere 언어(예: 'ko')
 */
export async function runLocalSttE2E(
  fixtureUrl = '/ko-fixture.wav',
  language = 'ko',
): Promise<LocalSttE2EResult> {
  try {
    // 1. 모델 경로 해석(샌드박스에 이미 복사돼 있어야 함 — ensure_cohere_model 선행).
    const paths = await invoke<{ dir: string }>('resolve_model_paths')
    const t0 = performance.now()
    await invoke('stt_load', { modelDir: paths.dir, language })
    const loadMs = Math.round(performance.now() - t0)

    // 2. fixture 로드 → Float32 16k.
    const buf = await (await fetch(fixtureUrl)).arrayBuffer()
    const pcm = decodeWav16kMono(buf)

    // 3. 로컬 회의 생성(진실원천).
    const localId = await localStore.createLocal({ title: 'E2E 검증 회의', lang: language })

    // 4. 실제 VAD + accumulator로 세그먼트 컷.
    const vad: SileroVad = await loadSileroVad()
    const acc = new SegmentAccumulator(chunkerOptsFromAudioConfig(DEFAULT_AUDIO_CONFIG))
    const FRAME = 512
    const segmentsPcm: Float32Array[] = []
    acc.onSegment = (seg) => {
      if (rms(seg) >= RMS_GATE) segmentsPcm.push(seg.slice())
    }
    for (let i = 0; i + FRAME <= pcm.length; i += FRAME) {
      const frame = pcm.subarray(i, i + FRAME)
      const speech = await vad.process(frame)
      acc.feed(frame, speech)
    }
    acc.flush()

    // 5. 세그먼트마다 transcribe → localStore 영속.
    const texts: string[] = []
    let transcribeMsTotal = 0
    let seq = 0
    for (const seg of segmentsPcm) {
      const tt = performance.now()
      const raw = await invoke<string>('stt_transcribe', { pcm: Array.from(seg) })
      transcribeMsTotal += performance.now() - tt
      const content = cutEosLeak(raw)
      if (!content) continue
      texts.push(content)
      const final: TranscriptFinalData = {
        id: seq,
        content,
        speaker_label: '',
        started_at_ms: 0,
        ended_at_ms: 0,
        sequence_number: seq,
        applied: false,
        created_at: new Date().toISOString(),
        audio_source: 'mic',
      }
      await localStore.appendSegment(localId, final)
      await localStore.appendAudio(localId, seq, float32ToInt16(seg))
      seq++
    }

    // 6. 읽기검증: localStore에서 다시 읽어 영속 확인.
    const back = await localStore.getLocal(localId)

    return {
      ok: true,
      localId,
      segments: segmentsPcm.length,
      texts,
      persisted: back.segments.length,
      loadMs,
      transcribeMsTotal: Math.round(transcribeMsTotal),
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) }
  }
}

function float32ToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]))
    out[i] = s < 0 ? s * 32768 : s * 32767
  }
  return out
}
