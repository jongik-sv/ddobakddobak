# 기밀 구간 절단 (transcript redact range) 구현 계획

- 설계: `docs/superpowers/specs/2026-07-31-transcript-redact-range-design.md` (FINAL)
- 선행: `docs/superpowers/specs/2026-07-30-transcript-split-design.md` (main `32d4aa34`)
- 브랜치: `feature/transcript-redact-range`

## Goal

회의에서 선택한 전사 행 집합과 **그 구간의 오디오를 실제로 파기**한다. 마스킹·필터가 아니라 절단이며 되돌릴 수 없다.
전사 행·FTS 인덱스·요약·AI 생성 액션아이템/결정·brief_summary·북마크·챗 인용 마커·오디오 본체·파형 캐시·부산물(`_parts/`, `stt_chunks/`, `*.merged.*`)까지 한 요청에서 처리한다.

## Architecture

```
POST /api/v1/meetings/:meeting_id/transcripts/redact
  └─ Api::V1::TranscriptsController#redact          가드 · 오케스트레이션 · 트랜잭션
       ├─ TranscriptRedactionPlan   (순수)          런 묶기 · 경계 클램프 · 병합 · delta · 겹침 완전성 · kept_segments
       ├─ AudioRedactor             (파일시스템)    부산물 선삭제 · ffmpeg 절단 · 백업/복구 · peaks 무효화
       └─ LlmPrompts::CitationMarkers (순수)        마커 정규식 · mm:ss 파싱 · 재직렬화

AudioUploadJob#perform                              소스 identity 검증 → 절단본 클로버 거부 (경합 방어의 본체)

프론트
  api/meetings/transcripts.ts     redactTranscripts()  (expected_bounds 필수)
  stores/transcriptStore          remoteStructureRevision(=split 개명) + audioRevision
  channels/transcription          'transcript_redacted' 핸들러 (원격 경로)
  components/meeting/TranscriptPanel  다중 선택 + 절단 액션 + confirmDialog   ← 진입점
  pages/MeetingPage               배선 + 로컬 반영(재조회 · markAudioChanged)  ← 유일한 발화점
  components/meeting/meetingDetailTabs  모바일 탭 경로 prop 스레딩
  hooks/useAudioPlayer            URL 캐시 버스터 + deps
```

오디오 토큰(`audioRevision`)을 올리는 곳은 **정확히 두 군데이고 서로 배타적**이다: 원격 수신(채널, 에코 아님) / 로컬 절단 성공(`MeetingPage.handleTranscriptRedact`). 한 절단당 오디오 재요청은 1회여야 한다.

## Tech Stack

- 백엔드: Rails 8 / SQLite / RSpec / rubocop-rails-omakase / ffmpeg 5.1.10 / SolidQueue(prod) · :async(dev·test)
- 프론트: React 19 + TypeScript + zustand + ky + vitest + @testing-library/react
- 실시간: ActionCable (`meeting_<id>_transcription` 스트림)

## Global Constraints

이하 전부 **모든 태스크에 적용**된다.

1. **전사 행 삭제는 반드시 `destroy_all`.** `delete_all` / `update_all` / raw SQL 금지. `transcripts_fts` 정리는 AR 콜백(`fts_indexable.rb:7` `after_destroy :fts_delete`)이 유일한 경로라, 우회하면 잘라낸 기밀 전문이 FTS 인덱스에 원문 그대로 영구히 남는다.
2. **DB 스키마 마이그레이션 금지.** dev 서버가 떠 있어 `db/migrate`에 파일을 두는 순간 모든 요청이 `PendingMigrationError`로 500이 된다. 마이그레이션이 필요해 보이는 태스크를 만나면 **작업을 멈추고 보고**한다.
3. **러닝 dev 서버에 절단 요청을 절대 보내지 않는다.** 파괴적·비가역이다. 검증은 spec으로만 한다.
4. **`main`에 커밋하지 않는다.** 모든 작업은 `feature/transcript-redact-range`에서 한다.
5. **프론트 타입체크는 `npx tsc -p tsconfig.app.json`.** bare `tsc`는 루트 tsconfig의 `files: []` 때문에 거짓 green이다.
6. **`window.confirm` 금지, `confirmDialog`(`frontend/src/lib/confirmDialog.ts`) 사용.** Tauri WKWebView에서 `window.confirm`은 non-blocking이라 취소해도 이미 실행된다.
7. **모든 LIKE 쿼리에 `ESCAPE '\'`를 붙인다.** SQLite는 기본 ESCAPE 문자가 없다.
8. **`stt_chunks` 경로는 반드시 `SttChunkStorage::ROOT`를 쓴다.** 리터럴 `storage/stt_chunks/` 금지 — test 환경에서 ROOT는 `tmp/storage/stt_chunks`이며, 이 분기는 spec이 프로덕션 청크 디렉터리를 삭제하지 못하게 하려고 일부러 만든 구조적 방어선이다(`app/services/stt_chunk_storage.rb:8-11`).
9. **`transcripts.ended_at_ms`는 `null: false`다**(`db/schema.rb` `create_table "transcripts"`). `nil` 방어 코드를 **쓰지 않는다** — 테스트할 수 없는 죽은 코드가 된다. nullable은 프론트 타입(`SpeakerLookupFinal.ended_at_ms: number | null`)에만 존재한다. (설계 §절단 경계 계산 `:168`도 같은 결론으로 수정됨.)
10. **착수 전 기준선**: 백엔드 `bundle exec rspec` 2158 examples / 0 failures, `bundle exec rubocop` no offenses. 프론트 `npx vitest run` 213 files / 1904 tests 통과(사전 존재 uncaught exception 2건: `AiChatPanel.test.tsx`, `MeetingLivePage.test.tsx`), `npx tsc -p tsconfig.app.json` 에러 0.
11. 모든 커맨드는 `cd backend` 또는 `cd frontend`에서 실행한다. 커밋 메시지는 각 스텝에 적힌 문장을 그대로 쓴다.

## ⚠️ 착수 전 반드시 읽을 것 — 설계·코드 충돌 3건, **전부 결정 완료**

계획 초안이 제기한 3건은 모두 사용자 결정이 났고 설계 문서에 반영되었다(설계 §낙관적 동시성 가드 · §V5 · §V4-b). **미결 항목이 아니다.** 구현자는 아래 결정대로만 진행한다.

- **(A) 동시 split 가드 — `expected_bounds` 필수 파라미터로 해결. 결정: 적용, required.**
  초안의 겹침 완전성 검사만으로는 동시 split을 못 잡는다(split 직후 서버 상태가 자기완결적이라 클램프 경계가 새 조각과 겹치지 않는다 — 설계 §낙관적 동시성 가드 (1)의 인용 블록에 근거 기록됨).
  → 클라이언트가 각 선택 행의 `{started_at_ms, ended_at_ms}`를 되돌려 보내고, 서버 현재값과 하나라도 다르면 409. **파라미터가 없으면 422다(조건부 아님)** — 기밀 파기에서 필드 누락이 가드를 통째로 없애는 설계는 허용하지 않는다.
  → 겹침 완전성 검사는 **그대로 유지한다.** 둘이 잡는 실패가 다르다: `expected_bounds`는 선택한 행의 변경을, 겹침 완전성은 애초에 선택 목록에 없던 행(구간 안으로 삽입·이어녹음·확장된 경계에 새로 걸린 이웃)을 잡는다. Task 6.

- **(B) 진입점 — `TranscriptPanel`에 다중 선택 신규 구현. 결정: `FullRecord` 안 쓴다.**
  `FullRecord` ← `RecordTabPanel` ← `MeetingLivePage`(녹음 중) · `MeetingViewerPage`(라이브 뷰어)뿐이고, 그 화면들은 회의가 `recording`/`transcribing`이라 절단이 **거의 항상 409**다.
  → 오디오 플레이어와 전사 뷰가 있는 `MeetingPage`(→ `TranscriptPanel`)에 다중 선택을 새로 만든다. 선택 UI는 `FullRecord.tsx:21`(`selected` Set) · `:70-100`(`toggleSelect`/`toggleAll`/`handleDelete`) 패턴을 **그대로 미러링**한다 — 새 방식 발명 금지. Task 11·12.

- **(C) 채널 구독 부재 — 수용, 후속으로 분리. 결정: Task 9·10은 설계대로 유지.**
  `MeetingPage`는 전사 채널을 구독하지 않는다(`useTranscription` 호출부는 `useLiveRecording.ts:125`·`MeetingViewerPage.tsx:41`뿐). 머지된 split의 원격 동기도 같은 이유로 죽어 있는 **사전 존재 갭**이다.
  → Task 9·10을 설계대로 넣되, 두 태스크의 **테스트는 실제 구독에 의존하지 않고 채널 핸들러/훅을 직접 호출**해 검증한다. 절단한 본인 화면은 원격 신호가 아니라 **로컬 경로(Task 12)** 로 갱신되므로 정상 동작한다. 후속 항목은 문서 말미 §후속(별도 티켓) 참조.

계획 초안이 제기한 나머지 2건도 설계 문서에 반영되어 **더 이상 불일치가 없다**:

- **`drop_backups!`(백업 파기) 위치** — 초안 의사코드는 `begin` 블록 안에 `FileUtils.rm_f(backup)` 을 두었는데, 이건 커밋 **뒤** 실행이라 여기서 실패하면 `rescue` 가 백업을 되살려 "전사는 지워졌는데 기밀 오디오는 복원된다"가 된다(설계가 §트랜잭션 순서에서 명시적으로 금지한 방향). → 설계 `:224-227` 이 `rescue` **밖**으로 옮기고 이유를 주석으로 남겼다. 계획의 Task 6 코드가 이미 그 형태이고, Task 7.3 이 두 실패 지점(커밋 전 / 커밋 후)의 처분을 구분해 적어 두었다.
- **`ended_at_ms` nil 방어** — 설계 `:168` 이 취소선으로 정정되었다. Global Constraint 9 와 일치한다.

---

# Task 1 — `LlmPrompts::CitationMarkers` 신설 (순수 유닛)

인용 마커의 Ruby 단일 소스. 절단 경로만 이것을 쓴다. 기존 하드코딩 4곳의 통일은 이 작업 범위 밖(주석으로만 대조).

## Files

- Create: `backend/app/services/llm_prompts/citation_markers.rb`
- Create: `backend/spec/services/llm_prompts/citation_markers_spec.rb`

## Interfaces

**Consumes**: 없음 (순수 모듈).

**Produces** — Task 6이 이 이름 그대로 참조한다:

```ruby
LlmPrompts::CitationMarkers::CITATION_RE          # => Regexp, 캡처 1=시간문자열, 2=화자
LlmPrompts::CitationMarkers::FOLDER_CITATION_RE   # => Regexp, 캡처 1=회의id, 2=시간문자열, 3=화자
LlmPrompts::CitationMarkers.marker_time_to_ms(raw : String) # => Integer(ms)
LlmPrompts::CitationMarkers.format_marker_time(ms : Integer, like: String) # => String
```

`app/services/llm_prompts/`는 이미 존재하는 디렉터리다(새 autoload 루트가 아니므로 dev 서버 재시작 불필요). `llm_prompts.rb`에 **include하지 않는다** — `DomainTermsPrompts`와 같은 완전정규화 접근 전용 선례를 따른다.

## Steps

- [ ] 1.1 브랜치 생성: `cd backend && git checkout -b feature/transcript-redact-range` (리포 루트 기준 한 번만; 이미 그 브랜치면 생략)
- [ ] 1.2 실패 테스트 작성 — `backend/spec/services/llm_prompts/citation_markers_spec.rb` 신규 생성:

```ruby
require "rails_helper"

RSpec.describe LlmPrompts::CitationMarkers do
  describe "CITATION_RE" do
    it "슬래시 구분자 마커를 시간·화자로 캡처한다" do
      m = described_class::CITATION_RE.match("결정은 보류됐다. ⟦t:125000/s:화자 1⟧")
      expect(m[1]).to eq("125000")
      expect(m[2]).to eq("화자 1")
    end

    it "파이프 구분자 변형도 매치한다" do
      m = described_class::CITATION_RE.match("⟦t:125000|s:화자 1⟧")
      expect(m[1]).to eq("125000")
      expect(m[2]).to eq("화자 1")
    end

    it "콜론 형태(mm:ss·hh:mm:ss) 시간도 캡처한다" do
      expect(described_class::CITATION_RE.match("⟦t:2:05/s:화자 1⟧")[1]).to eq("2:05")
      expect(described_class::CITATION_RE.match("⟦t:1:02:05/s:화자 1⟧")[1]).to eq("1:02:05")
    end

    it "폴더 스코프 마커(⟦m:..⟧)는 매치하지 않는다" do
      expect(described_class::CITATION_RE.match("⟦m:142/t:125000/s:화자 1⟧")).to be_nil
    end
  end

  describe "FOLDER_CITATION_RE" do
    it "회의id·시간·화자를 캡처한다" do
      m = described_class::FOLDER_CITATION_RE.match("⟦m:142/t:125000/s:화자 1⟧")
      expect(m[1]).to eq("142")
      expect(m[2]).to eq("125000")
      expect(m[3]).to eq("화자 1")
    end

    it "s 앞 구분자의 파이프 변형도 매치한다" do
      m = described_class::FOLDER_CITATION_RE.match("⟦m:142/t:2:05|s:화자 1⟧")
      expect(m[1]).to eq("142")
      expect(m[2]).to eq("2:05")
    end
  end

  describe ".marker_time_to_ms" do
    it "숫자만이면 이미 ms" do
      expect(described_class.marker_time_to_ms("125000")).to eq(125_000)
    end

    it "mm:ss를 ms로 환산한다" do
      expect(described_class.marker_time_to_ms("2:05")).to eq(125_000)
    end

    it "hh:mm:ss를 ms로 환산한다" do
      expect(described_class.marker_time_to_ms("1:02:05")).to eq(3_725_000)
    end
  end

  describe ".format_marker_time" do
    it "원본이 숫자 형태면 ms 숫자로 재직렬화한다" do
      expect(described_class.format_marker_time(65_000, like: "125000")).to eq("65000")
    end

    it "원본이 mm:ss면 mm:ss로 재직렬화한다" do
      expect(described_class.format_marker_time(65_000, like: "2:05")).to eq("1:05")
    end

    it "원본이 hh:mm:ss면 hh:mm:ss로 재직렬화한다(시가 0이어도 3필드 유지)" do
      expect(described_class.format_marker_time(65_000, like: "1:02:05")).to eq("0:01:05")
    end

    it "초 미만은 버린다(mm:ss에 소수 필드가 없음)" do
      expect(described_class.format_marker_time(65_499, like: "2:05")).to eq("1:05")
    end
  end
end
```

- [ ] 1.3 실패 확인: `cd backend && bundle exec rspec spec/services/llm_prompts/citation_markers_spec.rb`
      → 전부 `NameError: uninitialized constant LlmPrompts::CitationMarkers`로 실패해야 한다.
- [ ] 1.4 구현 — `backend/app/services/llm_prompts/citation_markers.rb` 신규 생성:

```ruby
module LlmPrompts
  # 인용 마커 ⟦t:<ms>[|/]s:<화자>⟧ / ⟦m:<회의id>/t:<ms>[|/]s:<화자>⟧ 의 Ruby 단일 소스.
  # 프론트 frontend/src/lib/citationMarkers.ts 의 CITATION_RE(:3) / FOLDER_CITATION_RE(:6) /
  # markerTimeToMs(:9-15) 와 1:1로 대응한다.
  #
  # 절단(transcripts#redact)은 마커를 "쓰기" 때문에 단일 소스가 필수다. 기존 하드코딩 4곳은
  # 표현식이 제각각이고 그중 둘은 폴더 스코프 m: 형태를 아예 못 다룬다 — 통일은 별도 후속이며
  # 여기서는 대조만 해둔다:
  #   app/models/summary.rb:14                /⟦t:\d+(?::\d+)*[|\/]s:[^⟧]+⟧/  콜론 O, m: X
  #   app/models/meeting.rb:620               /⟦[^⟧]*⟧/                        전 마커 통삭제
  #   app/services/markdown_exporter.rb:43    /[ \t]*⟦t:\d+[|\/]s:[^⟧]+⟧/      콜론 X, m: X
  #   app/services/meeting_chat_context.rb:50 /⟦t:\d+[|\/]s:[^⟧]+⟧/            콜론 X, m: X
  module CitationMarkers
    # 회의 스코프 마커. 캡처: 1=시간문자열(ms 또는 mm:ss/hh:mm:ss), 2=화자.
    CITATION_RE = /⟦t:(\d+(?::\d+)*)[|\/]s:([^⟧]+)⟧/
    # 폴더·프로젝트 스코프 마커. 캡처: 1=회의id, 2=시간문자열, 3=화자.
    # m: 와 t: 사이 구분자는 프론트와 동일하게 '/' 고정이고, s: 앞만 [|/] 둘 다 허용된다.
    FOLDER_CITATION_RE = /⟦m:(\d+)\/t:(\d+(?::\d+)*)[|\/]s:([^⟧]+)⟧/

    module_function

    # 마커 시각값 → ms. ':' 있으면 mm:ss 또는 hh:mm:ss, 없으면 이미 ms.
    def marker_time_to_ms(raw)
      return raw.to_i unless raw.include?(":")

      raw.split(":").map(&:to_i).reduce(0) { |acc, n| acc * 60 + n } * 1000
    end

    # ms → 마커 시각 문자열. `like`(원본 문자열)와 같은 형태로 재직렬화한다.
    # 콜론 형태에는 소수 필드가 없으므로 초 미만은 버린다(경계 클램프의 정수 나눗셈 때문에
    # 시프트 결과가 초 단위로 떨어지지 않을 수 있다).
    def format_marker_time(ms, like:)
      return ms.to_s unless like.include?(":")

      total = ms / 1000
      if like.count(":") >= 2
        format("%d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
      else
        format("%d:%02d", total / 60, total % 60)
      end
    end
  end
end
```

- [ ] 1.5 통과 확인: `cd backend && bundle exec rspec spec/services/llm_prompts/citation_markers_spec.rb` → 15 examples, 0 failures
- [ ] 1.6 회귀 확인: `cd backend && bundle exec rspec spec/services/llm_prompts_spec.rb spec/services/llm_prompts_relocation_spec.rb` → 0 failures (새 nested 모듈이 `LlmPrompts` re-include 목록에 들어가지 않았음을 확인)
- [ ] 1.7 rubocop: `cd backend && bundle exec rubocop app/services/llm_prompts/citation_markers.rb spec/services/llm_prompts/citation_markers_spec.rb` → no offenses
- [ ] 1.8 커밋: `git add -A && git commit -m "feat(redact): 인용 마커 Ruby 단일 소스 LlmPrompts::CitationMarkers 신설"`

---

# Task 2 — `TranscriptRedactionPlan` 신설 (순수 유닛, I/O 없음)

선택 id 집합 → 연속 런 → 클램프된 절단 경계 → 병합 → 누적 delta → 겹침 완전성 → 남길 오디오 세그먼트.

## Files

- Create: `backend/app/services/transcript_redaction_plan.rb`
- Create: `backend/spec/services/transcript_redaction_plan_spec.rb`

## Interfaces

**Consumes**: 없음. `rows`는 `started_at_ms` / `ended_at_ms` / `sequence_number` / `id`에만 응답하면 되므로 spec은 `Struct`로 대체할 수 있다.

**Produces** — Task 6이 이 이름 그대로 참조한다:

```ruby
TranscriptRedactionPlan::CutRange = Struct.new(:start_ms, :end_ms, :exempt_ids)
  # #length_ms  #cover?(ms)  #exempt?(row_id)  #bounds → [start_ms, end_ms]
TranscriptRedactionPlan.new(rows:, selected_ids:, audio_duration_ms:)
  #ranges                    # => Array<CutRange>  (start_ms 오름차순, 병합됨)
  #total_cut_ms              # => Integer
  #delta_for(ms)             # => Integer
  #selected_rows             # => Array(rows)
  #remaining_rows            # => Array(rows)
  #unselected_overlapping_ids # => Array<Integer>
  #complete?                 # => Boolean
  #range_bounds              # => Array<[start_ms, end_ms]>  경계 값 비교용(면제 목록 제외)
  #kept_segments             # => Array<[start_ms, end_ms]>  (길이 0 제거됨)
```

## Steps

- [ ] 2.1 실패 테스트 작성 — `backend/spec/services/transcript_redaction_plan_spec.rb` 신규 생성:

```ruby
require "rails_helper"

RSpec.describe TranscriptRedactionPlan do
  # 전역 상수 오염 금지 — RSpec 예제 그룹 안의 `Row = Struct.new(...)` 은 Object 에 상수를 만들어
  # 전체 스위트에서 다른 스펙의 Row 와 충돌한다. let 으로 가둔다.
  let(:row_class) { Struct.new(:id, :sequence_number, :started_at_ms, :ended_at_ms) }

  # 1: [0, 40000]  2: [41250, 68900]  3: [70000, 90000]  4: [121000, 134500]  5: [140000, 160000]
  let(:rows) do
    [
      row_class.new(1, 1, 0, 40_000),
      row_class.new(2, 2, 41_250, 68_900),
      row_class.new(3, 3, 70_000, 90_000),
      row_class.new(4, 4, 121_000, 134_500),
      row_class.new(5, 5, 140_000, 160_000)
    ]
  end
  let(:duration_ms) { 180_000 }

  def plan_for(ids)
    described_class.new(rows: rows, selected_ids: ids, audio_duration_ms: duration_ms)
  end

  # 앞뒤 이웃이 선택 런과 오디오 overlap(500ms 설계 상수) 하는 픽스처. 실제로 존재하는 형태다.
  let(:overlapping_plan) do
    described_class.new(
      rows: [
        row_class.new(1, 1, 0, 42_000),      # 다음 행 시작(41250)보다 늦게 끝난다 = 겹침
        row_class.new(2, 2, 41_250, 68_900),
        row_class.new(3, 3, 68_500, 90_000)  # 이전 행 끝(68900)보다 일찍 시작한다 = 겹침
      ],
      selected_ids: [ 2 ], audio_duration_ms: duration_ms
    )
  end

  describe "경계 클램프" do
    it "이웃과 gap이 있으면 행 ms가 아니라 gap 중간점을 쓴다" do
      r = plan_for([ 2 ]).ranges
      expect(r.length).to eq(1)
      expect(r.first.start_ms).to eq((40_000 + 41_250) / 2)   # 40625
      expect(r.first.end_ms).to eq((68_900 + 70_000) / 2)     # 69450
    end

    it "이전 행이 없으면 0부터, 다음 행이 없으면 오디오 끝까지" do
      first = plan_for([ 1 ]).ranges.first
      expect(first.start_ms).to eq(0)
      last = plan_for([ 5 ]).ranges.first
      expect(last.end_ms).to eq(duration_ms)
    end

    it "이웃과 겹치면(overlap) 클램프하지 않고 행 ms를 그대로 쓴다" do
      r = overlapping_plan.ranges.first
      expect(r.start_ms).to eq(41_250)
      expect(r.end_ms).to eq(68_900)
    end

    it "겹치는 이웃 때문에 완전성 검사가 깨지지 않는다 (영구 409 방지)" do
      # ⭐ 이 단언이 없어서 사각이 생겼던 자리다. 클램프를 포기하면 cut_start == run_start 라
      # prev.ended_at_ms > cut_start 가 정의상 참 → 면제가 없으면 complete? 가 영원히 false 다.
      expect(overlapping_plan.unselected_overlapping_ids).to be_empty
      expect(overlapping_plan).to be_complete
    end

    it "면제는 그 경계에만 적용된다 — 다른 구간 안에 든 같은 행은 여전히 잡힌다" do
      # 1과 2가 겹치고(1이 2의 prev 로 면제됨), 4를 따로 고르면 4의 구간은 [.., 오디오끝] 인데
      # 거기에 3이 통째로 들어간다. 면제를 플랜 전역으로 두면 이 3을 놓친다.
      rows_x = [
        row_class.new(1, 1, 0, 42_000),
        row_class.new(2, 2, 41_250, 68_900),
        row_class.new(3, 3, 120_000, 130_000),
        row_class.new(4, 4, 131_000, 140_000)
      ]
      plan = described_class.new(rows: rows_x, selected_ids: [ 2, 4 ], audio_duration_ms: duration_ms)
      # 1은 2의 겹치는 prev 라 면제, 3은 어떤 경계에서도 면제된 적이 없다.
      expect(plan.unselected_overlapping_ids).not_to include(1)
      expect(plan).not_to be_complete
      expect(plan.unselected_overlapping_ids).to include(3)
    end

    it "면제되지 않은 행이 구간과 겹치면 그대로 잡는다 (면제가 과잉적용되지 않음)" do
      intruder = rows + [ row_class.new(99, 6, 50_000, 52_000) ]
      plan = described_class.new(rows: intruder.sort_by(&:sequence_number),
                                 selected_ids: [ 2 ], audio_duration_ms: duration_ms)
      expect(plan.unselected_overlapping_ids).to include(99)
    end
  end

  describe "런 묶기와 병합" do
    it "비연속 선택은 구간 2개가 된다" do
      expect(plan_for([ 2, 4 ]).ranges.length).to eq(2)
    end

    it "연속 선택은 구간 1개로 묶인다" do
      r = plan_for([ 2, 3 ]).ranges
      expect(r.length).to eq(1)
      expect(r.first.start_ms).to eq(40_625)
      expect(r.first.end_ms).to eq((90_000 + 121_000) / 2)   # 105500
    end

    it "맞닿는 구간은 하나로 병합된다" do
      # 1과 3을 고르면 구간은 [0, 40625]와 [69450, 105500] — 병합되지 않는다.
      # 1,2,3을 고르면 하나의 런이므로 [0, 105500] 하나다.
      r = plan_for([ 1, 2, 3 ]).ranges
      expect(r.length).to eq(1)
      expect(r.first.start_ms).to eq(0)
      expect(r.first.end_ms).to eq(105_500)
    end
  end

  describe "#total_cut_ms / #delta_for — 다중 구간 누적" do
    it "마지막 구간 뒤 시점의 delta는 두 구간 길이의 합이다" do
      plan = plan_for([ 2, 4 ])
      len1 = 69_450 - 40_625
      len2 = (134_500 + 140_000) / 2 - (90_000 + 121_000) / 2
      expect(plan.total_cut_ms).to eq(len1 + len2)
      expect(plan.delta_for(150_000)).to eq(len1 + len2)
    end

    it "구간 사이 시점은 앞 구간 길이만 당긴다" do
      plan = plan_for([ 2, 4 ])
      expect(plan.delta_for(70_000)).to eq(69_450 - 40_625)
    end

    it "첫 구간 이전 시점은 0이다" do
      expect(plan_for([ 2, 4 ]).delta_for(10_000)).to eq(0)
    end
  end

  describe "#unselected_overlapping_ids / #complete?" do
    it "선택 밖 행이 경계에 걸치지 않으면 완전하다" do
      expect(plan_for([ 2 ])).to be_complete
    end

    it "구간 안으로 새로 삽입된 행이 선택 밖이면 잡아낸다" do
      with_inserted = rows + [ row_class.new(99, 2, 50_000, 52_000) ]
      plan = described_class.new(rows: with_inserted.sort_by(&:started_at_ms),
                                 selected_ids: [ 2 ], audio_duration_ms: duration_ms)
      expect(plan.unselected_overlapping_ids).to include(99)
      expect(plan).not_to be_complete
    end
  end

  describe "#kept_segments" do
    it "구간의 여집합을 [start, end] 배열로 준다" do
      expect(plan_for([ 2 ]).kept_segments).to eq([ [ 0, 40_625 ], [ 69_450, 180_000 ] ])
    end

    it "0에서 시작하는 구간은 길이 0 선두 세그먼트를 만들지 않는다" do
      expect(plan_for([ 1 ]).kept_segments).to eq([ [ 40_625, 180_000 ] ])
    end

    it "전체를 고르면 남길 세그먼트가 없다" do
      expect(plan_for([ 1, 2, 3, 4, 5 ]).kept_segments).to eq([])
    end
  end
end
```

- [ ] 2.2 실패 확인: `cd backend && bundle exec rspec spec/services/transcript_redaction_plan_spec.rb`
      → `NameError: uninitialized constant TranscriptRedactionPlan`
- [ ] 2.3 구현 — `backend/app/services/transcript_redaction_plan.rb` 신규 생성:

