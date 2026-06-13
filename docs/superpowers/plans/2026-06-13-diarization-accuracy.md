# 화자분리 정확도(AHC threshold) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의별로 화자분리 민감도(AHC distance threshold)를 조절해 과소분할(여러 명이 한 화자로 병합)을 고친다. 기본 0.4.

**Architecture:** speakrs 0.4.2를 의존하는 새 Rust CLI 래퍼(`sidecar/speakrs-cli/`)가 `--ahc-threshold`를 노출 → 기존 28MB 하드코딩 바이너리 교체. 값은 회의 컬럼 `diarization_threshold` → Rails job → sidecar `diarization_config.ahc_threshold` → speakrs_runner subprocess 플래그로 흐른다. UI 슬라이더는 `EditMeetingDialog`에 0.1 단위로.

**Tech Stack:** Rust(speakrs, coreml feature), Python(FastAPI sidecar, pytest), Rails(RSpec, SQLite), React+TS(vitest, ky).

**측정 게이트(완료, PASS):** 회의111서 threshold 0.6→4명, 0.4→5명(실참석자 수), 0.2→8명(과분할). AHC threshold가 VBx+reconstruct 거친 최종 화자수를 실제로 제어함이 실측됨. `ExecutionMode` 전환은 무효(현 바이너리 이미 ~full) → 래퍼는 `CoreMl` 고정, threshold만 노출. 상세: `docs/superpowers/specs/2026-06-13-diarization-accuracy-design.md`.

**입력 포맷 주의:** sidecar가 넘기는 PCM은 **Int16 s16le** 16kHz mono(`schemas.py` 확인). 래퍼는 s16le를 읽어 f32(/32768)로 변환. (게이트 throwaway 도구는 f32le였으니 그대로 베끼지 말 것.)

**출력 계약(불변):** stdout JSON `{"speakers":["화자 1",...],"turns":[{"start_ms":int,"end_ms":int,"speaker":"화자 N"}]}`. crate는 초(f64)+`SPEAKER_00`을 주므로 래퍼가 초→ms, raw→**시작시각 등장순 1-based `화자 N`** 변환. stderr `[speakrs-cli]` 타이밍 로그.

---

## File Structure

**Create:**
- `sidecar/speakrs-cli/Cargo.toml` — 새 래퍼 crate manifest
- `sidecar/speakrs-cli/src/main.rs` — 래퍼 본체 (s16le→diarize→JSON)
- `sidecar/speakrs-cli/.gitignore` — `/target`
- `backend/db/migrate/<ts>_add_diarization_threshold_to_meetings.rb`
- `backend/spec/requests/api/v1/meetings_diarization_threshold_spec.rb`
- `sidecar/tests/test_speakrs_runner_threshold.py`

**Modify:**
- `sidecar/app/diarization/speakrs_runner.py` — `run_speakrs(audio_bytes, ahc_threshold=None)` + 플래그
- `sidecar/app/diarization/batch_processor.py:24-46` — `ahc_threshold` 파라미터 thread
- `sidecar/app/routers/stt.py:162-172` — `diar_cfg.get("ahc_threshold")` 추출·전달
- `sidecar/app/schemas.py:58-65` — 주석만(타입 dict 유지)
- `settings.yaml` — diarization 블록에 `ahc_threshold: 0.4`
- `backend/app/services/app_settings.rb:8-33` — `ahc_threshold` 기본키
- `backend/app/jobs/file_transcription_job.rb:19-22` — 회의값 주입
- `backend/app/controllers/api/v1/meetings_controller.rb:109-136` — permitted attr
- `frontend/src/api/meetings.ts:38-73,328-340` — `Meeting` + `UpdateMeetingParams`에 필드
- `frontend/src/components/meeting/EditMeetingDialog.tsx` — 슬라이더 + onConfirm
- `frontend/src/pages/MeetingsPage.tsx` — onConfirm→updateMeeting 매핑

---

## Task 1: Rust 래퍼 crate 작성 (빌드만, 교체 전)

