import { describe, it, expect } from "vitest";
import { cutEosLeak, rms, RMS_GATE } from "./postprocess";

describe("cutEosLeak", () => {
  it("cuts at the EOS marker", () => {
    expect(cutEosLeak("안녕하세요<|endoftext|>")).toBe("안녕하세요");
  });
  it("leaves text without a marker", () => {
    expect(cutEosLeak("no marker")).toBe("no marker");
  });
  it("returns empty when the marker leads (after trim)", () => {
    expect(cutEosLeak("  <|im_start|>")).toBe("");
  });
});

describe("rms", () => {
  it("silence is below the gate", () => {
    expect(rms(new Float32Array(16000))).toBeLessThan(RMS_GATE);
  });
  it("loud sine is above the gate", () => {
    const n = 16000;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16000);
    expect(rms(pcm)).toBeGreaterThan(RMS_GATE);
  });
});