```ruby
# 기밀 구간 절단의 순수 계산부. 파일·DB I/O 없음.
# 선택된 전사 행 id → sequence_number 연속 런 → 이웃 gap 중간점으로 클램프된 절단 경계 →
# 병합 → 누적 delta / 겹침 완전성 / 남길 오디오 세그먼트.
# 설계: docs/superpowers/specs/2026-07-31-transcript-redact-range-design.md
class TranscriptRedactionPlan
  # exempt_ids: 이 경계에서 **클램프를 포기한** 이웃 행 id (0~2개). 이웃과 오디오 overlap 이
  # 있으면 클램프하지 않고 행 ms 를 그대로 쓰는데(설계 §절단 경계 계산), 그러면 그 이웃은
  # 정의상 항상 경계와 겹쳐 완전성 검사가 영구히 false 가 된다 — 사용자는 새로고침해도 못 고치는
  # 409 에 갇힌다. 그 이웃만 **이 경계에 한해** 면제한다.
  # 면제를 플랜 전역 집합으로 두면 안 된다: run A 의 이웃으로 면제된 행이 병합된 다른 구간
  # 안에 통째로 들어가 있을 때 그 구간에서도 면제되어 진짜 잔존을 놓친다. 구간별로 들고 다니고
  # merge 시에만 합집합을 취한다.
  CutRange = Struct.new(:start_ms, :end_ms, :exempt_ids) do
    def length_ms
      end_ms - start_ms
    end

    def cover?(ms)
      ms >= start_ms && ms < end_ms
    end

    def exempt?(row_id)
      Array(exempt_ids).include?(row_id)
    end

    # ffmpeg 산출물 재사용 가부 판정용 비교 키. exempt_ids 는 경계값이 아니므로 제외한다
    # (Struct#== 를 그대로 쓰면 면제 목록 차이만으로 "경계가 달라졌다"고 오판한다).
    def bounds
      [ start_ms, end_ms ]
    end
  end

  attr_reader :ranges

  # rows: 이 회의의 전사 행 전부(부분집합이면 이웃 클램프가 틀어진다)
  def initialize(rows:, selected_ids:, audio_duration_ms:)
    @rows = rows.sort_by(&:sequence_number)
    @selected_ids = Array(selected_ids).map(&:to_i).uniq
    @audio_duration_ms = audio_duration_ms.to_i
    @ranges = merge(runs.map { |run| clamp(run) })
  end

  def selected_rows
    @selected_rows ||= @rows.select { |r| @selected_ids.include?(r.id) }
  end

  def remaining_rows
    @remaining_rows ||= @rows.reject { |r| @selected_ids.include?(r.id) }
  end

  def total_cut_ms
    @ranges.sum(&:length_ms)
  end

  # delta(t) = Σ (end - start), 단 end <= t 인 구간만. 구간을 가로지르는 행은 없다
  # (완전성 검사를 통과했으므로) → started/ended 에 같은 delta 를 적용한다.
  def delta_for(ms)
    @ranges.select { |r| r.end_ms <= ms }.sum(&:length_ms)
  end

  # 절단 경계와 겹치는데 선택되지 않은 행 id. 비어 있지 않으면 409.
  # 그 경계에서 클램프를 포기한 이웃(exempt_ids)은 제외한다 — 안 그러면 overlap 이 있는 회의는
  # 영구히 절단 불가가 된다. 면제는 구간별이라 다른 구간 안에 들어간 같은 행은 여전히 잡힌다.
  def unselected_overlapping_ids
    remaining_rows.select { |row|
      @ranges.any? { |r| overlap?(row, r) && !r.exempt?(row.id) }
    }.map(&:id)
  end

  # 경계 목록의 값 비교용(면제 목록 제외). 컨트롤러가 트랜잭션 안에서 재계산한 플랜과 대조해
  # ffmpeg 산출물을 그대로 써도 되는지 판정한다.
  def range_bounds
    @ranges.map(&:bounds)
  end

  def complete?
    unselected_overlapping_ids.empty?
  end

  # 남길 오디오 세그먼트 [start_ms, end_ms]. 길이 0 이하는 버린다 —
  # 그대로 두면 asplit=N 의 N 이 어긋나고 빈 atrim 세그먼트가 생긴다.
  def kept_segments
    bounds = [ 0 ]
    @ranges.each { |r| bounds << r.start_ms << r.end_ms }
    bounds << @audio_duration_ms
    bounds.each_slice(2).map { |s, e| [ s, e ] }.select { |s, e| e > s }
  end

  private

  def row_index
    @row_index ||= @rows.each_with_index.to_h { |r, i| [ r.id, i ] }
  end

  def overlap?(row, range)
    row.started_at_ms < range.end_ms && row.ended_at_ms > range.start_ms
  end

  # 선택 행을 sequence_number 연속 런으로 자른다(비연속 선택 = 구간 여러 개).
  def runs
    picked = selected_rows
    return [] if picked.empty?

    picked.slice_when { |a, b| row_index[b.id] != row_index[a.id] + 1 }.to_a
  end

  # 런 하나의 절단 경계. 행 ms 를 그대로 쓰면 인접 발언을 깎는다(오디오 overlap 500ms).
  # 클램프를 포기한 이웃은 exempt_ids 로 이 경계에 한해 완전성 검사에서 면제한다(위 CutRange 주석).
  def clamp(run)
    prev_row = row_index[run.first.id].positive? ? @rows[row_index[run.first.id] - 1] : nil
    next_row = @rows[row_index[run.last.id] + 1]
    run_start = run.first.started_at_ms
    run_end   = run.last.ended_at_ms
    exempt = []

    cut_start =
      if prev_row.nil?
        0
      elsif prev_row.ended_at_ms < run_start
        (prev_row.ended_at_ms + run_start) / 2 # gap 중간점
      else
        exempt << prev_row.id                  # 겹침이면 클램프하지 않는다 → 이 경계에서만 면제
        run_start
      end

    cut_end =
      if next_row.nil?
        @audio_duration_ms
      elsif run_end < next_row.started_at_ms
        (run_end + next_row.started_at_ms) / 2
      else
        exempt << next_row.id
        run_end
      end

    CutRange.new(cut_start, cut_end, exempt)
  end

  def merge(list)
    list.sort_by(&:start_ms).each_with_object([]) do |r, acc|
      last = acc.last
      if last && r.start_ms <= last.end_ms
        last.end_ms = [ last.end_ms, r.end_ms ].max
        last.exempt_ids = (last.exempt_ids | r.exempt_ids) # 병합된 구간은 면제도 합집합
      else
        acc << CutRange.new(r.start_ms, r.end_ms, r.exempt_ids.dup)
      end
    end
  end
end
```

- [ ] 2.4 통과 확인: `cd backend && bundle exec rspec spec/services/transcript_redaction_plan_spec.rb` → 19 examples, 0 failures
- [ ] 2.5 반증 실증(수동, 커밋하지 않는다):
      - `delta_for`의 `r.end_ms <= ms` 를 `@ranges.first&.length_ms.to_i` 로 바꿔 실행 → "마지막 구간 뒤 시점의 delta는 두 구간 길이의 합이다" 실패 확인 후 원복
      - `clamp`의 gap 중간점 분기를 `run_start` 로 바꿔 실행 → "이웃과 gap이 있으면 …" 실패 확인 후 원복
      - `unselected_overlapping_ids` 의 `&& !r.exempt?(row.id)` 를 지워 실행 → "겹치는 이웃 때문에 완전성 검사가 깨지지 않는다" 실패 확인 후 원복
      - 면제를 플랜 전역 집합으로 바꿔(모든 구간의 `exempt_ids` 합집합으로 판정) 실행 → "면제는 그 경계에만 적용된다" 실패 확인 후 원복. **이게 실패하지 않으면 면제가 과잉적용되어 진짜 잔존을 놓치는 경로가 열려 있는 것이므로 멈추고 보고한다.**
- [ ] 2.6 rubocop: `cd backend && bundle exec rubocop app/services/transcript_redaction_plan.rb spec/services/transcript_redaction_plan_spec.rb` → no offenses
- [ ] 2.7 커밋: `git add -A && git commit -m "feat(redact): 절단 구간·경계·누적 delta 계산 TranscriptRedactionPlan 신설"`

---

# Task 3 — `AudioUploadJob` 소스 identity 클로버 거부 ⭐

이 기능 전체에서 가장 중요한 반증 테스트가 여기 있다. 이 경로가 뚫리면 절단한 기밀 오디오가 **조용히 복원된다**. 단독으로 먼저 머지 가능한 안전 변경이다.

## Files

- Modify: `backend/app/jobs/audio_upload_job.rb` (전체 `perform` 재작성 + private 헬퍼 2개 추가)
- Modify: `backend/spec/jobs/audio_upload_job_spec.rb` (`:62` 끝에 example 2개 추가)

## Interfaces

**Consumes**: `Meeting#set_audio_file!`(`app/models/meeting.rb:137-140`), `AudioUploadJob::MP3_BITRATE`.

**Produces** — Task 6이 참조한다:

```ruby
AudioUploadJob.in_flight_for?(meeting_id : Integer) # => Boolean  (값싼 조기 409용, 보증 아님)
```

## Steps

- [ ] 3.1 실패 테스트 작성 — `backend/spec/jobs/audio_upload_job_spec.rb`의 마지막 `it` 블록(`:58-61`) 뒤, `end` 앞에 추가:

```ruby
  it "최종 mp3 경로에 직접 쓰지 않는다 — 검증 통과 전에는 tmp 에만 존재한다" do
    # 최종 파일명으로 먼저 쓰면 identity 검사 전에 절단 전(기밀) 오디오가 정식 이름으로 디스크에
    # 올라가고, 그 사이 프로세스가 죽으면 검사가 영영 안 돌아 기밀 mp3 가 남는다.
    wav = File.join(audio_dir, "#{meeting.id}.wav")
    write_wav(wav)
    meeting.update!(audio_file_path: wav)
    final_mp3 = File.join(audio_dir, "#{meeting.id}.mp3")

    job = described_class.new
    seen_final = nil
    allow(job).to receive(:transcode_to_mp3).and_wrap_original do |orig, src, dest|
      result = orig.call(src, dest)
      # 인코딩 직후(= identity 검사 직전) 시점에 최종 경로가 아직 비어 있어야 한다.
      seen_final = File.exist?(final_mp3)
      expect(dest).to end_with(".upload-tmp")
      result
    end

    job.perform(meeting_id: meeting.id)

    expect(seen_final).to be false
    expect(File.exist?(final_mp3)).to be true          # 검증 통과 후 mv 됨
    expect(Dir.glob(File.join(audio_dir, "*.upload-tmp"))).to be_empty
  end

  it "변환 중 소스 오디오가 교체되면 결과를 버리고 audio_file_path를 바꾸지 않는다 (절단본 클로버 거부)" do
    # 기밀 구간 절단이 in-flight AudioUploadJob 과 경합하는 상황. ffmpeg 은 열린 fd(옛 inode)를
    # 계속 읽으므로 결과물은 "절단 전" 오디오다 — 그대로 set_audio_file! + cleanup_original 하면
    # 절단한 webm 을 지우고 기밀을 복원한다. 진입 가드로는 못 막고, 쓰는 쪽이 거부해야 한다.
    wav = File.join(audio_dir, "#{meeting.id}.wav")
    write_wav(wav)
    meeting.update!(audio_file_path: wav)

    job = described_class.new
    allow(job).to receive(:transcode_to_mp3).and_wrap_original do |orig, src, dest|
      result = orig.call(src, dest)
      # 절단이 같은 경로를 새 파일로 교체한 상황 재현(같은 디렉토리 mv = rename = 새 inode)
      replacement = "#{src}.redacted"
      write_wav(replacement, seconds: 0.1)
      FileUtils.mv(replacement, src)
      result
    end

    job.perform(meeting_id: meeting.id)

    meeting.reload
    expect(meeting.audio_file_path).to eq(wav)
    expect(File.exist?(wav)).to be true
    expect(File.exist?(File.join(audio_dir, "#{meeting.id}.mp3"))).to be false
    # tmp 도 남기지 않는다 — 그 안에 절단 전(기밀) 오디오가 들어 있다.
    expect(Dir.glob(File.join(audio_dir, "*.upload-tmp"))).to be_empty
  end

  describe ".job_meeting_id" do
    # 순수 파싱. ActiveJob 이 perform(meeting_id:) 를 어떻게 직렬화하는지에 대한 계약을 고정한다.
    it "kwargs 직렬화에서 meeting_id 를 뽑는다" do
      job = instance_double(SolidQueue::Job, arguments: {
        "job_class" => "AudioUploadJob",
        "arguments" => [ { "meeting_id" => 42, "_aj_symbol_keys" => [ "meeting_id" ] } ]
      })
      expect(described_class.job_meeting_id(job)).to eq(42)
    end

    it "형태가 다르면 nil (가드가 조용히 오탐하지 않게)" do
      expect(described_class.job_meeting_id(instance_double(SolidQueue::Job, arguments: []))).to be_nil
      expect(described_class.job_meeting_id(instance_double(SolidQueue::Job, arguments: { "arguments" => [ 7 ] }))).to be_nil
    end
  end

  describe ".in_flight_for?" do
    # 체인 스텁은 실제 구현과 같은 단계 수여야 한다 — where(...).left_joins(...).where(...).to_a.
    # (where.missing 은 WhereChain 메서드라 verified double 로 재현할 수 없어 구현에서 뺐다.)
    def stub_queue(jobs)
      relation = instance_double(ActiveRecord::Relation)
      allow(SolidQueue::Job).to receive(:where).and_return(relation)
      allow(relation).to receive(:left_joins).and_return(relation)
      allow(relation).to receive(:where).and_return(relation)
      allow(relation).to receive(:to_a).and_return(jobs)
    end

    def queued_job(meeting_id)
      instance_double(SolidQueue::Job, arguments: {
        "job_class" => "AudioUploadJob",
        "arguments" => [ { "meeting_id" => meeting_id, "_aj_symbol_keys" => [ "meeting_id" ] } ]
      })
    end

    it "같은 회의의 미완료 잡이 있으면 true" do
      stub_queue([ queued_job(meeting.id) ])
      expect(described_class.in_flight_for?(meeting.id)).to be true
    end

    it "다른 회의의 잡만 있으면 false (남의 잡으로 409 를 내지 않는다)" do
      stub_queue([ queued_job(meeting.id + 1) ])
      expect(described_class.in_flight_for?(meeting.id)).to be false
    end
  end
```

- [ ] 3.2 실패 확인: `cd backend && bundle exec rspec spec/jobs/audio_upload_job_spec.rb`
      → "최종 mp3 경로에 직접 쓰지 않는다"는 `dest` 가 `.upload-tmp` 로 안 끝나 실패, "절단본 클로버 거부"는 `expected "…/N.wav" got "…/N.mp3"`로, `.job_meeting_id`·`.in_flight_for?` 4건은 `NoMethodError`로 실패.
- [ ] 3.3 구현 — `backend/app/jobs/audio_upload_job.rb` 전체를 아래로 교체:

```ruby
class AudioUploadJob < ApplicationJob
  queue_as :default

  # 음성용 mp3 비트레이트 (mono 64kbps면 회의 음성에 충분하고 WAV 대비 ~1/15)
  MP3_BITRATE = "64k".freeze

  # 같은 회의의 미완료 AudioUploadJob 이 큐에 있는지. transcripts#redact 의 **값싼 조기 409(UX)**
  # 전용이며 경합 보증이 아니다 — 정말 위험한 잡은 이미 claim 되어 실행 중인 잡이고, 검사와
  # 파일 교체 사이의 창은 이걸로 닫히지 않는다. 실제 방어는 아래 perform 의 소스 identity 검증이다.
  # dev/test 는 큐 어댑터가 :async 라 solid_queue_jobs 테이블 자체가 없어 항상 false 가 된다.
  # where.missing 을 쓰지 않는다 — missing 은 WhereChain 메서드라 스펙에서 relation double 로
  # 체인을 재현할 수 없다(verified double 이 거부). 같은 의미의 left_joins 한 단계 체인으로 쓴다.
  def self.in_flight_for?(meeting_id)
    SolidQueue::Job.where(class_name: name, finished_at: nil)
                   .left_joins(:failed_execution)
                   .where(solid_queue_failed_executions: { id: nil })
                   .to_a
                   .any? { |job| job_meeting_id(job) == meeting_id }
  rescue ActiveRecord::StatementInvalid, NameError
    false
  end

  # ActiveJob 직렬화: perform(meeting_id:) 는 arguments 가 [{"meeting_id"=>1, "_aj_symbol_keys"=>[...]}].
  def self.job_meeting_id(job)
    args = job.arguments
    return nil unless args.is_a?(Hash)

    first = Array(args["arguments"]).first
    first.is_a?(Hash) ? first["meeting_id"] : nil
  end

  def perform(meeting_id:)
    meeting = Meeting.find(meeting_id)
    src = meeting.audio_file_path
    return unless src.present? && File.exist?(src) && File.size(src) > 0

    # 이미 mp3면 변환 불필요
    return if File.extname(src).casecmp(".mp3").zero?

    src_identity = file_identity(src)
    mp3_path = "#{src.sub(/#{Regexp.escape(File.extname(src))}\z/, '')}.mp3"
    # ⚠️ 최종 경로에 직접 쓰지 않는다. 최종 파일명으로 먼저 쓰면 identity 검사 **이전에** 절단 전
    # (기밀) 오디오가 정식 파일명으로 디스크에 올라간다 — 그 사이 프로세스가 죽으면(배포·OOM·
    # 워커 재시작) 검사가 영영 안 돌아 기밀 mp3 가 그대로 남는다. webm+mp3 공존(V3)에서는 방금
    # 절단한 <id>.mp3 를 미절단본으로 덮어쓰기까지 한다. tmp 로 쓰고 검증 통과 후에만 mv 한다.
    tmp_path = "#{mp3_path}.upload-tmp"

    unless transcode_to_mp3(src, tmp_path)
      FileUtils.rm_f(tmp_path)
      Rails.logger.error "[AudioUploadJob] meeting=#{meeting_id} mp3 변환 실패, 원본 유지 #{src}"
      return
    end

    # 기밀 구간 절단(transcripts#redact)이 변환 중에 소스를 통째로 교체했을 수 있다. ffmpeg 은
    # 열린 fd(옛 inode)를 계속 읽으므로 방금 만든 mp3 는 "절단 전" 오디오다 — 그대로
    # set_audio_file! + cleanup_original 하면 절단한 파일을 지우고 기밀을 복원한다.
    # 진입 가드(큐 조회)로는 못 막는다(검사와 mv 사이 창 + dev/test 는 큐 테이블 없음).
    # 쓰기를 소유한 여기서 경합을 닫는다.
    if file_identity(src) != src_identity
      FileUtils.rm_f(tmp_path)
      Rails.logger.warn "[AudioUploadJob] meeting=#{meeting_id} 소스 오디오가 변환 중 교체됨 — 결과 폐기 #{src}"
      return
    end

    FileUtils.mv(tmp_path, mp3_path)
    meeting.set_audio_file!(mp3_path)
    cleanup_original(src)
    Rails.logger.info "[AudioUploadJob] meeting=#{meeting_id} mp3 변환 완료 #{mp3_path}"
  rescue ActiveRecord::RecordNotFound
    Rails.logger.error "[AudioUploadJob] Meeting not found: #{meeting_id}"
  end

  private

  # 소스 파일 동일성 지문. 절단은 같은 디렉토리 mv(rename)로 교체하므로 inode 만으로도
  # 잡히지만, inode 재사용·복사 교체까지 덮도록 (inode, size, mtime) 셋을 합친다.
  # 파일이 사라졌으면 nil — 이것도 "달라졌다"로 취급된다.
  def file_identity(path)
    stat = File.stat(path)
    [ stat.ino, stat.size, stat.mtime.to_r ]
  rescue Errno::ENOENT
    nil
  end

  def transcode_to_mp3(src, dest)
    ok = system(
      "ffmpeg", "-y", "-loglevel", "error",
      "-i", src,
      "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", MP3_BITRATE,
      dest
    )
    ok && File.exist?(dest) && File.size(dest) > 0
  end

  # 변환 성공 시 원본 오디오와 원본 기준 peaks 캐시를 제거 (peaks는 mp3 기준으로 재생성됨)
  def cleanup_original(src)
    File.delete(src) if File.exist?(src)
    old_peaks = "#{src}.peaks.json"
    File.delete(old_peaks) if File.exist?(old_peaks)
  end
end
```

- [ ] 3.4 통과 확인: `cd backend && bundle exec rspec spec/jobs/audio_upload_job_spec.rb` → 9 examples, 0 failures
- [ ] 3.5 반증 실증(수동, 커밋하지 않는다):
      - `if file_identity(src) != src_identity` 블록 전체를 주석 처리 → "절단본 클로버 거부" 실패 확인 후 원복. **실패하지 않으면 테스트가 경합을 재현하지 못하는 것이므로 멈추고 보고한다.**
      - `tmp_path` 를 `mp3_path` 로 되돌려(최종 경로 직접 인코딩) 실행 → "최종 mp3 경로에 직접 쓰지 않는다" 실패 확인 후 원복
- [ ] 3.6 rubocop: `cd backend && bundle exec rubocop app/jobs/audio_upload_job.rb spec/jobs/audio_upload_job_spec.rb` → no offenses
- [ ] 3.7 커밋: `git add -A && git commit -m "fix(audio): AudioUploadJob 이 변환 중 교체된 소스의 결과를 덮어쓰지 않게 거부"`

---

# Task 4 — `AudioRedactor` 신설 (ffmpeg 절단 · 부산물 파기 · 백업/복구)

## Files

- Create: `backend/app/services/audio_redactor.rb`
- Create: `backend/spec/services/audio_redactor_spec.rb`

## Interfaces

**Consumes**: `AudioStorage#audio_dir`(`app/controllers/concerns/audio_storage.rb:7-9`), `AudioUploadJob::MP3_BITRATE`, `SttChunkStorage::ROOT`.

**Produces** — Task 6이 이 이름 그대로 참조한다:

```ruby
AudioRedactor::Error            # 상위 예외 (컨트롤러가 422 로 변환)
AudioRedactor::UnsupportedFormat < Error
AudioRedactor::TranscodeFailed  < Error
AudioRedactor::PurgeFailed      < Error

AudioRedactor.new(meeting : Meeting)
  #audio_paths                       # => Array<String>  <id>.* 오디오 전부 (파생·임시·백업 제외)
  #primary_audio_path                # => String|nil     meeting.audio_file_path — 유일한 절단 대상
  #orphan_audio_paths                # => Array<String>  나머지 <id>.* — 절단이 아니라 삭제 대상
  #purge_duplicate_sources!          # => void  _parts/ · stt_chunks/ · *.merged.* · 고아 오디오 ·
                                     #          잔존 *.redact-backup 삭제 (실패 시 PurgeFailed).
                                     #          swap_in! 보다 먼저 호출해야 하며 코드로 강제된다.
  #cut_to_temp(kept_segments, total_cut_ms) # => Hash{원본경로 => 임시경로}  (primary 하나만)
  #swap_in!(mapping)                 # => void  원본을 .redact-backup 으로 옮기고 임시본을 제자리에
  #drop_backups!                     # => void  커밋 후 백업 파기
  #restore_backups!                  # => void  롤백 시 원본 복구
  #purge_peaks!                      # => void  <path>.peaks.json 삭제 (멱등, swap 전·커밋 후 2회 호출)
  #move_all_audio_to_backup!         # => void  남길 세그먼트 0개일 때 오디오를 백업으로 이동(rm 아님)
```

## Steps

- [ ] 4.1 실패 테스트 작성 — `backend/spec/services/audio_redactor_spec.rb` 신규 생성:

```ruby
require "rails_helper"

RSpec.describe AudioRedactor do
  let(:meeting) { create(:meeting) }
  let(:audio_dir) { Rails.root.join("tmp", "test_audio_#{SecureRandom.hex(4)}").to_s }
  let(:redactor) { described_class.new(meeting) }

  around do |example|
    prev = ENV["AUDIO_DIR"]
    ENV["AUDIO_DIR"] = audio_dir
    FileUtils.mkdir_p(audio_dir)
    example.run
  ensure
    prev.nil? ? ENV.delete("AUDIO_DIR") : ENV["AUDIO_DIR"] = prev
    FileUtils.rm_rf(audio_dir)
  end

  # 10초 무음 16kHz mono WAV (ffmpeg 이 디코딩 가능한 최소 유효 파일)
  def write_wav(path, seconds: 10.0, rate: 16_000)
    samples = (rate * seconds).to_i
    data = ("\x00\x00".b * samples)
    File.open(path, "wb") do |f|
      f.write("RIFF"); f.write([ 36 + data.bytesize ].pack("V")); f.write("WAVE")
      f.write("fmt "); f.write([ 16 ].pack("V")); f.write([ 1 ].pack("v")); f.write([ 1 ].pack("v"))
      f.write([ rate ].pack("V")); f.write([ rate * 2 ].pack("V"))
      f.write([ 2 ].pack("v")); f.write([ 16 ].pack("v"))
      f.write("data"); f.write([ data.bytesize ].pack("V")); f.write(data)
    end
  end

  def probe_ms(path)
    out = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(path)}`.strip
    (out.to_f * 1000).to_i
  end

  describe "#audio_paths" do
    it "본 오디오만 고르고 peaks·merged 임시본·백업은 제외한다" do
      %W[#{meeting.id}.mp3 #{meeting.id}.webm].each { |n| File.binwrite(File.join(audio_dir, n), "x") }
      File.binwrite(File.join(audio_dir, "#{meeting.id}.mp3.peaks.json"), "{}")
      File.binwrite(File.join(audio_dir, "#{meeting.id}.webm.merged.webm"), "x")
      File.binwrite(File.join(audio_dir, "#{meeting.id}.mp3.redact-backup"), "x")
      File.binwrite(File.join(audio_dir, "#{meeting.id}0.mp3"), "x") # 다른 회의(id 접두 충돌)

      expect(redactor.audio_paths.map { |p| File.basename(p) })
        .to contain_exactly("#{meeting.id}.mp3", "#{meeting.id}.webm")
    end
  end

  describe "#purge_duplicate_sources!" do
    it "_parts/ · stt_chunks/ · *.merged.* 를 지운다" do
      parts = File.join(audio_dir, "#{meeting.id}_parts")
      FileUtils.mkdir_p(parts)
      File.binwrite(File.join(parts, "0.part"), "x")
      chunks = SttChunkStorage::ROOT.join(meeting.id.to_s)
      FileUtils.mkdir_p(chunks)
      File.binwrite(chunks.join("0-abc.pcm"), "x")
      merged = File.join(audio_dir, "#{meeting.id}.webm.merged.webm")
      File.binwrite(merged, "x")

      redactor.purge_duplicate_sources!

      expect(Dir.exist?(parts)).to be false
      expect(Dir.exist?(chunks)).to be false
      expect(File.exist?(merged)).to be false
    end

    it "이전 절단이 남긴 .redact-backup 을 지운다 (절단 전 원음 = 기밀)" do
      stale = File.join(audio_dir, "#{meeting.id}.mp3.redact-backup")
      File.binwrite(stale, "절단 전 원음 전체")

      redactor.purge_duplicate_sources!

      expect(File.exist?(stale)).to be false
    end

    it "다른 회의의 .redact-backup 은 건드리지 않는다" do
      other = File.join(audio_dir, "#{meeting.id}0.mp3.redact-backup")
      File.binwrite(other, "남의 회의")

      redactor.purge_duplicate_sources!

      expect(File.exist?(other)).to be true
    end

    it "swap_in! 뒤에 호출하면 raise 한다 (순서 계약을 코드로 강제)" do
      # ⭐ 주석·호출순서만으로는 리팩토링하다 깨진다. 잘못된 순서가 조용히 통과하면 이번 실행의
      # 백업이 지워져 롤백 복구 경로가 끊긴다 — 그 상태에서 커밋이 실패하면 오디오가 사라진다.
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      meeting.update!(audio_file_path: src)
      tmp = "#{src}.redact-tmp.wav"
      write_wav(tmp, seconds: 5.0)

      redactor.swap_in!(src => tmp)

      expect { redactor.purge_duplicate_sources! }
        .to raise_error(described_class::PurgeFailed, /먼저 호출/)
      expect(File.exist?("#{src}.redact-backup")).to be true # 백업은 그대로 살아 있다
    end

    it "고아 오디오(audio_file_path 가 아닌 <id>.*)를 peaks 와 함께 삭제한다" do
      primary = File.join(audio_dir, "#{meeting.id}.mp3")
      File.binwrite(primary, "x")
      meeting.update!(audio_file_path: primary)
      orphan = File.join(audio_dir, "#{meeting.id}.webm")
      File.binwrite(orphan, "절단 전 기밀 오디오")
      File.binwrite("#{orphan}.peaks.json", "{}")

      redactor.purge_duplicate_sources!

      expect(File.exist?(orphan)).to be false
      expect(File.exist?("#{orphan}.peaks.json")).to be false
      expect(File.exist?(primary)).to be true # primary 는 절단 대상이라 남는다
    end
  end

  describe "#primary_audio_path / #orphan_audio_paths" do
    it "audio_file_path 만 primary 이고 나머지 <id>.* 는 고아다" do
      primary = File.join(audio_dir, "#{meeting.id}.mp3")
      orphan  = File.join(audio_dir, "#{meeting.id}.webm")
      [ primary, orphan ].each { |p| File.binwrite(p, "x") }
      meeting.update!(audio_file_path: primary)

      expect(redactor.primary_audio_path).to eq(primary)
      expect(redactor.orphan_audio_paths).to eq([ orphan ])
    end
  end

  describe "#cut_to_temp" do
    it "남길 세그먼트를 concat 해 기대 길이(±1초)의 임시본을 만든다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      # [3s, 6s] 절단 → 남길 세그먼트 [0,3000] + [6000,10000] = 7초
      map = redactor.cut_to_temp([ [ 0, 3_000 ], [ 6_000, 10_000 ] ], 3_000)

      expect(map.keys).to eq([ src ])
      expect(probe_ms(map[src])).to be_within(1_000).of(7_000)
      expect(File.exist?(src)).to be true # 원본은 아직 그대로
    end

    it "지원하지 않는 확장자면 UnsupportedFormat" do
      File.binwrite(File.join(audio_dir, "#{meeting.id}.flac"), "x")
      expect { redactor.cut_to_temp([ [ 0, 1_000 ] ], 0) }.to raise_error(described_class::UnsupportedFormat)
    end

    it "ffmpeg 이 실패하면 TranscodeFailed 이고 임시본이 남지 않는다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      File.binwrite(src, "not audio at all")
      expect { redactor.cut_to_temp([ [ 0, 1_000 ] ], 0) }.to raise_error(described_class::TranscodeFailed)
      expect(Dir.glob(File.join(audio_dir, "*.redact-tmp*"))).to be_empty
    end
  end

  describe "#swap_in! / #restore_backups! / #drop_backups!" do
    it "교체 후 restore 하면 원본 내용이 되돌아온다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      original = File.binread(src)
      tmp = "#{src}.redact-tmp.wav"
      write_wav(tmp, seconds: 5.0)

      redactor.swap_in!(src => tmp)
      expect(File.binread(src)).not_to eq(original)

      redactor.restore_backups!
      expect(File.binread(src)).to eq(original)
      expect(Dir.glob(File.join(audio_dir, "*.redact-backup"))).to be_empty
    end

    it "drop_backups! 후에는 백업이 남지 않는다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      tmp = "#{src}.redact-tmp.wav"
      write_wav(tmp, seconds: 5.0)

      redactor.swap_in!(src => tmp)
      redactor.drop_backups!

      expect(Dir.glob(File.join(audio_dir, "*.redact-backup"))).to be_empty
      expect(File.exist?(src)).to be true
    end
  end

  describe "#purge_peaks! / #move_all_audio_to_backup!" do
    it "peaks 캐시를 지운다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      File.binwrite(src, "x")
      peaks = "#{src}.peaks.json"
      File.binwrite(peaks, "{}")

      redactor.purge_peaks!

      expect(File.exist?(peaks)).to be false
      expect(File.exist?(src)).to be true
    end

    it "move_all_audio_to_backup! 은 rm 이 아니라 백업으로 옮겨 롤백 복구를 남긴다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      meeting.update!(audio_file_path: src)
      original = File.binread(src)

      redactor.move_all_audio_to_backup!
      expect(File.exist?(src)).to be false

      redactor.restore_backups!
      expect(File.binread(src)).to eq(original)
    end

    it "move_all_audio_to_backup! 은 peaks 를 즉시 파기한다 (백업 대상 아님)" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      meeting.update!(audio_file_path: src)
      File.binwrite("#{src}.peaks.json", "{}")

      redactor.move_all_audio_to_backup!

      expect(File.exist?("#{src}.peaks.json")).to be false
    end
  end
end
```

- [ ] 4.2 실패 확인: `cd backend && bundle exec rspec spec/services/audio_redactor_spec.rb`
      → `NameError: uninitialized constant AudioRedactor`
- [ ] 4.3 구현 — `backend/app/services/audio_redactor.rb` 신규 생성:

```ruby
# 기밀 구간 절단의 파일시스템 담당. 본 오디오 절단 + 중복 기밀 사본 파기 + 백업/복구.
#
# 파일시스템은 트랜잭션이 아니므로 순서를 코드로 못 박는다:
#   purge_duplicate_sources!  (트랜잭션·ffmpeg 보다 먼저 — 남겨두면 finalize 가 재구성한다)
#   cut_to_temp               (DB 무변경. 여기서 실패하면 아무것도 안 바뀐다)
#   swap_in!                  (트랜잭션 마지막. 같은 디렉토리 mv = rename = 사실상 원자적)
#   drop_backups! / restore_backups!
# 설계: docs/superpowers/specs/2026-07-31-transcript-redact-range-design.md
class AudioRedactor
  include AudioStorage

  class Error < StandardError; end
  class UnsupportedFormat < Error; end
  class TranscodeFailed < Error; end
  class PurgeFailed < Error; end

  # 확장자별 인코더. -c copy 는 임의 지점 절단에 쓸 수 없어 재인코딩이 강제된다(한 세대 손실 수용).
  # 추측 기본값을 두지 않는다 — 모르는 형식은 조용히 망가뜨리는 대신 422 로 거부한다.
  CODECS = {
    ".mp3"  => [ "-c:a", "libmp3lame", "-b:a", AudioUploadJob::MP3_BITRATE ],
    ".webm" => [ "-c:a", "libopus" ],
    ".ogg"  => [ "-c:a", "libopus" ],
    ".m4a"  => [ "-c:a", "aac" ],
    ".mp4"  => [ "-c:a", "aac" ],
    ".wav"  => [ "-c:a", "pcm_s16le" ]
  }.freeze

  DURATION_TOLERANCE_MS = 1000

  def initialize(meeting)
    @meeting = meeting
    @backups = {}
    @swapped = false # swap_in! 이 한 번이라도 돌았는지 — purge_stale_backups! 순서 강제용
  end

  # <id>.* 중 파생물을 제외한 오디오 파일 전부. 절단 대상(primary)과 삭제 대상(orphan)을 가르는
  # 재료일 뿐, 이걸 그대로 절단하지 않는다 — 아래 primary_audio_path / orphan_audio_paths 참조.
  # .redact-backup 제외가 특히 중요하다: 앞선 시도가 두 mv 사이에서 죽으면 백업이 잔존하는데,
  # 다음 시도가 이걸 '오디오'로 오인해 절단하면 마지막 남은 원본까지 오염된다. 대신 그 잔존
  # 백업은 purge_stale_backups! 가 통째로 파기한다 — 제외만 하고 끝내면 기밀 원음이 영구히 남는다.
  def audio_paths
    Dir.glob(File.join(audio_dir, "#{@meeting.id}.*")).reject { |p|
      b = File.basename(p)
      b.end_with?(".peaks.json", ".redact-backup") || b.include?(".merged.") ||
        b.include?(".redact-tmp") || b.include?(".upload-tmp")
    }.sort
  end

  # 실제로 절단할 파일 — meeting.audio_file_path 하나뿐이다.
  def primary_audio_path
    path = @meeting.audio_file_path
    path.presence && File.exist?(path) ? path : nil
  end

  # 나머지 <id>.* 오디오 = **고아 파일**. 절단하지 않고 삭제한다.
  #
  # 왜 자르지 않고 지우는가: kept_segments 는 primary 의 타임라인 기준인데, V3 가 지적한
  # webm+mp3 공존은 정확히 **길이가 다른 두 파일**이다(재녹음 병합 시 dest 확장자가 새 업로드
  # 기준으로 바뀌어 옛 <id>.mp3 가 그대로 남는다). 짧은 쪽에 같은 세그먼트를 적용하면 뒤쪽
  # 세그먼트가 통째로 잘려 ffprobe 길이 검증에 걸리고 → 그 회의는 **영원히 절단 불가**가 된다.
  # 게다가 이 파일들은 audio_file_path 가 가리키지 않아 어디서도 재생·다운로드되지 않는
  # 절단 전 기밀 오디오다. 남길 이유가 없다. AudioUploadJob 이 나중에 이걸 집어 갈 위험도
  # 함께 사라진다(그 경합은 별도로 인플라이트 409 + 소스 identity 검증이 막는다).
  def orphan_audio_paths
    primary = primary_audio_path
    audio_paths.reject { |p| p == primary }
  end

  # 중복 기밀 사본 선삭제. 본 오디오에 이미 병합된 조각들이라 롤백 시 잃어도 무해하고,
  # 남겨두는 쪽이 위험하다 — finalize 에는 회의 상태 가드가 없어 <id>_parts/ 가 있으면
  # 잘리지 않은 청크로 오디오를 재구성한다(V6-b). stt_chunks 는 6시간 스위퍼가 유일한
  # 정리 경로라 완료된 회의에도 원시 PCM 이 남아 있을 수 있다(V1).
  #
  # ⚠️ 반드시 swap_in! **전에** 호출한다. 이 메서드는 잔존 .redact-backup 도 쓸어내는데,
  # swap_in! 뒤에 부르면 방금 만든 이번 실행의 백업까지 지워 롤백 복구 경로가 끊긴다.
  # 컨트롤러가 cut_to_temp 앞에서 한 번만 호출하는 것으로 순서를 고정한다.
  def purge_duplicate_sources!
    purge_tree!(File.join(audio_dir, "#{@meeting.id}_parts"))
    purge_tree!(SttChunkStorage::ROOT.join(@meeting.id.to_s).to_s)
    Dir.glob(File.join(audio_dir, "#{@meeting.id}*.merged.*")).each do |p|
      FileUtils.rm_f(p)
      raise PurgeFailed, "임시 병합 파일을 지우지 못했습니다: #{p}" if File.exist?(p)
    end
    # 고아 오디오(<id>.* 중 audio_file_path 가 아닌 것) — 참조되지 않는 절단 전 기밀 오디오다.
    orphan_audio_paths.each do |p|
      FileUtils.rm_f("#{p}.peaks.json")
      FileUtils.rm_f(p)
      raise PurgeFailed, "고아 오디오를 지우지 못했습니다: #{p}" if File.exist?(p)
    end
    purge_stale_backups!
  end

  # 이전 절단이 남긴 .redact-backup 스윕. 이건 "임시 파일"이 아니라 **절단 전 오디오 전체**,
  # 즉 기밀 원음이다. 커밋 뒤 drop_backups! 가 실패하면 남는데, 그때 복구하는 것은 금지돼 있고
  # (DB 는 이미 커밋됐다 — 되살리면 전사만 지워진 채 기밀 오디오가 부활한다) audio_paths 글롭도
  # .redact-backup 을 제외하므로(작업 중인 백업을 자기가 자르면 안 되니까) 이후 절단에서도
  # 영원히 잘리지 않는다. 지우는 코드가 여기 말고는 없다 → 다음 절단이 파기 책임을 진다.
  # 순서 계약을 **코드로** 강제한다. 주석만으로는 리팩토링하다 깨지고, "본문이 스스로 올바른
  # 순서로 부르는" 유닛 테스트는 순서를 규정할 뿐 검증하지 못한다. swap 이후 호출은 즉시 raise.
  def purge_stale_backups!
    if @swapped
      raise PurgeFailed, "purge_stale_backups! 는 swap_in! 보다 먼저 호출해야 합니다 (이번 실행의 백업까지 지워 롤백 복구가 끊긴다)"
    end

    Dir.glob(File.join(audio_dir, "#{@meeting.id}.*.redact-backup")).each do |p|
      FileUtils.rm_f(p)
      raise PurgeFailed, "이전 절단의 잔존 백업을 지우지 못했습니다: #{p}" if File.exist?(p)
    end
  end

  # primary 오디오 하나만 임시본으로 절단한다(고아는 purge_duplicate_sources! 가 이미 지웠다).
  # 실패하면 만들던 임시본을 지우고 예외를 올린다.
  def cut_to_temp(kept_segments, total_cut_ms)
    produced = {}
    created = []
    begin
      Array(primary_audio_path).each do |path|
        ext = File.extname(path).downcase
        codec = CODECS[ext]
        raise UnsupportedFormat, "지원하지 않는 오디오 형식입니다: #{ext}" if codec.nil?

        src_duration_ms = probe_duration_ms(path)
        tmp = "#{path}.redact-tmp#{ext}"
        created << tmp

        ok = system(
          "ffmpeg", "-y", "-loglevel", "error",
          "-i", path,
          "-filter_complex", filter_graph(kept_segments, src_duration_ms),
          "-map", "[out]", *codec, tmp,
          out: File::NULL, err: File::NULL
        )
        unless ok && File.exist?(tmp) && File.size(tmp) > 0
          raise TranscodeFailed, "오디오 절단에 실패했습니다: #{File.basename(path)}"
        end

        expected = src_duration_ms - total_cut_ms
        actual = probe_duration_ms(tmp)
        if (actual - expected).abs > DURATION_TOLERANCE_MS
          raise TranscodeFailed,
                "절단 결과 길이가 기대와 다릅니다(#{File.basename(path)}): 기대 #{expected}ms, 실측 #{actual}ms"
        end

        produced[path] = tmp
      end
      produced
    rescue StandardError
      created.each { |t| FileUtils.rm_f(t) }
      raise
    end
  end

  # 트랜잭션 마지막에 호출. 같은 디렉토리 안 mv = rename 이라 사실상 원자적이다.
  def swap_in!(mapping)
    @swapped = true
    mapping.each do |path, tmp|
      backup = "#{path}.redact-backup"
      FileUtils.mv(path, backup)
      @backups[path] = backup
      FileUtils.mv(tmp, path)
    end
  end

  # 커밋 후에만 호출한다.
  def drop_backups!
    @backups.each_value { |b| FileUtils.rm_f(b) }
    @backups = {}
  end

  def restore_backups!
    @backups.each do |path, backup|
      next unless File.exist?(backup)

      FileUtils.rm_f(path)
      FileUtils.mv(backup, path)
    end
    @backups = {}
  end

  # 파형 캐시 무효화. peaks 는 파일 존재 여부로만 캐시 판정하므로
  # (meetings_audio_controller.rb:100-101) 안 지우면 절단 전 파형이 영구히 서빙된다.
  # 같은 경로 in-place 교체는 cleanup_original 의 무효화 경로에 걸리지 않는다.
  # **멱등이며 swap_in! 직전과 커밋 직후 두 번 호출한다** — 커밋 뒤 한 번만 부르면 그 사이
  # 프로세스가 죽었을 때 절단 전 파형이 회수 경로 없이 영구히 서빙된다(peaks 는 재생성 트리거가
  # "파일 없음" 뿐이라 스스로 낫지 않는다). 먼저 지워도 손해가 없다: 요청 시 재생성된다.
  def purge_peaks!
    audio_paths.each { |p| FileUtils.rm_f("#{p}.peaks.json") }
  end

  # 남길 세그먼트가 하나도 없는 경우(전사 전체 선택). ffmpeg 필터 그래프가 성립하지 않으므로
  # 절단 대신 오디오 자체를 치운다. reset_content(meetings_controller.rb:475-483)의 선례를 따르되,
  # 경로를 비우는 것은 set_audio_file!(meeting.rb:134-140)의 담당 범위가 아니라 호출부가 처리한다.
  #
  # **rm 이 아니라 swap 경로와 같은 백업 규율을 쓴다.** 그냥 지우면 이 호출 뒤 커밋이 실패했을 때
  # "전사는 그대로인데 오디오만 사라진 500" 이 되어 복구할 수 없다. .redact-backup 으로 옮겨두면
  # 기존 rescue 의 restore_backups! 가 그대로 되살린다(커밋 후 drop_backups! 가 파기).
  def move_all_audio_to_backup!
    @swapped = true
    audio_paths.each do |p|
      FileUtils.rm_f("#{p}.peaks.json")
      backup = "#{p}.redact-backup"
      FileUtils.mv(p, backup)
      @backups[p] = backup
    end
  end

  private

  def purge_tree!(path)
    return unless File.exist?(path)

    FileUtils.rm_rf(path)
    raise PurgeFailed, "중복 오디오 사본을 지우지 못했습니다: #{path}" if File.exist?(path)
  end

  # asplit=N 을 명시한다. 입력 pad 재사용을 split 없이 허용할지는 ffmpeg 빌드마다 달라
  # (실서버 WSL2 vs dev macOS) 명시하는 쪽이 안전하다. N 은 "남길 세그먼트 수"다.
  def filter_graph(kept_segments, duration_ms)
    n = kept_segments.length
    parts = [ "[0:a]asplit=#{n}#{(0...n).map { |i| "[s#{i}]" }.join}" ]
    kept_segments.each_with_index do |(s, e), i|
      trim = "atrim=start=#{seconds(s)}"
      # 마지막 세그먼트가 파일 끝까지면 end 를 생략한다(부동소수 반올림으로 EOF 를 넘지 않게).
      trim += ":end=#{seconds(e)}" if e < duration_ms
      parts << "[s#{i}]#{trim},asetpts=N/SR/TB[a#{i}]"
    end
    parts << "#{(0...n).map { |i| "[a#{i}]" }.join}concat=n=#{n}:v=0:a=1[out]"
    parts.join("; ")
  end

  def seconds(ms)
    format("%.3f", ms / 1000.0)
  end

  def probe_duration_ms(path)
    out = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(path)}`.strip
    (out.to_f * 1000).to_i
  end
end
```

- [ ] 4.4 통과 확인: `cd backend && bundle exec rspec spec/services/audio_redactor_spec.rb` → 16 examples, 0 failures
- [ ] 4.4b 반증 실증(수동, 커밋하지 않는다):
      - `purge_stale_backups!` 호출을 지워 실행 → "이전 절단이 남긴 .redact-backup 을 지운다" 실패 확인 후 원복
      - `purge_stale_backups!` 의 `if @swapped … raise` 가드를 지워 실행 → "swap_in! 뒤에 호출하면 raise 한다" 실패 확인 후 원복. **주석이 아니라 코드가 순서를 강제하는지 확인하는 자리다.**
      - `orphan_audio_paths` 삭제 루프를 지워 실행 → "고아 오디오를 peaks 와 함께 삭제한다" 실패 확인 후 원복
- [ ] 4.5 rubocop: `cd backend && bundle exec rubocop app/services/audio_redactor.rb spec/services/audio_redactor_spec.rb` → no offenses
- [ ] 4.6 커밋: `git add -A && git commit -m "feat(redact): 오디오 절단·부산물 파기·백업복구 담당 AudioRedactor 신설"`

---

# Task 5 — `authorize_meeting_admin!` (owner/admin 전용 인가)

절단은 복구 불가한 파기 + 오디오 재인코딩을 동반하므로 split의 `authorize_meeting_control!`(협업자 허용)보다 한 단계 위 티어를 쓴다.

## Files

- Modify: `backend/app/controllers/concerns/meeting_lookup.rb` (`:37` `authorize_meeting_control!` 끝 뒤에 메서드 추가)

> 이 태스크에는 전용 스펙 파일을 만들지 않는다. 익명 컨트롤러 + `Rails.application.routes.draw` 재작성은 **프로세스 전역 라우트 셋을 갈아엎어** 그 사이에 실행되는 다른 request spec 을 무작위로 깨뜨린다. 인가 규칙은 유일한 사용처(Task 6 `redact`)의 `context "권한"` 3건이 고정한다.

## Interfaces

**Consumes**: `MeetingLookup#meeting_admin?`(`:52-55`), `Meeting#owner?`(`app/models/meeting.rb:237-239`).

**Produces** — Task 6이 `before_action :authorize_meeting_admin!, only: %i[redact]`로 쓴다:

```ruby
MeetingLookup#authorize_meeting_admin!   # private. 실패 시 403 {"error": "이 회의를 관리할 권한이 없습니다"}
```

## Steps

- [ ] 5.1 현재 상태 확인: `cd backend && grep -n "authorize_meeting_admin!" -r app/` → **0줄이어야 한다.** 결과가 나오면 이미 존재하는 것이므로 5.2를 건너뛰고 시그니처가 `meeting_admin? || @meeting.owner?(current_user)` 와 같은지 확인만 한다.
      (참고: `MeetingsController#authorize_meeting_collaborator_admin!`(`:897-902`)이 같은 규칙이지만 `MeetingLookup` concern 이 아니라 그 컨트롤러의 private 메서드라 `TranscriptsController` 에서 쓸 수 없다.)
- [ ] 5.2 구현 — `backend/app/controllers/concerns/meeting_lookup.rb`의 `authorize_meeting_control!` 정의(`:31-37`) 바로 뒤에 추가:

```ruby
  # 관리 인가: admin / 소유자만. 협업자는 제외한다 — 복구 불가한 파기·구조 변경 액션 전용
  # (idea 44 에서 정한 "관리 액션 = owner/admin" 원칙). 전사 절단(transcripts#redact)이 첫 사용처.
  # split 이 authorize_meeting_control!(협업자 허용)인 이유는 "split 은 기밀 삭제가 아니라 편집"이며,
  # 절단은 정확히 그 반대 케이스다.
  # 같은 규칙이 MeetingsController#authorize_meeting_collaborator_admin! 에도 있으나 에러 문구가
  # 액션 도메인별로 달라(협업자 관리 vs 회의 관리) 통합하지 않는다.
  def authorize_meeting_admin!
    return if meeting_admin?
    return if @meeting.owner?(current_user)

    render json: { error: "이 회의를 관리할 권한이 없습니다" }, status: :forbidden
  end
```

- [ ] 5.3 회귀 확인: `cd backend && bundle exec rspec spec/requests` → 0 failures (concern 에 메서드를 추가했을 뿐이므로 기존 동작 무변경이어야 한다)
- [ ] 5.4 rubocop: `cd backend && bundle exec rubocop app/controllers/concerns/meeting_lookup.rb` → no offenses
- [ ] 5.5 커밋: `git add -A && git commit -m "feat(redact): owner/admin 전용 authorize_meeting_admin! 인가 헬퍼 추가"`

> 이 메서드의 인가 규칙(소유자 통과 / admin 통과 / **협업자 403**)은 Task 6의 `context "권한"` 3건이 고정한다. Task 6까지 가기 전에는 커버리지가 비어 있으므로 **Task 5와 Task 6은 연달아 진행한다.**

---

# Task 6 — `redact` 액션 (라우트 · 가드 · 트랜잭션 · 응답 · 브로드캐스트)

## Files

- Modify: `backend/config/routes.rb` (`:99-102` collection 블록에 `post :redact` 추가)
- Modify: `backend/app/controllers/api/v1/transcripts_controller.rb`
  - `:10-11` before_action 2줄 수정 + 1줄 추가
  - `:244` `split` 끝 뒤에 `redact` 액션 추가
  - `private` 아래(`:302` 끝)에 헬퍼 5개 추가
- Modify: `backend/spec/requests/api/v1/transcripts_spec.rb` (`:532` `split` describe 종료 뒤, `destroy_batch` describe 앞에 `redact` describe 추가)

## Interfaces

**Consumes**:

```ruby
TranscriptRedactionPlan.new(rows:, selected_ids:, audio_duration_ms:)
  #ranges #total_cut_ms #delta_for(ms) #remaining_rows #unselected_overlapping_ids #complete? #kept_segments
TranscriptRedactionPlan::CutRange  # .start_ms .end_ms .length_ms

AudioRedactor.new(meeting)
  #purge_duplicate_sources! #cut_to_temp(kept_segments, total_cut_ms) #swap_in!(mapping)
  #drop_backups! #restore_backups! #purge_peaks! #move_all_audio_to_backup!
AudioRedactor::Error

AudioUploadJob.in_flight_for?(meeting_id)

LlmPrompts::CitationMarkers::CITATION_RE
LlmPrompts::CitationMarkers::FOLDER_CITATION_RE
LlmPrompts::CitationMarkers.marker_time_to_ms(raw)
LlmPrompts::CitationMarkers.format_marker_time(ms, like:)

MeetingLookup#authorize_meeting_admin!
```

**Produces** — Task 8·9가 이 JSON 계약을 그대로 타입으로 옮긴다:

```
POST /api/v1/meetings/:meeting_id/transcripts/redact
  body { transcript_ids: number[],
         expected_bounds: { "<id>": { started_at_ms, ended_at_ms } },   ← 필수
         client_id?: string }
  200  { deleted_ids, ranges: [{start_ms, end_ms}], total_cut_ms, audio_duration_ms,
         summaries_destroyed, chat_markers_updated, bookmarks_removed, backup_retained }
  409  진행 중 / AudioUploadJob 인플라이트 / expected_bounds 불일치 / 겹침 완전성 실패 /
       **트랜잭션 내 재검증 실패(ffmpeg 실행 창 동안의 동시 변경)**
  422  transcript_ids 없음·비정수 / expected_bounds 누락(파라미터 또는 개별 항목) /
       알 수 없는 id / 오디오 형식·절단 실패 / 부산물 파기 실패
  403  비 owner·admin / 잠긴 회의
ActionCable  { type: "transcript_redacted", deleted_ids, ranges, total_cut_ms,
               audio_duration_ms, summaries_destroyed, chat_markers_updated,
               bookmarks_removed, backup_retained, client_id }
```

## Steps

- [ ] 6.1 라우트 추가 — `backend/config/routes.rb:99-102` collection 블록을 아래로 교체:

```ruby
          collection do
            delete :destroy_batch
            post :bulk, action: :bulk_create
            # 기밀 구간 절단(비가역). 상세: docs/superpowers/specs/2026-07-31-transcript-redact-range-design.md
            post :redact
          end
```

- [ ] 6.2 실패 테스트 작성(가드) — `backend/spec/requests/api/v1/transcripts_spec.rb`의 split `describe` 종료(`:532`) 뒤, `destroy_batch` 주석 블록(`:534`) 앞에 삽입:

```ruby
  # ─────────────────────────────────────────────────────────
  # POST /api/v1/meetings/:meeting_id/transcripts/redact
  # 기밀 구간 절단 — 전사 행 + 오디오를 실제로 파기(비가역)
  # ─────────────────────────────────────────────────────────
  describe "POST /api/v1/meetings/:meeting_id/transcripts/redact" do
    include ActiveJob::TestHelper

    let(:audio_dir) { Rails.root.join("tmp", "test_audio_#{SecureRandom.hex(4)}").to_s }

    around do |example|
      prev = ENV["AUDIO_DIR"]
      ENV["AUDIO_DIR"] = audio_dir
      FileUtils.mkdir_p(audio_dir)
      example.run
    ensure
      prev.nil? ? ENV.delete("AUDIO_DIR") : ENV["AUDIO_DIR"] = prev
      FileUtils.rm_rf(audio_dir)
    end

    def write_wav(path, seconds: 10.0, rate: 16_000)
      samples = (rate * seconds).to_i
      data = ("\x00\x00".b * samples)
      File.open(path, "wb") do |f|
        f.write("RIFF"); f.write([ 36 + data.bytesize ].pack("V")); f.write("WAVE")
        f.write("fmt "); f.write([ 16 ].pack("V")); f.write([ 1 ].pack("v")); f.write([ 1 ].pack("v"))
        f.write([ rate ].pack("V")); f.write([ rate * 2 ].pack("V"))
        f.write([ 2 ].pack("v")); f.write([ 16 ].pack("v"))
        f.write("data"); f.write([ data.bytesize ].pack("V")); f.write(data)
      end
    end

    # 1: [0,2000]  2: [3000,4000]  3: [5000,6000]  4: [7000,9000]
    let!(:t1) { create(:transcript, meeting: meeting, sequence_number: 1, content: "앞부분 발언", started_at_ms: 0, ended_at_ms: 2_000) }
    let!(:t2) { create(:transcript, meeting: meeting, sequence_number: 2, content: "기밀토큰AAA", started_at_ms: 3_000, ended_at_ms: 4_000) }
    let!(:t3) { create(:transcript, meeting: meeting, sequence_number: 3, content: "중간 발언", started_at_ms: 5_000, ended_at_ms: 6_000) }
    let!(:t4) { create(:transcript, meeting: meeting, sequence_number: 4, content: "기밀토큰BBB", started_at_ms: 7_000, ended_at_ms: 9_000) }

    before do
      wav = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(wav)
      meeting.update!(audio_file_path: wav)
    end

    # expected_bounds 는 required 다. 기본은 "화면과 서버가 일치하는 정상 상태" — DB 현재값을
    # 그대로 실어 보낸다. 불일치·누락 케이스는 각 테스트가 명시적으로 다르게 보낸다.
    def bounds_for(ids)
      Transcript.where(id: ids).each_with_object({}) do |t, h|
        h[t.id.to_s] = { started_at_ms: t.started_at_ms, ended_at_ms: t.ended_at_ms }
      end
    end

    def do_redact(ids, client_id: "c1", expected_bounds: nil)
      post "/api/v1/meetings/#{meeting.id}/transcripts/redact",
           params: { transcript_ids: ids, client_id: client_id,
                     expected_bounds: expected_bounds || bounds_for(ids) },
           as: :json
    end

    context "가드" do
      it "transcript_ids 가 비면 422" do
        do_redact([])
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "이 회의에 없는 id 가 섞이면 422 이고 아무 행도 지워지지 않는다" do
        do_redact([ t2.id, 999_999 ])
        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end

      it "recording 중이면 409" do
        meeting.update!(status: "recording")
        do_redact([ t2.id ])
        expect(response).to have_http_status(:conflict)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end

      it "transcribing 중이면 409" do
        meeting.update!(status: "transcribing")
        do_redact([ t2.id ])
        expect(response).to have_http_status(:conflict)
      end

      it "summarizing 중이면 409" do
        meeting.update!(summarizing: true)
        do_redact([ t2.id ])
        expect(response).to have_http_status(:conflict)
      end

      it "AudioUploadJob 이 인플라이트면 409 이고 아무것도 변하지 않는다 (조기 UX 가드)" do
        allow(AudioUploadJob).to receive(:in_flight_for?).with(meeting.id).and_return(true)
        do_redact([ t2.id ])
        expect(response).to have_http_status(:conflict)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
        expect(t2.reload.content).to eq("기밀토큰AAA")
      end

      it "잠긴 회의는 403" do
        meeting.update!(locked_at: Time.current)
        do_redact([ t2.id ])
        expect(response).to have_http_status(:forbidden)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end
    end

    context "권한" do
      it "협업자는 403 이다 (split 과 다른 티어)" do
        # :meeting_collaborator 팩토리는 이 저장소에 없다 — 기존 스펙과 같이 모델을 직접 만든다
        # (spec/requests/api/v1/meeting_collaborators_spec.rb:32).
        MeetingCollaborator.create!(meeting: meeting, user: other_user)
        create(:project_membership, project: project, user: other_user)
        login_as(other_user)

        do_redact([ t2.id ])

        expect(response).to have_http_status(:forbidden)
        expect(t2.reload.content).to eq("기밀토큰AAA")
      end

      it "소유자는 통과한다" do
        do_redact([ t2.id ])
        expect(response).to have_http_status(:ok)
      end

      it "admin 은 통과한다" do
        admin = create(:user, role: "admin")
        login_as(admin)

        do_redact([ t2.id ])

        expect(response).to have_http_status(:ok)
      end
    end
  end
```

> 이 `context "권한"` 3건이 Task 5의 `authorize_meeting_admin!` 규칙(소유자 ∨ admin, 협업자 제외)을 고정하는 유일한 커버리지다.

- [ ] 6.3 실패 확인: `cd backend && bundle exec rspec spec/requests/api/v1/transcripts_spec.rb -e "transcripts/redact"`
      → 라우트는 있으나 액션이 없어 `AbstractController::ActionNotFound` 또는 500 로 전부 실패.
- [ ] 6.4 구현(가드 부분) — `backend/app/controllers/api/v1/transcripts_controller.rb:10-11`을 아래로 교체:

```ruby
      before_action :authorize_meeting_control!, only: %i[destroy_batch bulk_create update_content split]
      # 절단은 복구 불가한 기밀 파기 + 오디오 재인코딩을 동반하므로 협업자를 제외한다
      # (idea 44: 관리 액션 = owner/admin). split 은 "편집"이라 control 티어를 유지한다.
      before_action :authorize_meeting_admin!, only: %i[redact]
      before_action :reject_if_locked!, only: %i[bulk_create update_content destroy_batch split redact]
```

- [ ] 6.5 구현(액션 본체) — 같은 파일 `split` 액션 종료(`:244`) 뒤, `private`(`:246`) 앞에 삽입:

```ruby
      # POST /api/v1/meetings/:meeting_id/transcripts/redact
      # 선택한 전사 행과 그 구간의 오디오를 실제로 파기한다. 마스킹이 아니라 절단이며 되돌릴 수 없다.
      # 설계: docs/superpowers/specs/2026-07-31-transcript-redact-range-design.md
      def redact
        raw_ids = Array(params[:transcript_ids])
        # 비스칼라 원소를 조용히 버리면 **부분 절단**이 된다 — 사용자는 전부 지웠다고 믿는데
        # 일부 기밀 행이 남는다. 하나라도 이상하면 아무것도 하지 않고 422.
        unless raw_ids.all? { |v| scalar_param?(v) }
          return render json: { error: "transcript_ids must be integers" }, status: :unprocessable_entity
        end
        ids = raw_ids.map(&:to_i).uniq
        return render json: { error: "transcript_ids required" }, status: :unprocessable_entity if ids.empty?

        # 진행 상태 가드는 split 과 동일한 이유(재번호 충돌 / 행이 계속 생성 중 / 요약 append 대상 어긋남).
        if @meeting.recording? || @meeting.transcribing?
          return render json: { error: "녹음 또는 전사 중에는 절단할 수 없습니다." }, status: :conflict
        end
        if @meeting.summarizing?
          return render json: { error: "요약 중에는 절단할 수 없습니다." }, status: :conflict
        end
        # 값싼 조기 409(UX)일 뿐 보증이 아니다 — 실제 경합은 AudioUploadJob 의 소스 identity 검증이
        # 닫는다(dev/test 는 :async 어댑터라 이 조회가 항상 false 다).
        if AudioUploadJob.in_flight_for?(@meeting.id)
          return render json: { error: "오디오 변환이 진행 중입니다. 잠시 후 다시 시도하세요." }, status: :conflict
        end

        rows = Transcript.where(meeting_id: @meeting.id).order(:sequence_number).to_a
        unknown = ids - rows.map(&:id)
        if unknown.any?
          return render json: { error: "transcript not found: #{unknown.join(', ')}" },
                        status: :unprocessable_entity
        end

        # 동시 split 가드 (설계 §낙관적 동시성 가드 (1)). 클라이언트가 화면에서 본 각 선택 행의 ms
        # 경계를 되돌려 보내고, 서버 현재값과 하나라도 다르면 아무것도 바꾸지 않고 409.
        # **required 다** — 없으면 422. optional 로 두면 클라이언트가 필드를 빠뜨렸을 때 가드가
        # 통째로 사라지고, 기밀 파기 기능에서 그 실패 모드는 허용되지 않는다.
        # 아래 겹침 완전성 검사로는 이 케이스를 잡을 수 없다: split 은 원행의 ended_at_ms 를
        # 분할점으로 줄이고 새 조각이 정확히 그 지점에서 시작하므로 gap 이 0 이 되어 클램프된
        # 경계가 새 조각과 겹치지 않는다 → 검사를 통과하고 절반만 잘려 기밀이 살아남는다.
        expected = params[:expected_bounds]
        unless expected.respond_to?(:[]) && expected.respond_to?(:key?)
          return render json: { error: "expected_bounds required" }, status: :unprocessable_entity
        end
        # 항목 **누락**과 값 **불일치**를 구분한다. 누락은 클라이언트 결함이라 새로고침해도 안 낫는다
        # (422). 불일치만 "다른 곳에서 바뀜"이라 재조회로 회복 가능한 409다.
        selected_rows = rows.select { |row| ids.include?(row.id) }
        missing_bounds = selected_rows.reject { |row| bounds_entry(expected, row.id) }
        if missing_bounds.any?
          return render json: { error: "expected_bounds missing for: #{missing_bounds.map(&:id).join(', ')}" },
                        status: :unprocessable_entity
        end
        if selected_rows.any? { |row| bounds_stale?(expected, row) }
          return render json: { error: "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요." },
                        status: :conflict
        end

        # 절단 경계는 실측 오디오 길이 기준이어야 한다. audio_duration_ms 는 전사 ms 파생이 아니고
        # (meeting.rb:117-132) stale 이면 마지막 구간의 cut_end 와 ffprobe 길이 검증이 함께 어긋난다.
        @meeting.refresh_audio_duration!
        plan = TranscriptRedactionPlan.new(
          rows: rows, selected_ids: ids, audio_duration_ms: @meeting.audio_duration_ms.to_i
        )
        unless plan.complete?
          return render json: { error: "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요." },
                        status: :conflict
        end

        kept = plan.kept_segments
        redactor = AudioRedactor.new(@meeting)
        tmp_map = {}
        begin
          # 중복 기밀 사본 선삭제 — 트랜잭션·ffmpeg 보다 먼저(V6-b). 남겨두면 finalize 가 잘리지 않은
          # 청크로 오디오를 재구성한다. 롤백돼도 무해하다(본 오디오에 이미 병합된 중복).
          # 여기서 이전 절단이 남긴 .redact-backup(= 절단 전 원음)도 함께 쓸어낸다. 이 호출이
          # swap_in! 보다 먼저여야 이번 실행의 백업이 살아남아 롤백 복구가 가능하다 — 순서 고정.
          redactor.purge_duplicate_sources!
          tmp_map = redactor.cut_to_temp(kept, plan.total_cut_ms) if kept.any?
        rescue AudioRedactor::Error => e
          # 여기서 중단하면 DB 는 무변경이다.
          return render json: { error: e.message }, status: :unprocessable_entity
        end

        summaries_destroyed = false
        chat_markers_updated = 0
        bookmarks_removed = 0
        begin
          ActiveRecord::Base.transaction do
            # ⭐ 트랜잭션 안에서 재검증. cut_to_temp 는 -c copy 가 불가해 1시간 mp3 면 수십 초
            # 걸리고, redact 는 아무 상태 플래그도 세우지 않으며 진행 상태 가드는
            # recording?/transcribing?/summarizing? 뿐이다. 그 창으로 split·bulk_create(이어녹음)·
            # destroy_batch 가 그대로 들어온다. 재검증이 없으면 destroy_all 이 **스냅샷 ids 만**
            # 지워 새 조각이 기밀 텍스트를 안고 살아남고, shift_remaining_transcripts! 도 옛
            # 스냅샷을 써서 그 조각은 ms 시프트도 못 받아 오디오와 어긋난다.
            plan = revalidate_redaction!(ids, expected, plan)

            # FTS 때문에 destroy_all 필수 — delete_all 은 after_destroy :fts_delete 를 건너뛰어
            # 잘라낸 전사 전문이 transcripts_fts 에 영구히 남는다(이 기능이 막으려는 실패 그 자체).
            @meeting.transcripts.where(id: ids).destroy_all
            # ⭐ 그런데 fts_delete 자체가 best-effort 다 — fts_indexable.rb:46-49 가 예외를 삼키고
            # Rails.logger.warn 만 한다. SQLITE_BUSY(이 저장소에 lock storm 실측 이력 있음)로
            # 실패하면 트랜잭션은 그대로 커밋되고 전사 행은 사라진 채 기밀 평문이 FTS 에
            # 영구히 남으면서 200 이 나간다. 삭제됐는지 직접 확인하고 아니면 롤백한다.
            # (fts_delete 자체는 공유 코드라 이 작업 범위 밖 — 여기서 검증만 한다.)
            verify_fts_purged!("transcripts_fts", ids)

            shift_remaining_transcripts!(plan)
            bookmarks_removed = redact_bookmarks!(plan)
            chat_markers_updated = redact_chat_markers!(plan)

            # 회의록은 마커 보정이 아니라 행 삭제 — realtime 요약이 append 형이라
            # (meeting_summarization_job.rb compose_appended_notes) 전사를 지워도 텍스트가 남는다.
            summary_ids = @meeting.summaries.pluck(:id)
            summaries_destroyed = @meeting.summaries.destroy_all.length.positive?
            # Summary 도 FtsIndexable(summaries_fts) 라 같은 best-effort 문제를 안는다.
            verify_fts_purged!("summaries_fts", summary_ids)
            @meeting.action_items.where(ai_generated: true).destroy_all
            @meeting.decisions.where(ai_generated: true).destroy_all

            # brief_summary 는 명시적 nil. refresh_brief_summary! 가 `if text.present?`(meeting.rb:615)라
            # 재생성 결과가 빈 값이면 옛 발췌가 남고, 이 컬럼은 LIKE 검색 대상이다(meeting.rb:151).
            @meeting.update_column(:brief_summary, nil)
            @meeting.update!(last_user_edit_at: Time.current) # D'Flow 재전송 신호

            # 파일 교체는 트랜잭션 마지막. 교체 실패 → 롤백 → 원본 오디오 온전.
            # 반대 순서(DB 커밋 후 교체)는 교체 실패 시 전사만 사라지고 기밀 오디오가 남는다.
            # peaks 는 여기서 한 번 지운다(멱등) — 커밋 뒤에만 지우면 그 사이 죽었을 때 절단 전
            # 파형이 회수 경로 없이 영구히 서빙된다.
            redactor.purge_peaks!
            if kept.empty?
              redactor.move_all_audio_to_backup! # rm 아님 — 커밋 실패 시 restore 로 되살린다
              @meeting.update_columns(audio_file_path: nil, audio_duration_ms: nil)
            else
              redactor.swap_in!(tmp_map)
            end
          end
        rescue RedactConflict => e
          # 재검증 실패 = 커밋 전이다. 오디오·DB 모두 무변경으로 되돌리고 409.
          redactor.restore_backups!
          tmp_map.each_value { |t| FileUtils.rm_f(t) }
          return render json: { error: e.message }, status: :conflict
        rescue StandardError
          # 여기 도달 = 커밋 전 실패. swap_in! 이 일부만 됐어도 전부 원본으로 되돌린다.
          redactor.restore_backups!
          tmp_map.each_value { |t| FileUtils.rm_f(t) }
          raise
        end

        # 커밋 후에만 백업 파기. 이 호출은 rescue 밖이어야 한다 — 커밋된 뒤에 restore_backups! 가
        # 돌면 "전사는 지워졌는데 기밀 오디오는 되살아나는" 금지된 방향이 된다.
        # 실패해도 되살리지 않는다. 대신 남은 백업(= 절단 전 원음)은 (a) 다음 절단의
        # purge_stale_backups! (b) 매시간 SttChunkStorage.sweep! 가 회수한다. 사용자에게도 알린다.
        backup_retained = false
        begin
          redactor.drop_backups!
        rescue StandardError => e
          backup_retained = true
          Rails.logger.error "[redact] meeting=#{@meeting.id} 백업 파기 실패 — 스위퍼가 회수한다: #{e.message}"
        end

        redactor.purge_peaks!
        @meeting.refresh_audio_duration! if kept.any?
        @meeting.reconcile_embeddings!

        payload = {
          deleted_ids: ids,
          ranges: plan.ranges.map { |r| { start_ms: r.start_ms, end_ms: r.end_ms } },
          total_cut_ms: plan.total_cut_ms,
          audio_duration_ms: @meeting.audio_duration_ms.to_i,
          summaries_destroyed: summaries_destroyed,
          chat_markers_updated: chat_markers_updated,
          bookmarks_removed: bookmarks_removed,
          backup_retained: backup_retained
        }

        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          payload.merge(type: "transcript_redacted", client_id: params[:client_id])
        )

        render json: payload
      end
```

- [ ] 6.6 구현(헬퍼) — 같은 파일 `private` 아래, `bulk_transcript_attrs` 정의(`:302`) 뒤에 추가:

```ruby
      # 트랜잭션 안 재검증 실패. rescue 에서 409 로 변환한다(500 아님).
      RedactConflict = Class.new(StandardError)

      # expected_bounds 항목 하나 꺼내기. nil 이면 "누락"(422), 있으면 값 비교 대상(409).
      def bounds_entry(expected, row_id)
        e = expected[row_id.to_s]
        e.respond_to?(:[]) && e.respond_to?(:key?) ? e : nil
      end

      # 값 불일치 판정. `.to_i` 를 쓰면 nil.to_i == 0 이라 started_at_ms 가 0 인 첫 행에서
      # "값이 없음"과 "값이 0"이 같아져 가드가 통과한다 — 키 존재와 정수 파싱을 분리한다.
      def bounds_stale?(expected, row)
        e = bounds_entry(expected, row.id)
        return true if e.nil?

        started = e.key?(:started_at_ms) ? Integer(e[:started_at_ms].to_s, exception: false) : nil
        ended   = e.key?(:ended_at_ms)   ? Integer(e[:ended_at_ms].to_s, exception: false)   : nil
        started != row.started_at_ms || ended != row.ended_at_ms
      end

      # ffmpeg 실행 창(수십 초) 동안 들어온 동시 변경을 트랜잭션 안에서 다시 잡는다.
      # 세 가지를 모두 본다:
      #   (a) expected_bounds — 선택 행이 split 등으로 바뀌었는지
      #   (b) complete?       — 창 안에 새로 삽입·이어녹음된 행이 경계에 걸리는지
      #   (c) 경계 동일성     — 위 둘을 통과해도 경계가 달라졌다면 이미 만든 ffmpeg 산출물이
      #                          무효다. 같다면 그대로 써도 안전하다(이 검사가 재사용을 licence 한다).
      # 반환값은 **재계산된 plan** — 이후 ms 시프트·재번호가 반드시 최신 스냅샷을 쓰게 한다.
      def revalidate_redaction!(ids, expected, original_plan)
        rows = Transcript.where(meeting_id: @meeting.id).order(:sequence_number).to_a
        if (ids - rows.map(&:id)).any?
          raise RedactConflict, "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요."
        end

        selected = rows.select { |row| ids.include?(row.id) }
        if selected.any? { |row| bounds_stale?(expected, row) }
          raise RedactConflict, "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요."
        end

        plan = TranscriptRedactionPlan.new(
          rows: rows, selected_ids: ids, audio_duration_ms: @meeting.audio_duration_ms.to_i
        )
        unless plan.complete?
          raise RedactConflict, "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요."
        end
        unless plan.range_bounds == original_plan.range_bounds
          raise RedactConflict, "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요."
        end

        plan
      end

      # FTS 행이 실제로 지워졌는지 확인. fts_delete 가 예외를 삼키므로(fts_indexable.rb:46-49)
      # destroy_all 이 성공해도 인덱스에 기밀 평문이 남아 있을 수 있다. 남아 있으면 raise 해
      # 트랜잭션을 롤백시킨다(→ 오디오도 원복, 사용자는 재시도 가능).
      def verify_fts_purged!(table, source_ids)
        return if source_ids.empty?

        conn = ActiveRecord::Base.connection
        placeholders = ([ "?" ] * source_ids.length).join(", ")
        rows = conn.execute(ActiveRecord::Base.sanitize_sql_array(
          [ "SELECT COUNT(*) AS c FROM #{table} WHERE source_id IN (#{placeholders})" ] + source_ids
        ))
        row = rows.to_a.first
        remaining = (row.is_a?(Hash) ? row["c"] : row&.first).to_i
        return if remaining.zero?

        raise "FTS 인덱스에서 #{remaining}건이 지워지지 않았습니다(#{table}) — 기밀 평문 잔존 위험으로 롤백합니다"
      end

      # 남은 행의 ms 를 누적 delta 만큼 당기고 sequence_number 를 1..N 으로 재번호한다.
      # FTS 콜백은 content/speaker_label/speaker_name 변경에만 걸리므로
      # (transcript.rb:3 fts_table columns) ms·seq 벌크 갱신에는 콜백이 필요 없다.
      # reorder(nil) 필수 — default_scope { order(:sequence_number) } 가 UPDATE 에 ORDER BY 를
      # 붙이면 SQLite 가 컴파일 플래그 없이 거부한다(split 과 동일 이유).
      def shift_remaining_transcripts!(plan)
        plan.remaining_rows.group_by { |row| plan.delta_for(row.started_at_ms) }.each do |delta, group|
          next if delta.zero?

          Transcript.where(id: group.map(&:id)).reorder(nil).update_all(
            ActiveRecord::Base.sanitize_sql_array(
              [ "started_at_ms = started_at_ms - ?, ended_at_ms = ended_at_ms - ?", delta, delta ]
            )
          )
        end

        # 재번호는 행당 UPDATE 로 하지 않는다 — 3000행 회의면 2999개 UPDATE 가 하나의 트랜잭션
        # 안에서 SQLite write lock 을 오래 쥔다(이 저장소에 lock storm 실측 이력이 있다).
        # (meeting_id, sequence_number) 에 unique 제약이 없으므로(schema.rb 일반 index) 중간
        # 충돌 걱정 없이 한 번에 갱신할 수 있다. 필요한 값이 같은 행끼리 묶어 update_all 한다.
        remaining = Transcript.where(meeting_id: @meeting.id).order(:sequence_number).to_a
        remaining.each_with_index.group_by { |row, i| i + 1 - row.sequence_number }
                 .each do |shift, pairs|
          next if shift.zero?

          Transcript.where(id: pairs.map { |row, _| row.id }).reorder(nil).update_all(
            ActiveRecord::Base.sanitize_sql_array(
              [ "sequence_number = sequence_number + ?", shift ]
            )
          )
        end
      end

      # meeting_bookmarks.timestamp_ms 는 transcript 와 FK 가 없는 독립 마커라 destroy_batch 가
      # 손대지 않는다. 구간 내부는 그 순간이 사라졌으므로 삭제, 이후는 delta 만큼 당긴다.
      # 경계 규약은 delta 규칙(cut_end <= t)과 맞춘다: cut_start <= ts < cut_end 면 삭제.
      def redact_bookmarks!(plan)
        removed = 0
        @meeting.meeting_bookmarks.to_a.each do |bm|
          if plan.ranges.any? { |r| r.cover?(bm.timestamp_ms) }
            bm.destroy!
            removed += 1
          else
            delta = plan.delta_for(bm.timestamp_ms)
            bm.update_column(:timestamp_ms, bm.timestamp_ms - delta) if delta.positive?
          end
        end
        removed
      end

      # 챗 인용 마커 보정. 챗 본문 자체는 지우지 않는다(사용자 결정) — 대신 마커가 어긋난 채
      # 남으면 speakerAtMs 의 nearest 폴백에 거리 상한이 없어(citationMarkers.ts:76-85) 조용히
      # 엉뚱한 발언으로 시크한다. ChatMessage 에는 FTS·임베딩 콜백이 없어 update_column 으로 충분하다.
      def redact_chat_markers!(plan)
        changed = 0

        # 회의 스코프 — 시스템 작업이므로 for_user 를 쓰지 않는다(전 사용자 대상).
        @meeting.chat_messages.each do |msg|
          new_content, n = rewrite_meeting_markers(msg.content.to_s, plan)
          next if n.zero?

          msg.update_column(:content, new_content)
          changed += n
        end

        # 폴더·프로젝트 스코프 — 이 회의를 인용한 것만. | 구분자 변형 때문에 LIKE 는 ⟦m:<id>/
        # 접두만 거르는 1차 필터이고 실제 판정은 정규식이 한다. ESCAPE '\' 는 하우스 룰(리터럴에
        # %·_ 가 없어도 붙인다).
        ChatMessage.where(scope_type: %w[folder project])
                   .where("content LIKE ? ESCAPE '\\'", "%⟦m:#{@meeting.id}/%")
                   .each do |msg|
          new_content, n = rewrite_folder_markers(msg.content.to_s, plan)
          next if n.zero?

          msg.update_column(:content, new_content)
          changed += n
        end

        changed
      end

      def rewrite_meeting_markers(text, plan)
        n = 0
        out = text.gsub(LlmPrompts::CitationMarkers::CITATION_RE) do
          m = Regexp.last_match
          shifted = shifted_marker_time(m[1], plan)
          next m[0] if shifted.nil?

          n += 1
          shifted.empty? ? "" : "⟦t:#{shifted}/s:#{m[2]}⟧"
        end
        [ out, n ]
      end

      def rewrite_folder_markers(text, plan)
        n = 0
        out = text.gsub(LlmPrompts::CitationMarkers::FOLDER_CITATION_RE) do
          m = Regexp.last_match
          next m[0] if m[1].to_i != @meeting.id

          shifted = shifted_marker_time(m[2], plan)
          next m[0] if shifted.nil?

          n += 1
          shifted.empty? ? "" : "⟦m:#{@meeting.id}/t:#{shifted}/s:#{m[3]}⟧"
        end
        [ out, n ]
      end

      # 구간 내부 → "" (마커 제거), 구간들 이후 → delta 만큼 당긴 시간 문자열, 그 외 → nil(무변경).
      # 콜론 형태(mm:ss·hh:mm:ss)는 같은 형태로 재직렬화한다.
      def shifted_marker_time(raw_time, plan)
        ms = LlmPrompts::CitationMarkers.marker_time_to_ms(raw_time)
        return "" if plan.ranges.any? { |r| r.cover?(ms) }

        delta = plan.delta_for(ms)
        return nil if delta.zero?

        LlmPrompts::CitationMarkers.format_marker_time(ms - delta, like: raw_time)
      end
```

- [ ] 6.7 통과 확인(가드): `cd backend && bundle exec rspec spec/requests/api/v1/transcripts_spec.rb -e "transcripts/redact"` → 9 examples, 0 failures
- [ ] 6.8 커밋: `git add -A && git commit -m "feat(redact): transcripts#redact 액션 + 라우트 + 진행상태·권한·완전성 가드"`

- [ ] 6.9 실패 테스트 추가(본 동작) — `redact` describe 안, `context "권한"` 뒤에 삽입:

```ruby
    context "정상 절단" do
      it "선택 행이 사라지고 응답에 구간·총 절단 길이가 담긴다" do
        do_redact([ t2.id ])

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["deleted_ids"]).to eq([ t2.id ])
        # t1 끝 2000, t2 [3000,4000], t3 시작 5000 → gap 중간점 [2500, 4500]
        expect(json["ranges"]).to eq([ { "start_ms" => 2_500, "end_ms" => 4_500 } ])
        expect(json["total_cut_ms"]).to eq(2_000)
        expect(Transcript.where(id: t2.id)).not_to exist
        expect(Transcript.where(meeting: meeting).count).to eq(3)
      end

      it "구간 2개면 마지막 구간 뒤 행의 ms 가 두 구간 길이의 합만큼 당겨진다 (누적 delta)" do
        do_redact([ t2.id, t4.id ])

        # 구간1 [2500,4500] = 2000ms, 구간2 [6500, 10000(오디오 끝)] — t4 가 마지막 행이라 끝까지.
        json = response.parsed_body
        expect(json["ranges"].length).to eq(2)
        expect(t3.reload.started_at_ms).to eq(5_000 - 2_000)
        expect(t3.reload.ended_at_ms).to eq(6_000 - 2_000)
      end

      it "경계는 행 ms 가 아니라 이웃과의 gap 중간점이다" do
        do_redact([ t2.id ])
        expect(response.parsed_body["ranges"].first["start_ms"]).to eq(2_500) # 3000(행 ms)이 아니다
      end

      it "sequence_number 가 1..N 으로 재번호된다" do
        do_redact([ t2.id ])
        expect(Transcript.where(meeting: meeting).order(:sequence_number).pluck(:sequence_number)).to eq([ 1, 2, 3 ])
      end

      it "last_user_edit_at 을 갱신한다 (D'Flow 재전송 신호)" do
        freeze = Time.zone.parse("2026-07-31 09:00:00")
        travel_to(freeze) { do_redact([ t2.id ]) }
        expect(meeting.reload.last_user_edit_at).to be_within(1.second).of(freeze)
      end

      it "transcript_redacted 를 브로드캐스트한다" do
        # allow 를 먼저 깔아 다른 브로드캐스트를 통과시킨다 — 스텁이 broadcast 자체를 대체하므로
        # 엄격 매칭만 걸면 무관한 브로드캐스트 하나에 원인 모를 실패가 난다.
        allow(ActionCable.server).to receive(:broadcast).and_call_original
        expect(ActionCable.server).to receive(:broadcast).with(
          meeting.transcription_stream, hash_including(type: "transcript_redacted", client_id: "c1")
        ).at_least(:once)
        do_redact([ t2.id ])
      end
    end

    context "FTS 정합성" do
      def fts_content_for(source_id)
        conn = ActiveRecord::Base.connection
        rows = conn.execute(ActiveRecord::Base.sanitize_sql_array(
          [ "SELECT content FROM transcripts_fts WHERE source_id = ?", source_id ]
        ))
        row = rows.to_a.first
        row.is_a?(Hash) ? row["content"] : row&.first
      end

      it "절단한 행의 텍스트가 transcripts_fts 에서 사라진다" do
        expect(fts_content_for(t2.id)).to eq("기밀토큰AAA")

        do_redact([ t2.id ])

        expect(fts_content_for(t2.id)).to be_nil
      end
    end

    context "동시 split 가드 (expected_bounds)" do
      it "expected_bounds 를 빼면 422 이고 아무 행도 변하지 않는다 (조용히 가드 없이 진행 금지)" do
        post "/api/v1/meetings/#{meeting.id}/transcripts/redact",
             params: { transcript_ids: [ t2.id ], client_id: "c1" }, as: :json

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to eq("expected_bounds required")
        expect(Transcript.where(meeting: meeting).count).to eq(4)
        expect(t2.reload.content).to eq("기밀토큰AAA")
      end

      it "선택 행 중 하나의 항목이 빠지면 409 가 아니라 422 다 (새로고침해도 안 낫는 클라이언트 결함)" do
        do_redact([ t2.id, t4.id ], expected_bounds: bounds_for([ t2.id ]))

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to include("expected_bounds missing")
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end

      it "started_at_ms 가 0 인 첫 행에서도 값 누락을 잡는다 (nil.to_i == 0 함정)" do
        # `.to_i` 로 비교하면 키가 없어도 0 이 되어 t1(started_at_ms: 0)에서 가드가 통과한다.
        do_redact([ t1.id ], expected_bounds: { t1.id.to_s => { ended_at_ms: 2_000 } })

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(id: t1.id)).to exist
      end

      it "transcript_ids 에 정수가 아닌 원소가 섞이면 422 다 (조용한 부분 절단 금지)" do
        post "/api/v1/meetings/#{meeting.id}/transcripts/redact",
             params: { transcript_ids: [ t2.id, { evil: 1 } ], client_id: "c1",
                       expected_bounds: bounds_for([ t2.id ]) },
             as: :json

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end

      it "선택 행을 split 한 뒤 옛 경계로 요청하면 409 이고 아무 행도 변하지 않는다 ⭐" do
        # 클라이언트가 목록을 읽은 시점의 경계를 스냅샷.
        stale_bounds = bounds_for([ t2.id ])

        # 그 사이 다른 클라이언트가 t2 를 split — 원행 ended_at_ms 가 3500 으로 줄고
        # 새 조각 [3500, 4000] 이 생긴다. 기밀 텍스트가 두 행에 나뉘어 남는다.
        post "/api/v1/meetings/#{meeting.id}/transcripts/#{t2.id}/split",
             params: { split_ms: 3_500, split_index: 2, expected_content: "기밀토큰AAA" }, as: :json
        expect(response).to have_http_status(:ok)
        inserted_id = response.parsed_body["inserted"]["id"]

        do_redact([ t2.id ], expected_bounds: stale_bounds)

        expect(response).to have_http_status(:conflict)
        expect(response.parsed_body["error"]).to include("새로고침")
        # 아무 행도 변하지 않는다 — split 이 만든 5개 행이 그대로다.
        expect(Transcript.where(meeting: meeting).count).to eq(5)
        expect(Transcript.where(id: t2.id)).to exist
        expect(Transcript.where(id: inserted_id)).to exist
        expect(t3.reload.started_at_ms).to eq(5_000) # ms 시프트도 일어나지 않았다
      end

      it "겹침 완전성만으로는 위 케이스가 통과한다 — 그래서 expected_bounds 가 따로 필요하다 (반증 고정)" do
        # 같은 시나리오를 "현재 경계"로 요청하면(=expected_bounds 가드가 무력화된 상황과 동일)
        # 겹침 완전성은 통과해 절반만 잘린다. 이 사실을 테스트로 못 박아, 나중에 누군가
        # expected_bounds 를 지우고 "겹침 완전성이 있으니 괜찮다"고 판단하지 못하게 한다.
        post "/api/v1/meetings/#{meeting.id}/transcripts/#{t2.id}/split",
             params: { split_ms: 3_500, split_index: 2, expected_content: "기밀토큰AAA" }, as: :json
        inserted_id = response.parsed_body["inserted"]["id"]

        do_redact([ t2.id ]) # 현재 경계 사용 → expected_bounds 통과

        expect(response).to have_http_status(:ok)
        # 조각2가 그대로 살아남는다 = 기밀 텍스트 잔존. expected_bounds 가 유일한 방어선이다.
        expect(Transcript.where(id: inserted_id)).to exist
      end
    end

    context "ffmpeg 실행 창 동안의 동시 변경 (트랜잭션 내 재검증)" do
      it "ffmpeg 도중 선택 행이 split 되면 409 이고 아무 행도 변하지 않는다 ⭐" do
        # cut_to_temp 는 -c copy 불가라 실제로 수십 초 걸린다. redact 는 상태 플래그를 세우지
        # 않으므로 그 창에 split 이 그대로 들어온다. 진입 시점 검증만 있으면 destroy_all 이
        # 스냅샷 ids 만 지워 새 조각이 기밀 텍스트를 안고 살아남는다.
        inserted_id = nil
        allow_any_instance_of(AudioRedactor).to receive(:cut_to_temp).and_wrap_original do |orig, *args|
          result = orig.call(*args)
          post "/api/v1/meetings/#{meeting.id}/transcripts/#{t2.id}/split",
               params: { split_ms: 3_500, split_index: 2, expected_content: "기밀토큰AAA" }, as: :json
          inserted_id = response.parsed_body["inserted"]["id"]
          result
        end

        do_redact([ t2.id ])

        expect(response).to have_http_status(:conflict)
        expect(Transcript.where(id: t2.id)).to exist
        expect(Transcript.where(id: inserted_id)).to exist
        expect(t3.reload.started_at_ms).to eq(5_000)
        expect(Dir.glob(File.join(audio_dir, "*.redact-tmp*"))).to be_empty
      end

      it "ffmpeg 도중 구간 안으로 행이 삽입되면 409 다 (expected_bounds 만으로는 못 잡는 경로)" do
        allow_any_instance_of(AudioRedactor).to receive(:cut_to_temp).and_wrap_original do |orig, *args|
          result = orig.call(*args)
          # 선택 행 자체는 안 바뀌므로 expected_bounds 는 통과한다 — complete? 재검증이 잡아야 한다.
          create(:transcript, meeting: meeting, sequence_number: 5,
                 content: "창 안에 들어온 행", started_at_ms: 3_200, ended_at_ms: 3_800)
          result
        end

        do_redact([ t2.id ])

        expect(response).to have_http_status(:conflict)
        expect(Transcript.where(id: t2.id)).to exist
      end
    end

    context "FTS 삭제 실패 시 롤백 (fts_delete 가 예외를 삼키는 것에 대한 방어)" do
      it "transcripts_fts 에 행이 남으면 롤백하고 오디오도 원본 그대로다" do
        # fts_indexable.rb:46-49 가 rescue + logger.warn 이라 SQLITE_BUSY 로 실패해도 커밋된다.
        # 그러면 전사 행은 사라진 채 기밀 평문이 FTS 에 영구히 남고 200 이 나간다.
        allow_any_instance_of(Transcript).to receive(:fts_delete) # no-op = 삭제 실패 재현
        original = File.binread(meeting.audio_file_path)

        expect { do_redact([ t2.id ]) }.to raise_error(/FTS 인덱스/)

        expect(Transcript.where(id: t2.id)).to exist
        expect(t2.reload.content).to eq("기밀토큰AAA")
        expect(File.binread(meeting.reload.audio_file_path)).to eq(original)
      end
    end

    context "겹침 완전성" do
      it "구간에 걸치는 행을 id 목록에서 빼면 409 이고 아무 행도 변하지 않는다" do
        # t2 구간 [2500,4500] 안으로 새 행이 들어온 상황(이어녹음·원격 bulk_create).
        intruder = create(:transcript, meeting: meeting, sequence_number: 5,
                          content: "나중에 들어온 행", started_at_ms: 3_500, ended_at_ms: 3_900)

        do_redact([ t2.id ])

        expect(response).to have_http_status(:conflict)
        expect(response.parsed_body["error"]).to include("새로고침")
        expect(Transcript.where(meeting: meeting).count).to eq(5)
        expect(t2.reload.content).to eq("기밀토큰AAA")
        expect(intruder.reload.started_at_ms).to eq(3_500)
      end
    end

    context "요약·brief_summary·AI 산출물" do
      it "요약 행을 삭제하고 brief_summary 를 명시적으로 nil 로 만든다" do
        meeting.summaries.create!(summary_type: "final", notes_markdown: "## 회의록\n- 기밀토큰AAA", generated_at: Time.current)
        meeting.update_column(:brief_summary, "옛 발췌 기밀토큰AAA")

        do_redact([ t2.id ])

        expect(meeting.reload.summaries.count).to eq(0)
        expect(meeting.reload.brief_summary).to be_nil
        expect(response.parsed_body["summaries_destroyed"]).to be true
      end

      it "ai_generated 액션아이템·결정만 삭제하고 사람이 쓴 것은 남긴다" do
        ai_item    = meeting.action_items.create!(content: "AI 추출", ai_generated: true)
        human_item = meeting.action_items.create!(content: "사람 입력", ai_generated: false)
        ai_dec     = meeting.decisions.create!(content: "AI 결정", ai_generated: true)
        human_dec  = meeting.decisions.create!(content: "사람 결정", ai_generated: false)

        do_redact([ t2.id ])

        expect(ActionItem.where(id: ai_item.id)).not_to exist
        expect(ActionItem.where(id: human_item.id)).to exist
        expect(Decision.where(id: ai_dec.id)).not_to exist
        expect(Decision.where(id: human_dec.id)).to exist
      end
    end

    context "북마크" do
      it "구간 내부 북마크는 사라지고 이후 북마크는 시프트된다" do
        inside = create(:meeting_bookmark, meeting: meeting, timestamp_ms: 3_500, label: "안쪽")
        after  = create(:meeting_bookmark, meeting: meeting, timestamp_ms: 8_000, label: "뒤쪽")
        before = create(:meeting_bookmark, meeting: meeting, timestamp_ms: 1_000, label: "앞쪽")

        do_redact([ t2.id ])

        expect(MeetingBookmark.where(id: inside.id)).not_to exist
        expect(after.reload.timestamp_ms).to eq(8_000 - 2_000)
        expect(before.reload.timestamp_ms).to eq(1_000)
        expect(response.parsed_body["bookmarks_removed"]).to eq(1)
      end
    end

    # 아래 챗 스펙 2개 주의:
    # - 회의 스코프 행은 meeting: 를 채워야 한다. 컨트롤러가 @meeting.chat_messages(=meeting_id)로
    #   훑기 때문이며, scope_type/scope_id 만으로는 걸리지 않는다.
    # - 폴더 스코프 행은 meeting_id 가 nil 이다(belongs_to :meeting, optional: true 라 유효).
    #   이쪽은 LIKE 1차 필터 + 정규식으로만 걸린다 — 의도한 경로다.
    context "챗 마커 보정" do
      it "구간 이후 마커는 당겨지고 구간 내부 마커는 제거된다" do
        msg = ChatMessage.create!(meeting: meeting, user: user, role: "assistant",
                                  scope_type: "meeting", scope_id: meeting.id,
                                  content: "뒤 근거 ⟦t:8000/s:화자 1⟧ 안쪽 근거 ⟦t:3500/s:화자 2⟧ 끝")

        do_redact([ t2.id ])

        expect(msg.reload.content).to eq("뒤 근거 ⟦t:6000/s:화자 1⟧ 안쪽 근거  끝")
        expect(response.parsed_body["chat_markers_updated"]).to eq(2)
      end

      it "콜론 형태 마커는 같은 형태로 파싱·시프트·재직렬화된다" do
        msg = ChatMessage.create!(meeting: meeting, user: user, role: "assistant",
                                  scope_type: "meeting", scope_id: meeting.id,
                                  content: "근거 ⟦t:0:08/s:화자 1⟧")

        do_redact([ t2.id ])

        expect(msg.reload.content).to eq("근거 ⟦t:0:06/s:화자 1⟧")
      end

      it "폴더 스코프 마커(| 구분자 포함)도 같은 회의 인용분만 보정한다" do
        mine = ChatMessage.create!(user: user, role: "assistant", scope_type: "folder", scope_id: 7,
                                   content: "A ⟦m:#{meeting.id}/t:8000|s:화자 1⟧ B ⟦m:#{meeting.id + 9999}/t:8000/s:화자 3⟧")

        do_redact([ t2.id ])

        expect(mine.reload.content)
          .to eq("A ⟦m:#{meeting.id}/t:6000/s:화자 1⟧ B ⟦m:#{meeting.id + 9999}/t:8000/s:화자 3⟧")
      end
    end
```

- [ ] 6.10 실패 확인: `cd backend && bundle exec rspec spec/requests/api/v1/transcripts_spec.rb -e "transcripts/redact"`
      → 새 example 들이 실패해야 한다(6.5·6.6 구현이 이미 있으면 대부분 통과할 수 있다 — 통과하면 그대로 진행하고, 실패가 나면 원인을 고친다).
- [ ] 6.11 통과 확인 후 반증 실증(수동, 커밋하지 않는다):
      - `expected_bounds` 검사 블록을 통째로 지워 실행 → "선택 행을 split 한 뒤 옛 경계로 요청하면 409 ⭐" 실패 확인 후 원복. **이 반증이 실패하지 않으면 가드가 실제로 아무것도 막지 않는 것이므로 멈추고 보고한다.**
      - `unless expected.respond_to?(:[]) …` 가드를 `if expected.present?` 조건부로 되돌려 실행 → "expected_bounds 를 빼면 422" 실패 확인 후 원복
      - `plan = revalidate_redaction!(...)` 호출을 지워 실행 → "ffmpeg 도중 선택 행이 split 되면 409 ⭐"·"구간 안으로 행이 삽입되면 409" 둘 다 실패 확인 후 원복. **둘 중 하나라도 실패하지 않으면 ffmpeg 창이 그대로 열려 있는 것이므로 멈추고 보고한다.**
      - `verify_fts_purged!` 호출 2개를 지워 실행 → "transcripts_fts 에 행이 남으면 롤백한다" 실패 확인 후 원복
      - `bounds_stale?` 의 `Integer(..., exception: false)` 를 `.to_i` 로 되돌려 실행 → "started_at_ms 가 0 인 첫 행에서도 값 누락을 잡는다" 실패 확인 후 원복
      - `@meeting.transcripts.where(id: ids).destroy_all` → `.delete_all` 로 바꿔 실행 → "절단한 행의 텍스트가 transcripts_fts 에서 사라진다" 실패 확인 후 원복
      - `plan.delta_for(row.started_at_ms)` → `plan.ranges.first.length_ms` 로 바꿔 실행 → "누적 delta" 실패 확인 후 원복
      - `LlmPrompts::CitationMarkers.marker_time_to_ms` 를 `raw_time.to_i` 로 바꿔 실행 → "콜론 형태 마커" 실패 확인 후 원복
      - `@meeting.update_column(:brief_summary, nil)` 를 `@meeting.refresh_brief_summary!` 로 바꿔 실행 → "brief_summary nil" 실패 확인 후 원복
- [ ] 6.12 rubocop: `cd backend && bundle exec rubocop app/controllers/api/v1/transcripts_controller.rb config/routes.rb spec/requests/api/v1/transcripts_spec.rb` → no offenses
- [ ] 6.13 커밋: `git add -A && git commit -m "test(redact): 절단 본동작·FTS·누적delta·마커·북마크·요약 스펙 추가"`

---

# Task 7 — 오디오·아티팩트 반증 스펙

Task 6에서 만든 `redact` describe에 오디오 계열 반증 케이스를 추가한다. 구현 변경 없이 스펙만 늘어나는 것이 정상이며, 실패하면 Task 4/6의 코드를 고친다.

## Files

- Modify: `backend/spec/requests/api/v1/transcripts_spec.rb` (`redact` describe 안, `context "챗 마커 보정"` 뒤)

## Interfaces

**Consumes**: Task 6의 `do_redact` / `write_wav` / `audio_dir` let·헬퍼, `AudioRedactor`, `SttChunkStorage::ROOT`.
**Produces**: 없음.

## Steps

- [ ] 7.1 실패 테스트 작성 — `redact` describe 안 마지막에 삽입:

```ruby
    context "오디오 절단" do
      def probe_ms(path)
        out = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(path)}`.strip
        (out.to_f * 1000).to_i
      end

      it "오디오가 총 절단 길이만큼 짧아지고 audio_duration_ms 가 실측으로 갱신된다" do
        do_redact([ t2.id ])

        expect(response).to have_http_status(:ok)
        expect(probe_ms(meeting.reload.audio_file_path)).to be_within(1_000).of(8_000)
        expect(response.parsed_body["audio_duration_ms"]).to be_within(1_000).of(8_000)
      end

      it "peaks 캐시가 무효화된다 (안 지우면 절단 전 파형이 영구히 서빙된다)" do
        peaks = "#{meeting.audio_file_path}.peaks.json"
        File.write(peaks, "{}")

        do_redact([ t2.id ])

        expect(File.exist?(peaks)).to be false
      end

      it "길이가 다른 고아 오디오(<id>.webm)는 절단이 아니라 삭제된다" do
        # ⚠️ 픽스처는 반드시 **길이가 다른** 파일이어야 한다. 같은 소스에서 트랜스코딩하면
        # 길이가 같아, 하나의 kept_segments 를 전 파일에 적용하는 잘못된 구현도 통과해버린다.
        # 실제 V3 시나리오(재녹음 병합)에서 <id>.webm 과 <id>.mp3 는 길이가 다르다.
        short = File.join(audio_dir, "#{meeting.id}_short.wav")
        write_wav(short, seconds: 4.0)
        webm = File.join(audio_dir, "#{meeting.id}.webm")
        system("ffmpeg", "-y", "-loglevel", "error", "-i", short,
               "-c:a", "libopus", webm, out: File::NULL, err: File::NULL)
        FileUtils.rm_f(short)
        expect(probe_ms(webm)).to be_within(1_000).of(4_000) # primary(10초)보다 짧다
        File.binwrite("#{webm}.peaks.json", "{}")

        do_redact([ t2.id ])

        expect(response).to have_http_status(:ok)
        # 고아는 audio_file_path 가 가리키지 않는 절단 전 기밀 오디오다 — 자르지 않고 지운다.
        # (자르려 하면 짧은 쪽에서 뒤쪽 세그먼트가 통째로 잘려 길이 검증 실패 → 영구 절단 불가)
        expect(File.exist?(webm)).to be false
        expect(File.exist?("#{webm}.peaks.json")).to be false
        # primary 는 정상 절단된다.
        expect(probe_ms(File.join(audio_dir, "#{meeting.id}.wav"))).to be_within(1_000).of(8_000)
      end

      it "_parts/ 와 stt_chunks/ 가 파기되고, 그 상태에서 finalize 는 오디오를 재구성하지 못한다" do
        parts = File.join(audio_dir, "#{meeting.id}_parts")
        FileUtils.mkdir_p(parts)
        File.binwrite(File.join(parts, "0.part"), "\x1A\x45\xDF\xA3" + ("x" * 100))
        chunks = SttChunkStorage::ROOT.join(meeting.id.to_s)
        FileUtils.mkdir_p(chunks)
        File.binwrite(chunks.join("0-abc.pcm"), "x" * 100)
        merged = File.join(audio_dir, "#{meeting.id}.webm.merged.webm")
        File.binwrite(merged, "x")

        do_redact([ t2.id ])

        expect(Dir.exist?(parts)).to be false
        expect(Dir.exist?(chunks)).to be false
        expect(File.exist?(merged)).to be false

        # 선삭제를 커밋 후로 미루면 이 사이에 finalize 가 잘리지 않은 청크로 오디오를 재구성한다.
        post "/api/v1/meetings/#{meeting.id}/audio_finalize"
        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to eq("No audio chunks")
      end

      it "이전 절단이 남긴 .redact-backup 을 파기한다 (절단 전 원음이 영구 잔존하지 않도록)" do
        # 커밋 후 drop_backups! 가 실패하면 남는 파일. 절단 전 오디오 **전체**라 기밀 원음이고,
        # audio_paths 글롭에서 제외되므로 이후 절단에서도 잘리지 않는다 — 지우는 코드가
        # purge_stale_backups! 말고는 없다.
        stale = File.join(audio_dir, "#{meeting.id}.wav.redact-backup")
        File.binwrite(stale, "절단 전 원음 전체")

        do_redact([ t2.id ])

        expect(response).to have_http_status(:ok)
        expect(File.exist?(stale)).to be false
        # 이번 실행의 백업은 커밋 후 정상 파기되므로 어느 쪽도 남지 않는다.
        expect(Dir.glob(File.join(audio_dir, "*.redact-backup"))).to be_empty
      end

      it "ffmpeg 이 실패하면 DB 무변경 + 422 이고 오디오도 원본 그대로다" do
        File.binwrite(meeting.audio_file_path, "not audio at all")
        original = File.binread(meeting.audio_file_path)

        do_redact([ t2.id ])

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
        expect(t2.reload.content).to eq("기밀토큰AAA")
        expect(File.binread(meeting.reload.audio_file_path)).to eq(original)
      end

      it "지원하지 않는 오디오 형식이면 422 이고 DB 무변경이다" do
        flac = File.join(audio_dir, "#{meeting.id}.flac")
        File.binwrite(flac, "x")

        do_redact([ t2.id ])

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end

      it "파일 교체 도중 실패하면 DB 가 롤백되고 오디오가 원본 그대로 복구된다 (롤백 원자성)" do
        wav_original = File.binread(meeting.audio_file_path)

        # ⚠️ 실패 지점은 반드시 **트랜잭션 안**, swap_in! 이 백업을 만든 **뒤**여야 한다.
        # drop_backups! 는 커밋 뒤라 거기서 깨면 "전사는 지워졌는데 오디오는 복구됨" — 설계가
        # 금지한 방향이 되어 이 단언이 성립하지 않는다.
        allow_any_instance_of(AudioRedactor).to receive(:swap_in!).and_wrap_original do |orig, mapping|
          orig.call(mapping) # 백업 생성 + 교체까지 실제로 수행한 뒤
          raise StandardError, "boom" # 그 상태에서 터뜨려 restore 경로를 태운다
        end

        expect { do_redact([ t2.id ]) }.to raise_error(StandardError, "boom")

        expect(Transcript.where(id: t2.id)).to exist
        expect(Transcript.where(meeting: meeting).count).to eq(4)
        expect(File.binread(File.join(audio_dir, "#{meeting.id}.wav"))).to eq(wav_original)
        expect(Dir.glob(File.join(audio_dir, "*.redact-backup"))).to be_empty
        expect(Dir.glob(File.join(audio_dir, "*.redact-tmp*"))).to be_empty
      end

      it "purge 를 swap 뒤로 옮기면 요청이 실패한다 (순서 계약 회귀 가드)" do
        # M3: 유닛 테스트만으로는 컨트롤러 호출 순서를 뒤집어도 잡히지 않았다. AudioRedactor 가
        # @swapped 로 순서를 강제하므로, 순서가 뒤집히면 여기서 PurgeFailed 로 드러난다.
        allow_any_instance_of(AudioRedactor).to receive(:purge_duplicate_sources!).and_wrap_original do |orig, *args|
          orig.receiver.send(:instance_variable_set, :@swapped, true) # swap 이 먼저 돈 상태 재현
          orig.call(*args)
        end

        do_redact([ t2.id ])

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(id: t2.id)).to exist
      end

      it "전사를 전부 고르면 오디오 파일이 사라지고 audio_file_path 가 비워진다" do
        path = meeting.audio_file_path

        do_redact([ t1.id, t2.id, t3.id, t4.id ])

        expect(response).to have_http_status(:ok)
        expect(Transcript.where(meeting: meeting).count).to eq(0)
        expect(File.exist?(path)).to be false
        expect(meeting.reload.audio_file_path).to be_nil
        # 백업 경유로 치웠지만 커밋 후 파기되므로 아무것도 남지 않는다.
        expect(Dir.glob(File.join(audio_dir, "*.redact-backup"))).to be_empty
      end

      it "전체 선택 경로에서 커밋이 실패하면 오디오가 되살아난다 (rm 이 아니라 백업 규율)" do
        path = meeting.audio_file_path
        original = File.binread(path)
        allow_any_instance_of(Meeting).to receive(:update_columns).and_raise(StandardError, "boom")

        expect { do_redact([ t1.id, t2.id, t3.id, t4.id ]) }.to raise_error(StandardError, "boom")

        expect(File.binread(path)).to eq(original)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end
    end
```

- [ ] 7.2 실행: `cd backend && bundle exec rspec spec/requests/api/v1/transcripts_spec.rb -e "오디오 절단"`
- [ ] 7.3 실패가 나오면 Task 4/6 코드를 고친다. 순서 불변식(**파일 교체는 트랜잭션 안 마지막, 백업 파기는 커밋 뒤**)은 절대 바꾸지 않는다. 참고로 이 순서의 귀결은 다음과 같고, 스펙도 그렇게 짜여 있다:
      - `swap_in!` 도중 실패 → 트랜잭션 롤백 + `restore_backups!` → **DB·파일 모두 원상** (위 "롤백 원자성" 케이스)
      - 커밋 성공 후 `drop_backups!` 실패 → 백업 파일만 남는다. **여기서 `restore_backups!` 를 돌리면 안 된다** — DB 는 이미 커밋됐으므로 "전사는 지워졌는데 기밀 오디오는 복구됨"이 되어 설계가 금지한 방향이 된다.
        ⚠️ **다만 그 잔존 파일은 무해하지 않다.** `<id>.*.redact-backup` 은 절단 **전** 오디오 전체, 즉 기밀 원음이다. `audio_paths` 글롭이 이걸 제외하므로(작업 중인 백업을 자기가 자르면 안 되니까) 이후 절단에서도 잘리지 않고, 지우는 코드도 `purge_stale_backups!` 말고는 없다. → **다음 절단이 시작 시 스윕해서 파기한다**(Task 4 `purge_duplicate_sources!`).
        회수 경로는 **둘**이다: (a) 다음 절단의 `purge_stale_backups!` (b) 매시간 `SttChunkStorage.sweep_redact_backups!`(Task 13, `older_than: 1.hour`). (a) 만으로는 회수가 아니다 — 대부분의 회의는 두 번 절단되지 않는다. 실패 시 `Rails.logger.error` + 응답 `backup_retained: true` 로 노출한다.
        **잔여 한계**: 최대 ~1시간 동안은 디스크에 남는다(진행 중인 절단의 백업을 뺏지 않기 위한 임계).
- [ ] 7.4 반증 실증(수동, 커밋하지 않는다):
      - `redactor.purge_peaks!` 호출을 지워 실행 → "peaks 캐시가 무효화된다" 실패 확인 후 원복
      - `purge_duplicate_sources!` 호출을 트랜잭션 커밋 뒤로 옮겨 실행 → "_parts/ 와 stt_chunks/ …" 의 finalize 422 단언이 실패하는지 확인 후 원복
      - `purge_duplicate_sources!` 의 고아 삭제 루프를 지워 실행 → "길이가 다른 고아 오디오는 절단이 아니라 삭제된다" 실패 확인 후 원복
      - `cut_to_temp` 의 `Array(primary_audio_path)` 를 `audio_paths` 로 되돌려 실행 → 같은 테스트가 `TranscodeFailed`(길이 불일치)로 실패하는지 확인 후 원복. **이게 M2 가 막는 "그 회의 영구 절단 불가" 경로다.**
      - `purge_peaks!` 의 트랜잭션 내 호출(swap 직전)을 지워도 테스트는 통과한다 — 커밋 후 호출이 남아 있기 때문이다. 이 이중 호출은 "커밋과 커밋 후 호출 사이에 죽는" 창을 좁히는 방어이며 스펙으로 고정하지 않는다(프로세스 사망을 스펙에서 재현할 수 없다). 주석으로만 이유를 남긴다.
      - `purge_stale_backups!` 호출을 지워 실행 → "이전 절단이 남긴 .redact-backup 을 파기한다" 실패 확인 후 원복. **실패하지 않으면 기밀 원음이 디스크에 영구히 남는 경로가 열려 있는 것이므로 멈추고 보고한다.**
- [ ] 7.5 백엔드 전체 확인: `cd backend && bundle exec rspec` → 0 failures (기준선 2158 + 신규분)
- [ ] 7.6 rubocop: `cd backend && bundle exec rubocop` → no offenses
- [ ] 7.7 커밋: `git add -A && git commit -m "test(redact): 오디오 절단·peaks 무효화·부산물 파기·롤백 원자성 반증 스펙"`

---

# Task 8 — 프론트 API 클라이언트 + 타입

## Files

- Modify: `frontend/src/api/meetings/types.ts` (`:241` `SplitTranscriptResponse` 정의 뒤에 추가)
- Modify: `frontend/src/api/meetings/transcripts.ts` (`:2` import 확장, `:18` `splitTranscript` 뒤에 함수 추가)

## Interfaces

**Consumes**: Task 6의 JSON 계약.

**Produces** — Task 9·11이 이 이름 그대로 import 한다 (배럴 `frontend/src/api/meetings.ts`가 자동 re-export):

```ts
export interface RedactedRange { start_ms: number; end_ms: number }
export interface TranscriptBounds { started_at_ms: number; ended_at_ms: number }
export interface RedactTranscriptsParams {
  transcript_ids: number[]
  expected_bounds: Record<string, TranscriptBounds>   // 필수 (optional 아님)
  client_id?: string
}
export interface RedactTranscriptsResponse {
  deleted_ids: number[]
  ranges: RedactedRange[]
  total_cut_ms: number
  audio_duration_ms: number
  summaries_destroyed: boolean
  chat_markers_updated: number
  bookmarks_removed: number
  /** 커밋 후 백업 파기가 실패해 `.redact-backup`(절단 전 원음)이 남았는지. true 면 다음 절단
   *  또는 매시간 스위퍼가 회수할 때까지 디스크에 남는다. UI 가 경고에 쓸 수 있다. */
  backup_retained: boolean
}
export function redactTranscripts(meetingId: number, params: RedactTranscriptsParams): Promise<RedactTranscriptsResponse>
```

## Steps

- [ ] 8.1 타입 추가 — `frontend/src/api/meetings/types.ts:241`(`SplitTranscriptResponse` 닫는 `}`) 뒤에 삽입:

```ts
/** 서버가 확정한 절단 구간(이웃 gap 중간점으로 클램프·병합된 값). 요청의 행 ms 와 다를 수 있다. */
export interface RedactedRange {
  start_ms: number
  end_ms: number
}

/** 화면에서 본 전사 행의 ms 경계. 동시 split 가드의 단언 단위. */
export interface TranscriptBounds {
  started_at_ms: number
  ended_at_ms: number
}

/** POST transcripts/redact 요청 바디. 선택한 전사 행 id 집합 —
 *  서버가 sequence_number 연속 런으로 묶어 구간 N개를 만든다. 되돌릴 수 없다. */
export interface RedactTranscriptsParams {
  transcript_ids: number[]
  /** 각 선택 행의 "화면에서 본" ms 경계(키 = transcript id 문자열). 서버 현재값과 하나라도
   *  다르면 409. **필수다** — 빠뜨리면 422다. optional 로 두면 동시 split 가드가 통째로
   *  사라지고, 그 경우 기밀 텍스트가 절반만 잘려 살아남는다(겹침 완전성 검사로는 못 잡는다). */
  expected_bounds: Record<string, TranscriptBounds>
  client_id?: string
}

/** POST transcripts/redact 응답. */
export interface RedactTranscriptsResponse {
  deleted_ids: number[]
  ranges: RedactedRange[]
  total_cut_ms: number
  /** 절단 후 ffprobe 로 재측정한 오디오 길이. 전사 ms 파생이 아니다. */
  audio_duration_ms: number
  /** 회의록(요약) 행이 삭제되었는지 — 사용자에게 재생성을 안내하는 데 쓴다. */
  summaries_destroyed: boolean
  chat_markers_updated: number
  bookmarks_removed: number
  /** 커밋 후 백업 파기가 실패해 `.redact-backup`(절단 전 원음)이 남았는지. true 면 다음 절단
   *  또는 매시간 스위퍼가 회수할 때까지 디스크에 남는다. UI 가 경고에 쓸 수 있다. */
  backup_retained: boolean
}
```

- [ ] 8.2 API 함수 추가 — `frontend/src/api/meetings/transcripts.ts:2` import 를 아래로 교체:

```ts
import type {
  Transcript,
  BulkTranscriptItem,
  SplitTranscriptParams,
  SplitTranscriptResponse,
  RedactTranscriptsParams,
  RedactTranscriptsResponse,
} from './types'
```

  `RedactTranscriptsParams.expected_bounds` 가 필수 필드이므로, 호출부(Task 11)가 이 필드를 빠뜨리면 `npx tsc -p tsconfig.app.json` 이 컴파일 단계에서 잡는다 — 서버의 422 는 두 번째 방어선이다.

  그리고 `splitTranscript` 정의(`:18` 닫는 `}`) 뒤에 삽입:

```ts
/** 선택한 전사 행과 그 구간의 오디오를 실제로 파기한다. 마스킹이 아니라 절단이며 되돌릴 수 없다.
 *  403(비 owner/admin·잠금)·409(녹음·전사·요약 중, 오디오 변환 중, 겹침 완전성 실패)·
 *  422(검증·오디오 절단 실패)는 호출부가 HTTPError 로 받는다. */