**Files:**
- Create: `sidecar/speakrs-cli/Cargo.toml`
- Create: `sidecar/speakrs-cli/src/main.rs`
- Create: `sidecar/speakrs-cli/.gitignore`

- [ ] **Step 1: Cargo.toml 작성**

`sidecar/speakrs-cli/Cargo.toml`:
```toml
[package]
name = "speakrs-cli"
version = "0.1.0"
edition = "2021"

[dependencies]
# default features include "online" (HF cache 모델 자동 로드). coreml = 네이티브 CoreML(FP32 ~1s step).
speakrs = { version = "0.4.2", features = ["coreml"] }

[[bin]]
name = "speakrs-cli"
path = "src/main.rs"

[profile.release]
opt-level = 3
lto = true
```

- [ ] **Step 2: .gitignore 작성**

`sidecar/speakrs-cli/.gitignore`:
```
/target
```

- [ ] **Step 3: main.rs 작성 (전체 코드)**

`sidecar/speakrs-cli/src/main.rs`:
```rust
// speakrs(Rust/CoreML) diarization CLI 래퍼.
// 입력: PCM s16le 16kHz mono (positional). 출력 stdout JSON:
//   {"speakers":["화자 1",...],"turns":[{"start_ms":int,"end_ms":int,"speaker":"화자 N"}]}
// 옵션: --ahc-threshold <f32> (기본 0.4). 낮을수록 화자 더 분리(거리 컷오프).
// ExecutionMode는 CoreMl 고정(FP32 ~1s step). stderr엔 [speakrs-cli] 타이밍 로그.

use speakrs::{ExecutionMode, OwnedDiarizationPipeline, PipelineConfig};
use std::collections::HashMap;
use std::io::Read;
use std::time::Instant;

fn main() {
    // --- args ---
    let mut pcm_path: Option<String> = None;
    let mut ahc_threshold: f32 = 0.4;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--ahc-threshold" => {
                let v = it.next().unwrap_or_else(|| die("--ahc-threshold needs a value"));
                ahc_threshold = v
                    .parse()
                    .unwrap_or_else(|_| die("--ahc-threshold must be a float"));
            }
            other if pcm_path.is_none() => pcm_path = Some(other.to_string()),
            _ => {}
        }
    }
    let pcm_path = pcm_path
        .unwrap_or_else(|| die("usage: speakrs-cli <pcm_s16le_16k_mono> [--ahc-threshold <f32>]"));

    // --- load s16le PCM -> f32 mono 16k ---
    let mut buf = Vec::new();
    std::fs::File::open(&pcm_path)
        .unwrap_or_else(|e| die(&format!("open pcm: {e}")))
        .read_to_end(&mut buf)
        .unwrap_or_else(|e| die(&format!("read pcm: {e}")));
    let audio: Vec<f32> = buf
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect();
    eprintln!(
        "[speakrs-cli] loaded {} samples = {:.1}s",
        audio.len(),
        audio.len() as f32 / 16000.0
    );

    // --- diarize (CoreMl FP32 ~1s step) ---
    let t0 = Instant::now();
    let mut pipeline = OwnedDiarizationPipeline::from_pretrained(ExecutionMode::CoreMl)
        .unwrap_or_else(|e| die(&format!("build pipeline: {e:?}")));
    let mut cfg = PipelineConfig::default(); // == for_mode(CoreMl): 20 VBx iters
    cfg.ahc.threshold = ahc_threshold;
    let res = pipeline
        .run_with_config(&audio, "audio", &cfg)
        .unwrap_or_else(|e| die(&format!("diarize: {e:?}")));
    eprintln!(
        "[speakrs-cli] diarized in {:.1}s, threshold={:.2}, {} segments",
        t0.elapsed().as_secs_f32(),
        ahc_threshold,
        res.segments.len()
    );

    // --- map raw "SPEAKER_NN" -> "화자 N" in first-appearance(time) order ---
    let mut segs = res.segments.clone();
    segs.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));

    let mut label_map: HashMap<String, String> = HashMap::new();
    let mut ordered: Vec<String> = Vec::new();
    let mut turns = String::new();
    for (i, s) in segs.iter().enumerate() {
        let label = label_map
            .entry(s.speaker.clone())
            .or_insert_with(|| {
                let name = format!("화자 {}", ordered.len() + 1);
                ordered.push(name.clone());
                name
            })
            .clone();
        if i > 0 {
            turns.push(',');
        }
        let start_ms = (s.start * 1000.0).round() as i64;
        let end_ms = (s.end * 1000.0).round() as i64;
        turns.push_str(&format!(
            "{{\"start_ms\":{start_ms},\"end_ms\":{end_ms},\"speaker\":\"{label}\"}}"
        ));
    }
    let speakers = ordered
        .iter()
        .map(|s| format!("\"{s}\""))
        .collect::<Vec<_>>()
        .join(",");
    println!("{{\"speakers\":[{speakers}],\"turns\":[{turns}]}}");
}

fn die(msg: &str) -> ! {
    eprintln!("[speakrs-cli] {msg}");
    std::process::exit(1);
}
```

