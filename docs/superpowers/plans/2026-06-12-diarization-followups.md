# 화자분리 후속 3건 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SpeakerPanel 접기 + 배치 화자분리 세밀화(참여인원 ±2 힌트 + clustering threshold) + 화자분리 ON 시 회의록 자동생성 스킵(수동 생성 흐름).

**Architecture:** spec `docs/superpowers/specs/2026-06-12-diarization-followups-design.md` 참조. 백엔드(Rails)는 `meetings.expected_participants` 컬럼과 `clustering_threshold` 설정을 sidecar `diarization_config`로 전달, sidecar(FastAPI)는 pyannote community-1에 call-time `min/max_speakers` + `pipeline.instantiate(clustering.threshold)` 적용. 프론트(React+zustand)는 죽은 슬라이더 3개를 세밀도 슬라이더 1개로 교체.

**Tech Stack:** Rails 8 + RSpec / FastAPI + pytest / React 19 + TS + vitest / pyannote.audio 4.0.4

**병렬 실행 가이드 (orchestrator용):**
- 레인 B(백엔드, rspec sqlite 충돌 방지 위해 레인 내 순차): Task 1 → 2 → 3 → 4 → 5
- 레인 S(sidecar): Task 6 — 레인 B와 병렬 가능
- 레인 F(프론트, 파일 디스조인트라 상호 병렬 가능): Task 7, 8, 9, 10 — 레인 B·S와 병렬 가능
- 구현 subagent는 **git commit 금지** (병렬 인덱스 락 충돌). 검증 출력만 보고하고 orchestrator가 리뷰 후 커밋.
- 전체 게이트: `cd backend && bundle exec rspec` (pre-existing 실패 1건 default_user_lookup_spec 무시) / `cd sidecar && .venv/bin/python -m pytest tests/` / `cd frontend && npx vitest run && npx vite build` (tsc -b 기존 에러 9개 무시)

---

### Task 1: meetings.expected_participants 컬럼 + 직렬화 + update 수용

**Files:**
- Create: `backend/db/migrate/<timestamp>_add_expected_participants_to_meetings.rb`
- Modify: `backend/app/models/meeting.rb` (validation 추가)
- Modify: `backend/app/controllers/concerns/meeting_serializable.rb` (meeting_json에 노출)
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb:109-136` (update에서 수용)
- Test: `backend/spec/requests/api/v1/meetings_spec.rb`

- [ ] **Step 1: 실패하는 테스트 작성** — meetings_spec.rb의 update 관련 describe 블록에 추가 (기존 스타일 따라 인증 헬퍼 재사용):

```ruby
describe "expected_participants" do
  it "update로 참여 인원수를 설정/해제할 수 있다" do
    patch "/api/v1/meetings/#{meeting.id}", params: { expected_participants: 5 }, headers: auth_headers
    expect(response).to have_http_status(:ok)
    expect(meeting.reload.expected_participants).to eq(5)
    expect(JSON.parse(response.body).dig("meeting", "expected_participants")).to eq(5)

    patch "/api/v1/meetings/#{meeting.id}", params: { expected_participants: "" }, headers: auth_headers
    expect(meeting.reload.expected_participants).to be_nil
  end

  it "범위 밖 값은 422" do
    patch "/api/v1/meetings/#{meeting.id}", params: { expected_participants: 0 }, headers: auth_headers
    expect(response).to have_http_status(:unprocessable_entity)
  end
end
```

(주의: 파일 내 기존 `meeting`/`auth_headers` let 정의를 그대로 사용. 없으면 인접 예제의 셋업 패턴 복사.)

- [ ] **Step 2: 실패 확인** — `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb` → 신규 2건 FAIL (column 없음)

- [ ] **Step 3: 마이그레이션 작성** — `cd backend && bin/rails generate migration AddExpectedParticipantsToMeetings expected_participants:integer` 후 내용 확인:

```ruby
class AddExpectedParticipantsToMeetings < ActiveRecord::Migration[8.0]
  def change
    add_column :meetings, :expected_participants, :integer
  end
