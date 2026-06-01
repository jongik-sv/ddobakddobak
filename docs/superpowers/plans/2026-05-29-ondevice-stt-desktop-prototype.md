# 온디바이스 STT — 데스크톱 프로토타입 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qwen3-ASR-0.6B를 llama.cpp로 네이티브 구동하는 독립 Tauri 앱의 **데스크톱 프로토타입** — 마이크 연속 녹음 → VAD 세그먼트 → 온디바이스 전사 → 실시간 트랜스크립트 렌더 → 로컬 저장.

**Architecture:** Tauri v2. WebView(React/TS)가 마이크 캡처 + Silero VAD(wasm)로 발화 세그먼트를 잘라 16kHz PCM을 Tauri command로 Rust에 전달. Rust `Transcriber` 트레이트의 `LocalTranscriber`가 llama.cpp(mtmd, Qwen3-ASR-0.6B Q4_K_M + mmproj Q8)로 전사. 결과를 WebView가 렌더하고 SQLite에 저장.

**Tech Stack:** Tauri v2, Rust, React+TypeScript+Vite, llama.cpp(libmtmd), Qwen3-ASR-0.6B GGUF, Silero VAD(transformers.js wasm), tauri-plugin-sql(SQLite).

**범위 노트:** 이 플랜은 **데스크톱(macOS) 프로토타입**까지다. 가장 큰 리스크(llama.cpp mtmd Rust 바인딩)를 NDK 변수 없이 먼저 제거한다. **Android 포팅**과 **또박또박 통합**은 바인딩이 확정된 뒤 별도 후속 플랜으로 작성한다(설계서 §9 단계 5·6).

**선행 사실 (실측·조사 완료):**
- 검증된 모델: `/Users/jji/project/qwen-native-poc/gguf/llm-q4_k_m.gguf`(462MB) + `gguf/mmproj-q8.gguf`(204MB). `llama-mtmd-cli`로 한국어 전사 확인됨(`ko.wav` → "안녕하세요. 오늘 회의를 시작하겠습니다...").
- 검증된 fixture: `/Users/jji/project/qwen-native-poc/ko.wav`(16kHz mono, 7.67s).
- `llama-cpp-2` crate는 mtmd 미지원. 후보 바인딩: `mullama` crate(멀티모달 표방, docs.rs 빌드실패 이력 → 로컬 빌드 확인 필요) / 폴백 = libmtmd C API 직접 FFI / 데스크톱 한정 폴백 = `llama-server` HTTP.
- libmtmd 오디오 = 30초 고정청크 패딩 + "experimental", 알려진 버그 #21847(긴 오디오 무출력) → 세그먼트는 ≤30초로 제한, 스파이크서 긴 입력도 검증.
- VAD 청킹 로직은 `/Users/jji/project/moonshine-poc/worker.js`·`processor.js`에 동작본 존재(포팅 소스).

---

## Task 0: 리포 골격 + fixture 자산 배치

**Files:**
- Create: `ondevice-stt/` (신규 독립 디렉토리, ddobakddobak 밖)
- Create: `ondevice-stt/README.md`
- Create: `ondevice-stt/fixtures/ko.wav` (복사)

- [ ] **Step 1: 디렉토리 + fixture 복사**

```bash
mkdir -p /Users/jji/project/ondevice-stt/fixtures
cp /Users/jji/project/qwen-native-poc/ko.wav /Users/jji/project/ondevice-stt/fixtures/ko.wav
mkdir -p /Users/jji/project/ondevice-stt/models
cp /Users/jji/project/qwen-native-poc/gguf/llm-q4_k_m.gguf /Users/jji/project/ondevice-stt/models/
cp /Users/jji/project/qwen-native-poc/gguf/mmproj-q8.gguf /Users/jji/project/ondevice-stt/models/
cd /Users/jji/project/ondevice-stt && git init
```

- [ ] **Step 2: README + .gitignore**

