import { describe, it, expect } from "vitest";
import { SegmentAccumulator } from "./chunker";

describe("SegmentAccumulator", () => {
  it("emits on silence after speech", () => {
    const a = new SegmentAccumulator({ sampleRate: 16000, minSilenceMs: 400, maxSegmentS: 20 });
    const out: number[] = [];
    a.onSegment = (pcm) => out.push(pcm.length);
    a.feed(new Float32Array(16000), true);   // 1s speech
    a.feed(new Float32Array(8000), false);   // 0.5s silence > 400ms -> emit
    expect(out.length).toBe(1);
    expect(out[0]).toBeGreaterThanOrEqual(16000);
  });

  it("force-cuts at maxSegment without silence", () => {
    const a = new SegmentAccumulator({ sampleRate: 16000, minSilenceMs: 400, maxSegmentS: 1 });
    const out: number[] = [];
    a.onSegment = (pcm) => out.push(pcm.length);
    for (let i = 0; i < 4; i++) a.feed(new Float32Array(8000), true); // 2s continuous
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it("flush emits trailing speech", () => {
    const a = new SegmentAccumulator({ sampleRate: 16000, minSilenceMs: 400, maxSegmentS: 20 });
    const out: number[] = [];
    a.onSegment = (pcm) => out.push(pcm.length);
    a.feed(new Float32Array(16000), true);
    a.flush();
    expect(out.length).toBe(1);
  });

  // 실제 useStt가 쓰는 production opts 그대로(프리롤/오버랩이 naive cap을 깨는 정확한 조건).
  const PROD_OPTS = {
    sampleRate: 16000,
    minSegmentS: 4,
    minSilenceMs: 500,
    maxSilenceMs: 1500,
    maxSegmentS: 8,
    prerollMs: 400,
    overlapMs: 300,
  } as const;

  it("caps every emitted segment at <= 8s even with preroll+overlap", () => {
    const a = new SegmentAccumulator({ ...PROD_OPTS });
    const out: number[] = [];
    a.onSegment = (pcm) => out.push(pcm.length);

    // 프리롤을 idle 프레임으로 채운다(녹음 전 = isSpeech:false) — onset에서 front-load됨.
    for (let i = 0; i < 5; i++) a.feed(new Float32Array(8000), false);
    // 충분히 긴 연속 발화: 40×8000 = 320000 샘플 = 20s. 첫 emit 이후 onset에 깔리는
    // overlapTail(300ms)이 누적되며 두 번째 세그먼트부터 maxSamples를 넘어서므로
    // (naive 코드라면 8.x s를 내보내 실패) 하드 클램프가 반드시 동작해야 한다.
    for (let i = 0; i < 40; i++) a.feed(new Float32Array(8000), true);

    expect(out.length).toBeGreaterThanOrEqual(1);
    // 클램프 (a)가 있으면 모든 세그먼트가 정확히 <= 8s; 없으면 overlap 누적분이 초과.
    for (const len of out) expect(len).toBeLessThanOrEqual(8 * 16000);
  });

  it("preserves 4s minSegment under 8s cap", () => {
    const a = new SegmentAccumulator({ ...PROD_OPTS });
    const out: number[] = [];
    a.onSegment = (pcm) => out.push(pcm.length);

    // 2s 발화 + 0.5s 무음 → minSilence(500ms)는 충족되나 longEnough(4s) 미충족 → emit 없음.
    a.feed(new Float32Array(2 * 16000), true);
    a.feed(new Float32Array(0.5 * 16000), false);
    expect(out.length).toBe(0);

    // 이어서 >4s 발화 + 0.6s 무음 → 정확히 1회 emit, 길이는 [4s, 8s].
    a.feed(new Float32Array(3 * 16000), true); // 누적 발화 5s
    a.feed(new Float32Array(0.6 * 16000), false);
    expect(out.length).toBe(1);
    expect(out[0]).toBeGreaterThanOrEqual(4 * 16000);
    expect(out[0]).toBeLessThanOrEqual(8 * 16000);
  });

  // 클램프 carry-forward의 최고위험 속성: 경계에서 샘플이 유실/중복되지 않는다.
  // preroll/overlap=0(기본)으로 두어 emit 총합 == 입력 총합이 정확히 성립하도록 한다.
  it("clamps an oversized frame into conserved <=cap segments (recursion, no loss/dup)", () => {
    const cap = 2 * 16000; // maxSegmentS=2 → 32000 샘플
    const a = new SegmentAccumulator({ sampleRate: 16000, minSilenceMs: 500, maxSegmentS: 2 });
    const out: number[] = [];
    a.onSegment = (pcm) => out.push(pcm.length);

    // 단일 5s 프레임(80000) = cap의 2.5배 → emit()이 line-142에서 재귀 분할.
    a.feed(new Float32Array(5 * 16000), true);
    a.flush(); // 이월된 마지막 꼬리 방출.

    for (const len of out) expect(len).toBeLessThanOrEqual(cap);
    const total = out.reduce((s, n) => s + n, 0);
    expect(total).toBe(5 * 16000); // 샘플 보존: 유실/중복 0
    expect(out.length).toBe(Math.ceil((5 * 16000) / cap)); // 32000,32000,16000 → 3개
  });
});
