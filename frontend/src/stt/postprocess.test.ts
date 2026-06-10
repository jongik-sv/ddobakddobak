import { describe, it, expect } from "vitest";
import { cutEosLeak, hasSpeech, hasSpeechFrame, rms, RMS_GATE } from "./postprocess";

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

describe("hasSpeech — 프레임 단위 발화 게이트(무음 패딩 희석 방지)", () => {
  /** speech 구간(0.2 진폭 사인) + 무음 패딩으로 구성된 PCM 생성. */
  function speechWithSilence(speechSec: number, silenceSec: number, sr = 16000): Float32Array {
    const n = Math.round((speechSec + silenceSec) * sr);
    const pcm = new Float32Array(n);
    const speechN = Math.round(speechSec * sr);
    for (let i = 0; i < speechN; i++) pcm[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / sr);
    return pcm;
  }

  it("완전 무음은 false", () => {
    expect(hasSpeech(new Float32Array(16000))).toBe(false);
  });

  it("통짜 RMS가 게이트 미만으로 희석돼도 발화 프레임이 있으면 true (과거 버그: 통째 드랍)", () => {
    // 1초 발화 + 19초 무음: 통짜 RMS ≈ 0.2/√2/√20 ≈ 0.0316... 더 약한 발화로 확실히 게이트 아래로.
    const pcm = speechWithSilence(1, 19);
    for (let i = 0; i < 16000; i++) pcm[i] *= 0.2; // 발화 진폭 0.04 → 통짜 RMS ≈ 0.0063 < 0.015
    expect(rms(pcm)).toBeLessThan(RMS_GATE); // 전제: 통짜 게이트면 드랍됐을 신호
    expect(hasSpeech(pcm)).toBe(true); // 프레임 게이트는 살린다
  });

  it("저레벨 100ms 단발 스파이크(클릭/팝)는 false (환각 차단 유지)", () => {
    // 진폭 0.06 → 프레임 RMS ≈ 0.042: RMS_GATE 이상이지만 FRAME_HIGH_GATE(0.05) 미만 단발.
    const pcm = new Float32Array(16000 * 4);
    for (let i = 0; i < 1600; i++) pcm[i] = 0.06 * Math.sin((2 * Math.PI * 440 * i) / 16000);
    expect(hasSpeech(pcm)).toBe(false);
  });

  it("산발적(비연속) 저레벨 프레임 3개는 false (숨소리/부스럭 차단)", () => {
    const pcm = new Float32Array(16000 * 4);
    for (const startMs of [0, 1000, 2000]) {
      const s = (startMs / 1000) * 16000;
      for (let i = 0; i < 1600; i++) pcm[s + i] = 0.06 * Math.sin((2 * Math.PI * 440 * i) / 16000);
    }
    expect(hasSpeech(pcm)).toBe(false);
  });

  it("큰 단음절(~200ms, '네')은 긴 무음 속에서도 true (고에너지 프레임 경로)", () => {
    const pcm = new Float32Array(16000 * 2);
    for (let i = 0; i < 3200; i++) pcm[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / 16000);
    expect(hasSpeech(pcm)).toBe(true);
  });

  it("프레임 3개 미만의 짧은 PCM도 충분히 크면 true", () => {
    const pcm = new Float32Array(3200); // 200ms = 2프레임, 진폭 0.2 → 고에너지 경로
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / 16000);
    expect(hasSpeech(pcm)).toBe(true);
  });
});

describe("hasSpeechFrame — 분할 조각용 느슨한 게이트", () => {
  it("완전 무음은 false", () => {
    expect(hasSpeechFrame(new Float32Array(16000))).toBe(false);
  });

  it("게이트 넘는 프레임 1개면 true (경계 걸친 발화 보존)", () => {
    const pcm = new Float32Array(16000);
    for (let i = 0; i < 1600; i++) pcm[i] = 0.03 * Math.sin((2 * Math.PI * 220 * i) / 16000);
    expect(hasSpeechFrame(pcm)).toBe(true);
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