`ondevice-stt/README.md`:
```markdown
# ondevice-stt
독립 온디바이스 STT 프로토타입 (Qwen3-ASR-0.6B + llama.cpp, Tauri).
설계: ddobakddobak/docs/superpowers/specs/2026-05-29-ondevice-stt-design.md
```

`ondevice-stt/.gitignore`:
```
/models/*.gguf
node_modules/
src-tauri/target/
dist/
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jji/project/ondevice-stt
git add README.md .gitignore && git commit -m "chore: scaffold ondevice-stt repo"
```

---

## Task 1: [SPIKE] llama.cpp mtmd Rust 바인딩 확정

**목적:** Rust에서 Qwen3-ASR GGUF로 wav를 전사하는 함수 하나를 동작시킨다. 이 태스크의 **산출물 = 바인딩 방법 확정 + 통과하는 통합 테스트**. (정확한 바인딩 API가 사전 미상이므로 스파이크로 결정한다.)

**Files:**
- Create: `ondevice-stt/spike/Cargo.toml`
- Create: `ondevice-stt/spike/src/main.rs`

- [ ] **Step 1: 후보 1 — mullama crate 빌드 확인**

`ondevice-stt/spike/Cargo.toml`:
```toml
[package]
name = "stt-spike"
version = "0.0.0"
edition = "2021"

[dependencies]
mullama = "*"      # 최신 버전 확인; 멀티모달/오디오 지원 표방
hound = "3"        # wav 로딩
anyhow = "1"
```

```bash
cd /Users/jji/project/ondevice-stt/spike && cargo build 2>&1 | tail -30
```
Expected: 빌드 성공 또는 실패 로그. **실패하면 Step 4(폴백)로.**

- [ ] **Step 2: mullama로 전사 스파이크 작성**

`spike/src/main.rs` (mullama 실제 API는 빌드 후 `cargo doc --open` 또는 repo 예제로 확정; 아래는 목표 형태):
```rust
// 목표: 모델+mmproj 로드 → wav f32 PCM 16k → 전사 텍스트
// mullama의 Model/Context + audio/mmproj API로 구현.
// 산출: fn transcribe_wav(model, mmproj, wav_path) -> anyhow::Result<String>
fn main() -> anyhow::Result<()> {
    let text = transcribe_wav(
        "../models/llm-q4_k_m.gguf",
        "../models/mmproj-q8.gguf",
        "../fixtures/ko.wav",
    )?;
    println!("RESULT: {text}");
    Ok(())
}
```

- [ ] **Step 3: 스파이크 실행 — 한국어 출력 확인**

```bash
cd /Users/jji/project/ondevice-stt/spike && cargo run --release 2>/dev/null
```
Expected: `RESULT:` 뒤에 "안녕하세요" 포함 한국어 문장. 성공 시 **Task 1 종료, Task 2로**.

- [ ] **Step 4: [조건부 폴백] mullama 불가 시 — libmtmd 직접 FFI**

mullama 빌드/API 불가 시:
```toml
# Cargo.toml 교체
[dependencies]
llama-cpp-sys-2 = "*"   # 또는 vendored llama.cpp + cc/bindgen
bindgen = "0.70"
hound = "3"
anyhow = "1"
[build-dependencies]
bindgen = "0.70"
cc = "1"
```
`build.rs`로 `llama.cpp/tools/mtmd/mtmd.h` 바인딩 생성, `mtmd_init_from_file`/`mtmd_tokenize`/`mtmd_helper_eval` + `llama_decode` 호출로 `transcribe_wav` 구현. 참조: llama.cpp `tools/mtmd/mtmd.h`, `mtmd-cli.cpp`.
Expected: Step 3과 동일 출력.

- [ ] **Step 5: 바인딩 결정 기록 + Commit**

