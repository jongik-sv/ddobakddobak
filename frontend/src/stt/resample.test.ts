import { describe, it, expect } from "vitest";
import { resampleTo16k, shouldResample } from "./resample";

describe("resample", () => {
  it("downsamples 48k → 16k length ~= 16000", () => {
    const out = resampleTo16k(new Float32Array(48000), 48000);
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(1);
  });

  it("shouldResample false at 16k, true otherwise", () => {
    expect(shouldResample(16000)).toBe(false);
    expect(shouldResample(48000)).toBe(true);
  });

  it("returns input unchanged at 16k", () => {
    const f = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleTo16k(f, 16000)).toBe(f);
  });
});
