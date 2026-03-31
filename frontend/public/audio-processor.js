/**
 * AudioWorklet 프로세서: VAD(Voice Activity Detection) 기반 청킹
 * RMS 에너지로 무음 구간을 감지하여 자연스러운 문장 경계에서 청크 전송
 *
 * 설정값은 메인 스레드에서 'init' 메시지로 전달받으며,
 * 전달되지 않으면 기본값을 사용한다.
 */

// 기본값 (config.yaml과 동기화)
let SAMPLE_RATE = 16000
let SILENCE_THRESHOLD = 0.05
let SPEECH_THRESHOLD = 0.06
let SILENCE_SAMPLES = 8000     // 500ms
let MAX_CHUNK_SAMPLES = 160000 // 10s
let MIN_CHUNK_SAMPLES = 32000  // 2s
let PREROLL_SAMPLES = 6400     // 400ms
let OVERLAP_SAMPLES = 4800     // 300ms

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

    // 시스템 오디오 직접 주입 큐 (injector worklet 경유 제거)
    this._sysQueue = []
    this._sysCurrent = null
    this._sysOffset = 0

    // 샘플 기반 타임스탬프: Date.now() 대신 실제 오디오 샘플 수로 정확한 위치 추적
    this._totalSamplesIn = 0
    this._chunkStartSample = 0

    // 녹음용 원본 믹싱 PCM 배치 출력 (4800 samples = 300ms)
    this._rawBuf = new Float32Array(4800)
    this._rawPos = 0

    this.port.onmessage = (event) => {
      if (event.data?.type === 'system-audio') {
        // 시스템 오디오 PCM (Int16Array) → Float32 변환 후 큐에 추가
        const pcm = event.data.pcm
        if (pcm && pcm.length > 0) {
          const f32 = new Float32Array(pcm.length)
          for (let i = 0; i < pcm.length; i++) {
            f32[i] = pcm[i] / 32768.0
          }
          this._sysQueue.push(f32)
        }
      } else if (event.data?.type === 'pause') {
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
        // 일시정지 중 쌓인 stale 시스템 오디오 큐 클리어
        this._sysQueue = []
        this._sysCurrent = null
        this._sysOffset = 0
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

    const mic = input[0]

    // 마이크 + 시스템 오디오 믹싱 (시스템 오디오는 postMessage로 직접 수신)
    if (!this._mixBuf || this._mixBuf.length < mic.length) {
      this._mixBuf = new Float32Array(mic.length)
    }
    const channel = this._mixBuf
    for (let i = 0; i < mic.length; i++) {
      let sys = 0
      if (!this._sysCurrent || this._sysOffset >= this._sysCurrent.length) {
        if (this._sysQueue.length > 0) {
          this._sysCurrent = this._sysQueue.shift()
          this._sysOffset = 0
        } else {
          this._sysCurrent = null
        }
      }
      if (this._sysCurrent) {
        sys = this._sysCurrent[this._sysOffset++]
      }
      channel[i] = mic[i] + sys
    }

    // 녹음용: 믹싱된 PCM을 배치로 메인 스레드에 전달
    if (!this._paused) {
      for (let i = 0; i < channel.length; i++) {
        this._rawBuf[this._rawPos++] = channel[i]
        if (this._rawPos >= 4800) {
          const int16 = new Int16Array(4800)
          for (let j = 0; j < 4800; j++) {
            const s = Math.max(-1, Math.min(1, this._rawBuf[j]))
            int16[j] = s < 0 ? s * 0x8000 : s * 0x7fff
          }
          this.port.postMessage({ type: 'raw-pcm', pcm: int16 }, [int16.buffer])
          this._rawPos = 0
        }
      }
    }

    this._totalSamplesIn += channel.length

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
        // FIX: 버퍼 미충족 시 0부터 시작 (기존에는 미초기화 영역 읽음)
        const startIdx = this._prerollHead <= PREROLL_SAMPLES ? 0 : this._prerollHead % PREROLL_SAMPLES
        for (let i = 0; i < prerollLen; i++) {
          this._speech[this._speechLen++] = this._preroll[(startIdx + i) % PREROLL_SAMPLES]
        }
        // FIX: 현재 프레임은 이미 프리롤에 포함 — 중복 복사 제거
        this._chunkStartSample = this._totalSamplesIn - prerollLen
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
    this.port.postMessage({ pcm: int16, startSample: this._chunkStartSample }, [int16.buffer])

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