- [ ] **Step 4: 빌드 (coreml 컴파일 검증)**

Run: `cd sidecar/speakrs-cli && cargo build --release`
Expected: `Finished release` (게이트서 동일 deps 빌드 성공 확인됨). 실패 시 에러 그대로 보고.

- [ ] **Step 5: 커밋 (소스, target 제외)**

```bash
cd /Users/jji/project/ddobakddobak
git add sidecar/speakrs-cli/Cargo.toml sidecar/speakrs-cli/.gitignore sidecar/speakrs-cli/src/main.rs
git commit -m "feat(diarization): speakrs-cli wrapper with --ahc-threshold (CoreMl fixed)"
```

---

## Task 2: 골든/구조 검증 후 바이너리 교체

현 바이너리 출력과 **구조·라벨 매핑**이 같은지 확인하고 교체. (현 바이너리 threshold는 하드코딩이라 *정확히* 못 맞추므로, threshold 0.5에서 화자수 4가 나오는지 + JSON 계약 일치를 본다.)

**Files:**
- Modify (replace binary): `sidecar/bin/speakrs-cli`

- [ ] **Step 1: 검증용 s16le PCM 준비**

Run:
```bash
ffmpeg -y -loglevel error -i /Users/jji/project/ddobakddobak/backend/storage/audio/111.mp3 \
  -ac 1 -ar 16000 -f s16le -acodec pcm_s16le /tmp/m111.s16
ls -la /tmp/m111.s16
```
Expected: 파일 생성(약 132MB).

- [ ] **Step 2: 현 바이너리 출력 캡처 (골든 레퍼런스)**

Run:
```bash
/Users/jji/project/ddobakddobak/sidecar/bin/speakrs-cli /tmp/m111.s16 > /tmp/old.json 2>/tmp/old.err
python3 -c "import json;d=json.load(open('/tmp/old.json'));print('speakers',len(d['speakers']),d['speakers']);print('turns',len(d['turns']),'first',d['turns'][0])"
```
Expected: `speakers 4 ['화자 1','화자 2','화자 3','화자 4']`, turns 키 = start_ms/end_ms/speaker. (DB 회의111 4라벨과 일치.)

- [ ] **Step 3: 신규 래퍼 동일 PCM 실행 (계약 + 화자수)**

Run:
```bash
cd /Users/jji/project/ddobakddobak/sidecar/speakrs-cli
./target/release/speakrs-cli /tmp/m111.s16 --ahc-threshold 0.5 > /tmp/new05.json 2>/tmp/new05.err
./target/release/speakrs-cli /tmp/m111.s16 --ahc-threshold 0.4 > /tmp/new04.json 2>/tmp/new04.err
python3 - <<'PY'
import json
for f in ['/tmp/new05.json','/tmp/new04.json']:
    d=json.load(open(f))
    assert set(d.keys())=={'speakers','turns'}, d.keys()
    for t in d['turns']:
        assert set(t.keys())=={'start_ms','end_ms','speaker'}, t.keys()
        assert isinstance(t['start_ms'],int) and isinstance(t['end_ms'],int)
        assert t['start_ms']<=t['end_ms']
        assert t['speaker'] in d['speakers']
    assert d['speakers']==[f"화자 {i+1}" for i in range(len(d['speakers']))], d['speakers']
    print(f, 'speakers', len(d['speakers']))
PY
```
Expected: 둘 다 계약 통과. `new05` → 4명, `new04` → 5명 (게이트 실측과 일치). 0.5≈현 바이너리 4명이면 계약 동등 입증.