`ondevice-stt/docs/BINDING.md`에 채택 방법(mullama vs FFI), 버전, 핵심 호출 시퀀스, 빌드 플래그 기록.
```bash
cd /Users/jji/project/ondevice-stt
git add spike docs/BINDING.md && git commit -m "spike: confirm llama.cpp mtmd rust binding for qwen3-asr"
```

---

## Task 2: `stt-core` 크레이트 — Transcriber 트레이트 + LocalTranscriber

**Files:**
- Create: `ondevice-stt/crates/stt-core/Cargo.toml`
- Create: `ondevice-stt/crates/stt-core/src/lib.rs`
- Create: `ondevice-stt/crates/stt-core/src/local.rs`
- Test: `ondevice-stt/crates/stt-core/tests/transcribe_fixture.rs`

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`crates/stt-core/tests/transcribe_fixture.rs`:
```rust
use stt_core::{LocalTranscriber, Transcriber};

#[test]
fn transcribes_korean_fixture() {
    let t = LocalTranscriber::new(
        "../../models/llm-q4_k_m.gguf",
        "../../models/mmproj-q8.gguf",
    ).expect("load");
    // 16k mono f32 PCM from fixture
    let pcm = stt_core::test_util::read_wav_f32("../../fixtures/ko.wav");
    let seg = t.transcribe(&pcm, 16000).expect("transcribe");
    assert!(seg.text.contains("안녕"), "got: {}", seg.text);
}
```

- [ ] **Step 2: 트레이트 + 타입 정의**

`crates/stt-core/src/lib.rs`:
```rust
pub mod local;
pub mod test_util;
pub use local::LocalTranscriber;

#[derive(Debug, Clone)]
pub struct Segment {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

pub trait Transcriber: Send + Sync {
    /// 16kHz mono f32 PCM 세그먼트를 전사.
    fn transcribe(&self, pcm: &[f32], sample_rate: u32) -> anyhow::Result<Segment>;
}
```

`crates/stt-core/src/test_util.rs`:
```rust
pub fn read_wav_f32(path: &str) -> Vec<f32> {
    let mut r = hound::WavReader::open(path).unwrap();
    r.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect()
}
```

- [ ] **Step 3: LocalTranscriber 구현 (Task 1 바인딩 재사용)**

`crates/stt-core/src/local.rs` — Task 1에서 확정한 바인딩(mullama 또는 FFI)으로 `transcribe_wav` 로직을 구조체로 래핑:
```rust
use crate::{Segment, Transcriber};

pub struct LocalTranscriber { /* model, mmproj handles (Task1 확정 타입) */ }

impl LocalTranscriber {
    pub fn new(model: &str, mmproj: &str) -> anyhow::Result<Self> {
        // Task 1의 모델/mmproj 로드
        todo!("Task 1 바인딩 로드 코드 이식")
    }
}

impl Transcriber for LocalTranscriber {
    fn transcribe(&self, pcm: &[f32], _sr: u32) -> anyhow::Result<Segment> {
        // Task 1의 전사 호출. start/end_ms는 호출자(WebView)가 채우므로 0.
        let text = /* 전사 */ String::new();
        Ok(Segment { text, start_ms: 0, end_ms: 0 })
    }
}
```
> 주의: `todo!`/`/* 전사 */`는 Task 1 산출 코드로 **반드시 치환**. Task 1 미완 시 이 태스크 진행 금지.

`Cargo.toml`에 `hound`, `anyhow`, Task1 바인딩 의존성 추가.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd /Users/jji/project/ondevice-stt/crates/stt-core && cargo test --release transcribes_korean_fixture -- --nocapture`
Expected: PASS (출력에 한국어 전사).

- [ ] **Step 5: Commit**

```bash
cd /Users/jji/project/ondevice-stt
git add crates/stt-core && git commit -m "feat(stt-core): Transcriber trait + LocalTranscriber (qwen3-asr)"
```

---

## Task 3: Tauri v2 앱 골격 (데스크톱)

**Files:**
- Create: `ondevice-stt/` Tauri 프로젝트 (src-tauri/, src/, package.json 등)

- [ ] **Step 1: Tauri 앱 생성 (React+TS)**

```bash
cd /Users/jji/project/ondevice-stt
npm create tauri-app@latest . -- --template react-ts --manager npm --yes
npm install
```
Expected: `src-tauri/`, `src/`, `package.json` 생성.

- [ ] **Step 2: 빌드/실행 확인**

```bash
cd /Users/jji/project/ondevice-stt && npm run tauri dev
```
Expected: 데스크톱 창에 기본 Tauri 화면. 확인 후 종료.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold tauri v2 react-ts app"
```

