// 녹음-후(배치) 재전사 — 온라인 regenerate_stt(파일 재전사)의 온디바이스 대응.
//
// 라이브 STT는 실시간 VAD 조각(잘림/저레벨)에 의존해 정확도 손해가 있다. 여기선 끊김 없는
// 연속 녹음(recording.pcm)을 통째로 다시 잘라(batchSegment) 정규화 후 stt_transcribe →
// 기존 세그먼트를 결과로 교체(localStore.replaceSegments). 사용자가 수동 버튼으로 호출한다.
import { invoke } from '@tauri-apps/api/core'

import type { TranscriptFinalData } from '../channels/transcription'
import { segmentPcm } from './batchSegment'
import { cutEosLeak, hasSpeech, normalizeForStt } from './postprocess'
import { DEFAULT_AUDIO_CONFIG } from './vadConfig'
import * as localStore from './localStore'

const SR = 16000

function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

export interface RetranscribeProgress {
  done: number
  total: number
}

/**
 * recording.pcm을 재전사해 세그먼트를 교체한다. 반환=새 세그먼트(호출측이 transcriptStore 재적재).
 * @throws 연속 녹음이 없으면.
 */
export async function retranscribeLocal(
  localId: string,
  modelDir: string,
  language: string,
  onProgress?: (p: RetranscribeProgress) => void,
): Promise<TranscriptFinalData[]> {
  const pcm16 = await localStore.readRecordingPcm(localId)
  if (!pcm16 || pcm16.length === 0) {
    throw new Error('재전사할 연속 녹음이 없습니다.')
  }
  const float = int16ToFloat32(pcm16)

  await invoke('stt_load', { modelDir, language })

  const cfg = DEFAULT_AUDIO_CONFIG
  const segs = segmentPcm(float, {
    sampleRate: SR,
    speechThreshold: 0.06,
    minSilenceMs: cfg.silence_duration_ms,
    maxSegmentS: Math.min(cfg.max_chunk_sec, 8),
    prerollMs: cfg.preroll_ms,
  })

  const out: TranscriptFinalData[] = []
  let seq = 0
  const createdAt = new Date().toISOString()
  for (let i = 0; i < segs.length; i++) {
    onProgress?.({ done: i, total: segs.length })
    const { start, end } = segs[i]
    const slice = float.subarray(start, end)
    // 프레임 게이트 — 통짜 RMS는 무음 패딩 희석으로 정상 발화를 통째로 드랍한다.
    if (!hasSpeech(slice)) continue
    let content: string
    try {
      const raw = await invoke<string>('stt_transcribe', {
        pcm: Array.from(normalizeForStt(slice)),
      })
      content = cutEosLeak(raw)
    } catch (e) {
      console.error('[retranscribe] 세그먼트 전사 실패(스킵):', e)
      continue
    }
    if (!content) continue
    out.push({
      id: seq,
      content,
      speaker_label: '',
      started_at_ms: Math.round((start / SR) * 1000),
      ended_at_ms: Math.round((end / SR) * 1000),
      sequence_number: seq,
      applied: false,
      created_at: createdAt,
      audio_source: 'mic',
    })
    seq++
  }
  onProgress?.({ done: segs.length, total: segs.length })
  await localStore.replaceSegments(localId, out)
  return out
}
