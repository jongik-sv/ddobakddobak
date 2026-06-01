// Cohere Transcribe는 긴 청크에서 반복/열화하므로 세그먼트 상한은 8s로 고정한다(locked decision).
// emit()의 하드 클램프가 이 불변식을 코드 차원에서 보장하고, Rust FFI(P1 task 4)가
// 백스톱으로 8s 초과분을 한 번 더 잘라낸다.
//
// 또박또박 이식 메모(T6): maxSegmentS는 호출자가 더 큰 값을 줘도(config.yaml max_chunk_sec=10)
// 생성자에서 min(opts.maxSegmentS, MAX_SEGMENT_S)로 8s 상한에 하드클램프된다.
// 단, 8s 미만을 요청하면(테스트의 maxSegmentS:1/2 등) 그 값을 존중한다 — 상한이지 고정이 아니다.
export const MAX_SEGMENT_S = 8;

export interface ChunkerOpts {
  sampleRate: number;
  /** 이 길이만큼 무음이면 컷 (단 minSegmentS 이상 쌓였을 때만). */
  minSilenceMs: number;
  maxSegmentS: number;
  /** 청크 최소 길이. 이보다 짧으면 짧은 쉼에도 안 끊고 계속 누적한다(과분할/문맥부족 방지). 기본 0. */
  minSegmentS?: number;
  /** 이 길이만큼 무음이면 minSegmentS 미만이라도 강제 컷(화자가 확실히 멈춤). 기본 무한(=무효). */
  maxSilenceMs?: number;
  /** 발화 시작 전 음성을 미리 모아 첫 음절 손실(앞 잘림)을 막는다. 기본 0. */
  prerollMs?: number;
  /** 직전 청크 끝을 다음 청크 앞에 이어붙여 경계 음절 손실(뒤 잘림)을 막는다. 기본 0. */
  overlapMs?: number;
}

export class SegmentAccumulator {
  private buf: Float32Array[] = [];
  private samples = 0;
  private silenceSamples = 0;
  private recording = false;
  private minSilence: number;
  private maxSamples: number;
  private minSegmentSamples: number;
  private maxSilenceSamples: number;
  private prerollSamples: number;
  private overlapSamples: number;

  // 유휴(녹음 전) 상태에서 굴러가는 프리롤 버퍼 — 발화 온셋을 미리 잡는다.
  private preroll: Float32Array[] = [];
  private prerollLen = 0;
  // 직전 청크의 꼬리 — 다음 청크 앞에 이어붙인다.
  private overlapTail: Float32Array | null = null;

  onSegment: (pcm: Float32Array) => void = () => {};

  constructor(opts: ChunkerOpts) {
    this.minSilence = (opts.minSilenceMs / 1000) * opts.sampleRate;
    // Cohere 8s 상한 하드클램프(T6): 요청값이 8s를 넘으면 8s로 자르되, 더 작으면 존중.
    this.maxSamples = Math.min(opts.maxSegmentS, MAX_SEGMENT_S) * opts.sampleRate;
    this.minSegmentSamples = (opts.minSegmentS ?? 0) * opts.sampleRate;
    this.maxSilenceSamples =
      opts.maxSilenceMs != null ? (opts.maxSilenceMs / 1000) * opts.sampleRate : Infinity;
    this.prerollSamples = ((opts.prerollMs ?? 0) / 1000) * opts.sampleRate;
    this.overlapSamples = ((opts.overlapMs ?? 0) / 1000) * opts.sampleRate;
  }