end
```

**즉시 `bin/rails db:migrate` 실행** (러닝 dev 서버 PendingMigrationError 방지). `RAILS_ENV=test bin/rails db:migrate`도 실행.

- [ ] **Step 4: 모델 validation** — `backend/app/models/meeting.rb` 기존 validates 묶음 아래에:

```ruby
validates :expected_participants, numericality: { only_integer: true, greater_than_or_equal_to: 1, less_than_or_equal_to: 100 }, allow_nil: true
```

- [ ] **Step 5: 직렬화** — `meeting_serializable.rb` meeting_json의 `attendees: meeting.attendees,` 다음 줄에:

```ruby
expected_participants: meeting.expected_participants,
```

- [ ] **Step 6: update 수용** — meetings_controller.rb update의 `attrs[:attendees] = ...` 다음에:

```ruby
attrs[:expected_participants] = params[:expected_participants].presence&.to_i if params.key?(:expected_participants)
```

- [ ] **Step 7: 통과 확인** — `bundle exec rspec spec/requests/api/v1/meetings_spec.rb` → PASS

---

### Task 2: AppSettings + SettingsController에 clustering_threshold (구 3개 파라미터 UI 수용 제거)

**Files:**
- Modify: `backend/app/services/app_settings.rb`
- Modify: `backend/app/controllers/api/v1/settings_controller.rb:161-224`
- Test: `backend/spec/services/app_settings_spec.rb`, settings 요청 스펙(존재 시 — `rtk proxy grep -rl "app_settings" backend/spec/requests`로 확인, 없으면 service 스펙만)

- [ ] **Step 1: 실패하는 테스트** — app_settings_spec.rb에:

```ruby
it "clustering_threshold 기본값 0.6을 포함한다" do
  expect(AppSettings.diarization_config["clustering_threshold"]).to eq(0.6)
end
```

(기존 스펙이 settings.yaml을 스텁하는 패턴이면 동일 패턴으로 yaml에 `clustering_threshold: 0.55` 넣은 케이스도 1건 추가.)

- [ ] **Step 2: 실패 확인** — `bundle exec rspec spec/services/app_settings_spec.rb` → FAIL

- [ ] **Step 3: app_settings.rb 구현** — DIARIZATION_DEFAULTS에 `"clustering_threshold" => 0.6,` 추가 (enable 다음 줄), diarization_config 해시에:

```ruby
"clustering_threshold" => (d["clustering_threshold"] || DIARIZATION_DEFAULTS["clustering_threshold"]).to_f,
```

- [ ] **Step 4: settings_controller.rb** — app_settings(GET)의 diarization 블록을 다음으로 교체 (구 3키 노출 제거):

```ruby
# diarization
if (diar = cfg["diarization"])
  result["diarization_enabled"] = diar["enabled"] unless diar["enabled"].nil?
  result["diarization_clustering_threshold"] = diar["clustering_threshold"] if diar["clustering_threshold"]
end
```

update_app_settings의 `%w[similarity_threshold merge_threshold max_embeddings_per_speaker].each` 루프를 다음으로 교체:

```ruby
if params.key?(:diarization_clustering_threshold)
  cfg["diarization"] ||= {}
  cfg["diarization"]["clustering_threshold"] = params[:diarization_clustering_threshold].to_f.clamp(0.5, 0.8)
end
```

- [ ] **Step 5: 통과 확인** — `bundle exec rspec spec/services/app_settings_spec.rb` + settings 관련 요청 스펙 → PASS (구 키를 단언하는 기존 스펙 있으면 신규 동작에 맞게 수정)

---

### Task 3: Transcript.to_sidecar_payload가 speaker_name 우선 사용

**Files:**
- Modify: `backend/app/models/transcript.rb:15-19`
- Test: `backend/spec/models/transcript_speaker_name_spec.rb`

- [ ] **Step 1: 실패하는 테스트** — transcript_speaker_name_spec.rb에 추가:

```ruby
describe ".to_sidecar_payload" do
  it "speaker_name이 있으면 speaker로 사용, 없으면 speaker_label" do
    named = build(:transcript, speaker_label: "화자 1", speaker_name: "김철수")
    unnamed = build(:transcript, speaker_label: "화자 2", speaker_name: nil)
    payload = Transcript.to_sidecar_payload([named, unnamed])
    expect(payload[0][:speaker]).to eq("김철수")
    expect(payload[1][:speaker]).to eq("화자 2")
  end
end
```

(factory 없으면 기존 스펙 파일의 생성 방식(Meeting.create… 등)을 그대로 따라 작성.)

- [ ] **Step 2: 실패 확인** — `bundle exec rspec spec/models/transcript_speaker_name_spec.rb` → FAIL

- [ ] **Step 3: 구현** — transcript.rb:

```ruby
def self.to_sidecar_payload(transcripts)
  transcripts.map do |t|
    { speaker: t.speaker_name.presence || t.speaker_label, text: t.content, started_at_ms: t.started_at_ms }
  end
