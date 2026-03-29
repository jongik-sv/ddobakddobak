/**
 * 시스템 오디오 PCM을 AudioContext 오디오 그래프에 주입하는 AudioWorklet.
 * port.postMessage(Int16Array)로 받은 PCM 데이터를 Float32 출력으로 변환한다.
 */
class SystemAudioInjector extends AudioWorkletProcessor {
  constructor() {
    super()
    this.queue = []       // Float32Array 청크 큐
    this.current = null   // 현재 재생 중인 버퍼
    this.offset = 0       // 현재 버퍼 내 오프셋

    this.port.onmessage = (e) => {
      const int16 = e.data
      if (!(int16 instanceof Int16Array)) return
      const float32 = new Float32Array(int16.length)
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0
      }
      this.queue.push(float32)
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0]
    if (!output) return true

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