export async function redactTranscripts(
  meetingId: number,
  params: RedactTranscriptsParams,
): Promise<RedactTranscriptsResponse> {
  return apiClient
    .post(`meetings/${meetingId}/transcripts/redact`, { json: params })
    .json<RedactTranscriptsResponse>()
}
```

- [ ] 8.3 타입체크: `cd frontend && npx tsc -p tsconfig.app.json` → 에러 0
- [ ] 8.4 커밋: `git add -A && git commit -m "feat(redact): 프론트 redactTranscripts API 클라이언트·타입 추가"`

---

# Task 9 — 스토어 개명 + `audioRevision` + 채널 핸들러 + `MeetingPage` 배선

split이 만든 `remoteSplitRevision` 메커니즘을 일반화(개명)하고 절단에서도 쓴다. 기계적 변경이므로 **모든 호출부와 테스트를 함께** 바꾼다.

> **(C) 결정 사항 — 이 태스크의 원격 경로는 지금은 발화하지 않는다.** `MeetingPage`는 전사 채널을 구독하지 않으므로(`useTranscription` 호출부는 `useLiveRecording.ts:125`·`MeetingViewerPage.tsx:41`뿐) `transcript_redacted` 브로드캐스트가 `MeetingPage`에 도달하지 않는다. 머지된 split의 원격 동기도 같은 이유로 죽어 있는 **사전 존재 갭**이며, 이번 작업의 회귀가 아니다(설계 §V4-b). 구독이 붙는 순간 이 코드가 그대로 동작한다.
> 그래서 이 태스크의 테스트는 **실제 구독에 의존하지 않는다** — 채널 `received()` 핸들러와 store 액션을 직접 호출해 검증한다. 절단한 본인 화면의 갱신은 원격 신호가 아니라 Task 12의 로컬 경로가 담당한다.

## Files

- Modify: `frontend/src/stores/transcriptStore.ts` (`:22-26`, `:38-40`, `:70`, `:189`)
- Modify: `frontend/src/stores/transcriptStore.test.ts` (`:271-292`)
- Modify: `frontend/src/channels/transcription.ts` (`:37-64` BackendMessage, `:146-164` split case 뒤에 redact case 추가)
- Modify: `frontend/src/channels/transcription.test.ts` (`:238`, `:251-296`)
- Modify: `frontend/src/pages/MeetingPage.tsx` (`:131-143` 셀렉터·ref, `:311-333` 재조회 이펙트만. **`:195` `useAudioPlayer` 호출은 Task 10에서 바꾼다** — 훅 시그니처가 아직 1인자라 여기서 바꾸면 타입 에러)
- Modify: `frontend/src/pages/MeetingPage.test.tsx` (`:603-621`)

## Interfaces

**Consumes**: Task 6의 `transcript_redacted` 브로드캐스트 페이로드.

**Produces** — Task 10·11이 참조한다:

```ts
useTranscriptStore:
  remoteStructureRevision: number          // 구 remoteSplitRevision
  markRemoteStructureChange: () => void    // 구 markRemoteSplit
  audioRevision: number                    // 오디오 파일이 교체될 때마다 증가
  markAudioChanged: () => void