---

## Task 4: Tauri command — transcribe (stt-core 연결)

**Files:**
- Modify: `ondevice-stt/src-tauri/Cargo.toml`
- Modify: `ondevice-stt/src-tauri/src/lib.rs`
- Create: `ondevice-stt/src-tauri/src/stt.rs`

- [ ] **Step 1: stt-core 의존성 추가**

`src-tauri/Cargo.toml` `[dependencies]`에:
```toml
stt-core = { path = "../crates/stt-core" }
```
(`crates/`를 워크스페이스에 포함하도록 루트 `Cargo.toml` workspace members 조정.)

- [ ] **Step 2: transcribe command + 전역 모델 상태**

`src-tauri/src/stt.rs`:
```rust
use std::sync::Mutex;
use stt_core::{LocalTranscriber, Transcriber};
use tauri::State;

pub struct SttState(pub Mutex<Option<LocalTranscriber>>);

#[tauri::command]
pub fn stt_load(model: String, mmproj: String, state: State<SttState>) -> Result<(), String> {
    let t = LocalTranscriber::new(&model, &mmproj).map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(t);
    Ok(())
}

#[tauri::command]
pub fn stt_transcribe(pcm: Vec<f32>, state: State<SttState>) -> Result<String, String> {
    let guard = state.0.lock().unwrap();
    let t = guard.as_ref().ok_or("model not loaded")?;
    t.transcribe(&pcm, 16000).map(|s| s.text).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: command 등록**

`src-tauri/src/lib.rs` run() 안:
```rust
mod stt;
// .manage(stt::SttState(Default::default()))
// .invoke_handler(tauri::generate_handler![stt::stt_load, stt::stt_transcribe])
```

- [ ] **Step 4: 빌드 확인**

Run: `cd /Users/jji/project/ondevice-stt && npm run tauri build -- --debug 2>&1 | tail -20`
Expected: Rust 컴파일 성공.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(tauri): stt_load + stt_transcribe commands"
```

---

## Task 5: VAD 청킹 모듈 (WebView TS) — 순수 로직 + 테스트

**Files:**
- Create: `ondevice-stt/src/stt/chunker.ts`
- Test: `ondevice-stt/src/stt/chunker.test.ts`
- Create: `ondevice-stt/public/vad-processor.js` (POC processor.js 이식)

> 청킹 핵심 규칙(설계 §4 + libmtmd 30초 제약): VAD가 침묵(~400ms) 또는 **최대 세그먼트(기본 20s, ≤30s)** 도달 시 세그먼트 확정. `inferenceChain` 오염 금지(POC 회귀).

- [ ] **Step 1: vitest 설치**

```bash
cd /Users/jji/project/ondevice-stt && npm i -D vitest
```
`package.json` scripts에 `"test": "vitest run"`.

- [ ] **Step 2: 실패하는 테스트 — 세그먼트 경계 로직**

`src/stt/chunker.test.ts`:
```ts
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
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd /Users/jji/project/ondevice-stt && npx vitest run src/stt/chunker.test.ts`
Expected: FAIL ("Cannot find module './chunker'").

- [ ] **Step 4: SegmentAccumulator 구현**