end
```

- [ ] **Step 4: 통과 확인** → PASS

---

### Task 4: FileTranscriptionJob 분기 + expected_speakers 전달

**Files:**
- Modify: `backend/app/jobs/file_transcription_job.rb:14-46`
- Test: `backend/spec/jobs/file_transcription_job_spec.rb`

선행: Task 1(컬럼), Task 2(clustering_threshold).

- [ ] **Step 1: 실패하는 테스트** — file_transcription_job_spec.rb에 (기존 스펙의 SidecarClient 스텁 패턴 재사용):

```ruby
context "화자분리 ON" do
  before { allow(AppSettings).to receive(:diarization_config).and_return({ "enable" => true, "clustering_threshold" => 0.6 }) }

  it "회의록 자동생성과 finalizer를 스킵하고 completed로 만든다" do
    expect(LlmService).not_to receive(:new)
    expect(MeetingFinalizerService).not_to receive(:new)
    described_class.perform_now(meeting.id)
    expect(meeting.reload.status).to eq("completed")
  end

  it "expected_participants가 있으면 diarization_config에 expected_speakers로 넣어 보낸다" do
    meeting.update!(expected_participants: 5)
    expect_any_instance_of(SidecarClient).to receive(:transcribe_file)
      .with(anything, hash_including(diarization_config: hash_including("expected_speakers" => 5, "enable" => true)))
      .and_return({ "segments" => [] })
    described_class.perform_now(meeting.id)
  end
end

context "화자분리 OFF" do
  before { allow(AppSettings).to receive(:diarization_config).and_return({ "enable" => false, "clustering_threshold" => 0.6 }) }

  it "현행대로 회의록을 생성한다" do
    # 기존 스펙의 generate_summary 검증 패턴 재사용 (LlmService 스텁 후 Summary 생성 단언)
  end
end
```

(주의: 기존 스펙 셋업(meeting transcribing 상태, ffmpeg/convert_to_pcm 스텁, get_speakers 스텁)을 반드시 재사용. OFF 케이스는 기존 통과 스펙이 이미 커버하면 그 스펙이 깨지지 않는 것으로 갈음.)

- [ ] **Step 2: 실패 확인** — `bundle exec rspec spec/jobs/file_transcription_job_spec.rb` → 신규 FAIL

- [ ] **Step 3: 구현** — perform의 2번 블록에서 diarization_config 조립을 분리하고 4·5번을 분기:

```ruby
# 2. Sidecar /transcribe-file 호출 (...)
diarization_config = AppSettings.diarization_config
if meeting.expected_participants.present?
  diarization_config["expected_speakers"] = meeting.expected_participants
end
result = SidecarClient.new.transcribe_file(
  pcm_path,
  meeting_id: meeting.id,
  languages: languages,
  mode: mode,
  file_chunk_sec: file_chunk_sec,
  diarization_config: diarization_config
)
```

4·5번 단계 교체:

```ruby
if diarization_config["enable"]
  # 화자분리 ON: 회의록 자동생성 스킵 — 사용자가 화자 이름 지정 후 수동 생성(regenerate_notes)
  broadcast_progress(channel, 95, "화자 분리 완료 — 화자 이름 지정 후 회의록을 생성하세요")
else
  # 4. AI 회의록 생성 (final 모드)
  generate_summary(meeting)
  broadcast_progress(channel, 95, "AI 회의록 생성 완료")

  # 5. Action Items 추출
  MeetingFinalizerService.new(meeting).call
end
```

- [ ] **Step 4: 통과 확인** — `bundle exec rspec spec/jobs/file_transcription_job_spec.rb` → PASS

---

### Task 5: regenerate_notes가 MeetingFinalizerJob도 enqueue

분기 ON 흐름에서 finalizer가 스킵되므로 수동 생성 시 보강. (stop 액션과 동일 패턴 — meetings_controller.rb:182-183 참조.)

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb` regenerate_notes
- Test: `backend/spec/requests/api/v1/meetings_spec.rb`

- [ ] **Step 1: 실패하는 테스트** — 기존 regenerate_notes 스펙 블록에:

