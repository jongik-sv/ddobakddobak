/**
 * mic-pcm-forwarder — getUserMedia 마이크 원본 PCM을 배치로 전달하는 AudioWorklet.
 * 16kHz mono 기준 ~300ms(4800 samples)씩 메인 스레드로 전송.
 */
class MicPcmForwarder extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buf = new Float32Array(4800)
    this._pos = 0
  }

  process(inputs) {
    const ch = inputs[0]?.[0]
    if (!ch) return true

    for (let i = 0; i < ch.length; i++) {
      this._buf[this._pos++] = ch[i]
      if (this._pos >= 4800) {
        const batch = this._buf.slice(0, 4800)
        this.port.postMessage(batch, [batch.buffer])
        this._pos = 0
      }
    }
    return true
  }
}

registerProcessor('mic-pcm-forwarder', MicPcmForwarder)