`src/stt/chunker.ts`:
```ts
export interface ChunkerOpts { sampleRate: number; minSilenceMs: number; maxSegmentS: number; }

export class SegmentAccumulator {
  private buf: Float32Array[] = [];
  private samples = 0;
  private silenceSamples = 0;
  private recording = false;
  private minSilence: number;
  private maxSamples: number;
  onSegment: (pcm: Float32Array) => void = () => {};

  constructor(private opts: ChunkerOpts) {
    this.minSilence = (opts.minSilenceMs / 1000) * opts.sampleRate;
    this.maxSamples = opts.maxSegmentS * opts.sampleRate;
  }

  feed(frame: Float32Array, isSpeech: boolean) {
    if (!this.recording && !isSpeech) return;
    this.recording = true;
    this.buf.push(frame);
    this.samples += frame.length;
    if (isSpeech) this.silenceSamples = 0;
    else this.silenceSamples += frame.length;

    if (this.silenceSamples >= this.minSilence || this.samples >= this.maxSamples) {
      this.emit();
    }
  }

  flush() { if (this.recording && this.samples > 0) this.emit(); }

  private emit() {
    const pcm = new Float32Array(this.samples);
    let off = 0;
    for (const f of this.buf) { pcm.set(f, off); off += f.length; }
    this.buf = []; this.samples = 0; this.silenceSamples = 0; this.recording = false;
    this.onSegment(pcm);
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/stt/chunker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: vad-processor.js 이식**

`public/vad-processor.js` ← `/Users/jji/project/moonshine-poc/processor.js` 그대로 복사(512샘플 프레임 AudioWorklet).

- [ ] **Step 7: Commit**

```bash
git add src/stt public/vad-processor.js package.json && git commit -m "feat(chunker): VAD segment accumulator + tests"
```

---

## Task 6: 마이크 캡처 + Silero VAD + 전사 연결 (WebView)

**Files:**
- Create: `ondevice-stt/src/stt/useStt.ts`
- Modify: `ondevice-stt/src/App.tsx`

- [ ] **Step 1: transformers.js 설치**

```bash
cd /Users/jji/project/ondevice-stt && npm i @huggingface/transformers@3.7.1
```

- [ ] **Step 2: useStt 훅 — 캡처→VAD→chunker→Tauri transcribe**

`src/stt/useStt.ts`:
```ts
import { useRef, useState } from "react";
import { AutoModel, Tensor } from "@huggingface/transformers";
import { invoke } from "@tauri-apps/api/core";
import { SegmentAccumulator } from "./chunker";

const SR = 16000, SPEECH = 0.3, EXIT = 0.1;

export function useStt() {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const ref = useRef<any>({});

  async function start() {
    const vad = await AutoModel.from_pretrained("onnx-community/silero-vad",
      { config: { model_type: "custom" }, dtype: "fp32" });
    let state = new Tensor("float32", new Float32Array(2*128), [2,1,128]);
    const sr = new Tensor("int64", [SR], []);
    const acc = new SegmentAccumulator({ sampleRate: SR, minSilenceMs: 400, maxSegmentS: 20 });
    acc.onSegment = async (pcm) => {
      const text: string = await invoke("stt_transcribe", { pcm: Array.from(pcm) });
      if (text.trim()) setLines((l) => [...l, text.trim()]);
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: SR, echoCancellation: true, noiseSuppression: true } });
    const ctx = new AudioContext({ sampleRate: SR });
    await ctx.audioWorklet.addModule("/vad-processor.js");
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "vad-processor", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
    src.connect(node);
    let recording = false;
    node.port.onmessage = async (e) => {
      const frame: Float32Array = e.data.buffer;
      const out = await vad({ input: new Tensor("float32", frame, [1, frame.length]), sr, state });
      state = out.stateN;
      const p = out.output.data[0];
      const speech = p > SPEECH || (recording && p >= EXIT);
      recording = speech || recording;
      acc.feed(frame, speech);
    };
    ref.current = { stream, ctx, acc };
    setRunning(true);
  }

  function stop() {
    const { stream, ctx, acc } = ref.current;
    acc?.flush();
    stream?.getTracks().forEach((t: any) => t.stop());
    ctx?.close();
    setRunning(false);
  }

  return { lines, running, start, stop };
}
```

- [ ] **Step 3: App.tsx — 모델 로드 + UI 연결**

`src/App.tsx`:
```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStt } from "./stt/useStt";

