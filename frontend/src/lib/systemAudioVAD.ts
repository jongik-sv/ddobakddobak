/**
 * SystemAudioVAD — Tauri 시스템 오디오 이벤트용 VAD (Voice Activity Detection)
 *
 * audio-processor.js의 VAD 로직을 TypeScript로 포팅.
 * Tauri 이벤트로 받은 Int16 PCM을 동일한 상태 머신으로 처리한다.
 * AudioContext/AudioWorklet 불필요 — 이미 16kHz mono PCM.
 */

export interface AudioConfig {
  sample_rate: number
  silence_threshold: number
  speech_threshold: number
  silence_duration_ms: number
  max_chunk_sec: number
  min_chunk_sec: number
  preroll_ms: number
  overlap_ms: number
}

const DEFAULT_CONFIG: AudioConfig = {
  sample_rate: 16000,
  silence_threshold: 0.03,
  speech_threshold: 0.06,
  silence_duration_ms: 800,
  max_chunk_sec: 15,
  min_chunk_sec: 3,
  preroll_ms: 300,
  overlap_ms: 200,
}

type VADState = 'SILENCE' | 'SPEECH' | 'TRAILING_SILENCE'

export class SystemAudioVAD {
  private state: VADState = 'SILENCE'
  private config: AudioConfig

  private silenceSamples: number
  private maxChunkSamples: number
  private minChunkSamples: number
  private prerollSamples: number
  private overlapSamples: number

  private preroll: Float32Array
  private prerollHead = 0
  private speech: Float32Array
  private speechLen = 0
  private silenceCount = 0
  private tail: Float32Array
  private tailLen = 0

  // 샘플 기반 타임스탬프
  private totalSamplesIn = 0
  private chunkStartSample = 0

  private onChunk: (pcm: Int16Array, startSample: number) => void

  constructor(config: Partial<AudioConfig>, onChunk: (pcm: Int16Array, startSample: number) => void) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.onChunk = onChunk

    const sr = this.config.sample_rate
    this.silenceSamples = Math.round((this.config.silence_duration_ms / 1000) * sr)
    this.maxChunkSamples = Math.round(this.config.max_chunk_sec * sr)
    this.minChunkSamples = Math.round(this.config.min_chunk_sec * sr)
    this.prerollSamples = Math.round((this.config.preroll_ms / 1000) * sr)
    this.overlapSamples = Math.round((this.config.overlap_ms / 1000) * sr)

    this.preroll = new Float32Array(this.prerollSamples)
    this.speech = new Float32Array(this.maxChunkSamples)
    this.tail = new Float32Array(this.overlapSamples)
  }

  /**
   * Int16 PCM 버퍼를 입력한다 (Tauri 이벤트에서 디코딩한 데이터).
   */
  feed(pcmI16: Int16Array): void {
    // Int16 → Float32 정규화
    const floats = new Float32Array(pcmI16.length)
    for (let i = 0; i < pcmI16.length; i++) {
      floats[i] = pcmI16[i] / 32768.0
    }
    this.processFloats(floats)
  }

  /**
   * 남아 있는 음성 데이터를 강제 전송한다.
   */
  flush(): void {
    if (
      (this.state === 'SPEECH' || this.state === 'TRAILING_SILENCE') &&
      this.speechLen >= this.minChunkSamples
    ) {
      this.sendChunk()
    }
    this.resetToSilence()
  }

  private processFloats(channel: Float32Array): void {
    this.totalSamplesIn += channel.length

    // RMS 계산
    let sumSq = 0
    for (let i = 0; i < channel.length; i++) {
      sumSq += channel[i] * channel[i]
    }
    const rms = Math.sqrt(sumSq / channel.length)

    if (this.state === 'SILENCE') {
      for (let i = 0; i < channel.length; i++) {
        this.preroll[this.prerollHead % this.prerollSamples] = channel[i]
        this.prerollHead++
      }

      if (rms > this.config.silence_threshold) {
        const prerollLen = Math.min(this.prerollHead, this.prerollSamples)
        // FIX: 버퍼 미충족 시 0부터 시작
        const startIdx = this.prerollHead <= this.prerollSamples ? 0 : this.prerollHead % this.prerollSamples
        for (let i = 0; i < prerollLen; i++) {
          this.speech[this.speechLen++] = this.preroll[(startIdx + i) % this.prerollSamples]
        }
        // FIX: 현재 프레임은 이미 프리롤에 포함 — 중복 복사 제거
        this.chunkStartSample = this.totalSamplesIn - prerollLen
        this.state = 'SPEECH'
        this.prerollHead = 0
      }
    } else if (this.state === 'SPEECH') {
      for (let i = 0; i < channel.length; i++) {
        if (this.speechLen < this.maxChunkSamples) {
          this.speech[this.speechLen++] = channel[i]
        }
      }

      if (this.speechLen >= this.maxChunkSamples) {
        this.sendChunk()
        this.resetToSilence()
      } else if (rms <= this.config.silence_threshold) {
        this.state = 'TRAILING_SILENCE'
        this.silenceCount = channel.length
      }
    } else if (this.state === 'TRAILING_SILENCE') {
      for (let i = 0; i < channel.length; i++) {
        if (this.speechLen < this.maxChunkSamples) {
          this.speech[this.speechLen++] = channel[i]
        }
      }

      if (rms > this.config.speech_threshold) {
        this.state = 'SPEECH'
        this.silenceCount = 0
      } else {
        this.silenceCount += channel.length

        if (this.silenceCount >= this.silenceSamples && this.speechLen >= this.minChunkSamples) {
          this.sendChunk()
          this.resetToSilence()
        } else if (this.speechLen >= this.maxChunkSamples) {
          this.sendChunk()
          this.resetToSilence()
        }
      }
    }
  }

  private sendChunk(): void {
    if (this.speechLen === 0) return

    const int16 = new Int16Array(this.speechLen)
    for (let i = 0; i < this.speechLen; i++) {
      const s = Math.max(-1, Math.min(1, this.speech[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    this.onChunk(int16, this.chunkStartSample)

    // overlap tail 저장
    const overlapStart = Math.max(0, this.speechLen - this.overlapSamples)
    this.tailLen = this.speechLen - overlapStart
    for (let i = 0; i < this.tailLen; i++) {
      this.tail[i] = this.speech[overlapStart + i]
    }

    this.speechLen = 0
  }

  private resetToSilence(): void {
    this.state = 'SILENCE'
    this.speechLen = 0
    this.silenceCount = 0
    const seedLen = Math.min(this.tailLen, this.prerollSamples)
    for (let i = 0; i < seedLen; i++) {
      this.preroll[i] = this.tail[i]
    }
    this.prerollHead = seedLen
    this.tailLen = 0
  }
}