```

## Steps

- [ ] 9.1 실패 테스트 작성 — `frontend/src/stores/transcriptStore.test.ts:271-292`의 `describe('markRemoteSplit', ...)` 블록 전체를 아래로 교체:

```ts
describe('markRemoteStructureChange', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('호출할 때마다 remoteStructureRevision을 증가시킨다', () => {
    expect(useTranscriptStore.getState().remoteStructureRevision).toBe(0)
    useTranscriptStore.getState().markRemoteStructureChange()
    expect(useTranscriptStore.getState().remoteStructureRevision).toBe(1)
    useTranscriptStore.getState().markRemoteStructureChange()
    expect(useTranscriptStore.getState().remoteStructureRevision).toBe(2)
  })

  it('applySplit 자체는 remoteStructureRevision을 건드리지 않는다 (로컬 경로에서 이중 재조회 방지)', () => {
    useTranscriptStore.getState().loadFinals([
      { id: 1, content: '원문', speaker_label: 'S0', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: true },
    ])
    useTranscriptStore.getState().applySplit(
      { id: 1, content: '원', speaker_label: 'S0', started_at_ms: 0, ended_at_ms: 500, sequence_number: 1 },
      { id: 2, content: '문', speaker_label: 'S0', started_at_ms: 500, ended_at_ms: 1000, sequence_number: 2 },
    )
    expect(useTranscriptStore.getState().remoteStructureRevision).toBe(0)
  })
})

