/**
 * AudioWorklet 프로세서: VAD(Voice Activity Detection) 기반 청킹
 * RMS 에너지로 무음 구간을 감지하여 자연스러운 문장 경계에서 청크 전송
 *
 * 설정값은 메인 스레드에서 'init' 메시지로 전달받으며,
 * 전달되지 않으면 기본값을 사용한다.
 */

// 기본값 (config.yaml과 동기화)
let SAMPLE_RATE = 16000
let SILENCE_THRESHOLD = 0.03
let SPEECH_THRESHOLD = 0.06
let SILENCE_SAMPLES = 12800    // 800ms
let MAX_CHUNK_SAMPLES = 240000 // 15s
let MIN_CHUNK_SAMPLES = 48000  // 3s
let PREROLL_SAMPLES = 4800     // 300ms
let OVERLAP_SAMPLES = 3200     // 200ms

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._state = 'SILENCE'
    this._preroll = new Float32Array(PREROLL_SAMPLES)
    this._prerollHead = 0
    this._speech = new Float32Array(MAX_CHUNK_SAMPLES)
    this._speechLen = 0
    this._silenceCount = 0
    this._tail = new Float32Array(OVERLAP_SAMPLES)
    this._tailLen = 0

    this._paused = false

    this.port.onmessage = (event) => {
      if (event.data?.type === 'pause') {
        // 일시정지: 진행 중인 음성이 있으면 전송 후 리셋
        if (
          (this._state === 'SPEECH' || this._state === 'TRAILING_SILENCE') &&
          this._speechLen >= MIN_CHUNK_SAMPLES
        ) {
          this._sendChunk()
        }
        this._resetToSilence()
        this._paused = true
      } else if (event.data?.type === 'resume') {
        this._paused = false
      } else if (event.data?.type === 'init') {
        const c = event.data.config
        if (c) {
          SAMPLE_RATE = c.sample_rate ?? SAMPLE_RATE
          SILENCE_THRESHOLD = c.silence_threshold ?? SILENCE_THRESHOLD
          SPEECH_THRESHOLD = c.speech_threshold ?? SPEECH_THRESHOLD
          SILENCE_SAMPLES = Math.round((c.silence_duration_ms ?? 800) * SAMPLE_RATE / 1000)
          MAX_CHUNK_SAMPLES = Math.round((c.max_chunk_sec ?? 15) * SAMPLE_RATE)
          MIN_CHUNK_SAMPLES = Math.round((c.min_chunk_sec ?? 3) * SAMPLE_RATE)
          PREROLL_SAMPLES = Math.round((c.preroll_ms ?? 300) * SAMPLE_RATE / 1000)
          OVERLAP_SAMPLES = Math.round((c.overlap_ms ?? 200) * SAMPLE_RATE / 1000)
          // 버퍼 재할당
          this._preroll = new Float32Array(PREROLL_SAMPLES)
          this._speech = new Float32Array(MAX_CHUNK_SAMPLES)
          this._tail = new Float32Array(OVERLAP_SAMPLES)
        }
      } else if (event.data?.type === 'flush') {
        if (
          (this._state === 'SPEECH' || this._state === 'TRAILING_SILENCE') &&
          this._speechLen >= MIN_CHUNK_SAMPLES
        ) {
          this._sendChunk()
        }
        this._resetToSilence()
      }
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true
    if (this._paused) return true

    const channel = input[0]

    let sumSq = 0
    for (let i = 0; i < channel.length; i++) {
      sumSq += channel[i] * channel[i]
    }
    const rms = Math.sqrt(sumSq / channel.length)

    if (this._state === 'SILENCE') {
      for (let i = 0; i < channel.length; i++) {
        this._preroll[this._prerollHead % PREROLL_SAMPLES] = channel[i]
        this._prerollHead++
      }

      if (rms > SILENCE_THRESHOLD) {
        const prerollLen = Math.min(this._prerollHead, PREROLL_SAMPLES)
        const startIdx = this._prerollHead % PREROLL_SAMPLES
        for (let i = 0; i < prerollLen; i++) {
          this._speech[this._speechLen++] = this._preroll[(startIdx + i) % PREROLL_SAMPLES]
        }
        for (let i = 0; i < channel.length; i++) {
          if (this._speechLen < MAX_CHUNK_SAMPLES) {
            this._speech[this._speechLen++] = channel[i]
          }
        }
        this._state = 'SPEECH'
        this._prerollHead = 0
      }
    } else if (this._state === 'SPEECH') {
      for (let i = 0; i < channel.length; i++) {
        if (this._speechLen < MAX_CHUNK_SAMPLES) {
          this._speech[this._speechLen++] = channel[i]
        }
      }

      if (this._speechLen >= MAX_CHUNK_SAMPLES) {
        this._sendChunk()
        this._resetToSilence()
      } else if (rms <= SILENCE_THRESHOLD) {
        this._state = 'TRAILING_SILENCE'
        this._silenceCount = channel.length
      }
    } else if (this._state === 'TRAILING_SILENCE') {
      for (let i = 0; i < channel.length; i++) {
        if (this._speechLen < MAX_CHUNK_SAMPLES) {
          this._speech[this._speechLen++] = channel[i]
        }
      }

      if (rms > SPEECH_THRESHOLD) {
        this._state = 'SPEECH'
        this._silenceCount = 0
      } else {
        this._silenceCount += channel.length

        if (this._silenceCount >= SILENCE_SAMPLES && this._speechLen >= MIN_CHUNK_SAMPLES) {
          this._sendChunk()
          this._resetToSilence()
        } else if (this._speechLen >= MAX_CHUNK_SAMPLES) {
          this._sendChunk()
          this._resetToSilence()
        }
      }
    }

    return true
  }

  _sendChunk() {
    if (this._speechLen === 0) return
    const int16 = new Int16Array(this._speechLen)
    for (let i = 0; i < this._speechLen; i++) {
      const s = Math.max(-1, Math.min(1, this._speech[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    this.port.postMessage(int16, [int16.buffer])

    // Save tail for overlap with next chunk
    const overlapStart = Math.max(0, this._speechLen - OVERLAP_SAMPLES)
    this._tailLen = this._speechLen - overlapStart
    for (let i = 0; i < this._tailLen; i++) {
      this._tail[i] = this._speech[overlapStart + i]
    }

    this._speechLen = 0
  }

  _resetToSilence() {
    this._state = 'SILENCE'
    this._speechLen = 0
    this._silenceCount = 0
    // Seed preroll with tail from previous chunk for overlap
    const seedLen = Math.min(this._tailLen, PREROLL_SAMPLES)
    for (let i = 0; i < seedLen; i++) {
      this._preroll[i] = this._tail[i]
    }
    this._prerollHead = seedLen
    this._tailLen = 0
  }
}

registerProcessor('audio-processor', AudioProcessor)
