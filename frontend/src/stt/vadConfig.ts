// config.yaml(레포 루트)의 audio 블록을 SegmentAccumulator(ChunkerOpts)로 매핑한다.
// chunker.ts는 ondevice-stt 원본의 충실한 복사본(클램프만 적응)이므로, 또박또박 정책값은
// 여기에 모아 둔다. 통합 시 이 상수/함수가 단일 진실원천(SoT)이 되어야 한다.
//
// config.yaml audio:
//   sample_rate: 16000
//   silence_threshold: 0.05      (RMS — VAD 상태머신 진입; sileroVad 확률 게이트와 별개)
//   speech_threshold: 0.06       (RMS — VAD 복귀)
//   silence_duration_ms: 500     → minSilenceMs
//   max_chunk_sec: 10            → maxSegmentS (단 Cohere 8s 상한 → min(10,8)=8 클램프)
//   min_chunk_sec: 2             → minSegmentS
//   preroll_ms: 500              → prerollMs
//   overlap_ms: 500              → overlapMs
//
// 주의: config.yaml에는 maxSilenceMs에 대응하는 필드가 없다. 원본 useStt는 1500ms를
// 하드코딩해 "짧은 마지막 발화가 minSegment 미만으로 갇히는" 것을 막았다. 그 의도를
// 유지하기 위해 여기서 명시적 상수로 보존한다(silent copy 아님 — 의도적 결정).
import type { ChunkerOpts } from "./chunker";
import { MAX_SEGMENT_S } from "./chunker";

/** config.yaml audio 블록에서 읽어 들이는 필드의 부분 형태(통합 시 yaml 로더가 채움). */
export interface AudioConfig {
  sample_rate: number;
  silence_duration_ms: number;
  max_chunk_sec: number;
  min_chunk_sec: number;
  preroll_ms: number;
  overlap_ms: number;
}

/** config.yaml audio 기본값(레포 루트 config.yaml과 정합). */
export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  sample_rate: 16000,
  silence_duration_ms: 500,
  max_chunk_sec: 10,
  min_chunk_sec: 2,
  preroll_ms: 500,
  overlap_ms: 500,
};

// config.yaml에 대응 필드가 없는 정책값(원본 useStt 의도 보존).
// minSegment 미만이라도 이만큼 멈추면 강제 컷 → 짧은 끝맺음 발화가 갇히지 않게 한다.
export const MAX_SILENCE_MS = 1500;

// near-silence 환각 차단 게이트. postprocess.RMS_GATE와 동일 의미이며 변경 금지(0.015 유지).
export { RMS_GATE } from "./postprocess";

/**
 * config.yaml audio 블록을 SegmentAccumulator 생성자 opts로 변환한다.
 * maxSegmentS는 Cohere 8s 상한으로 클램프된다(SegmentAccumulator 생성자도 백스톱으로 재클램프).
 */
export function chunkerOptsFromAudioConfig(cfg: AudioConfig = DEFAULT_AUDIO_CONFIG): ChunkerOpts {
  return {
    sampleRate: cfg.sample_rate,
    minSilenceMs: cfg.silence_duration_ms,
    // Cohere 8s 상한: config의 max_chunk_sec(10)를 8로 하드클램프.
    maxSegmentS: Math.min(cfg.max_chunk_sec, MAX_SEGMENT_S),
    minSegmentS: cfg.min_chunk_sec,
    maxSilenceMs: MAX_SILENCE_MS,
    prerollMs: cfg.preroll_ms,
    overlapMs: cfg.overlap_ms,
  };
}