```ruby
it "MeetingFinalizerJob도 enqueue한다" do
  expect {
    post "/api/v1/meetings/#{meeting.id}/regenerate_notes", headers: auth_headers
  }.to have_enqueued_job(MeetingFinalizerJob).with(meeting.id)
end
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 구현** — regenerate_notes의 `MeetingSummarizationJob.perform_later(...)` 다음 줄에:

```ruby
MeetingFinalizerJob.perform_later(@meeting.id)
```

- [ ] **Step 4: 통과 확인** → PASS. 이후 백엔드 전체: `bundle exec rspec` → pre-existing 1건 외 green

---

### Task 6: sidecar — batch_diarize에 min/max_speakers + clustering threshold instantiate

**Files:**
- Modify: `sidecar/app/diarization/batch_processor.py`
- Modify: `sidecar/app/routers/stt.py:157-184`
- Test: `sidecar/tests/test_batch_processor.py`

- [ ] **Step 1: 실패하는 테스트** — test_batch_processor.py의 기존 fake pipeline 패턴을 확장. fake pipeline에 `instantiate(params)` 기록과 `__call__(audio, **kwargs)` kwargs 기록을 추가한 뒤:

```python
def test_expected_speakers_passes_min_max(fake_pipeline_factory, segments_factory):
    # expected_speakers=5 → min_speakers=3, max_speakers=7
    ...
    assert fake.call_kwargs == {"min_speakers": 3, "max_speakers": 7}

def test_expected_speakers_clamps_min_to_1(...):
    # expected_speakers=2 → min_speakers=1, max_speakers=4
    assert fake.call_kwargs == {"min_speakers": 1, "max_speakers": 4}

def test_no_expected_speakers_no_kwargs(...):
    assert fake.call_kwargs == {}

def test_clustering_threshold_instantiates(...):
    # clustering_threshold=0.55 → instantiate 호출, params["clustering"]["threshold"] == 0.55
    assert fake.instantiated["clustering"]["threshold"] == 0.55

def test_no_clustering_threshold_skips_instantiate(...):
    assert fake.instantiated is None
```

(실제 fixture 이름·세그먼트 생성은 기존 테스트 파일 패턴 그대로. asyncio 테스트면 기존 마커 재사용.)

- [ ] **Step 2: 실패 확인** — `cd sidecar && .venv/bin/python -m pytest tests/test_batch_processor.py -v` → 신규 FAIL

- [ ] **Step 3: batch_processor.py 구현** — 시그니처/실행부 변경:

```python
# community-1 기본값 (HF config.yaml과 동일) — threshold만 사용자 조정, Fa/Fb는 고정
_VBX_FA = 0.07
_VBX_FB = 0.8
_SEG_MIN_DURATION_OFF = 0.0


async def batch_diarize(
    audio_bytes: bytes,
    pipeline: Any,
    segments: list[TranscriptSegment],
    meeting_id: int | None = None,
    db_dir: Path | None = None,
    expected_speakers: int | None = None,
    clustering_threshold: float | None = None,
) -> list[TranscriptSegment]:
```

executor 호출 교체:

```python
turns, embeddings, ordered_labels = await loop.run_in_executor(
    None, _run_full_pipeline, audio_bytes, pipeline, expected_speakers, clustering_threshold
)
```

`_run_full_pipeline` 시그니처 + `output = pipeline(audio_input)` 교체:

```python
def _run_full_pipeline(
    audio_bytes: bytes,
    pipeline: Any,
    expected_speakers: int | None = None,
    clustering_threshold: float | None = None,
) -> tuple[list[tuple[int, int, str]], Any, list[str]]:
```

```python
    # 클러스터링 세밀도: 싱글턴 파이프라인이라 매 호출 명시 설정(이전 호출 잔류값 방지).
    # gpu_lock 안에서만 호출되므로 동시 변경 없음.
    if clustering_threshold is not None:
        pipeline.instantiate({
            "clustering": {"threshold": float(clustering_threshold), "Fa": _VBX_FA, "Fb": _VBX_FB},
            "segmentation": {"min_duration_off": _SEG_MIN_DURATION_OFF},
        })

    # 참여인원 힌트: N±2 범위로 클러스터 수를 가드 (자동 감지 결과가 범위 밖일 때만 개입)
    call_kwargs: dict[str, int] = {}
    if expected_speakers:
        call_kwargs["min_speakers"] = max(1, expected_speakers - 2)
        call_kwargs["max_speakers"] = expected_speakers + 2
        logger.info(f"[batch-diarizer] 화자 수 힌트: {call_kwargs['min_speakers']}~{call_kwargs['max_speakers']}명")

    output = pipeline(audio_input, **call_kwargs)