export default function App() {
  const { lines, running, start, stop } = useStt();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // 프로토타입: models/ 절대경로로 로드
    invoke("stt_load", {
      model: "/Users/jji/project/ondevice-stt/models/llm-q4_k_m.gguf",
      mmproj: "/Users/jji/project/ondevice-stt/models/mmproj-q8.gguf",
    }).then(() => setReady(true)).catch(console.error);
  }, []);
  return (
    <main style={{ padding: 16, fontFamily: "system-ui" }}>
      <h1>온디바이스 STT</h1>
      <button disabled={!ready} onClick={running ? stop : start}>
        {running ? "회의 종료" : ready ? "회의 시작" : "모델 로딩..."}
      </button>
      <ul>{lines.map((t, i) => <li key={i} style={{ fontSize: 18 }}>{t}</li>)}</ul>
    </main>
  );
}
```

- [ ] **Step 4: 수동 검증 — 실제 연속 전사**

Run: `cd /Users/jji/project/ondevice-stt && npm run tauri dev`
Expected: "회의 시작" 클릭 → 마이크 권한 허용 → 한국어 말하면 발화 단위로 줄 추가. 밀림/유실 없는지 확인.

- [ ] **Step 5: Commit**

```bash
git add src && git commit -m "feat(webview): mic + silero VAD + continuous transcribe loop"
```

---

## Task 7: 로컬 저장 (SQLite) + 회의 목록

**Files:**
- Modify: `ondevice-stt/src-tauri/Cargo.toml` (tauri-plugin-sql)
- Modify: `ondevice-stt/src-tauri/src/lib.rs`
- Create: `ondevice-stt/src/db.ts`
- Modify: `ondevice-stt/src/App.tsx`

- [ ] **Step 1: tauri-plugin-sql 추가**

```bash
cd /Users/jji/project/ondevice-stt && npm i @tauri-apps/plugin-sql
```
`src-tauri/Cargo.toml`: `tauri-plugin-sql = { version = "2", features = ["sqlite"] }`
`src-tauri/src/lib.rs` run()에 `.plugin(tauri_plugin_sql::Builder::default().build())`.

- [ ] **Step 2: 스키마 + db 헬퍼**

`src/db.ts`:
```ts
import Database from "@tauri-apps/plugin-sql";
let db: Database;
export async function initDb() {
  db = await Database.load("sqlite:meetings.db");
  await db.execute(`CREATE TABLE IF NOT EXISTS meetings(
    id INTEGER PRIMARY KEY, title TEXT, created_at TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS segments(
    id INTEGER PRIMARY KEY, meeting_id INTEGER, text TEXT, start_ms INTEGER, end_ms INTEGER)`);
}
export async function newMeeting(title: string): Promise<number> {
  const r = await db.execute("INSERT INTO meetings(title, created_at) VALUES(?, datetime('now'))", [title]);
  return r.lastInsertId as number;
}
export async function addSegment(mid: number, text: string) {
  await db.execute("INSERT INTO segments(meeting_id, text, start_ms, end_ms) VALUES(?,?,0,0)", [mid, text]);
}
export async function listMeetings() {
  return db.select<any[]>("SELECT * FROM meetings ORDER BY id DESC");
}
```

- [ ] **Step 3: App에서 회의 시작 시 newMeeting, 세그먼트마다 addSegment**

`App.tsx`: `start()` 전 `initDb()`, 회의 시작 시 `newMeeting` → id 보관, `useStt`의 onSegment 콜백에서 `addSegment(mid, text)`. (useStt에 `onLine?: (t:string)=>void` 콜백 추가해 App이 저장.)

- [ ] **Step 4: 수동 검증 — 저장 + 목록**

Run: `npm run tauri dev` → 회의 1회 진행 → 앱 재시작 → 회의/세그먼트 유지 확인.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): sqlite meetings + segments persistence"
```

