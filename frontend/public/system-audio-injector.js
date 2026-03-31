/**
 * 시스템 오디오 PCM을 AudioContext 오디오 그래프에 주입하는 AudioWorklet.
 * port.postMessage(Int16Array)로 받은 PCM 데이터를 Float32 출력으로 변환한다.
 *
 * Pre-buffer: 첫 배치 도착 후 일정량이 쌓일 때까지 무음 출력하여
 * 메인 스레드 이벤트 전달 지연(지터)으로 인한 끊김을 방지한다.
 */
class SystemAudioInjector extends AudioWorkletProcessor {
  constructor() {
    super()
    this.queue = []       // Float32Array 청크 큐
    this.current = null   // 현재 재생 중인 버퍼
    this.offset = 0       // 현재 버퍼 내 오프셋

    // Pre-buffer: 첫 데이터 도착 후 ~150ms(2400 samples @16kHz)가 쌓인 후 출력 시작
    this.buffering = false // 아직 데이터 도착 전
    this.bufferedSamples = 0
    this.PREBUFFER_SAMPLES = 2400

    this.port.onmessage = (e) => {
      const int16 = e.data
      if (!(int16 instanceof Int16Array)) return
      const float32 = new Float32Array(int16.length)
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0
      }
      this.queue.push(float32)
      this.bufferedSamples += float32.length

      // 첫 데이터 도착 시 버퍼링 모드 진입
      if (!this.buffering && !this.started) {
        this.buffering = true
      }
      // Pre-buffer 임계값 도달 → 출력 시작
      if (this.buffering && this.bufferedSamples >= this.PREBUFFER_SAMPLES) {
        this.buffering = false
        this.started = true
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0]
    if (!output) return true

    // 아직 버퍼링 중이거나 데이터 도착 전 → 무음
    if (this.buffering || !this.started) {
      output.fill(0)
      return true
    }

    for (let i = 0; i < output.length; i++) {
      // 현재 버퍼 소진 시 다음 버퍼로
      if (!this.current || this.offset >= this.current.length) {
        if (this.queue.length > 0) {
          this.current = this.queue.shift()
          this.offset = 0
        } else {
          output[i] = 0
          continue
        }
      }
      output[i] = this.current[this.offset++]
    }
    return true
  }
}

registerProcessor('system-audio-injector', SystemAudioInjector)
