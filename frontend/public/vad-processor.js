// AudioWorklet that emits fixed 512-sample frames for VAD (from moonshine-web)
const MIN_CHUNK_SIZE = 512;
let globalPointer = 0;
let globalBuffer = new Float32Array(MIN_CHUNK_SIZE);

class VADProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const buffer = inputs[0][0];
    if (!buffer) return true; // null when stream ends

    if (buffer.length > MIN_CHUNK_SIZE) {
      this.port.postMessage({ buffer });
    } else {
      const remaining = MIN_CHUNK_SIZE - globalPointer;
      if (buffer.length >= remaining) {
        globalBuffer.set(buffer.subarray(0, remaining), globalPointer);
        this.port.postMessage({ buffer: globalBuffer });
        globalBuffer = new Float32Array(MIN_CHUNK_SIZE);
        globalBuffer.set(buffer.subarray(remaining), 0);
        globalPointer = buffer.length - remaining;
      } else {
        globalBuffer.set(buffer, globalPointer);
        globalPointer += buffer.length;
      }
    }
    return true;
  }
}
registerProcessor("vad-processor", VADProcessor);