```

- [ ] **Step 4: stt.py 라우터 전달** — `enable_diarization = ...` 주변을 다음으로 교체:

```python
    diar_cfg = request.diarization_config or {}
    enable_diarization = diar_cfg.get("enable", False)
```

batch_diarize 호출에 인자 추가:

```python
                _expected = diar_cfg.get("expected_speakers")
                _threshold = diar_cfg.get("clustering_threshold")
                async with http_request.app.state.gpu_lock:
                    segments = await batch_diarize(
                        audio_bytes, pipeline, segments,
                        meeting_id=request.meeting_id,
                        expected_speakers=int(_expected) if _expected else None,
                        clustering_threshold=float(_threshold) if _threshold is not None else None,
                    )
```

- [ ] **Step 5: 통과 확인** — `pytest tests/test_batch_processor.py tests/ -v` → green. (uvicorn 재시작은 전체 머지 후 orchestrator가 수행 — tmux ddobak:1)

---

### Task 7: 프론트 설정 — 세밀도 슬라이더 1개로 교체

**Files:**
- Modify: `config.yaml` (프로젝트 루트 — 프론트 기본값 소스)
- Modify: `frontend/src/config.ts` (AppConfig.diarization 타입)
- Modify: `frontend/src/api/settings.ts` (AppSettings 타입 103-114 부근)
- Modify: `frontend/src/stores/appSettingsStore.ts` (diarKeys/diarMap)
- Modify: `frontend/src/components/settings/DiarizationPanel.tsx`
- Test: DiarizationPanel/appSettingsStore 기존 테스트 (`rtk proxy grep -rl "DiarizationPanel\|diarizationOverrides" frontend/src --include="*.test.*"`로 탐색)

- [ ] **Step 1: config.yaml** — diarization 섹션을:

```yaml
diarization:
  enabled: false                # 파일럿 검증 후 사용자가 토글로 ON
  clustering_threshold: 0.60    # 배치 클러스터링 세밀도 (0.5~0.8, 낮을수록 잘게 분리)
```

- [ ] **Step 2: config.ts** — AppConfig.diarization을:

```ts
  diarization: {
    clustering_threshold: number
  }
```

(`DiarizationConfig` 타입 정의가 이 객체를 참조하는지 확인 — 참조하면 자동 반영, 별도 정의면 동일하게 교체.)

- [ ] **Step 3: api/settings.ts** — `diarization_similarity_threshold`/`diarization_merge_threshold`/`diarization_max_embeddings_per_speaker` 3개 필드를 `diarization_clustering_threshold?: number` 1개로 교체.

- [ ] **Step 4: appSettingsStore.ts** — debouncedSave의 `diarKeys`를 `['clustering_threshold'] as const`로, loadAppSettings의 `diarMap`을 `{ diarization_clustering_threshold: 'clustering_threshold' } as const`로 교체.

- [ ] **Step 5: DiarizationPanel.tsx** — SettingSlider 3개를 1개로 교체:

```tsx
        <SettingSlider
          label="화자 구분 세밀도"
          description="배치 화자분리의 클러스터링 기준값. 낮을수록 화자를 더 잘게 분리하고, 높을수록 비슷한 목소리를 하나로 묶습니다."
          value={dv('clustering_threshold')}
          defaultValue={DIARIZATION_DEFAULTS.clustering_threshold}
          min={0.5} max={0.8} step={0.05}
          onChange={(v) => setDiarizationOverride('clustering_threshold', v)}
        />