- [ ] **Step 4: runner 파싱 통과 확인 (다운스트림 호환)**

Run:
```bash
cd /Users/jji/project/ddobakddobak/sidecar
python3 - <<'PY'
import json
from app.diarization.speakrs_runner import run_speakrs  # noqa
# JSON을 직접 파싱 경로로만 검증(바이너리 재실행 없이)
d=json.load(open('/tmp/new04.json'))
turns=[(int(t["start_ms"]),int(t["end_ms"]),str(t["speaker"])) for t in d.get("turns",[])]
labels=[str(s) for s in d.get("speakers",[])]
print("parsed", len(turns),"turns", len(labels),"labels:", labels)
assert labels and turns
PY
```
Expected: `parsed N turns 5 labels: ['화자 1'..'화자 5']`.

- [ ] **Step 5: 바이너리 교체 + 커밋**

```bash
cd /Users/jji/project/ddobakddobak
cp sidecar/speakrs-cli/target/release/speakrs-cli sidecar/bin/speakrs-cli
chmod +x sidecar/bin/speakrs-cli
git add sidecar/bin/speakrs-cli
git commit -m "feat(diarization): replace speakrs-cli binary with threshold-aware build"
```
참고: 28MB 바이너리가 git에 raw 추적 중이면 그대로 교체(히스토리 비대는 알려진 trade-off). LFS 전환은 범위 밖.

---

## Task 3: Sidecar passthrough (Python)

**Files:**
- Modify: `sidecar/app/diarization/speakrs_runner.py`
- Modify: `sidecar/app/diarization/batch_processor.py`
- Modify: `sidecar/app/routers/stt.py`
- Test: `sidecar/tests/test_speakrs_runner_threshold.py`

- [ ] **Step 1: 실패 테스트 작성 (run_speakrs가 threshold를 subprocess 인자로 전달)**

`sidecar/tests/test_speakrs_runner_threshold.py`:
```python
import json
from unittest.mock import patch, MagicMock
from app.diarization import speakrs_runner


def _fake_proc(stdout: dict):
    p = MagicMock()
    p.returncode = 0
    p.stdout = json.dumps(stdout).encode("utf-8")
    p.stderr = b""
    return p


@patch("app.diarization.speakrs_runner.subprocess.run")
def test_run_speakrs_passes_threshold_flag(mock_run):
    mock_run.return_value = _fake_proc({"speakers": ["화자 1"], "turns": []})
    speakrs_runner.run_speakrs(b"\x00\x00" * 16000, ahc_threshold=0.4)
    args = mock_run.call_args[0][0]
    assert "--ahc-threshold" in args
    assert args[args.index("--ahc-threshold") + 1] == "0.4"


@patch("app.diarization.speakrs_runner.subprocess.run")
def test_run_speakrs_omits_flag_when_none(mock_run):
    mock_run.return_value = _fake_proc({"speakers": [], "turns": []})
    speakrs_runner.run_speakrs(b"\x00\x00" * 16000, ahc_threshold=None)
    args = mock_run.call_args[0][0]
    assert "--ahc-threshold" not in args
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd sidecar && python -m pytest tests/test_speakrs_runner_threshold.py -v`
Expected: FAIL (`run_speakrs() got an unexpected keyword argument 'ahc_threshold'`).

- [ ] **Step 3: speakrs_runner.run_speakrs 시그니처 + 플래그 추가**