  feed(frame: Float32Array, isSpeech: boolean) {
    if (!this.recording) {
      if (!isSpeech) {
        // 유휴: 최근 음성을 프리롤로 굴려둔다 (앞 음절 포착용).
        this.pushPreroll(frame);
        return;
      }
      // 발화 시작: 직전 청크 꼬리(overlap) + 프리롤을 먼저 깔고 시작.
      this.recording = true;
      if (this.overlapTail && this.overlapTail.length > 0) {
        this.buf.push(this.overlapTail);
        this.samples += this.overlapTail.length;
        this.overlapTail = null;
      }
      for (const f of this.preroll) {
        this.buf.push(f);
        this.samples += f.length;
      }
      this.preroll = [];
      this.prerollLen = 0;
    }

    this.buf.push(frame);
    this.samples += frame.length;
    if (isSpeech) this.silenceSamples = 0;
    else this.silenceSamples += frame.length;

    const paused = this.silenceSamples >= this.minSilence;
    const longEnough = this.samples >= this.minSegmentSamples;
    const hardPause = this.silenceSamples >= this.maxSilenceSamples;
    // 충분히 길고 쉼이 있거나 / 화자가 확실히 멈췄거나(긴 침묵) / 최대 길이 도달.
    if ((paused && longEnough) || hardPause || this.samples >= this.maxSamples) {
      this.emit();
    }
  }

  flush() {
    if (this.recording && this.samples > 0) this.emit();
  }

  private pushPreroll(frame: Float32Array) {
    if (this.prerollSamples <= 0) return;
    this.preroll.push(frame);
    this.prerollLen += frame.length;
    // 앞에서부터 잘라 prerollSamples 이하로 유지 (최소 1프레임은 남긴다).
    while (this.preroll.length > 1 && this.prerollLen - this.preroll[0].length >= this.prerollSamples) {
      this.prerollLen -= this.preroll.shift()!.length;
    }
  }

  private emit() {
    // 누적 버퍼를 평탄화한다.
    const full = new Float32Array(this.samples);
    let off = 0;
    for (const f of this.buf) {
      full.set(f, off);
      off += f.length;
    }

    // 하드 클램프(review BLOCKER fix): onset에서 overlapTail(≤300ms)+preroll(≤400ms)을
    // 한 프레임에 깔기 때문에 maxSamples 검사 직후에도 한 세그먼트가 maxSamples를
    // 초과할 수 있다. 초과분은 절대 내보내지 않고, 정확히 앞 maxSamples만 emit하며
    // 남은 꼬리는 다음 세그먼트의 head로 이월한다(녹음 상태/오버랩 로직 유지).
    let pcm: Float32Array;
    let carry: Float32Array | null = null;
    if (full.length > this.maxSamples) {
      pcm = full.subarray(0, this.maxSamples);
      carry = full.subarray(this.maxSamples);
    } else {
      pcm = full;
    }

    // 청크 꼬리를 다음 청크 앞에 이어붙이기 위해 보관 (경계 음절 손실 방지).
    // 단 carry가 있는 클램프 경계에선 이월분이 연속 오디오라 overlap을 깔 필요가 없고,
    // recording이 유지돼 onset prepend도 안 도므로 여기서 잡은 overlapTail은 소비되지
    // 않고 다음 emit에 덮어써질 dead-write다 → carry 있을 땐 건너뛴다 (review minor fix).
    if (this.overlapSamples > 0 && pcm.length > 0 && !carry) {
      const start = Math.max(0, pcm.length - Math.floor(this.overlapSamples));
      this.overlapTail = pcm.slice(start);
    }

    if (carry && carry.length > 0) {
      // 남은 꼬리를 다음 세그먼트의 head로 이월. 발화가 계속되는 중이므로
      // recording을 유지하고, preroll/overlapTail은 추가로 깔지 않는다(이미 연속 오디오).
      this.buf = [carry.slice()];
      this.samples = carry.length;
      // 이월된 head가 또 maxSamples를 넘으면(이론상 한 프레임이 8s+인 경우) 즉시 재컷.
      // silenceSamples는 보존하지 않는다 — 클램프는 "최대 길이 도달"로 인한 컷이며
      // 무음 카운팅과 무관하므로 0으로 두어 다음 무음 판정을 새로 시작한다.
      this.silenceSamples = 0;
      this.preroll = [];
      this.prerollLen = 0;
      this.onSegment(pcm.slice());
      if (this.samples >= this.maxSamples) this.emit();
      return;
    }

    this.buf = [];
    this.samples = 0;
    this.silenceSamples = 0;
    this.recording = false;
    this.preroll = [];
    this.prerollLen = 0;
    this.onSegment(pcm.length === full.length ? pcm : pcm.slice());
  }
}