describe('markAudioChanged', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('호출할 때마다 audioRevision을 증가시킨다', () => {
    expect(useTranscriptStore.getState().audioRevision).toBe(0)
    useTranscriptStore.getState().markAudioChanged()
    expect(useTranscriptStore.getState().audioRevision).toBe(1)
  })

  it('remoteStructureRevision과 독립이다 (원격 split은 오디오를 바꾸지 않는다)', () => {
    useTranscriptStore.getState().markRemoteStructureChange()
    expect(useTranscriptStore.getState().audioRevision).toBe(0)
  })
})
```

- [ ] 9.2 실패 확인: `cd frontend && npx vitest run src/stores/transcriptStore.test.ts`
      → `markRemoteStructureChange is not a function`, `markAudioChanged is not a function`
- [ ] 9.3 스토어 구현 — `frontend/src/stores/transcriptStore.ts`에서 4곳 수정:

  `:22-26` 주석·필드를 아래로 교체:

```ts
  /** 원격(다른 클라이언트)에서 전사 "구조"가 바뀐 횟수 — split(행 삽입)과 redact(행 삭제·ms 시프트)
   *  양쪽이 여기로 모인다. 채널 경로(channels/transcription.ts)에서만 증가한다 — 로컬 조작은
   *  호출부가 직접 반영하므로 증가시키지 않는다(중복 재조회 방지).
   *  MeetingPage가 이 값의 변화를 감지해 자신이 들고 있는 transcripts 배열을 재조회하는 트리거로 쓴다
   *  (TranscriptPanel은 prop 구조 기반이라 store 갱신만으론 행 수 변화가 화면에 안 나타나서). */
  remoteStructureRevision: number
  /** 서버 오디오 파일이 교체된 횟수. 절단은 같은 URL 의 파일 내용을 바꾸므로, 이 값을
   *  useAudioPlayer 의 URL·deps 에 넣지 않으면 캐시된 옛 오디오(=기밀)가 계속 재생된다.
   *  올리는 곳은 정확히 두 군데이며 서로 배타적이다 — 원격 수신(채널, 에코 아님)과
   *  로컬 절단 성공(MeetingPage.handleTranscriptRedact). 둘 다 올리면 blob 을 두 번 받는다. */
  audioRevision: number
```

  `:38-40` 액션 선언을 아래로 교체:

```ts
  applySplit: (updated: Transcript, inserted: Transcript) => void
  /** 원격 구조 변경(split·redact) 수신을 표시(카운터 증가). 채널 코드에서만 호출할 것. */
  markRemoteStructureChange: () => void
  /** 오디오 파일 교체를 표시(카운터 증가). 원격 수신(채널, 에코 아님) 또는 로컬 절단 성공
   *  경로에서만 호출한다 — 두 경로는 배타적이므로 한 절단당 정확히 1회 증가한다. */
  markAudioChanged: () => void
```

  `:70` `remoteSplitRevision: 0,` 를 아래로 교체:

```ts
  remoteStructureRevision: 0,
  audioRevision: 0,
```

  `:189` `markRemoteSplit:` 줄을 아래로 교체:

```ts
  markRemoteStructureChange: () => set((state) => ({ remoteStructureRevision: state.remoteStructureRevision + 1 })),

  markAudioChanged: () => set((state) => ({ audioRevision: state.audioRevision + 1 })),
```

- [ ] 9.4 통과 확인: `cd frontend && npx vitest run src/stores/transcriptStore.test.ts` → 0 failures
- [ ] 9.5 채널 테스트 수정 — `frontend/src/channels/transcription.test.ts:238`의 `remoteSplitRevision: 0,` 를 `remoteStructureRevision: 0,\n      audioRevision: 0,` 로 바꾸고, `:251-296`의 4개 `it` 안 `remoteSplitRevision` 을 전부 `remoteStructureRevision` 으로, `markRemoteSplit()` 을 `markRemoteStructureChange()` 로 치환한다. 그리고 같은 `describe` 끝에 아래를 추가:

```ts
  it('transcript_redacted 수신 시 삭제 행이 store에서 빠지고 remoteStructureRevision이 증가한다', () => {
    const received = captureReceived() // 이 파일의 기존 관용구 — 각 it 안에서 팩토리를 호출한다
    useTranscriptStore.getState().loadFinals([
      { id: 1, content: 'a', speaker_label: 'S0', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: true },
      { id: 2, content: '기밀', speaker_label: 'S0', started_at_ms: 2000, ended_at_ms: 3000, sequence_number: 2, applied: true },
    ])

    received({ type: 'transcript_redacted', deleted_ids: [2], client_id: 'other' })

    expect(useTranscriptStore.getState().finals.map((f) => f.id)).toEqual([1])
    expect(useTranscriptStore.getState().remoteStructureRevision).toBe(1)
  })

  it('transcript_redacted가 내 client_id(에코)면 두 카운터 모두 건드리지 않는다', () => {
    // 에코 = 내가 보낸 절단. 그 화면은 Task 12의 로컬 경로가 이미 갱신했고 audioRevision도
    // 거기서 올린다 — 여기서 또 올리면 오디오 blob을 두 번 받는다(정확히 1회여야 한다).
    const received = captureReceived()
    const myId = useTranscriptStore.getState().clientId

    received({ type: 'transcript_redacted', deleted_ids: [2], client_id: myId })

    expect(useTranscriptStore.getState().audioRevision).toBe(0)
    expect(useTranscriptStore.getState().remoteStructureRevision).toBe(0)
  })

  it('transcript_redacted(원격)는 audioRevision도 올린다 — 옛 blob이 기밀을 계속 재생하지 않도록', () => {
    const received = captureReceived()

    received({ type: 'transcript_redacted', deleted_ids: [2], client_id: 'other' })

    expect(useTranscriptStore.getState().audioRevision).toBe(1)
  })
```

> `captureReceived()` 는 이 파일이 이미 쓰는 **팩토리**다(`:10` 정의, `:32`·`:38`·… 각 `it` 안에서 호출). 자유 변수 `received` 로 참조하면 안 되고, 위처럼 각 example 첫 줄에서 호출해야 한다. 이 테스트들은 구독을 만들지 않고 핸들러를 직접 호출하므로 (C) 갭의 영향을 받지 않는다.

- [ ] 9.6 실패 확인: `cd frontend && npx vitest run src/channels/transcription.test.ts` → 새 2건 실패
- [ ] 9.7 채널 구현 — `frontend/src/channels/transcription.ts:50` (`ids?: number[]`) 뒤에 필드 추가:

```ts
  // transcript_redacted: 파기된 전사 행 id 와 잘라낸 오디오 구간.
  deleted_ids?: number[]
  ranges?: { start_ms: number; end_ms: number }[]
  total_cut_ms?: number
  audio_duration_ms?: number
  summaries_destroyed?: boolean
```

  `:161` `store.markRemoteSplit()` 를 `store.markRemoteStructureChange()` 로 바꾸고, `transcript_split` case 의 닫는 `}`(`:164`) 뒤에 삽입:

```ts
          case 'transcript_redacted': {
            // Echo 가드: 내 절단 요청은 응답 경로(MeetingPage.handleTranscriptRedact)가 이미
            // store·배열·audioRevision을 전부 갱신했다. 여기서 또 올리면 오디오 blob을 두 번
            // 받는다 — 오디오 재로드는 어느 경로로든 정확히 1회여야 한다.
            if (raw.client_id && raw.client_id === store.clientId) {
              break
            }
            // Reset 가드: 최근 reset 직후의 잔여 broadcast 무시
            if (Date.now() - store.lastResetAt < 5000) {
              break
            }
            if (raw.deleted_ids && raw.deleted_ids.length > 0) {
              store.removeFinals(raw.deleted_ids)
            }
            // TranscriptPanel은 prop(transcripts) 구조 기반이라 store만 갱신해선 삭제·시프트가
            // 화면에 반영되지 않는다 — 페이지가 전체 재조회하도록 신호를 올린다.
            store.markRemoteStructureChange()
            // 오디오 파일이 같은 URL에서 교체됐다 — 캐시된 옛 blob을 계속 쓰면 절단한 기밀이
            // 계속 들린다.
            store.markAudioChanged()
            break
          }
```

- [ ] 9.8 통과 확인: `cd frontend && npx vitest run src/channels/transcription.test.ts` → 0 failures
- [ ] 9.9 `MeetingPage` 개명 — `frontend/src/pages/MeetingPage.tsx`에서:
  - `:131-133` 주석·`const remoteSplitRevision = ...` 를 아래로 교체:

```ts
  // 원격(다른 클라이언트) 전사 구조 변경 신호(split·redact). 채널 경로에서만 증가 — 로컬 조작
  // (handleTranscriptSplit 등)은 이 값을 건드리지 않는다.
  const remoteStructureRevision = useTranscriptStore((s) => s.remoteStructureRevision)
```

  > ⚠️ `audioRevision` 셀렉터는 **여기서 선언하지 않는다.** `frontend/tsconfig.app.json:21` 이 `noUnusedLocals: true` 라, 소비처(`useAudioPlayer` 호출)가 없는 채로 선언하면 9.12 의 `tsc` 가 TS6133 으로 실패하고 9.14 가 red 트리를 커밋하게 된다. 선언과 소비를 **Task 10.5 에서 함께** 넣는다.

  - `:139` `const remoteSplitRevisionSeenRef = useRef<number | null>(null)` → `const remoteStructureRevisionSeenRef = useRef<number | null>(null)`
  - `:142` `remoteSplitRevisionSeenRef.current = 0` → `remoteStructureRevisionSeenRef.current = 0`
  - `:311-333` 이펙트의 주석 첫 줄 "원격 split 재조회"를 "원격 구조 변경(split·redact) 재조회"로 바꾸고, 본문의 `remoteSplitRevisionSeenRef`/`remoteSplitRevision` 3곳을 `remoteStructureRevisionSeenRef`/`remoteStructureRevision` 으로 치환. deps 배열도 `[remoteStructureRevision, meetingId, loadFinals]`.
  - `:195` `useAudioPlayer(meetingId)` 는 **여기서 건드리지 않는다.** 훅이 아직 1인자라 지금 바꾸면 타입 에러다 — 셀렉터 선언과 함께 Task 10.5 에서 적용한다. Task 9 는 이 상태로 tsc·vitest 모두 green 이다.
- [ ] 9.10 `MeetingPage.test.tsx` 수정 — `:603-621`의 주석과 `markRemoteSplit()` 호출을 `markRemoteStructureChange()` 로, 테스트 제목의 `remoteSplitRevision` 을 `remoteStructureRevision` 으로 치환한다.
- [ ] 9.11 잔여 참조 전수 확인: `cd frontend && grep -rn "remoteSplitRevision\|markRemoteSplit" src` → **결과 0줄이어야 한다.** 남아 있으면 전부 바꾼다.
- [ ] 9.12 타입체크: `cd frontend && npx tsc -p tsconfig.app.json` → 에러 0
- [ ] 9.13 관련 테스트: `cd frontend && npx vitest run src/stores/transcriptStore.test.ts src/channels/transcription.test.ts src/pages/MeetingPage.test.tsx` → 0 failures
- [ ] 9.14 커밋: `git add -A && git commit -m "refactor(redact): remoteSplitRevision→remoteStructureRevision 일반화 + audioRevision·transcript_redacted 핸들러"`

---

# Task 10 — `useAudioPlayer` 오디오 캐시 버스터

절단은 **같은 URL의 파일 내용**을 바꾼다. 현재 훅은 deps가 `[meetingId]`뿐이고 서버 모드는 blob objectURL을 ref에 잡아두므로, 절단 후에도 기밀이 들어 있는 옛 오디오가 계속 재생된다.

> **(C) 결정 사항.** 이 토큰을 올리는 원격 경로(채널 수신)는 `MeetingPage`가 전사 채널을 구독하지 않아 지금은 발화하지 않는다(사전 존재 갭, split도 동일 — 설계 §V4-b). **절단한 본인 화면은 Task 12의 로컬 경로가 `markAudioChanged()`를 직접 호출하므로 정상 동작한다.** 이 태스크의 테스트는 구독이나 채널에 의존하지 않고 `renderHook` 으로 훅에 인자를 직접 넘겨 검증한다.

## Files

- Modify: `frontend/src/hooks/useAudioPlayer.ts` (`:23` 시그니처, `:38` URL, `:135` deps)
- Modify: `frontend/src/hooks/useAudioPlayer.test.ts` (파일 끝 `describe` 안에 example 추가)
- Modify: `frontend/src/pages/MeetingPage.tsx` (`:195`)

## Interfaces

**Consumes**: Task 9의 `useTranscriptStore.audioRevision`.

**Produces**:

```ts
export function useAudioPlayer(meetingId: number, audioVersion?: number): AudioPlayerResult
```

`audioVersion` 기본값 0. 0보다 클 때만 `?v=<n>` 을 붙인다(기존 URL·기존 테스트 무변경).

## Steps

- [ ] 10.1 실패 테스트 작성 — `frontend/src/hooks/useAudioPlayer.test.ts` 의 `describe('useAudioPlayer', ...)` 안 마지막에 삽입:

```ts
  it('audioVersion이 바뀌면 새 URL로 오디오를 다시 받는다 (절단 후 옛 오디오 재생 방지)', async () => {
    const { rerender } = renderHook(({ v }: { v: number }) => useAudioPlayer(1, v), {
      initialProps: { v: 0 },
    })

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const firstUrls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(firstUrls.some((u) => u.includes('?v='))).toBe(false)

    rerender({ v: 1 })

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/meetings/1/audio?v=1'))).toBe(true)
  })

  it('audioVersion이 그대로면 재요청하지 않는다', () => {
    const { rerender } = renderHook(({ v }: { v: number }) => useAudioPlayer(1, v), {
      initialProps: { v: 2 },
    })
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const before = fetchMock.mock.calls.length

    rerender({ v: 2 })

    expect(fetchMock.mock.calls.length).toBe(before)
  })
```

- [ ] 10.2 실패 확인: `cd frontend && npx vitest run src/hooks/useAudioPlayer.test.ts`
      → 첫 번째 example이 `?v=1` URL을 못 찾아 실패.
- [ ] 10.3 구현 — `frontend/src/hooks/useAudioPlayer.ts`:
  - `:23` 시그니처를 아래로 교체:

```ts
/**
 * @param audioVersion 서버 오디오 파일이 교체될 때마다 증가하는 토큰(transcriptStore.audioRevision).
 *   절단(transcripts#redact)은 같은 경로의 파일 내용을 바꾸므로, 이 값이 URL과 effect deps에
 *   들어가지 않으면 캐시된 blob(=절단 전 기밀 오디오)이 계속 재생된다. 길이는 우연히 같을 수
 *   있으므로 durationMs 가 아니라 별도 카운터를 쓴다.
 */
export function useAudioPlayer(meetingId: number, audioVersion = 0): AudioPlayerResult {
```

  - `:38` audioUrl 을 아래로 교체:

```ts
    const audioUrl = audioVersion > 0
      ? `${getApiBaseUrl()}/meetings/${meetingId}/audio?v=${audioVersion}`
      : `${getApiBaseUrl()}/meetings/${meetingId}/audio`
```

  - `:135` deps 를 아래로 교체:

```ts
  }, [meetingId, audioVersion])
```

- [ ] 10.4 통과 확인: `cd frontend && npx vitest run src/hooks/useAudioPlayer.test.ts src/hooks/useAudioPlayer.loading.test.ts` → 0 failures
- [ ] 10.5 `MeetingPage` 배선 — 선언과 소비를 **같은 스텝에서** 넣는다(`noUnusedLocals` 때문에 분리 불가):
  - `frontend/src/pages/MeetingPage.tsx` 의 `remoteStructureRevision` 셀렉터 바로 뒤에 추가:

```ts
  // 오디오 파일 교체 신호(절단). useAudioPlayer 의 URL·deps 에 넣어야 캐시된 옛 오디오를 버린다.
  const audioRevision = useTranscriptStore((s) => s.audioRevision)
```

  - `:195` 를 아래로 교체:

```ts
  const audio = useAudioPlayer(meetingId, audioRevision)
```

- [ ] 10.6 반증 실증(수동, 커밋하지 않는다): deps 를 `[meetingId]` 로 되돌려 실행 → "audioVersion이 바뀌면 …" 실패 확인 후 원복.
- [ ] 10.7 타입체크: `cd frontend && npx tsc -p tsconfig.app.json` → 에러 0
- [ ] 10.8 커밋: `git add -A && git commit -m "fix(redact): useAudioPlayer 에 오디오 버전 토큰 추가 — 절단 후 옛 오디오 재생 방지"`

---

# Task 11 — `TranscriptPanel` 다중 선택 + 기밀 구간 절단 액션

설계 §UI 진입점 / §V5 (사용자 결정): **`TranscriptPanel`에 다중 선택(체크박스 + 전체선택)을 새로 만들고** "기밀 구간 절단" 액션을 붙인다. `FullRecord`는 건드리지 않는다 — 그 화면(`MeetingLivePage`·`MeetingViewerPage`)은 회의가 `recording`/`transcribing`이라 절단이 거의 항상 409다.

선택 UI는 `FullRecord.tsx:21`(`selected` Set) · `:70-100`(`toggleSelect`/`toggleAll`/`handleDelete`) 패턴을 **그대로 미러링**한다. 새 방식을 발명하지 않는다.

**바 위치만 다르다(의도적).** `FullRecord`는 하단 고정 바(`:171-194`)인데, 그건 루트가 `flex flex-col h-full` + 내부 스크롤 div 구조이기 때문이다. `TranscriptPanel`은 **루트 자체가 스크롤 컨테이너**(`:162` `overflow-y-auto`)이고 `MeetingPage`가 그걸 또 `overflow-y-auto`로 감싼다(`MeetingPage.tsx:623`). 하단 바를 붙이려면 두 스크롤 컨테이너 구조를 바꿔야 하므로, 기존 스크롤 구조를 건드리지 않는 **상단 sticky 바**로 만든다. 선택 상태·토글·액션 로직은 미러링 그대로다.

## Files

- Modify: `frontend/src/api/meetings/helpers.ts` (`:19` `canEditMeeting` 닫는 `}` 뒤에 `canRedactMeeting` 추가)
- Modify: `frontend/src/components/meeting/TranscriptPanel.tsx`
  - `:1` react import에 `useCallback` 추가, `:3-10` import 4줄 추가
  - `:12-31` props 인터페이스에 3개 추가
  - `:40-51` 시그니처 구조분해에 3개 추가
  - `:53` state 2개 추가 + store 셀렉터 1개 추가
  - `:116` `handleRename` 뒤에 선택·절단 로직 추가
  - `:162` 루트 바로 안쪽에 sticky 바 추가
  - `:183-194` 세그먼트 행 className 3분기 + 체크박스 추가 (`<div key=` 는 183 에서 시작하고 대체 블록은 194 의 `<div className="flex-1 min-w-0">` 까지 포함한다)
- Create: `frontend/src/components/meeting/TranscriptPanel.redact.test.tsx`

## Interfaces

**Consumes**:

```ts
redactTranscripts(meetingId, params): Promise<RedactTranscriptsResponse>   // Task 8
RedactTranscriptsResponse, TranscriptBounds                                // Task 8
useTranscriptStore: removeFinals, clientId                                 // 기존 + Task 9
confirmDialog from '../../lib/confirmDialog'
useToastStore from '../../stores/toastStore'   // showStatus(message, durationMs)
formatTimestamp(ms)                            // TranscriptPanel.tsx:33-38 에 이미 있는 로컬 함수
```

**Produces** — Task 12가 이 이름 그대로 쓴다:

```ts
canRedactMeeting(meeting, user): boolean                 // helpers.ts — 소유자 ∨ admin (협업자 제외)
TranscriptPanelProps.canRedact?: boolean                 // 기본 false
TranscriptPanelProps.dflowSynced?: boolean               // undefined = 알 수 없음 → 경고 표시(안전 측)
TranscriptPanelProps.onRedacted?: (result: RedactTranscriptsResponse) => void
```

## Steps

- [ ] 11.1 인가 헬퍼 추가 — `frontend/src/api/meetings/helpers.ts:19`(`canEditMeeting` 닫는 `}`) 뒤에 삽입:

```ts
/**
 * 기밀 구간 절단처럼 되돌릴 수 없는 관리 액션의 어포던스를 노출할지 판단하는 순수 헬퍼.
 *
 * canEditMeeting 과 다르다: 서버가 내려주는 `editable` 은 협업자까지 true 라서 여기에 쓸 수 없다
 * (절단은 owner/admin 전용 — MeetingLookup#authorize_meeting_admin!). 소유자 또는 전역 admin 만 true.
 * 서버의 admin override 는 남의 개인 프로젝트 회의를 제외하지만 클라이언트는 그 정보를 갖고 있지
 * 않다 — UX 어포던스 게이팅일 뿐이고 권한 자체는 서버가 403 으로 강제한다.
 */
export function canRedactMeeting(
  meeting: Pick<Meeting, 'created_by'> | null | undefined,
  user: { id: number; role: 'admin' | 'manager' | 'member' } | null | undefined,
): boolean {
  if (!meeting || !user) return false
  return meeting.created_by?.id === user.id || user.role === 'admin'
}
```

- [ ] 11.1b 인가 헬퍼 실패 테스트 — `frontend/src/api/meetings/helpers.test.ts` 가 있으면 거기에, 없으면 `frontend/src/api/meetings/canRedactMeeting.test.ts` 로 신규 생성:

```ts
import { describe, it, expect } from 'vitest'
import { canRedactMeeting } from './helpers'

const owner = { id: 1, role: 'member' as const }
const stranger = { id: 2, role: 'member' as const }
const admin = { id: 3, role: 'admin' as const }
const meeting = { created_by: { id: 1, name: '소유자' } }

describe('canRedactMeeting', () => {
  it('소유자는 true', () => {
    expect(canRedactMeeting(meeting, owner)).toBe(true)
  })

  it('admin 은 true', () => {
    expect(canRedactMeeting(meeting, admin)).toBe(true)
  })

  it('타인(협업자 포함)은 false — canEditMeeting 과 다른 티어다', () => {
    // 서버가 내려주는 editable 은 협업자까지 true 지만 절단은 owner/admin 전용이라
    // (authorize_meeting_admin!) 이 헬퍼는 editable 을 보지 않는다.
    expect(canRedactMeeting({ ...meeting, editable: true } as never, stranger)).toBe(false)
  })

  it('meeting 또는 user 가 없으면 false', () => {
    expect(canRedactMeeting(null, owner)).toBe(false)
    expect(canRedactMeeting(meeting, null)).toBe(false)
  })
})
```

- [ ] 11.2 실패 테스트 작성 — `frontend/src/components/meeting/TranscriptPanel.redact.test.tsx` 신규 생성:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const confirmDialog = vi.fn<(...args: unknown[]) => Promise<boolean>>()
vi.mock('../../lib/confirmDialog', () => ({
  confirmDialog: (...args: unknown[]) => confirmDialog(...args),
}))

const redactTranscripts = vi.fn()
vi.mock('../../api/meetings', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return { ...actual, redactTranscripts: (...args: unknown[]) => redactTranscripts(...args), splitTranscript: vi.fn() }
})

vi.mock('../../api/speakers', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return { ...actual, getSpeakers: vi.fn(async () => []) }
})

import { TranscriptPanel } from './TranscriptPanel'
import { useTranscriptStore } from '../../stores/transcriptStore'

const transcripts = [
  { id: 1, speaker_label: 'SPEAKER_00', content: '앞부분 발언', started_at_ms: 0, ended_at_ms: 2000, sequence_number: 1 },
  { id: 2, speaker_label: 'SPEAKER_01', content: '기밀 발언', started_at_ms: 3000, ended_at_ms: 4000, sequence_number: 2 },
]

const okResult = {
  deleted_ids: [2],
  ranges: [{ start_ms: 2500, end_ms: 4000 }],
  total_cut_ms: 1500,
  audio_duration_ms: 8500,
  summaries_destroyed: true,
  chat_markers_updated: 0,
  bookmarks_removed: 0,
  backup_retained: false,
}

function renderPanel(props: Record<string, unknown> = {}) {
  return render(
    <TranscriptPanel
      meetingId={1}
      transcripts={transcripts}
      currentTimeMs={0}
      onSeek={vi.fn()}
      {...props}
    />
  )
}

describe('TranscriptPanel 기밀 구간 절단', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmDialog.mockResolvedValue(true)
    redactTranscripts.mockResolvedValue(okResult)
    useTranscriptStore.getState().reset()
  })

  it('canRedact가 아니면 체크박스도 절단 버튼도 렌더되지 않는다', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: '기밀 구간 절단' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('절단 대상 선택')).not.toBeInTheDocument()
  })

  it('readOnly면 canRedact여도 노출되지 않는다', () => {
    renderPanel({ canRedact: true, readOnly: true })
    expect(screen.queryByRole('button', { name: '기밀 구간 절단' })).not.toBeInTheDocument()
  })

  it('canRedact면 버튼이 보이고, 선택이 없으면 비활성이다', () => {
    renderPanel({ canRedact: true })
    expect(screen.getByRole('button', { name: '기밀 구간 절단' })).toBeDisabled()
  })

  it('체크박스 클릭은 행의 onSeek를 발화시키지 않는다 (stopPropagation)', async () => {
    const onSeek = vi.fn()
    renderPanel({ canRedact: true, onSeek })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])

    expect(onSeek).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '기밀 구간 절단' })).toBeEnabled()
  })

  it('전체 선택이 모든 행을 고르고 다시 누르면 해제한다', async () => {
    renderPanel({ canRedact: true })
    const all = screen.getByLabelText('전체 선택')

    await userEvent.click(all)
    expect(screen.getByText('2개 선택')).toBeInTheDocument()

    await userEvent.click(all)
    expect(screen.queryByText(/개 선택/)).not.toBeInTheDocument()
  })

  it('confirmDialog를 취소하면 API를 호출하지 않는다', async () => {
    confirmDialog.mockResolvedValue(false)
    renderPanel({ canRedact: true })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(redactTranscripts).not.toHaveBeenCalled()
  })

  it('window.confirm이 아니라 confirmDialog 헬퍼를 쓴다', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm')
    renderPanel({ canRedact: true })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(nativeConfirm).not.toHaveBeenCalled()
  })

  it('확인 문구에 비가역·오디오 재인코딩·회의록 삭제·챗 잔존·데스크톱 경고가 모두 들어간다', async () => {
    renderPanel({ canRedact: true })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    const message = String(confirmDialog.mock.calls[0][0])
    expect(message).toContain('되돌릴 수 없습니다')
    expect(message).toContain('재인코딩')
    expect(message).toContain('회의록')
    expect(message).toContain('내 챗 기록에 인용된 내용은 남습니다')
    expect(message).toContain('직접 편집한 회의록도 함께 삭제되며 복구되지 않습니다')
    expect(message).toContain('데스크톱')
    expect(message).toContain('00:03') // 선택 구간 시작
  })

  it('한 시간이 넘는 구간을 시:분:초로 표시한다 (MM:SS 고정이면 "90:00"이 된다)', async () => {
    const long = [
      { id: 1, speaker_label: 'S0', content: '앞', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1 },
      { id: 2, speaker_label: 'S1', content: '긴 기밀', started_at_ms: 3_600_000, ended_at_ms: 5_400_000, sequence_number: 2 },
    ]
    renderPanel({ canRedact: true, transcripts: long })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(String(confirmDialog.mock.calls[0][0])).toContain('1:00:00')
  })

  it("dflowSynced={false}면 D'Flow 경고를 넣지 않는다", async () => {
    renderPanel({ canRedact: true, dflowSynced: false })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(String(confirmDialog.mock.calls[0][0])).not.toContain("D'Flow")
  })

  it('승인하면 선택 id와 화면에서 본 expected_bounds를 함께 보낸다', async () => {
    renderPanel({ canRedact: true })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(redactTranscripts).toHaveBeenCalled())
    expect(redactTranscripts.mock.calls[0][0]).toBe(1)
    const params = redactTranscripts.mock.calls[0][1]
    expect(params.transcript_ids).toEqual([2])
    expect(params.expected_bounds).toEqual({ '2': { started_at_ms: 3000, ended_at_ms: 4000 } })
  })

  it('성공하면 store에서 행을 제거하고 onRedacted를 호출한다', async () => {
    useTranscriptStore.getState().loadFinals([
      { id: 1, content: '앞부분 발언', speaker_label: 'SPEAKER_00', started_at_ms: 0, ended_at_ms: 2000, sequence_number: 1, applied: true },
      { id: 2, content: '기밀 발언', speaker_label: 'SPEAKER_01', started_at_ms: 3000, ended_at_ms: 4000, sequence_number: 2, applied: true },
    ])
    const onRedacted = vi.fn()
    renderPanel({ canRedact: true, onRedacted })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(onRedacted).toHaveBeenCalledWith(okResult))
    expect(useTranscriptStore.getState().finals.map((f) => f.id)).toEqual([1])
  })

  it('transcripts prop에서 사라진 행의 선택은 정리된다 (stale id 전송 방지)', async () => {
    const { rerender } = render(
      <TranscriptPanel meetingId={1} transcripts={transcripts} currentTimeMs={0} onSeek={vi.fn()} canRedact />
    )

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    expect(screen.getByText('1개 선택')).toBeInTheDocument()

    rerender(
      <TranscriptPanel meetingId={1} transcripts={[transcripts[0]]} currentTimeMs={0} onSeek={vi.fn()} canRedact />
    )

    expect(screen.queryByText(/개 선택/)).not.toBeInTheDocument()
  })
})
```