---

## Task 8: 내보내기 (txt) + 서버전송 stub

**Files:**
- Create: `ondevice-stt/src/export.ts`
- Modify: `ondevice-stt/src/App.tsx`

- [ ] **Step 1: txt 내보내기**

`src/export.ts`:
```ts
export function exportTxt(lines: string[], filename = "transcript.txt") {
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}
// 서버 전송 시드(미구현): 후속 또박또박 통합 시 ServerTranscriber/sync 진입점.
export async function sendToServer(_meetingId: number): Promise<void> {
  throw new Error("not implemented: server sync (deferred)");
}
```

- [ ] **Step 2: App에 내보내기 버튼**

`App.tsx`에 `<button onClick={() => exportTxt(lines)}>내보내기</button>`.

- [ ] **Step 3: 수동 확인 + Commit**

```bash
git add -A && git commit -m "feat(export): txt export + server-sync stub"
```

---

## Task 9: 모델 로더 정리 (상대경로 → 앱 데이터 디렉토리, 첫실행 다운로드 자리)

**Files:**
- Modify: `ondevice-stt/src-tauri/src/stt.rs`
- Create: `ondevice-stt/src-tauri/src/model_path.rs`

- [ ] **Step 1: 앱 데이터 경로 해석 command**

`model_path.rs`: `tauri::path` API로 앱 데이터 디렉토리의 `models/llm-q4_k_m.gguf`·`mmproj-q8.gguf` 경로 반환하는 command. 없으면 명확한 에러(다운로드 안내 자리 — 실제 다운로드는 Android 플랜에서). 프로토타입은 `models/` 수동 배치 허용.

- [ ] **Step 2: App.tsx가 하드코딩 경로 대신 command 사용**

- [ ] **Step 3: 빌드/실행 확인 + Commit**

```bash
git add -A && git commit -m "refactor(stt): resolve model path via app data dir"
```

---

## 후속 플랜 (이 플랜 범위 밖 — 별도 작성)

- **Android 포팅 플랜**: Task 1 바인딩을 ARM/NDK로 빌드(`cargo-ndk`), `tauri android init`, llama.cpp ARM 컴파일·링크, 모델 첫실행 다운로드, 실기기 RTF/RAM/발열 검증. (설계 §6·§9-5)
- **또박또박 통합 플랜**: `stt-core`를 또박 Tauri에 의존성 추가, `ServerTranscriber`(기존 sidecar 경로) 구현, 설정/회의별 `local|server` 선택 UI, 트랜스크립트 동기화. (설계 §3·§9-6)

---

## Self-Review 메모

- **스펙 커버리지**: §1 목표(독립앱·연속전사)=Task3-6, §2 모델(Qwen Q4 llama.cpp)=Task1-2·4, §3 아키텍처(Transcriber trait/WebView↔Rust)=Task2·4·6, §4 흐름(VAD/flush)=Task5-6, §5 저장=Task7, §6 배포(경로/다운로드 자리)=Task9, §7 에러(체인오염·미로드)=Task5·4, §8 테스트=Task2·5. Android/통합(§9-5·6)=후속 플랜 명시.
- **플레이스홀더**: Task1 스파이크의 바인딩 API와 Task2-3의 `todo!`는 의도된 스파이크 산출물(Task1 완료 후 치환)로, 숨은 TODO 아님 — Task2 Step3에 치환 강제 명시.
- **타입 일관성**: `Transcriber.transcribe(&[f32], u32) -> Segment`, `Segment{text,start_ms,end_ms}`, command `stt_load`/`stt_transcribe`, `SegmentAccumulator.onSegment(Float32Array)` — 전 태스크 일관.