`sidecar/app/diarization/speakrs_runner.py` — `run_speakrs` 정의(현 `:33`)와 subprocess 호출(현 `:49-53`) 수정:
```python
def run_speakrs(
    audio_bytes: bytes,
    ahc_threshold: float | None = None,
) -> tuple[list[tuple[int, int, str]], list[str]]:
    """PCM 16k mono Int16 → (turns, ordered_labels).

    ahc_threshold: 화자 클러스터링 거리 컷오프(낮을수록 화자 더 분리). None=래퍼 기본(0.4).
    turns: [(start_ms, end_ms, '화자 N'), ...]
    ordered_labels: ['화자 1', '화자 2', ...] (등장순)
    실패 시 ([], []) 반환.
    """
    binp = _bin_path()
    if not binp.is_file():
        raise FileNotFoundError(f"speakrs-cli 바이너리 없음: {binp}")

    with tempfile.NamedTemporaryFile(suffix=".pcm", delete=False) as tf:
        tf.write(audio_bytes)
        pcm_path = tf.name

    cmd = [str(binp), pcm_path]
    if ahc_threshold is not None:
        cmd += ["--ahc-threshold", f"{float(ahc_threshold):g}"]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=600,
        )
```
(이하 returncode/파싱 로직은 기존 그대로 유지.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd sidecar && python -m pytest tests/test_speakrs_runner_threshold.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: batch_diarize_speakrs에 threshold thread**

`sidecar/app/diarization/batch_processor.py` — 시그니처(`:24-29`)에 파라미터 추가, runner 호출(`:41`) 수정:
```python
async def batch_diarize_speakrs(
    audio_bytes: bytes,
    segments: list[TranscriptSegment],
    meeting_id: int | None = None,
    db_dir: Path | None = None,
    ahc_threshold: float | None = None,
) -> list[TranscriptSegment]:
```
호출부(현 `loop.run_in_executor(None, run_speakrs, audio_bytes)`)를 functools.partial로:
```python
    from functools import partial
    loop = asyncio.get_running_loop()
    turns, ordered_labels = await loop.run_in_executor(
        None, partial(run_speakrs, audio_bytes, ahc_threshold=ahc_threshold)
    )
```

- [ ] **Step 6: 라우터에서 ahc_threshold 추출·전달**

`sidecar/app/routers/stt.py:162-172` — `diar_cfg` 읽은 뒤, batch 호출에 전달:
```python
    diar_cfg = request.diarization_config or {}
    enable_diarization = diar_cfg.get("enable", False)
    ahc_threshold = diar_cfg.get("ahc_threshold")  # None이면 래퍼 기본(0.4)
    if enable_diarization and segments:
        diar_engine = _resolve_diar_engine()
        try:
            if diar_engine == "speakrs":
                from app.diarization.batch_processor import batch_diarize_speakrs
                segments = await batch_diarize_speakrs(
                    audio_bytes, segments, meeting_id=request.meeting_id,
                    ahc_threshold=ahc_threshold,
                )
```

- [ ] **Step 7: schemas.py 주석 보강 (타입은 dict 유지)**

`sidecar/app/schemas.py:60` `diarization_config: dict | None = None` 줄 주석에 ` # {enable, ahc_threshold, ...}` 추가. 구조 변경 없음.

- [ ] **Step 8: 커밋**

```bash
git add sidecar/app/diarization/speakrs_runner.py sidecar/app/diarization/batch_processor.py sidecar/app/routers/stt.py sidecar/app/schemas.py sidecar/tests/test_speakrs_runner_threshold.py
git commit -m "feat(diarization): thread ahc_threshold from request to speakrs-cli"
```

---

## Task 4: Rails 마이그레이션 (가장 먼저 — 러닝 서버 PendingMigration 500 trap)

**Files:**
- Create: `backend/db/migrate/<ts>_add_diarization_threshold_to_meetings.rb`

- [ ] **Step 1: 마이그레이션 생성**

Run: `cd backend && bin/rails g migration AddDiarizationThresholdToMeetings diarization_threshold:float`
그러면 파일 내용이 아래와 같은지 확인(아니면 맞춰 수정):
```ruby
class AddDiarizationThresholdToMeetings < ActiveRecord::Migration[7.1]
  def change
    add_column :meetings, :diarization_threshold, :float, null: true
  end
end
```

- [ ] **Step 2: 마이그레이트**

Run: `cd backend && bin/rails db:migrate`
Expected: `add_column(:meetings, :diarization_threshold, :float)` 적용. `db/schema.rb` meetings 테이블에 `t.float "diarization_threshold"` 추가됨.

- [ ] **Step 3: 커밋**

```bash
git add backend/db/migrate backend/db/schema.rb
git commit -m "feat(diarization): add meetings.diarization_threshold column"
```

---

## Task 5: Rails 배선 (controller + job + app_settings) + spec

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb`
- Modify: `backend/app/jobs/file_transcription_job.rb`
- Modify: `backend/app/services/app_settings.rb`
- Modify: `settings.yaml`
- Test: `backend/spec/requests/api/v1/meetings_diarization_threshold_spec.rb`

- [ ] **Step 1: 실패 request spec 작성**

`backend/spec/requests/api/v1/meetings_diarization_threshold_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe "Api::V1::Meetings diarization_threshold", type: :request do
  let(:user) { create(:user) }
  let(:meeting) { create(:meeting, created_by: user) }
  let(:headers) { auth_headers(user) }  # support/ 헬퍼(기존 spec 패턴 동일)

  it "persists diarization_threshold on update" do
    patch "/api/v1/meetings/#{meeting.id}",
          params: { diarization_threshold: 0.4 }.to_json,
          headers: headers
    expect(response).to have_http_status(:ok)
    expect(meeting.reload.diarization_threshold).to eq(0.4)
  end

  it "clears diarization_threshold when blank" do
    meeting.update!(diarization_threshold: 0.5)
    patch "/api/v1/meetings/#{meeting.id}",
          params: { diarization_threshold: "" }.to_json,
          headers: headers
    expect(response).to have_http_status(:ok)
    expect(meeting.reload.diarization_threshold).to be_nil
  end
end
```
> 참고: `auth_headers`/factory 명칭은 기존 `spec/requests/api/v1/meetings_sharing_spec.rb`와 동일 헬퍼를 사용. 다르면 그 파일의 패턴에 맞춰 한 줄만 교체.

- [ ] **Step 2: spec 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_diarization_threshold_spec.rb`
Expected: FAIL (threshold가 nil로 남음 — permit 안 됨).

- [ ] **Step 3: controller update에 permitted attr 추가**

`backend/app/controllers/api/v1/meetings_controller.rb` update 메서드, `expected_participants` 줄(`:117`) 바로 아래:
```ruby
        attrs[:expected_participants] = params[:expected_participants].presence&.to_i if params.key?(:expected_participants)
        attrs[:diarization_threshold] = params[:diarization_threshold].to_s.strip.presence&.to_f if params.key?(:diarization_threshold)
```
(`""` → nil, 숫자문자열 → float. expected_participants와 동일 패턴.)

- [ ] **Step 4: spec 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_diarization_threshold_spec.rb`
Expected: PASS (2 examples, 0 failures).

- [ ] **Step 5: settings.yaml 글로벌 기본값 추가**

`settings.yaml` diarization 블록에 한 줄:
```yaml
diarization:
  enabled: true
  engine: speakrs
  ahc_threshold: 0.4
  similarity_threshold: 0.35
  merge_threshold: 0.5
  max_embeddings_per_speaker: 15
  clustering_threshold: 0.5
```

- [ ] **Step 6: AppSettings에 기본키 추가**

`backend/app/services/app_settings.rb` — `DIARIZATION_DEFAULTS`(`:8-14`)에 추가:
```ruby
  DIARIZATION_DEFAULTS = {
    "enable" => false,
    "ahc_threshold" => 0.4,
    "clustering_threshold" => 0.6,
    "similarity_threshold" => 0.35,
    "merge_threshold" => 0.5,
    "max_embeddings_per_speaker" => 15
  }.freeze
```
`diarization_config`(`:24-33`) 반환 해시에 추가:
```ruby
      "enable" => d.key?("enabled") ? !!d["enabled"] : DIARIZATION_DEFAULTS["enable"],
      "ahc_threshold" => (d["ahc_threshold"] || DIARIZATION_DEFAULTS["ahc_threshold"]).to_f,
```

- [ ] **Step 7: job에서 회의값 주입 (글로벌 기본을 override)**

`backend/app/jobs/file_transcription_job.rb` — `expected_participants` 주입 블록(`:19-22`) 바로 아래:
```ruby
    diarization_config = AppSettings.diarization_config
    if meeting.expected_participants.present?
      diarization_config["expected_speakers"] = meeting.expected_participants
    end
    if meeting.diarization_threshold.present?
      diarization_config["ahc_threshold"] = meeting.diarization_threshold
    end
```

- [ ] **Step 8: 전체 backend spec 회귀 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_diarization_threshold_spec.rb spec/services`
Expected: 신규 2 PASS + 기존 services spec green.

- [ ] **Step 9: 커밋**

```bash
git add backend/app/controllers/api/v1/meetings_controller.rb backend/app/jobs/file_transcription_job.rb backend/app/services/app_settings.rb settings.yaml backend/spec/requests/api/v1/meetings_diarization_threshold_spec.rb
git commit -m "feat(diarization): wire per-meeting ahc_threshold (controller/job/app_settings)"
```

---

## Task 6: Frontend 슬라이더

**Files:**
- Modify: `frontend/src/api/meetings.ts`
- Modify: `frontend/src/components/meeting/EditMeetingDialog.tsx`
- Modify: `frontend/src/pages/MeetingsPage.tsx`

- [ ] **Step 1: 타입에 필드 추가**

`frontend/src/api/meetings.ts` — `Meeting` 인터페이스(`expected_participants` 줄 `:57` 아래):
```ts
  /** 참여 인원수 (화자분리 ±2 힌트). null=자동 감지 */
  expected_participants?: number | null
  /** 화자분리 거리 컷오프(AHC). 낮을수록 화자 더 분리. null=글로벌 기본(0.4) */
  diarization_threshold?: number | null
```
`UpdateMeetingParams`(`:335` 아래):
```ts
  expected_participants?: number | null
  diarization_threshold?: number | null
```

- [ ] **Step 2: EditMeetingDialog onConfirm 타입 + state**

`frontend/src/components/meeting/EditMeetingDialog.tsx` — `onConfirm` 시그니처(`:13`)에 필드 추가:
```ts
  onConfirm: (data: { title: string; meeting_type: string; tag_ids: number[]; brief_summary: string | null; attendees: string | null; expected_participants: number | null; diarization_threshold: number | null; shared: boolean }) => void
```
state 추가(`expectedParticipants` state `:29-31` 아래):
```ts
  const [diarizationThreshold, setDiarizationThreshold] = useState(
    meeting.diarization_threshold != null ? String(meeting.diarization_threshold) : ''
  )
```
`handleSubmit`의 `onConfirm({...})`에 추가:
```ts
      expected_participants: expectedParticipants.trim() ? Number(expectedParticipants) : null,
      diarization_threshold: diarizationThreshold.trim() ? Number(diarizationThreshold) : null,
      shared,
```

- [ ] **Step 3: 슬라이더 UI 추가 ("참여 인원" 블록 바로 아래)**

`EditMeetingDialog.tsx` — "참여 인원" `</div>` 다음, "STT 모델" 블록 앞에:
```tsx
          {/* 화자 구분 민감도 (AHC threshold) */}
          <div>
            <label className="block text-sm font-medium mb-1">
              화자 구분 민감도{diarizationThreshold ? ` (${diarizationThreshold})` : ' (기본)'}
            </label>
            <input
              type="range"
              min={0.2}
              max={0.8}
              step={0.1}
              value={diarizationThreshold || '0.4'}
              onChange={(e) => setDiarizationThreshold(e.target.value)}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>적게 나눔(0.8)</span>
              <button
                type="button"
                onClick={() => setDiarizationThreshold('')}
                className="underline hover:text-foreground"
              >
                기본값(0.4)
              </button>
              <span>많이 나눔(0.2)</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              여러 명이 한 화자로 뭉치면 값을 낮추세요. 저장 후 STT 재실행 시 적용됩니다.
            </p>
          </div>
```
> 주의: 슬라이더는 0.2(왼쪽)~0.8 인데 라벨상 "많이 나눔"이 낮은 값. min/max는 숫자 그대로 두고 좌우 설명으로 방향을 안내(역방향 재매핑 불필요).

- [ ] **Step 4: MeetingsPage onConfirm → updateMeeting 매핑**

`frontend/src/pages/MeetingsPage.tsx`에서 `EditMeetingDialog`의 `onConfirm` 콜백 찾기(`updateMeeting(` 또는 `expected_participants` 검색). 그 호출 객체에 한 줄 추가:
```ts
      expected_participants: data.expected_participants,
      diarization_threshold: data.diarization_threshold,
```
(콜백이 `data`를 그대로 `updateMeeting(id, data)`로 넘기면 별도 수정 불필요 — 타입만 통과시키면 됨. 명시 매핑이면 위 한 줄 추가.)

- [ ] **Step 5: 타입체크 + 빌드**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 에러 없음. (EditMeetingDialog.test.tsx의 onConfirm mock이 새 필드로 깨지면 그 테스트의 기대 객체에 `diarization_threshold: null` 추가.)

- [ ] **Step 6: 기존 다이얼로그 테스트 갱신 + 실행**

Run: `cd frontend && npx vitest run src/components/meeting/EditMeetingDialog.test.tsx`
Expected: PASS. onConfirm 인자 단언이 있으면 `diarization_threshold: null` 포함하도록 수정.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/api/meetings.ts frontend/src/components/meeting/EditMeetingDialog.tsx frontend/src/pages/MeetingsPage.tsx frontend/src/components/meeting/EditMeetingDialog.test.tsx
git commit -m "feat(diarization): per-meeting sensitivity slider in EditMeetingDialog"
```

---

## Task 7: E2E 검증 (회의 111)

**Files:** 없음 (런타임 검증).

- [ ] **Step 1: 서버/sidecar 재기동 (새 바이너리·코드 로드)**

Run: 개발 스크립트로 sidecar+backend 재시작(예 `./dev.sh` 또는 해당 프로세스). sidecar가 교체된 `bin/speakrs-cli`를 쓰는지 확인.

- [ ] **Step 2: 회의 111에 threshold 0.4 설정**

UI: 회의 111 열기 → 정보 수정 → "화자 구분 민감도" 0.4 → 저장.
또는 직접: `PATCH /api/v1/meetings/111 {diarization_threshold: 0.4}`.
확인: `sqlite3 backend/storage/development.sqlite3 "SELECT diarization_threshold FROM meetings WHERE id=111;"` → `0.4`.

- [ ] **Step 3: STT 재실행**

UI에서 "STT 재실행"(regenerate_stt). 완료까지 대기(69분 오디오라 수 분).

- [ ] **Step 4: 화자 5명으로 분리됐는지 검증**

Run:
```bash
sqlite3 backend/storage/development.sqlite3 \
  "SELECT speaker_label, COUNT(*) FROM transcripts WHERE meeting_id=111 GROUP BY speaker_label ORDER BY speaker_label;"
```
Expected: **화자 1~화자 5** (4개가 아니라 5개). 기존 "홍춘식, 조덕현" 병합이 두 화자로 갈림. (speaker_name은 재전사로 초기화되므로 라벨 수만 확인 → 청취로 실제 분리 품질 확인.)

- [ ] **Step 5: 결과 기록**

`docs/superpowers/specs/2026-06-13-diarization-accuracy-design.md` 하단에 E2E 결과(화자수, 체감 품질) 한 줄 추가. status done.

---

## Notes / 범위 밖
- Phase 2(화자별 문장분리), 임베딩 rename/재클러스터: 별도 plan.
- 28MB 바이너리 LFS 전환: 별도.
- mac 전용 빌드(coreml): 리눅스 서버는 graceful degrade(diarization off)로 무영향 — 별도 대응 불필요.