- [ ] 11.3 실패 확인: `cd frontend && npx vitest run src/components/meeting/TranscriptPanel.redact.test.tsx`
      → 선택 UI가 없어 12개 중 "canRedact가 아니면 …"·"readOnly면 …" 2건만 통과하고 나머지 10건 실패.
- [ ] 11.4 구현 — `frontend/src/components/meeting/TranscriptPanel.tsx` 6곳 수정:

  (a) `:1-10` import 블록을 아래로 교체:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Scissors } from 'lucide-react'
import type { Transcript, RedactTranscriptsResponse, TranscriptBounds } from '../../api/meetings'
import { redactTranscripts } from '../../api/meetings'
import { renameSpeaker } from '../../api/speakers'
import { EditableTranscriptText } from './EditableTranscriptText'
import { HighlightedText } from './HighlightedText'
import { SpeakerLabel, speakerBorderColor } from './SpeakerLabel'
import { SplitTranscriptDialog } from './SplitTranscriptDialog'
import { resolveHighlightIndex } from './transcriptHighlight'
import { useTranscriptStore } from '../../stores/transcriptStore'
import { useToastStore } from '../../stores/toastStore'
import { confirmDialog } from '../../lib/confirmDialog'
```

  (b) `:30` `onSplit?: ...` 뒤(props 인터페이스 닫는 `}` 앞)에 추가:

```ts
  /** owner/admin 이고 잠기지 않았을 때만 다중 선택 + 기밀 구간 절단 UI 를 노출한다. 기본 false.
   *  서버(authorize_meeting_admin!)의 403 과 이중 방어 — 여기서 숨기는 건 어포던스일 뿐이다. */
  canRedact?: boolean
  /** D'Flow 전송 이력 여부. undefined = 알 수 없음 → 경고를 표시한다(빠뜨리는 쪽이 더 위험). */
  dflowSynced?: boolean
  /** 절단 성공 시 호출 — 부모(MeetingPage)가 transcripts 배열 재조회·오디오 토큰 갱신을 하도록
   *  알린다. store 반영(removeFinals)은 이 컴포넌트가 이미 수행한다. */
  onRedacted?: (result: RedactTranscriptsResponse) => void
```

  (c) `:50` `onSplit,` 뒤(구조분해 닫는 `}` 앞)에 추가:

```ts
  canRedact = false,
  dflowSynced,
  onRedacted,
```

  (d) `:53` `const [splittingTranscript, ...]` 뒤에 추가:

```ts
  // 선택 상태는 FullRecord.tsx:21,70-100 패턴을 그대로 미러링한다(Set + toggleSelect + toggleAll).
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [redacting, setRedacting] = useState(false)
  const removeFinalsInStore = useTranscriptStore((s) => s.removeFinals)
```

  (e) `:116` `handleRename` 함수 닫는 `}` 뒤에 추가:

```ts
  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (selected.size === transcripts.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(transcripts.map((t) => t.id)))
    }
  }, [transcripts, selected.size])

  // 이 파일의 formatTimestamp(:33-38)는 MM:SS 고정이라 90분이 "90:00"으로 보인다.
  // 확인 다이얼로그는 회의 전체 길이를 다루므로 시 단위가 필요하다(기존 함수는 세그먼트
  // 헤더용이라 그대로 둔다 — 표시 폭이 바뀌면 레이아웃이 흔들린다).
  function formatDuration(ms: number): string {
    const total = Math.floor(ms / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const mm = String(m).padStart(2, '0')
    const ss = String(s).padStart(2, '0')
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
  }

  // 선택 정리: transcripts 가 갈리면(절단 후 재조회·원격 구조 변경·회의 전환) 사라진 행의 id 를
  // 버린다. FullRecord 에는 이 처리가 없지만 여기서는 필요하다 — TranscriptPanel 은 prop 배열
  // 기반이라 부모가 배열을 통째로 갈아끼우고, 남은 stale id 가 다음 요청의 transcript_ids 에
  // 실리면 서버가 422("transcript not found")로 거절한다.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set(transcripts.map((t) => t.id))
      const next = new Set([...prev].filter((id) => alive.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [transcripts])

  const handleRedact = useCallback(async () => {
    if (selected.size === 0) return
    const rows = transcripts.filter((t) => selected.has(t.id))
    if (rows.length === 0) return

    const spans = rows
      .map((r) => `  · ${formatDuration(r.started_at_ms)} – ${formatDuration(r.ended_at_ms)}`)
      .join('\n')
    const totalMs = rows.reduce((acc, r) => acc + (r.ended_at_ms - r.started_at_ms), 0)

    const lines = [
      `선택한 ${rows.length}개 구간을 전사와 오디오에서 모두 파기합니다.`,
      spans,
      `총 길이 약 ${formatDuration(totalMs)}`,
      '',
      '⚠️ 되돌릴 수 없습니다.',
      '· 오디오도 함께 잘리며 재인코딩 손실이 있습니다.',
      // update_notes(meetings_controller.rb:758-767)가 summaries.notes_markdown 에 쓰므로,
      // summaries.destroy_all 은 사용자가 손으로 편집한 회의록까지 지운다 — 재생성으로 돌아오지
      // 않는 유일한 손실이라 별도 문장으로 명시한다.
      '· 회의록과 AI가 생성한 액션아이템·결정사항이 삭제됩니다(다시 생성해야 합니다).',
      '· 직접 편집한 회의록도 함께 삭제되며 복구되지 않습니다.',
      '· 내 챗 기록에 인용된 내용은 남습니다.',
      '· 데스크톱에 업로드되지 않은 원음이 남아 있을 수 있습니다.',
    ]
    // dflowSynced 를 모르는 호출부(undefined)에서는 경고를 빼지 않는다 — 빠뜨리는 쪽이 더 위험하다.
    if (dflowSynced !== false) {
      lines.push("· D'Flow에 이미 전송된 회의록은 남습니다. D'Flow에서 직접 처리하세요.")
    }
    lines.push('', '계속할까요?')

    const ok = await confirmDialog(lines.join('\n'), { title: '기밀 구간 절단', kind: 'warning' })
    if (!ok) return

    // expected_bounds 는 "화면에서 본" 경계다(필수 파라미터). 다이얼로그가 열려 있는 동안 다른
    // 클라이언트가 split 하면 서버 현재값과 어긋나 409 가 나고 아무것도 잘리지 않는다 —
    // 겹침 완전성 검사만으로는 그 케이스가 통과해 기밀 절반이 살아남는다.
    const expectedBounds: Record<string, TranscriptBounds> = {}
    for (const r of rows) {
      expectedBounds[String(r.id)] = { started_at_ms: r.started_at_ms, ended_at_ms: r.ended_at_ms }
    }

    setRedacting(true)
    try {
      const result = await redactTranscripts(meetingId, {
        transcript_ids: rows.map((r) => r.id),
        expected_bounds: expectedBounds,
        client_id: clientId,
      })
      removeFinalsInStore(result.deleted_ids)
      setSelected(new Set())
      onRedacted?.(result)
    } catch (err) {
      // 403(비 owner·잠금) / 409(진행 중·동시 변경) / 422(검증) 모두 서버가 한글 메시지를 준다.
      // ky 의 HTTPError 는 body 를 읽어주지 않으므로 직접 파싱한다.
      let message = '기밀 구간 절단에 실패했습니다.'
      const res = (err as { response?: Response }).response
      if (res) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        if (body?.error) message = body.error
      }
      useToastStore.getState().showStatus(message, 5000)
    } finally {
      setRedacting(false)
    }
  }, [meetingId, transcripts, selected, clientId, dflowSynced, onRedacted, removeFinalsInStore])
```

  (f) `:162` 루트 `<div className="flex flex-col gap-1 p-4 overflow-y-auto">` 바로 다음 줄(`{groups.map(` 앞)에 sticky 바 추가:

```tsx
      {canRedact && !readOnly && (
        // 상단 sticky — 루트가 곧 스크롤 컨테이너라(하단 고정 바를 쓰려면 이 구조를 바꿔야 한다)
        // -mx-4 -mt-4 로 루트의 p-4 를 상쇄해 폭 전체를 차지하고 위쪽에 붙게 한다.
        <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-2 px-4 py-2 bg-card border-b flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size === transcripts.length && transcripts.length > 0}
              onChange={toggleAll}
              aria-label="전체 선택"
            />
            전체 선택
          </label>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <span className="text-xs text-muted-foreground">{selected.size}개 선택</span>
            )}
            <button
              type="button"
              onClick={handleRedact}
              disabled={selected.size === 0 || redacting}
              className="px-3 py-1.5 text-xs font-medium rounded border border-red-600 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {redacting ? '절단 중...' : '기밀 구간 절단'}
            </button>
          </div>
        </div>
      )}
```

  (g) `:183-194` 세그먼트 행의 className 3분기 교체 + 체크박스 삽입 — `<div key={transcript.id} …>` 블록을 아래로 교체:

```tsx
              <div
                key={transcript.id}
                ref={isHighlighted ? highlightedRef : null}
                data-highlighted={isHighlighted ? 'true' : 'false'}
                className={`flex items-start gap-1 p-3 min-h-[44px] rounded cursor-pointer transition-colors ${
                  isHighlighted
                    ? 'bg-accent border-l-4 border-indigo-500'
                    : selected.has(transcript.id)
                      ? 'bg-red-50'
                      : 'hover:bg-muted active:bg-muted'
                }`}
                onClick={() => onSeek(transcript.started_at_ms)}
              >
                {canRedact && !readOnly && (
                  <input
                    type="checkbox"
                    checked={selected.has(transcript.id)}
                    onChange={() => toggleSelect(transcript.id)}
                    // 행 onClick 이 onSeek 이므로 stopPropagation 이 필수다(FullRecord.tsx:142 동일).
                    onClick={(e) => e.stopPropagation()}
                    aria-label="절단 대상 선택"
                    className="mt-1 shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
```

  (이하 `searchQuery ? … : …` 블록과 split 버튼은 기존 그대로 둔다.)

- [ ] 11.5 통과 확인: `cd frontend && npx vitest run src/components/meeting/TranscriptPanel.redact.test.tsx src/api/meetings/canRedactMeeting.test.ts` → 17 tests, 0 failures
- [ ] 11.6 기존 스펙 회귀: `cd frontend && npx vitest run src/components/meeting/TranscriptPanel.test.tsx` → 0 failures (`canRedact` 기본값 false라 기존 렌더가 바뀌지 않아야 한다)
- [ ] 11.7 타입체크: `cd frontend && npx tsc -p tsconfig.app.json` → 에러 0
- [ ] 11.8 커밋: `git add -A && git commit -m "feat(redact): TranscriptPanel 다중 선택 + 기밀 구간 절단 액션 + confirmDialog 경고"`

---

# Task 12 — `MeetingPage` 배선 + 로컬 절단 반영

`TranscriptPanel`에 `canRedact`/`dflowSynced`/`onRedacted`를 넘기고, 절단 성공 시 페이지가 들고 있는 `transcripts` 배열과 오디오 토큰을 갱신한다. 데스크톱 경로(`MeetingPage.tsx:624`)와 모바일 탭 경로(`meetingDetailTabs.tsx:100`) **둘 다** 배선해야 한다.

> **(C) 결정 사항.** `MeetingPage`는 전사 채널을 구독하지 않으므로 절단한 본인 화면은 브로드캐스트가 아니라 **이 태스크의 로컬 경로로만** 갱신된다. `markAudioChanged()` 호출이 여기 있는 이유다.

## Files

- Create: `frontend/src/lib/applyLocalRedaction.ts` (의존성 주입 순수 함수 — 아래 참조)
- Create: `frontend/src/lib/applyLocalRedaction.test.ts`
- Create: `frontend/src/components/meeting/meetingDetailTabs.redact.test.tsx`
- Modify: `frontend/src/pages/MeetingPage.tsx`
  - `:11` import에 `canRedactMeeting` 추가, toast store·`applyLocalRedaction` import 추가
  - `:129` 부근 store 셀렉터에 `markAudioChanged` 추가
  - `:366` `handleTranscriptSplit` 뒤에 `handleTranscriptRedact`(얇은 래퍼) 추가
  - `:491-496` `buildMeetingDetailTabs({...})` 인자에 3개 추가
  - `:624-635` `<TranscriptPanel …>` 에 3개 추가
- Modify: `frontend/src/components/meeting/meetingDetailTabs.tsx`
  - `:50` args 인터페이스에 3개 추가, `:78` 구조분해에 3개 추가, `:100-111` `<TranscriptPanel>` 에 3개 전달

## Interfaces

**Consumes**:

```ts
canRedactMeeting(meeting, user): boolean                       // Task 11
TranscriptPanelProps.canRedact / dflowSynced / onRedacted      // Task 11
RedactTranscriptsResponse                                      // Task 8
useTranscriptStore.markAudioChanged()                          // Task 9
getTranscripts(meetingId), mapTranscriptsToFinals(data, true)  // 기존 (MeetingPage.tsx:303-307 패턴)
useToastStore.getState().showStatus(message, durationMs)       // 기존
meeting.dflow_synced_at                                        // types.ts:108
```

**Produces**:

```ts
// frontend/src/lib/applyLocalRedaction.ts
export interface LocalRedactionDeps {
  reloadTranscripts: () => Promise<void>
  markAudioChanged: () => void
  notify: (message: string, durationMs?: number) => void
}
export function applyLocalRedaction(
  deps: LocalRedactionDeps,
  result: RedactTranscriptsResponse,
): Promise<void>
```

> `meetingId` 는 deps 에 넣지 않는다 — `reloadTranscripts` 가 이미 그 값을 닫고 있어 중복이고, 안 쓰는 필드는 호출부에 잡음만 남긴다.

## Steps

- [ ] 12.1 실패 테스트 작성 — `frontend/src/components/meeting/meetingDetailTabs.redact.test.tsx` 신규 생성.

> **왜 `MeetingPage.test.tsx` 가 아닌가.** 적대 검토가 지적한 대로 초안의 두 예제는 실행 불가였다: 이 파일의 렌더 헬퍼는 `renderPage(meetingId = '1')`(`:288`)이라 `meeting`·`me` 를 주입할 수 없고, `findElement` 는 `ReactNode` 트리 순회 헬퍼라 DOM 노드를 넘길 수 없으며, `transcript-panel-host` testid 는 존재하지 않는다(새 testid 추가는 이 계획이 금지).
> 대신 검증 가능한 **세 축**으로 나눈다: owner 게이팅 = `canRedactMeeting` 순수 유닛(Task 11.1b) / prop 스레딩 = `buildMeetingDetailTabs` 순수 함수(아래, `useLiveMobileTabs.test.tsx:49-68` 패턴) / **로컬 반영 본체 = `applyLocalRedaction` 의존성 주입 순수 함수**(12.1b). 세 번째가 `markAudioChanged()` 커버리지 공백을 닫는다 — 그건 절단한 본인 화면이 옛 오디오(=기밀)를 계속 재생하지 않게 하는 **유일한** 장치이고(`MeetingPage` 는 채널 미구독이라 원격 경로가 대신해 주지 않는다), 이 기능이 막으려는 실패의 마지막 방어선이라 수동 확인으로 넘길 수 없다.

```tsx
import { describe, it, expect, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { isValidElement } from 'react'
import { buildMeetingDetailTabs } from './meetingDetailTabs'
import { TranscriptPanel } from './TranscriptPanel'

// useLiveMobileTabs.test.tsx:56 과 같은 트리 순회 헬퍼 (그 파일은 로컬 정의라 재사용 불가)
function findElement<P>(node: ReactNode, type: unknown): ReactElement<P> | null {
  if (!isValidElement(node)) return null
  if (node.type === type) return node as ReactElement<P>
  const children = (node.props as { children?: ReactNode }).children
  if (Array.isArray(children)) {
    for (const c of children) {
      const found = findElement<P>(c, type)
      if (found) return found
    }
    return null
  }
  return findElement<P>(children, type)
}

type PanelProps = {
  canRedact?: boolean
  dflowSynced?: boolean
  onRedacted?: (r: unknown) => void
}

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    meetingId: 1,
    bookmarksVisible: false,
    bookmarks: [],
    transcripts: [],
    currentTimeMs: 0,
    isPlaying: false,
    onSeek: vi.fn(),
    onDeleteBookmark: vi.fn(),
    onNotesChange: vi.fn(),
    memoEditorRef: { current: null },
    onSaveMemo: vi.fn(),
    isSavingMemo: false,
    canEdit: true,
    ...overrides,
  } as Parameters<typeof buildMeetingDetailTabs>[0]
}

describe('meetingDetailTabs 절단 prop 스레딩 (모바일 탭 경로)', () => {
  it('canRedact·dflowSynced·onRedacted를 TranscriptPanel로 전달한다', () => {
    const onRedacted = vi.fn()
    const tabs = buildMeetingDetailTabs(buildArgs({ canRedact: true, dflowSynced: false, onRedacted }))
    const transcriptTab = tabs.find((t) => t.id === 'transcript')

    const panel = findElement<PanelProps>(transcriptTab!.content, TranscriptPanel)

    expect(panel?.props.canRedact).toBe(true)
    expect(panel?.props.dflowSynced).toBe(false)
    expect(panel?.props.onRedacted).toBe(onRedacted)
  })

  it('전달하지 않으면 canRedact가 undefined라 TranscriptPanel 기본값(false)이 적용된다', () => {
    const tabs = buildMeetingDetailTabs(buildArgs())
    const transcriptTab = tabs.find((t) => t.id === 'transcript')

    const panel = findElement<PanelProps>(transcriptTab!.content, TranscriptPanel)

    expect(panel?.props.canRedact).toBeUndefined()
  })
})
```

> `buildArgs` 의 필수 키 목록은 `meetingDetailTabs.tsx:17-51` 의 `BuildMeetingDetailTabsArgs` 를 열어 현재 시그니처와 맞춘다(옵셔널이 아닌 키가 늘어났으면 추가). 탭 id 가 `'transcript'` 가 맞는지도 같은 파일에서 확인한다.

- [ ] 12.1b 로컬 반영 본체 실패 테스트 — `frontend/src/lib/applyLocalRedaction.test.ts` 신규 생성:

```ts
import { describe, it, expect, vi } from 'vitest'
import { applyLocalRedaction } from './applyLocalRedaction'
import type { RedactTranscriptsResponse } from '../api/meetings'

function makeResult(over: Partial<RedactTranscriptsResponse> = {}): RedactTranscriptsResponse {
  return {
    deleted_ids: [2],
    ranges: [{ start_ms: 2500, end_ms: 4500 }],
    total_cut_ms: 2000,
    audio_duration_ms: 8000,
    summaries_destroyed: false,
    chat_markers_updated: 0,
    bookmarks_removed: 0,
    backup_retained: false,
    ...over,
  }
}

function makeDeps() {
  return {
    reloadTranscripts: vi.fn(async () => {}),
    markAudioChanged: vi.fn(),
    notify: vi.fn(),
  }
}

describe('applyLocalRedaction', () => {
  it('markAudioChanged를 정확히 1회 호출한다 ⭐', async () => {
    // 절단한 본인 화면이 옛 오디오(=기밀)를 계속 재생하지 않게 하는 유일한 장치다.
    // MeetingPage는 전사 채널을 구독하지 않으므로 원격 경로가 대신해 주지 않는다.
    const deps = makeDeps()

    await applyLocalRedaction(deps, makeResult())

    expect(deps.markAudioChanged).toHaveBeenCalledTimes(1)
  })

  it('재조회를 1회 한다 (서버 ms 시프트 규칙을 TS로 복제하지 않는다는 결정의 검증)', async () => {
    const deps = makeDeps()

    await applyLocalRedaction(deps, makeResult())

    expect(deps.reloadTranscripts).toHaveBeenCalledTimes(1)
  })

  it('재조회가 실패해도 markAudioChanged는 이미 호출된 상태다', async () => {
    // 전사 목록이 stale한 것보다 기밀 오디오가 계속 재생되는 쪽이 훨씬 나쁘다.
    const deps = makeDeps()
    deps.reloadTranscripts = vi.fn(async () => { throw new Error('network') })

    await expect(applyLocalRedaction(deps, makeResult())).rejects.toThrow('network')

    expect(deps.markAudioChanged).toHaveBeenCalledTimes(1)
  })

  it('summaries_destroyed일 때만 회의록 재생성 안내를 띄운다', async () => {
    const withSummary = makeDeps()
    await applyLocalRedaction(withSummary, makeResult({ summaries_destroyed: true }))
    expect(withSummary.notify).toHaveBeenCalledWith(expect.stringContaining('회의록'), expect.any(Number))

    const without = makeDeps()
    await applyLocalRedaction(without, makeResult({ summaries_destroyed: false }))
    expect(without.notify).not.toHaveBeenCalled()
  })

  it('backup_retained면 백업 잔존 경고도 띄운다', async () => {
    const deps = makeDeps()

    await applyLocalRedaction(deps, makeResult({ backup_retained: true }))

    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('백업'), expect.any(Number))
  })
})
```

- [ ] 12.1c 실패 확인: `cd frontend && npx vitest run src/lib/applyLocalRedaction.test.ts` → `Cannot find module './applyLocalRedaction'`
- [ ] 12.1d 구현 — `frontend/src/lib/applyLocalRedaction.ts` 신규 생성:

```ts
import type { RedactTranscriptsResponse } from '../api/meetings'

/** applyLocalRedaction이 필요로 하는 부수효과. 호출부(MeetingPage)가 자기 클로저 값을 주입한다. */
export interface LocalRedactionDeps {
  /** 페이지의 transcripts 배열과 store를 서버 최신값으로 다시 채운다. */
  reloadTranscripts: () => Promise<void>
  /** 오디오 버전 토큰을 올려 useAudioPlayer가 새 파일을 받게 한다. */
  markAudioChanged: () => void
  /** 사용자 안내(토스트). */
  notify: (message: string, durationMs?: number) => void
}

/**
 * 절단 성공 후 로컬 화면 반영. MeetingPage 밖의 순수 함수로 둔다 — 내부 클로저로 두면
 * markAudioChanged 호출을 자동 검증할 방법이 없는데, 그건 절단한 본인 화면이 옛 오디오
 * (= 기밀)를 계속 재생하지 않게 하는 유일한 장치다(MeetingPage는 전사 채널 미구독이라
 * 원격 경로가 대신해 주지 않는다).
 *
 * 재조회를 쓰는 이유: 절단은 남은 행 전부의 ms를 "클램프된 오디오 경계" 기준 누적 delta로
 * 당긴다(TranscriptRedactionPlan). 그 규칙을 TS로 옮겨 적으면 두 구현이 갈라지는 순간
 * 전사 타임라인이 오디오와 조용히 어긋난다. 재조회 1회가 훨씬 싸고 authoritative하다.
 */
export async function applyLocalRedaction(
  deps: LocalRedactionDeps,
  result: RedactTranscriptsResponse,
): Promise<void> {
  // ⚠️ 오디오 토큰을 **먼저** 올린다. 재조회 뒤에 두면 재조회가 실패했을 때 토큰이 영영
  // 안 올라가고, 그러면 플레이어가 절단 전 기밀 오디오를 계속 재생한다.
  deps.markAudioChanged()

  if (result.summaries_destroyed) {
    // 자동 재요약은 걸지 않는다(설계 §절단 후) — LLM 비용이 들고 사용자가 원하지 않을 수 있다.
    deps.notify('회의록이 삭제되었습니다. 다시 생성하세요.', 6000)
  }
  if (result.backup_retained) {
    deps.notify('절단 전 오디오 백업이 서버에 남았습니다. 최대 1시간 내 자동 정리됩니다.', 8000)
  }

  await deps.reloadTranscripts()
}
```

- [ ] 12.1e 통과 확인: `cd frontend && npx vitest run src/lib/applyLocalRedaction.test.ts` → 5 tests, 0 failures
- [ ] 12.1f 반증 실증(수동, 커밋하지 않는다): `deps.markAudioChanged()` 호출을 지워 실행 → "markAudioChanged를 정확히 1회 호출한다 ⭐" 실패 확인 후 원복. 이어서 그 호출을 `await deps.reloadTranscripts()` **뒤로** 옮겨 실행 → "재조회가 실패해도 …" 실패 확인 후 원복. **둘 중 하나라도 실패하지 않으면 절단 후 기밀 오디오가 계속 재생되는 경로가 열려 있는 것이므로 멈추고 보고한다.**
- [ ] 12.2 실패 확인: `cd frontend && npx vitest run src/components/meeting/meetingDetailTabs.redact.test.tsx` → `canRedact`/`dflowSynced`/`onRedacted` 가 `undefined` 라 첫 예제 실패
- [ ] 12.3 구현 — `frontend/src/pages/MeetingPage.tsx` 5곳 수정:

  (a) `:11` import를 아래로 교체하고, 그 아래에 toast store import를 추가:

```ts
import { getTranscripts, reopenMeeting, updateNotes, canEditMeeting, canRedactMeeting } from '../api/meetings'
import type { RedactTranscriptsResponse } from '../api/meetings'
import { useToastStore } from '../stores/toastStore'
import { applyLocalRedaction } from '../lib/applyLocalRedaction'
```

  (b) `:129` `const loadFinals = useTranscriptStore((s) => s.loadFinals)` 뒤에 추가:

```ts
  // 로컬 절단이 오디오 토큰을 직접 올린다 — MeetingPage 는 전사 채널을 구독하지 않아
  // 브로드캐스트 경로가 발화하지 않는다(설계 §V4-b). 올리지 않으면 절단 후에도 캐시된
  // 옛 blob(=기밀)이 계속 재생된다.
  const markAudioChanged = useTranscriptStore((s) => s.markAudioChanged)
```

  (c) `:366` `handleTranscriptSplit` 함수 닫는 `}` 뒤에 추가:

```tsx
  // 전사 절단 로컬 반영 — 본체는 applyLocalRedaction(lib/applyLocalRedaction.ts)에 있고
  // 여기서는 클로저 값만 주입하는 얇은 래퍼다. 본체를 이 안에 두면 markAudioChanged 호출을
  // 자동 검증할 방법이 없는데, 그건 절단한 본인 화면이 옛 오디오(= 기밀)를 계속 재생하지
  // 않게 하는 유일한 장치다(이 페이지는 전사 채널을 구독하지 않는다).
  // 원격 브로드캐스트는 client_id 에코 가드에 걸리므로 중복 재조회가 나가지 않는다.
  function handleTranscriptRedact(result: RedactTranscriptsResponse) {
    void applyLocalRedaction(
      {
        reloadTranscripts: async () => {
          const data = await getTranscripts(meetingId)
          setTranscripts(data)
          loadFinals(mapTranscriptsToFinals(data, true))
        },
        markAudioChanged,
        notify: (message, durationMs) => useToastStore.getState().showStatus(message, durationMs),
      },
      result,
    )
  }
```

  > `void` 로 부동 프라미스를 명시한다 — `getTranscripts` 는 실패를 삼켜 `[]` 를 반환하므로(`api/meetings/transcripts.ts:49-51`) 여기서 reject 가 올라올 일은 없다. 기존 재조회 이펙트(`:303-308`)와 같은 취급이다.

  (d) `:491-496` `buildMeetingDetailTabs({ … })` 호출의 `onSplit: handleTranscriptSplit,` 뒤에 추가:

```ts
    canRedact: canRedactMeeting(meeting, me) && !locked,
    dflowSynced: !!meeting?.dflow_synced_at,
    onRedacted: handleTranscriptRedact,
```

  (e) `:624-635` 데스크톱 `<TranscriptPanel … />` 의 `onSplit={handleTranscriptSplit}` 뒤에 추가:

```tsx
                  canRedact={canRedactMeeting(meeting, me) && !locked}
                  dflowSynced={!!meeting?.dflow_synced_at}
                  onRedacted={handleTranscriptRedact}
```

- [ ] 12.4 구현 — `frontend/src/components/meeting/meetingDetailTabs.tsx` 3곳 수정:

  (a) `:50` `onSplit?: (updated: Transcript, inserted: Transcript) => void` 뒤(인터페이스 닫는 `}` 앞)에 추가:

```ts
  /** owner/admin 이고 미잠금일 때만 TranscriptPanel 에 기밀 구간 절단 UI 를 노출한다. */
  canRedact?: boolean
  /** D'Flow 전송 이력 여부(확인 다이얼로그 경고 게이팅). */
  dflowSynced?: boolean
  /** 절단 성공 시 호출 — 페이지가 transcripts 재조회·오디오 토큰 갱신을 하도록 알린다. */
  onRedacted?: (result: import('../../api/meetings').RedactTranscriptsResponse) => void
```

  (b) `:78` `onSplit,` 뒤(구조분해 닫는 `}` 앞)에 추가:

```ts
  canRedact,
  dflowSynced,
  onRedacted,
```

  (c) `:110` `onSplit={onSplit}` 뒤에 추가:

```tsx
              canRedact={canRedact}
              dflowSynced={dflowSynced}
              onRedacted={onRedacted}