```

배치 분석 안내 박스(60-65행) 문구 끝에 한 문장 추가: `회의 정보의 '참여 인원'을 입력하면 그 인원수 ±2명 범위로 화자를 맞춥니다.`

- [ ] **Step 6: 잔존 참조 전수 grep** — `rtk proxy grep -rn "similarity_threshold\|merge_threshold\|max_embeddings_per_speaker" frontend/src` → 결과 0이어야 함 (실시간 경로 잔재 있으면 보고 — 임의 삭제 금지)

- [ ] **Step 7: 검증** — 관련 테스트 수정 후 `npx vitest run` + `npx vite build` → green (tsc -b 기존 9건 무시)

---

### Task 8: SpeakerPanel collapsible

**Files:**
- Modify: `frontend/src/components/meeting/SpeakerPanel.tsx`
- Modify: `frontend/src/pages/MeetingPage.tsx:481`, `frontend/src/pages/MeetingViewerPage.tsx:141`(데스크톱 분기만 — 77행 모바일 아코디언은 변경 금지), `frontend/src/pages/MeetingLivePage.tsx:284`
- Test: `frontend/src/components/meeting/SpeakerPanel.test.tsx`

- [ ] **Step 1: 실패하는 테스트** — SpeakerPanel.test.tsx 기존 모킹 패턴(getSpeakers + transcriptStore finals) 재사용:

```tsx
describe('collapsible', () => {
  it('화자 없으면 접힌 summary만 보인다', ...)        // '화자 목록' summary 존재, 목록 미렌더
  it('화자 로드되면 자동으로 펼쳐진다', ...)            // findByText('김철수') 또는 화자 행 노출
  it('수동으로 접으면 화자가 늘어도 다시 펼치지 않는다', ...) // summary 클릭 → 접힘 유지
  it('collapsible 미지정이면 기존 렌더 그대로', ...)
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/meeting/SpeakerPanel.test.tsx` → FAIL

- [ ] **Step 3: 구현** — props에 `collapsible?: boolean` 추가, 본문을 분리해 collapsible이면 `<details>`로 감싼다:

```tsx
interface SpeakerPanelProps {
  meetingId: number
  isRecording: boolean
  /** 데스크톱 사이드 패널용: 화자 없으면 접힘, 감지되면 자동 펼침(이후 수동 토글 우선) */
  collapsible?: boolean
}
```

컴포넌트 내부 (기존 state 아래):

```tsx
  const [open, setOpen] = useState(false)
  const userToggledRef = useRef(false)

  // 화자가 처음 감지되면 자동 펼침 — 사용자가 직접 토글한 뒤에는 개입하지 않음
  useEffect(() => {
    if (!userToggledRef.current && visibleSpeakers.length > 0) setOpen(true)
  }, [visibleSpeakers.length])
```

렌더: 기존 반환 JSX(빈 상태 + 목록)를 `body` 변수로 추출하고:

```tsx
  if (!collapsible) return body

  return (
    <details open={open}>
      <summary
        onClick={(e) => {
          e.preventDefault()
          userToggledRef.current = true
          setOpen((v) => !v)
        }}
        className="px-4 py-2 text-xs font-semibold text-gray-500 cursor-pointer hover:bg-gray-50 select-none"
      >
        화자 목록{visibleSpeakers.length > 0 ? ` (${visibleSpeakers.length})` : ''}
      </summary>
      {body}
    </details>
  )
```

(주의: collapsible 모드에서는 body 내부의 "화자 목록" 헤더 행이 summary와 중복되므로, body 추출 시 헤더 행의 라벨은 summary로 옮기고 초기화 버튼은 body 상단에 유지한다. `useRef` import 추가.)

- [ ] **Step 4: 호출처 3곳** — 각각 `<SpeakerPanel meetingId={...} isRecording={...} collapsible />`로 변경 (MeetingPage 481, MeetingViewerPage 141 데스크톱, MeetingLivePage 284).

- [ ] **Step 5: 통과 확인** — `npx vitest run src/components/meeting/SpeakerPanel.test.tsx src/pages/__tests__/MeetingPage.responsive.test.tsx src/pages/MeetingPage.test.tsx` → green

---

### Task 9: 참여 인원 입력 (EditMeetingDialog + 타입 + 패스스루)

**Files:**
- Modify: `frontend/src/api/meetings.ts` (Meeting:38-69, UpdateMeetingParams:310-322)
- Modify: `frontend/src/components/meeting/EditMeetingDialog.tsx`
- Modify: 호출처 onConfirm 타입이 명시적이면 보정 — `frontend/src/pages/MeetingPage.tsx:566-575`, `frontend/src/pages/MeetingsPage.tsx:446-450`, `frontend/src/pages/MeetingLivePage.tsx:443-450` (data를 updateMeeting에 그대로 전달하는 구조면 타입만 통과해도 됨)
- Test: `frontend/src/components/meeting/EditMeetingDialog.test.tsx`

- [ ] **Step 1: 실패하는 테스트** — EditMeetingDialog.test.tsx 기존 패턴으로:

```tsx
it('참여 인원을 입력하면 onConfirm에 expected_participants로 전달한다', ...)
  // '참여 인원' 라벨의 input에 '5' 입력 → 저장 → onConfirm 호출 인자에 expected_participants: 5
it('비우면 null로 전달한다', ...)
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 타입** — api/meetings.ts Meeting의 `attendees: string | null` 다음에:

```ts
  /** 참여 인원수 (화자분리 ±2 힌트). null=자동 감지 */
  expected_participants?: number | null
```

UpdateMeetingParams의 `attendees?: string | null` 다음에 `expected_participants?: number | null` 추가.

- [ ] **Step 4: 다이얼로그** — onConfirm prop 타입에 `expected_participants: number | null` 추가. state:

```tsx
  const [expectedParticipants, setExpectedParticipants] = useState(
    meeting.expected_participants != null ? String(meeting.expected_participants) : ''
  )
```

handleSubmit의 onConfirm 객체에:

```tsx
      expected_participants: expectedParticipants.trim() ? Number(expectedParticipants) : null,
```

참석자 textarea 블록 다음에 입력 필드:

```tsx
          {/* 참여 인원 (화자분리 힌트) */}
          <div>
            <label className="block text-sm font-medium mb-1">참여 인원</label>
            <input
              type="number"
              min={1}
              max={100}
              value={expectedParticipants}
              onChange={(e) => setExpectedParticipants(e.target.value)}
              placeholder="비우면 자동 감지"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              화자분리 시 이 인원수 ±2명 범위로 화자를 맞춥니다.
            </p>
          </div>
```

- [ ] **Step 5: 호출처 타입 보정** — 3개 페이지에서 onConfirm 핸들러가 data를 updateMeeting/updateMeetingInfo로 그대로 넘기는지 확인, 명시적 필드 복사면 expected_participants 추가.

- [ ] **Step 6: 통과 확인** — `npx vitest run src/components/meeting/EditMeetingDialog.test.tsx` + `npx vite build` → green

---

### Task 10: AI 회의록 빈 상태 안내 힌트

**Files:**
- Modify: `frontend/src/components/meeting/AiSummaryPanel.tsx`
- Test: AiSummaryPanel 테스트 (존재 확인 — 없으면 신규 `AiSummaryPanel.hint.test.tsx`, 기존 테스트 모킹 스타일 모방)

- [ ] **Step 1: 조건 정의** — 힌트 노출 조건 (모두 충족):
  - `useAppSettingsStore`의 `diarizationEnabled === true`
  - `meetingNotes`가 비어 있음 (transcriptStore의 meetingNotes null/'' )
  - `finals.length > 0` (transcriptStore — 전사 존재)
  - `!isSummarizing`

- [ ] **Step 2: 실패하는 테스트** — 위 조건 조합으로 힌트 렌더/비렌더 2케이스.

- [ ] **Step 3: 구현** — AiSummaryPanel 본문(에디터 영역 위)에:

```tsx
      {showManualHint && (
        <div className="mx-4 mt-3 rounded-md border border-blue-100 bg-blue-50/50 p-3 text-xs text-blue-700">
          화자분리가 완료되었습니다. 좌측 화자 목록에서 이름을 지정한 뒤
          <span className="font-semibold"> 회의록 재생성</span> 버튼으로 회의록을 만들 수 있습니다.
        </div>
      )}
```

`showManualHint`는 Step 1 조건의 useMemo/단순 표현식. (AiSummaryPanel 전체를 읽고 store 셀렉터 패턴·레이아웃에 맞춰 삽입 — 헤더 JSX는 135행 부근, isSummarizing/summarizationKind 셀렉터 기존재.)

- [ ] **Step 4: 통과 확인** — 해당 테스트 + `npx vitest run` → green

---

## 최종 검증 (orchestrator)

- [ ] `cd backend && bundle exec rspec` — pre-existing 1건(default_user_lookup_spec) 외 green
- [ ] `cd sidecar && .venv/bin/python -m pytest tests/` — green
- [ ] `cd frontend && npx vitest run && npx vite build` — green (tsc -b 기존 9건 무시)
- [ ] sidecar uvicorn 재시작 (tmux ddobak:1) — 핫리로드 없음
- [ ] settings.yaml에 구 diarization 키가 남아 있어도 무해함을 확인 (AppSettings가 무시)