```

- [ ] 12.5 통과 확인: `cd frontend && npx vitest run src/lib/applyLocalRedaction.test.ts src/components/meeting/meetingDetailTabs.redact.test.tsx` → 7 tests, 0 failures
- [ ] 12.5b **리팩토링 회귀 확인**: `cd frontend && npx vitest run src/pages/MeetingPage.test.tsx` → 0 failures. `handleTranscriptRedact` 를 얇은 래퍼로 바꾼 것 외에 페이지 동작이 달라지면 안 된다(래퍼가 하는 일은 클로저 값 주입뿐).
- [ ] 12.6 타입체크: `cd frontend && npx tsc -p tsconfig.app.json` → 에러 0
- [ ] 12.7 프론트 전체: `cd frontend && npx vitest run` → 213+ files 통과, 사전 존재 uncaught exception 2건(`AiChatPanel.test.tsx`, `MeetingLivePage.test.tsx`) 외 신규 없음
- [ ] 12.8 백엔드 전체 재확인: `cd backend && bundle exec rspec && bundle exec rubocop` → 0 failures / no offenses
- [ ] 12.9 커밋: `git add -A && git commit -m "feat(redact): MeetingPage·meetingDetailTabs 절단 배선 + 로컬 반영·오디오 토큰 갱신"`

---

# Task 13 — 잔존 `.redact-backup` 시간 기반 회수

"다음 절단이 스윕한다"만으로는 회수가 안 된다 — 대부분의 회의는 두 번 절단되지 않는다. 기밀 파기 기능이 **스스로 만든 기밀 사본**(절단 전 원음 전체)을 회수하지 못하는 상태는 수용 대상이 아니다.

이미 매시간 도는 `SttChunkStorage.sweep!` 안에서 처리한다 — `config/recurring.yml:22,42` 가 이 메서드를 **커맨드 문자열로 직접** 부르므로 스케줄 설정을 건드리지 않고 붙일 수 있다(신규 잡·스키마 변경 없음).

## Files

- Modify: `backend/app/services/stt_chunk_storage.rb` (`sweep!` 끝에 호출 1줄 + 새 클래스 메서드)
- Modify: `backend/spec/services/stt_chunk_storage_spec.rb` (기존 spec 에 `AUDIO_DIR` 가드 `around` 추가 + 신규 example 3건)

## Interfaces

**Consumes**: 없음 (`ENV["AUDIO_DIR"]` 만 읽는다).
**Produces**:

```ruby
SttChunkStorage.sweep_redact_backups!(older_than: 1.hour) # => Integer 삭제 건수
```

## Steps

- [ ] 13.1 실패 테스트 작성 — `backend/spec/services/stt_chunk_storage_spec.rb` 최상단 `describe` 안에 **기존 example 들보다 먼저** 아래 `around` 를 추가한다(⚠️ 필수 — 이게 없으면 `sweep!` 이 프로덕션 `storage/audio/` 를 스캔한다):

```ruby
  # ⚠️ sweep! 이 이제 오디오 디렉터리도 훑는다. AUDIO_DIR 미설정 시 기본값은
  # Rails.root/storage/audio — 이 저장소는 프로덕션 체크아웃에서 rspec 을 직접 돌리므로
  # 반드시 tmp 로 격리한다(SttChunkStorage::ROOT 가 test 에서 tmp 로 갈라지는 것과 같은 이유).
  around do |example|
    prev = ENV["AUDIO_DIR"]
    dir = Rails.root.join("tmp", "test_audio_#{SecureRandom.hex(4)}").to_s
    ENV["AUDIO_DIR"] = dir
    FileUtils.mkdir_p(dir)
    example.run
  ensure
    prev.nil? ? ENV.delete("AUDIO_DIR") : ENV["AUDIO_DIR"] = prev
    FileUtils.rm_rf(dir)
  end
```

  그리고 같은 파일 끝에 example 3건 추가:

```ruby
  describe ".sweep_redact_backups!" do
    let(:audio_dir) { ENV.fetch("AUDIO_DIR") }

    it "임계보다 오래된 .redact-backup 을 지운다 (절단 전 원음 회수)" do
      old = File.join(audio_dir, "7.mp3.redact-backup")
      File.binwrite(old, "절단 전 원음")
      FileUtils.touch(old, mtime: 3.hours.ago)

      expect(described_class.sweep_redact_backups!).to eq(1)
      expect(File.exist?(old)).to be false
    end

    it "임계보다 최근 파일은 남긴다 (진행 중인 절단의 백업을 뺏지 않는다)" do
      fresh = File.join(audio_dir, "8.mp3.redact-backup")
      File.binwrite(fresh, "지금 절단 중")

      expect(described_class.sweep_redact_backups!).to eq(0)
      expect(File.exist?(fresh)).to be true
    end

    it "오디오 파일 자체는 건드리지 않는다" do
      audio = File.join(audio_dir, "9.mp3")
      File.binwrite(audio, "x")
      FileUtils.touch(audio, mtime: 3.hours.ago)

      described_class.sweep_redact_backups!

      expect(File.exist?(audio)).to be true
    end
  end
```

- [ ] 13.2 실패 확인: `cd backend && bundle exec rspec spec/services/stt_chunk_storage_spec.rb` → 새 3건이 `NoMethodError: undefined method 'sweep_redact_backups!'` 로 실패
- [ ] 13.3 구현 — `backend/app/services/stt_chunk_storage.rb` 의 `sweep!` 마지막 `removed` 반환 **앞**에 호출을 넣고, 그 아래 새 메서드를 추가:

```ruby
      sweep_redact_backups!

      removed
    end

    # 기밀 구간 절단(transcripts#redact)이 남긴 <id>.*.redact-backup 회수.
    #
    # 이 파일은 절단 **전** 오디오 전체 = 기밀 원음이다. 정상 경로에서는 커밋 직후
    # drop_backups! 가 지우지만, 그 호출이 실패하면(디스크 오류·프로세스 사망) 남는다.
    # AudioRedactor#audio_paths 가 .redact-backup 을 제외하므로 이후 절단에서도 잘리지 않고,
    # "다음 절단이 스윕한다"는 대부분의 회의가 두 번 절단되지 않아 실질적으로 회수가 아니다.
    # 여기(이미 매시간 도는 유일한 훅)에서 시간 기반으로 회수한다.
    #
    # older_than 을 1시간으로 둔 이유: 진행 중인 절단의 백업을 뺏으면 안 된다. 절단 한 건은
    # 길어야 수십 초(ffmpeg 재인코딩)라 1시간이면 충분히 안전하다.
    def sweep_redact_backups!(older_than: 1.hour)
      dir = ENV["AUDIO_DIR"].presence
      # test 에서 AUDIO_DIR 이 없으면 기본값이 프로덕션 storage/audio 다. 이 저장소는 프로덕션
      # 체크아웃에서 rspec 을 돌리므로(ROOT 가 test 에서 tmp 로 갈라지는 것과 같은 이유)
      # 명시적으로 지정되지 않은 test 실행에서는 아무것도 하지 않는다 — 구조적 방어선.
      return 0 if dir.nil? && Rails.env.test?

      dir ||= Rails.root.join("storage", "audio").to_s
      return 0 unless Dir.exist?(dir)

      cutoff = older_than.ago
      removed = 0
      Dir.glob(File.join(dir, "*.redact-backup")).each do |path|
        begin
          next unless File.mtime(path) < cutoff

          File.delete(path)
          removed += 1
          Rails.logger.info("[SttChunkStorage] 잔존 절단 백업 회수: #{File.basename(path)}")
        rescue Errno::ENOENT
          # 다른 프로세스가 먼저 지움 — 무해.
        rescue StandardError => e
          Rails.logger.warn("[SttChunkStorage] 절단 백업 삭제 실패 #{path}: #{e.message}")
        end
      end
      removed
    end
```

- [ ] 13.4 통과 확인: `cd backend && bundle exec rspec spec/services/stt_chunk_storage_spec.rb` → 0 failures (기존 example 포함)
- [ ] 13.5 반증 실증(수동, 커밋하지 않는다): `sweep!` 안의 `sweep_redact_backups!` 호출을 지워 실행 → "임계보다 오래된 .redact-backup 을 지운다"는 그대로 통과하지만(직접 호출이라) `sweep!` 배선이 끊긴다. 배선을 확인하려면 기존 `sweep!` example 에 `.redact-backup` 파일을 하나 두고 `sweep!` 후 사라지는지 보는 example 을 추가한다.
- [ ] 13.6 `recurring.yml` 무변경 확인: `cd backend && git diff --name-only main -- config/recurring.yml` → 0줄
- [ ] 13.7 rubocop: `cd backend && bundle exec rubocop app/services/stt_chunk_storage.rb spec/services/stt_chunk_storage_spec.rb` → no offenses
- [ ] 13.8 커밋: `git add -A && git commit -m "fix(redact): 잔존 .redact-backup 을 매시간 스위퍼가 회수하도록 추가"`

---

# 최종 검증 게이트

- [ ] `cd backend && bundle exec rspec` → 0 failures (착수 전 2158 + 신규분)
- [ ] `cd backend && bundle exec rubocop` → no offenses
- [ ] `cd frontend && npx tsc -p tsconfig.app.json` → 에러 0 (bare `tsc` 금지)
- [ ] `cd frontend && npx vitest run` → 사전 존재 2건 외 실패 없음
- [ ] `cd frontend && grep -rn "remoteSplitRevision\|markRemoteSplit" src` → 0줄
- [ ] `cd backend && grep -rn "delete_all" app/controllers/api/v1/transcripts_controller.rb` → 0줄
- [ ] `cd frontend && grep -rn "redactTranscripts" src/components/meeting/FullRecord.tsx` → 0줄 (진입점은 `TranscriptPanel`뿐, `FullRecord` 미변경)
- [ ] `git log --oneline main..feature/transcript-redact-range` → 14개 커밋(T1~T5 각 1, T6 2, T7~T13 각 1), `main` 직접 커밋 없음
- [ ] 러닝 dev 서버에 절단 요청을 보낸 적 없음 (확인)
- [ ] `cd backend && git diff --name-only main -- db/ config/recurring.yml` → 0줄 (스키마·스케줄 무변경)

---

# 후속 (별도 티켓 — 이번 범위 아님)

1. **`MeetingPage`에 `useTranscription(meetingId)` 추가 — 전사 채널 구독 복구.**
   현재 구독 호출부는 `useLiveRecording.ts:125`·`MeetingViewerPage.tsx:41`뿐이라 `MeetingPage`는 `transcript_split`·`transcript_redacted` 브로드캐스트를 받지 못한다. 붙이면 **split의 원격 동기도 함께 살아난다**(머지된 기능의 사전 존재 갭). 다만 `useTranscription`은 녹음용 훅이라 `sendChunk`·하트비트 부수효과 검증이 선행돼야 하므로 기밀 기능 안에서 같이 고치지 않는다. 설계 §V4-b.
2. `finalize`에 `completed?` 거부 가드 (설계 §V6-b — 정상 녹음 순서를 깰 위험이 있어 별도 확인 필요).
3. `SttChunkStorage` 스위퍼를 회의 완료 이벤트에 연동 (설계 §V1 — 절단과 무관하게 원시 PCM이 6시간 남는 일반 문제).
4. 백엔드 기존 4곳(`summary.rb:14`·`meeting.rb:620`·`markdown_exporter.rb:43`·`meeting_chat_context.rb:50`)의 마커 정규식을 `LlmPrompts::CitationMarkers`로 통일 (Task 1이 신설만 하고 통일은 하지 않는다).

---

# 자기 점검

## 1. 설계 문서 절별 커버리지

| 설계 절 | 구현 태스크 |
|---|---|
| 배경 — 잔존 사본 인벤토리 / `destroy_all` 제약 | Global Constraint 1, Task 6 (FTS 스펙) |
| 부록 승계 결정 — 절단·ms 시프트·요약 행 삭제·brief_summary nil·ai_generated 삭제·경계 클램프 | Task 2 (클램프·delta), Task 6 (요약·brief_summary·ai_generated) |
| 1. 챗 히스토리 유지 + 마커 보정 | Task 1 (마커 파싱), Task 6 (`redact_chat_markers!`), Task 11 (다이얼로그 문구) |
| 2. 권한 티어 owner/admin | Task 5 (concern), Task 6 (before_action + `context "권한"` 3건), Task 11 (`canRedactMeeting`), Task 12 (배선) |
| 3-a. `meeting_bookmarks` | Task 6 (`redact_bookmarks!` + 스펙) |
| 3-b. Ruby 마커 단일 소스 | Task 1 |
| 범위 — 입력은 전사 행 id 집합 / API 형태 | Task 6, Task 8 |
| 동시성 가드 (1) `expected_bounds` 필수 | Task 6 (검사 + 422/409 스펙 3건), Task 8 (필수 타입), Task 11 (호출부가 채워 보냄) |
| 동시성 가드 (2) 겹침 완전성 | Task 2 (`complete?` + 구간별 면제 규칙 4건), Task 6 (409 스펙) |
| 동시성 가드 (3) **트랜잭션 내 재검증** (ffmpeg 실행 창) | Task 6 (`revalidate_redaction!` + ⭐ 반증 2건) |
| **FTS 삭제 실패 방어** (`fts_delete` 가 예외를 삼킴) | Task 6 (`verify_fts_purged!` transcripts/summaries + 롤백 스펙) |
| 진행 상태 가드 + `AudioUploadJob` 인플라이트 | Task 6 (가드 스펙), Task 3 (`in_flight_for?`) |
| 절단 경계 계산 | Task 2 |
| ms 시프트 | Task 2 (`delta_for`), Task 6 (`shift_remaining_transcripts!`) |
| 트랜잭션 순서 (오디오↔DB 원자성) | Task 6 (액션 본체), Task 7 (롤백 원자성 스펙) |
| 오디오 절단 명령 (asplit·코덱) | Task 4 (`filter_graph`·`CODECS`) |
| 파기 대상 아티팩트 전체 (V1~V3 + 잔존 `.redact-backup`) | Task 4 (`purge_duplicate_sources!`·`purge_stale_backups!`·`purge_peaks!`·`primary`/`orphan` 분리 + 유닛 6건), Task 7 (request 3건), **Task 13 (시간 기반 회수)** |
| 마커 보정 — 대상 컬럼·문법 2종·규칙·훑을 범위 | Task 1, Task 6 |
| 북마크 | Task 6 |
| 브로드캐스트 & 프론트 반영 (`remoteStructureRevision` 개명) | Task 9 |
| 오디오 재로드 (V4) | Task 10 (훅), Task 9 (원격 경로), Task 12 (로컬 경로 = 유일한 발화점, `applyLocalRedaction` ⭐ 반증 2건으로 고정) |
| V4-b 채널 구독 부재 — 수용 + 후속 분리 | Task 9·10 서두 주석, §후속 1 |
| UI 진입점 (V5 — `TranscriptPanel` 신규 다중 선택) + 확인 다이얼로그 | Task 11 |
| 절단 후 자동 재요약 안 함 (안내만) | Task 12 `applyLocalRedaction` (`summaries_destroyed` 토스트 + 반증 1건, 요약 잡 트리거 없음) |
| V6 `AudioUploadJob` 경합 — 쓰는 쪽 거부 ⭐ | Task 3 (identity 검증 + **tmp→mv 로 검사 전 기밀 노출 차단**) |
| V6-b `finalize` 되돌림 — `_parts/` 선삭제 타이밍 | Task 4·6 (호출 순서), Task 7 (finalize 422 스펙) |
| V7 `ChatMessage` 콜백 없음 → `update_column` | Task 6 |
| 테스트 — 백엔드 27항목 | Task 2(4 유닛) · 3(3) · 4(4 유닛) · 6(18) · 7(9) · 13(3) — 아래 2절 |
| 테스트 — 프론트 5항목 | Task 9(2) · 10(1) · 11(2: 컴포넌트 게이팅 + `canRedactMeeting` 유닛) · 12(2: 탭 스레딩 + **`applyLocalRedaction` 5건**) |
| 검증 게이트 4종 | 최종 검증 게이트 |
| 하지 않는 것 (YAGNI) 11항목 | 어느 태스크에도 없음 (확인 완료) |

**발견한 공백과 처리**

1. **남길 세그먼트 0개**(전사 전체 선택) — 설계에 없다. `asplit=0`/`concat=n=0` 은 성립하지 않아 500이 난다. → Task 4 `move_all_audio_to_backup!` + Task 6 `kept.empty?` 분기 + Task 7 스펙 2건으로 메웠다. rm 이 아니라 백업 경유라 커밋 실패 시 되살아난다(적대 검토 MINOR 반영). `reset_content`(`meetings_controller.rb:475-483`)의 선례를 따랐고, `audio_file_path: nil` 은 `set_audio_file!`(경로 쓰기의 단일 진입점)을 우회하므로 주석으로 명시했다.
2. **`.wav`/`.m4a`/`.mp4`/`.ogg` 코덱** — 설계는 `.mp3`/`.webm` 만 정했으나 `ALLOWED_AUDIO_CONTENT_TYPES` 와 `save_or_merge_audio` 의 업로드 확장자 채택 때문에 나머지도 실제로 `audio_file_path` 가 된다. → Task 4에 명시적 map + `UnsupportedFormat` 422. 추측 기본값을 두지 않았다.
3. **`.redact-backup` 이 `audio_paths` 글롭에 걸린다** — 두 `mv` 사이에서 죽으면 잔존한다. → Task 4 reject 목록에 `.redact-backup`·`.redact-tmp` 포함 + 스펙.
4. **길이 0 세그먼트** — 0에서 시작하는 구간이 빈 선두 세그먼트를 만들어 `asplit=N` 의 N 이 어긋난다. → Task 2 `kept_segments` 에서 제거 + 스펙.
5. **오디오 길이 stale** — 클램프 마지막 구간과 ffprobe ±1초 검증이 함께 틀어진다. → Task 6에서 plan 생성 **전에** `refresh_audio_duration!`.
6. **북마크 경계 규약**이 설계에 없다 → `cut_start <= ts < cut_end` 삭제로 고정(`delta_for` 의 `cut_end <= t` 와 일관), Task 6 스펙이 고정한다.
7. **콜론 마커 재직렬화 정밀도** — 중간점 클램프가 정수 나눗셈이라 delta가 초 단위로 떨어지지 않는다. → Task 1에서 초 미만 버림 + 필드 수 보존(2→2, 3→3) 규칙을 테스트로 고정.
8. **`stt_chunks` 경로** — 설계는 리터럴 `storage/stt_chunks/` 라고 적었으나 test 환경 ROOT 는 `tmp/storage/stt_chunks` 다. → Global Constraint 8로 승격.
9. **`TranscriptPanel` 선택 상태 정리** — 설계에 없다. 이 패널은 prop 배열 기반이라 부모가 배열을 통째로 갈아끼우는데(절단 후 재조회·원격 구조 변경·회의 전환), 사라진 행의 id 가 선택 Set 에 남으면 다음 요청의 `transcript_ids` 에 실려 서버가 422("transcript not found")로 거절한다. `FullRecord` 에는 이 처리가 없다(거기선 store 기반이라 필요가 덜하다). → Task 11 (e)의 prune 이펙트 + 테스트 1건.
10. **바 위치가 `FullRecord` 와 다르다** — `FullRecord` 의 하단 고정 바는 루트가 `flex flex-col h-full` + 내부 스크롤 div 라 가능한 것이고, `TranscriptPanel` 은 루트 자체가 스크롤 컨테이너(`:162`)에 `MeetingPage` 가 또 감싼다(`:623`). 하단 바를 쓰려면 두 스크롤 컨테이너 구조를 바꿔야 하므로 상단 sticky 로 했다. **선택 상태·토글·액션 로직은 설계가 요구한 대로 그대로 미러링**했고, 차이와 이유를 Task 11 서두에 적었다.
11. **적대 검토 반영(2차)** — CRITICAL 3 / MAJOR 9 / MINOR 9 를 전부 반영했다. 그중 계획의 **실질적 결함**이었던 것: ① ffmpeg 실행 창(수십 초)에 대한 트랜잭션 내 재검증 부재 ② `fts_delete` 가 예외를 삼켜 Global Constraint 1 의 "유일한 방어"가 best-effort 라는 사실 ③ `AudioUploadJob` 이 최종 경로에 직접 쓴 뒤에야 identity 검사 ④ overlap 이웃 때문에 `complete?` 가 영구 false(= 영구 409) ⑤ 하나의 `kept_segments` 를 길이 다른 파일들에 적용 ⑥ Task 9 가 `noUnusedLocals` 로 red 트리 커밋 ⑦ 실행 불가한 스펙 3건(`where.missing` 스텁·`:meeting_collaborator` 팩토리·`MeetingPage.test.tsx` 없는 API) ⑧ 반증력 없는 테스트 5건. 각 항목의 처리는 해당 태스크 주석과 반증 실증 스텝에 있다.
12. **`.redact-backup` 회수 경로가 하나뿐** — 초안은 "다음 절단이 스윕한다"로 끝냈으나 대부분의 회의는 두 번 절단되지 않는다. → Task 13(매시간 `sweep_redact_backups!`, `older_than: 1.hour`) + `drop_backups!` 실패 시 `logger.error` + 응답 `backup_retained`. `recurring.yml` 은 `SttChunkStorage.sweep!` 을 커맨드로 직접 부르므로 스케줄 설정 무변경.
13. **잔존 `.redact-backup` 파기** — 계획 초안은 커밋 후 `drop_backups!` 실패로 남는 백업을 "글롭에서 제외되므로 무해"라고 적었다. **틀렸다.** 그 파일은 절단 **전** 오디오 전체(기밀 원음)이고, 글롭 제외 때문에 이후 절단에서도 잘리지 않으며 지우는 코드가 어디에도 없었다 → 기밀 원음 영구 잔존. 이 기능이 막으려는 실패 그 자체다. → Task 4 `purge_stale_backups!`(`purge_duplicate_sources!` 안, `swap_in!` **전** 호출로 순서 고정) + 유닛 4건 + Task 7 request 반증 1건 + Task 7.3 서술 정정(무해 → "다음 절단이 스윕해 파기한다" + 절단이 재실행되지 않으면 남는다는 잔여 한계). 설계 §파기 대상 아티팩트 표에도 항목이 추가됐다.
14. **`drop_backups!` 는 `rescue` 밖이어야 한다** — 설계 초안 의사코드는 `FileUtils.rm_f(backup)` 을 `begin ... rescue` 안에 두었는데, 이 호출은 커밋 **뒤**에 실행되므로 여기서 실패해 `restore_backups!` 가 돌면 "전사는 지워졌는데 기밀 오디오는 되살아난다" — 같은 문서가 §트랜잭션 순서에서 명시적으로 금지한 방향이다. → Task 6에서 `rescue` 밖으로 뺐고 Task 7.3에 두 실패 지점(커밋 전/후)의 처분을 구분해 적었다. 롤백 원자성 스펙의 실패 주입 지점도 `swap_in!` **도중**(트랜잭션 안)으로 잡아 이 불변식과 일치시켰다. **설계 문서도 같은 결론으로 수정됨**(`:224-227`) — 현재 계획과 설계가 일치한다.

## 2. 설계의 테스트 목록 ↔ 태스크 대응 (전부 배치 확인)

백엔드: FTS 정합성(T6) · 다중 구간 누적 delta(T2·T6) · 경계 클램프(T2·T6) · 겹침 완전성 409(T2·T6) · **동시 split 409 ⭐(T6)** · **`expected_bounds` 누락 422(T6)** · 콜론 마커 시프트(T1·T6) · 구간 내부 마커 제거(T6) · 폴더 스코프 마커 `|` 변형(T1·T6) · `brief_summary` nil(T6) · 북마크(T6) · 롤백 원자성(T7) · 협업자 403(T6) · ffmpeg 실패 시 DB 무변경(T7) · peaks 무효화(T7) · 부산물 파기(T7) · **잔존 `.redact-backup` 스윕(T4 유닛 + T7 request)** · 오디오 파일 복수(T7) · `AudioUploadJob` 인플라이트 409(T6) · **`AudioUploadJob` 클로버 거부 ⭐(T3)** · `_parts/` 선삭제 타이밍 + finalize 422(T7).

적대 검토 반영으로 추가된 반증 케이스: **ffmpeg 창 동시 split 409 ⭐(T6)** · **ffmpeg 창 행 삽입 409(T6)** · **FTS 삭제 실패 롤백(T6)** · **최종 mp3 직접 쓰기 금지(T3)** · **overlap 이웃 면제(T2)** · **면제의 구간 한정성(T2)** · **purge/swap 순서 강제 raise(T4·T7)** · **길이 다른 고아 오디오 삭제(T7)** · **전체 선택 커밋 실패 시 오디오 복구(T7)** · **잔존 백업 시간 기반 회수(T13)**.

T6에는 위 목록 외에 반증 고정용 example 1건이 더 있다: "겹침 완전성만으로는 동시 split이 통과한다" — 나중에 누군가 `expected_bounds`를 지우고 "겹침 완전성이 있으니 괜찮다"고 판단하지 못하게 그 사실 자체를 못 박는다.

**반증력 없어 교체된 5건**(적대 검토 지적): ① 백업 순서 유닛(본문이 스스로 올바른 순서로 불러 규정만 함) → `@swapped` raise 검증 + T7 request 회귀 ② overlap 유닛이 `.ranges` 만 단언 → `complete?` 단언 추가 ③ `.in_flight_for?` `:async` 예제(자기가 stub 한 raise 확인) → `job_meeting_id` 순수 파싱 2건 + 체인 스텁 2건 ④ 롤백 스펙의 `call_count == 1`(wrap 구조상 자명) → 삭제 ⑤ 비-owner 버튼 미노출(비-owner 주입 불가) → `canRedactMeeting` 순수 유닛 4건.

프론트: **`markAudioChanged` 정확히 1회 ⭐(T12)** · **재조회 실패해도 오디오 토큰은 올라감(T12)** · `confirmDialog` 취소 시 API 미호출(T11) · 원격 `transcript_redacted` → `remoteStructureRevision` 증가(T9) · 로컬 절단(에코)은 두 카운터 모두 미변경(T9) · 비 owner 버튼 미노출(T11 `canRedact` 게이팅 + T12 배선) · 오디오 재로드 버전 토큰(T10 훅 + T12 로컬 발화).

## 3. 플레이스홀더 점검

"적절히", "비슷하게", "Task N과 동일", "위 내용에 대한 테스트 작성" 류 표현 없음. 모든 테스트·구현 코드가 인라인으로 적혀 있고, 반복되는 코드(예: `write_wav`, `probe_ms`)는 각 파일에 따로 적어 두었다.

예외 2곳은 **기존 테스트 파일의 헬퍼 이름을 그대로 따라야 하는 지점**이며, 확인 지시를 함께 적었다:
- Task 9.5의 `received(...)` 헬퍼 이름 → 파일 상단에서 실제 이름 확인
- Task 12.1의 `renderMeetingPage`/`findElement` 헬퍼 이름과 패널 조회 방식 → 파일 상단 확인. **소스에 새 `data-testid`를 추가하지 말 것**을 명시했다.

## 4. 타입 일관성 점검

- `TranscriptRedactionPlan` / `CutRange` / `#ranges` `#total_cut_ms` `#delta_for` `#remaining_rows` `#complete?` `#kept_segments` — Task 2 정의 ↔ Task 6 사용 철자 일치.
- `CutRange#cover?` — Task 2에서 정의하고 Task 6의 `redact_bookmarks!` / `shifted_marker_time` 에서 사용.
- `AudioRedactor#purge_duplicate_sources!` `#purge_stale_backups!` `#primary_audio_path` `#orphan_audio_paths` `#cut_to_temp` `#swap_in!` `#drop_backups!` `#restore_backups!` `#purge_peaks!` `#move_all_audio_to_backup!` `AudioRedactor::{Error,PurgeFailed,TranscodeFailed,UnsupportedFormat}` — Task 4 정의 ↔ Task 6·7 사용 일치. `delete_all_audio!` 는 `move_all_audio_to_backup!` 로 대체되었다.
- `AudioUploadJob.in_flight_for?` — Task 3 정의 ↔ Task 6 호출·Task 6 스펙 stub 일치.
- `LlmPrompts::CitationMarkers::{CITATION_RE, FOLDER_CITATION_RE}` / `.marker_time_to_ms` / `.format_marker_time(ms, like:)` — Task 1 정의 ↔ Task 6 사용 일치.
- `MeetingLookup#authorize_meeting_admin!` — Task 5 정의 ↔ Task 6 before_action 일치.
- JSON 키 `deleted_ids` `ranges` `total_cut_ms` `audio_duration_ms` `summaries_destroyed` `chat_markers_updated` `bookmarks_removed` `backup_retained` — Task 6 응답 ↔ Task 8 `RedactTranscriptsResponse` ↔ Task 9 `BackendMessage` ↔ Task 11 테스트 mock 전부 일치(8개).
- `TranscriptRedactionPlan#range_bounds` / `CutRange#bounds` `#exempt?` `exempt_ids` — Task 2 정의 ↔ Task 6 `revalidate_redaction!` 사용 일치. 경계 비교는 `Struct#==` 가 아니라 `range_bounds`(면제 목록 제외)로 한다.
- `RedactConflict` / `revalidate_redaction!` / `verify_fts_purged!` / `bounds_entry` / `bounds_stale?` — Task 6 내부 정의·사용 일치.
- `SttChunkStorage.sweep_redact_backups!` — Task 13 정의 ↔ Task 7.3·§후속 서술 일치.
- `applyLocalRedaction` / `LocalRedactionDeps{reloadTranscripts, markAudioChanged, notify}` — Task 12 정의(`lib/applyLocalRedaction.ts`) ↔ `MeetingPage.handleTranscriptRedact` 주입 ↔ 테스트 `makeDeps()` 키 3개 일치.
- `remoteStructureRevision` / `markRemoteStructureChange` / `audioRevision` / `markAudioChanged` — Task 9 정의 ↔ Task 10(`useAudioPlayer` 인자) ↔ Task 12(`MeetingPage` 셀렉터·로컬 호출) 일치. `markAudioChanged` 호출 지점이 정확히 2곳(Task 9 채널 비-에코 / Task 12 로컬)이고 배타적임을 세 곳 주석에 동일 문구로 기록했다.
- `TranscriptBounds` / `expected_bounds` — Task 6 서버 파싱(`e[:started_at_ms]`, 키는 `row.id.to_s`) ↔ Task 8 타입(`Record<string, TranscriptBounds>`) ↔ Task 11 호출부(`expectedBounds[String(r.id)]`) ↔ Task 6 스펙 `bounds_for`(`t.id.to_s`) — **키가 전부 문자열**로 일치한다.
- `canRedactMeeting` / `canRedact` / `dflowSynced` / `onRedacted` — Task 11 정의(helpers + `TranscriptPanelProps`) ↔ Task 12 전달(`MeetingPage` 데스크톱 · `meetingDetailTabs` 모바일) 철자 일치. `RedactTranscriptsResponse`가 `onRedacted` 시그니처로 Task 8 → 11 → 12를 관통한다.
