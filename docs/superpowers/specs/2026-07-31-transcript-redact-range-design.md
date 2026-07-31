# 기밀 구간 절단 (transcript redact range) 설계

- 선행: `2026-07-30-transcript-split-design.md` (split, main 머지 `32d4aa34`). 그 문서의 **부록**에서 확정된 결정을 이어받는다.
- 브랜치: `feature/transcript-redact-range`
- 별건: export/import 화자 리스트 누락은 `fix/export-import-speakers`로 분리 (이 문서 범위 아님)

## 목표

회의에서 기밀 구간 N개를 골라, **전사 행과 오디오를 실제로 파기**한다. 마스킹·필터가 아니라 절단이다.
되돌릴 수 없다.

## 배경 — 착수 전 실측한 잔존 사본 인벤토리

부록의 "미확인 항목"과 설계 시 못 봤던 경로를 전수 확인했다. **전사 텍스트의 잔존 사본은 챗뿐이다.**

| 경로 | 결과 | 근거 |
|---|---|---|
| `solid_queue_jobs.arguments` | 텍스트 없음 | 15개 job의 `perform` 시그니처 전부 ID·스칼라. 유일한 비ID 인자는 `TranscriptionJob`의 전사 **전** 오디오이며 그마저 `SttChunkStorage`가 경로로 우회 (`stt_chunk_storage.rb:4-6`) |
| `transcript_embeddings` | 텍스트 없음 | 벡터 blob + FK만 (`schema.rb:383-393`). `on_delete: :cascade` (`schema.rb:466`)로 행 삭제 시 자동 정리 |
| trash / soft-delete | 해당 없음 | `Transcript`는 `Trashable` 미포함, `deleted_at` 컬럼 없음. 휴지통 설계는 meeting·folder·project만 (`2026-06-18-trash-bin-design.md:5`) |
| `transcripts_fts` | **평문 사본 있음** | FTS5 가상테이블(`fts_indexable.rb:20`)이라 FK 불가. `after_destroy :fts_delete` 콜백이 유일한 방어 (`fts_indexable.rb:7`) |
| `chat_messages.content` | **평문 잔존 (수용)** | 아래 "챗 히스토리" 참조 |

### 이 인벤토리가 만드는 최우선 제약

> **전사 행 삭제는 반드시 `destroy_all`을 쓴다. `delete_all`·`update_all`·raw SQL 금지.**
> **그리고 `destroy_all`만으로는 부족하다 — 같은 트랜잭션 안에서 FTS 행이 실제로 사라졌는지 확인해야 한다.**

### `destroy_all`이 보장이 아닌 이유

`fts_indexable.rb:47-48`이 예외를 **삼킨다**:
```ruby
rescue => e
  Rails.logger.warn("FtsIndexable: delete failed for #{self.class.name}##{id}: #{e.message}")
```
즉 "유일한 방어"가 best-effort다. `DELETE FROM transcripts_fts`가 SQLITE_BUSY로 실패하면 트랜잭션은 그대로 커밋되어 **전사 행은 사라지고 기밀 평문은 FTS에 영구히 남은 채 200이 나간다.** 이 저장소는 SQLite lock storm 실측 이력이 있다(`reference_sqlite_busy_timeout_pragma_gvl`).

→ `destroy_all` 직후 같은 트랜잭션에서 `SELECT COUNT(*) ... WHERE source_id IN (...)` == 0을 확인하고 아니면 raise(→ 롤백 + 오디오 복구). `summaries_fts`도 같이.
`fts_delete` 자체는 고치지 않는다 — 공유 코드이고 이 작업 범위 밖이다. 절단 경로에서 **검증**만 한다.

`delete_all`은 AR 콜백을 건너뛰므로 `transcripts_fts`에 잘라낸 전사 전문이 **영구히** 남는다. 기밀 파기 기능이 막으려는 바로 그 실패다.
이 코드베이스에서 실제로 물린 적이 있다 — 마이그레이션 `20260615000003_cleanup_orphans_and_add_meeting_fks.rb:36`이 고아 `transcripts_fts` 행 청소용으로 존재한다.
기존 전체 파기 경로도 같은 패턴을 따른다 (`meeting.rb:559-567` `purge_transcription_content!` → `transcripts.destroy_all`).

`sequence_number` 재번호처럼 **삭제가 아닌** 벌크 갱신에는 split이 쓰던 `.reorder(nil).update_all(...)`를 그대로 쓴다 (`transcripts_controller.rb:198-201`). FTS 콜백은 `content`/`speaker_*` 변경에만 걸리므로 ms·seq 갱신에는 무관하다 — 단, 이 전제를 구현 시 `fts_indexable.rb`에서 재확인할 것.

## 부록에서 이어받은 확정 결정 (재논의 금지)

- 방식은 **절단**. 구간 N개를 모아 한 번에.
- 전사는 ms를 당긴다. 구간별 누적 delta라 행별 계산 필요.
- 회의록(요약)은 마커를 고치지 않고 **행을 지우고 재요약을 유도**한다. realtime 요약이 append형이라 (`meeting_summarization_job.rb:428-433` `compose_appended_notes`) 전사를 지워도 `notes_markdown`에서 텍스트가 사라지지 않기 때문.
- `meetings.brief_summary`는 **명시적 nil 처리**. `meeting.rb:615`가 `update_column(..., text) if text.present?`라 재생성 결과가 빈 값이면 옛 발췌가 남는다. LIKE 검색 대상이다 (`meeting.rb:151`).
- `action_items`/`decisions`의 `ai_generated: true` 행도 삭제 대상.
- 오디오 경계는 **이웃 행과의 gap 중간점으로 클램프**. 행 ms를 그대로 쓰면 인접 발언을 깎는다 (오디오 overlap 500ms, `citationMarkers.ts:46-48`).
- 챗 히스토리는 지우지 않는다 (아래 재검토 결과 유지).
- D'Flow 기전송분은 사용자가 직접 처리. 확인 다이얼로그에 경고 + 링크.
- 오디오 재인코딩 손실 수용 (`-c copy` 불가, 원본 mp3 64kbps).
- 파괴적이므로 `redacted_ranges` 테이블도, 구간 필터 인프라도 불필요.
- 데스크톱 로컬 잔존(`src-tauri/src/audio/mod.rs:139`)은 서버 삭제가 미치지 못하는 범위로 명시.

## 이번에 새로 정한 것

### 1. 챗 히스토리 — 유지 + 경고 명시 (재검토 완료)

부록은 노출 범위를 "이미 전사를 볼 수 있던 사람으로 한정"이라 적었다. 실측은 **더 좁다**:

```ruby
# app/models/chat_message.rb
scope :for_user, ->(user) { where(user: user) }
```
`scoped_chat_messages_controller.rb:9`, `chat_messages_controller.rb:11` 둘 다 `for_user(current_user)`를 강제한다.
교차 사용자 읽기 경로가 **없다** — 챗은 질문한 본인만 본다.

그래서 결정을 유지한다. 근거 두 가지:
- 노출이 본인 한정이라 부록이 가정한 것보다 안전하다.
- **부분 삭제는 완전성에 대한 착각을 준다.** "마커가 구간 내부를 가리키는 assistant 메시지만 삭제"는 마커 없이 인용한 답변과 사용자가 직접 타이핑한 기밀을 못 잡는다. "기밀 삭제됨"이라고 표시하면서 일부만 지우는 쪽이, 안 지운다고 명확히 말하는 쪽보다 나쁘다.

대신 **삭제 확인 다이얼로그에 명시**한다: "내 챗 기록에 인용된 내용은 남습니다."
D'Flow 경고와 같은 자리, 같은 원칙(사용자가 직접 처리).

챗 **마커 보정**은 여전히 필요하다 — `speakerAtMs`의 nearest 폴백(`citationMarkers.ts:58-86`)에 거리 상한이 없어, 구간 내부를 가리키는 마커가 에러 없이 **조용히 엉뚱한 발언으로 시크**한다.

### 2. 권한 티어 — owner/admin 전용

split은 `authorize_meeting_control!`(협업자 허용)이고, 선행 설계가 든 근거는 "split은 기밀 삭제가 아니라 편집"이다 (`2026-07-30-transcript-split-design.md:100-102`). 절단은 정확히 그 반대 케이스다.
복구 불가한 파기 + 오디오 재인코딩까지 동반하므로 `idea.md` 44에서 정한 원칙(관리 액션 = owner/admin)을 따른다.

`meeting_lookup.rb`에 `authorize_meeting_admin!` 상당이 없으면 신설한다 — `meeting_admin? || @meeting.owner?(current_user)`, 협업자 제외.
`reject_if_locked!`(`meeting_write_guard.rb:9-14`)는 split과 동일하게 적용한다.

### 3. 잔존 사본으로 새로 발견된 것

- **`meeting_bookmarks.timestamp_ms`** (`schema.rb:178-185`) — transcript와 FK가 없는 독립 ms 마커다. `destroy_batch`가 손대지 않아 절단 후 조용히 어긋난다. 부록 미기재. 이번에 처리한다.
- **Ruby 쪽 마커 정규식 단일 소스 부재** — `summary.rb:14`, `meeting.rb:619`, `markdown_exporter.rb:43`, `meeting_chat_context.rb:50`에 제각각 하드코딩. 그중 `markdown_exporter`·`meeting_chat_context`는 폴더 스코프 `m:` 형태를 처리하지 못한다.
  절단은 마커를 **쓰기** 때문에 단일 소스가 필수다. `LlmPrompts::CitationMarkers` 상수 모듈을 신설하고 절단 경로가 그것만 쓴다. 기존 4곳의 통일은 이 작업 범위 밖(별도 후속) — 다만 신설 모듈에 기존 4개 표현식을 주석으로 대조해 둔다.

## 범위 결정

### 입력은 전사 행 id 집합

시간 범위가 아니라 **선택한 전사 행**을 받는다. 이유:
- 기존 `destroy_batch`가 이미 id 기반이고 UI에 다중 선택이 있다 (구현 시 `TranscriptPanel`에서 확인 — 없으면 이 작업에 포함).
- 낙관적 동시성 가드가 자연스럽게 나온다 (아래).
- 사용자가 화면에서 보고 고르는 단위와 일치한다.

서버가 id들을 `sequence_number` 연속 런으로 묶어 **구간 N개**를 만든다. 비연속 선택 = 구간 여러 개.

### API

```
POST /api/v1/meetings/:meeting_id/transcripts/redact
{
  "transcript_ids": [12, 13, 14, 20],
  "client_id": "..."
}
```

응답:
```json
{
  "deleted_ids": [12, 13, 14, 20],
  "ranges": [{ "start_ms": 41250, "end_ms": 68900 }, { "start_ms": 121000, "end_ms": 134500 }],
  "total_cut_ms": 41150,
  "audio_duration_ms": 1802340,
  "summaries_destroyed": true,
  "chat_markers_updated": 7,
  "bookmarks_removed": 2
}
```

### 낙관적 동시성 가드 — 가드 **두 개**가 필요하다

#### (1) `expected_bounds` — 필수 파라미터

클라이언트가 화면에서 본 각 선택 행의 ms 경계를 그대로 되돌려 보낸다. 서버 현재값과 하나라도 다르면 아무것도 바꾸지 않고 409.

```
expected_bounds: { "<transcript_id>": { started_at_ms: N, ended_at_ms: M }, ... }
```

**optional 이 아니라 required 다.** 없으면 422. 기밀 파기 기능에서 클라이언트가 필드를 빠뜨리면 가드가 통째로 사라지는 설계는 허용하지 않는다.

이게 잡는 실패: 클라이언트가 목록을 읽은 뒤 누군가 그 기밀 행을 **split** 했다. split은 원행의 `ended_at_ms`를 분할점으로 줄이므로 경계가 달라져 즉시 걸린다.

> **왜 이 가드가 따로 필요한가 (설계 수정 이력).** 초안은 아래 (2) 겹침 완전성 검사만으로 동시 split을 잡는다고 적었다. **틀렸다.** split 직후 서버 상태는 자기완결적이다 — 원행의 `ended_at_ms`가 분할점으로 줄고 새 조각이 **정확히 그 지점에서** 시작하므로, 클램프 계산에서 gap이 0이 되어 클램프된 경계가 새 조각과 겹치지 않는다. 겹침 검사는 통과하고 절반만 잘려 **기밀 텍스트가 살아남는다**. split의 `expected_content`와 같은 성격의 클라이언트 단언이 있어야만 잡힌다.

#### (2) 겹침 완전성 검사

서버는 클램프된 절단 경계를 계산한 뒤, **그 경계와 겹치는 전사 행이 요청 id 집합 안에 전부 들어 있는지** 검사한다. 하나라도 밖에 있으면 409.

(1)이 있어도 이건 여전히 필요하다 — 구간 **안으로 새로 삽입된 행**, 이어녹음으로 붙은 행, gap 중간점까지 확장된 경계에 새로 걸리는 이웃 행은 (1)이 못 잡는다(그 행들은 애초에 클라이언트의 선택 목록에 없으므로 `expected_bounds`에도 없다).

`expected_content` 맵은 쓰지 않는다 — 지울 행의 내용 변경은 무해하고, 경계 단언이 동시 split을 이미 잡는다.

### 진행 상태 가드

split과 동일 (`transcripts_controller.rb:128-135`): `recording?`/`transcribing?` → 409, `summarizing?` → 409.
`FileTranscriptionJob`·`ReDiarizeJob`은 `transcribing?`로 이미 덮인다.
추가로 **`AudioUploadJob` 인플라이트 검사**가 필요하다 (V6 — 대응 플래그가 없고, 놓치면 기밀이 복원된다).

## 절단 경계 계산

전사 행 ms를 그대로 자르면 인접 발언을 깎는다. 구간 하나(연속 런)에 대해:

```
run_start_ms = 런의 첫 행.started_at_ms
run_end_ms   = 런의 마지막 행.ended_at_ms
prev         = 런 직전 행 (없으면 nil)
next_row     = 런 직후 행 (없으면 nil)

cut_start = prev.nil?     ? 0
                          : (prev.ended_at_ms < run_start_ms
                               ? (prev.ended_at_ms + run_start_ms) / 2   # gap 중간점
                               : run_start_ms)                            # 겹침이면 클램프 안 함
cut_end   = next_row.nil? ? audio_duration_ms
                          : (run_end_ms < next_row.started_at_ms
                               ? (run_end_ms + next_row.started_at_ms) / 2
                               : run_end_ms)
```

~~`ended_at_ms`가 `nil`인 행이 있을 수 있다~~ — **틀렸다.** `db/schema.rb`의 `transcripts` 테이블은 `t.integer "ended_at_ms", null: false`다. nullable은 프론트 타입(`SpeakerLookupFinal.ended_at_ms: number | null`)에만 있다. nil 방어는 테스트할 수 없는 죽은 코드가 되므로 **넣지 않는다**.

구간들을 `cut_start` 오름차순 정렬 후 **겹치거나 맞닿으면 병합**한다.

## ms 시프트

남은 행 하나(`t = started_at_ms`)의 delta:

```
delta(t) = Σ (cut_end_i − cut_start_i)   for all ranges i where cut_end_i ≤ t
```

**delta는 클램프된 오디오 경계로 계산한다** — 행 ms로 계산하면 전사 타임라인이 오디오와 어긋난다.

겹침 완전성 검사를 통과했으므로 남은 행은 어떤 구간도 가로지르지 않는다 → `started_at_ms`와 `ended_at_ms`에 **같은 delta**를 적용한다.

## 트랜잭션 순서 (오디오 ↔ DB 원자성)

ffmpeg은 파일시스템이라 트랜잭션이 아니다. 순서를 명시한다.

```ruby
# 1. 검증 전부 (권한 / 잠금 / 진행상태 / AudioUploadJob 조기 409 / id 유효성 / 겹침 완전성)
# 2. 구간·경계·delta 계산
# 3. 중복 기밀 사본 선삭제 — 트랜잭션·ffmpeg보다 먼저 (V6-b)
#    FileUtils.rm_rf("storage/audio/#{id}_parts")
#    FileUtils.rm_rf("storage/stt_chunks/#{id}")
#    삭제 실패 시 여기서 중단. 롤백돼도 무해(본 오디오에 이미 병합된 중복)하고,
#    남겨두면 finalize가 잘리지 않은 오디오를 재구성한다.
# 4. ffmpeg → 임시 파일. 검증: exit 0 && 출력 파일 존재 && ffprobe 길이 ≈ 기대치(±1초)
#    실패 시 여기서 중단 — DB 무변경
tmp_out = redact_audio_to_temp(path, ranges)

backup = "#{path}.redact-backup"
begin
  ActiveRecord::Base.transaction do
    # 4. DB 변경 전부
    #    4-0. ⭐ 가드 재검증 — ffmpeg 이 수십 초 걸리므로 1번의 검증은 이미 낡았다.
    #         트랜잭션 안에서 rows 를 다시 읽고 expected_bounds · 겹침 완전성 · 구간 경계
    #         동일성을 **모두** 재확인한다. 하나라도 어긋나면 409(→ 롤백, 오디오 무변경).
    #         구간 경계가 그대로여야 3번 ffmpeg 산출물을 재사용할 수 있다.
    #         재계산된 plan 을 이후 단계가 써야 한다 — 낡은 스냅샷을 쓰면 창 안에 생긴
    #         행이 ms 시프트를 못 받아 오디오와 어긋난다.
    #    4a. @meeting.transcripts.where(id: ids).destroy_all   ← destroy_all 필수 (FTS)
    #    4a-2. ⭐ FTS 삭제 검증 — SELECT COUNT(*) FROM transcripts_fts WHERE source_id IN (...)
    #          == 0 이 아니면 raise. summaries_fts 도 동일. 아래 "왜 필요한가" 참조.
    #    4b. 남은 행 ms 시프트 + sequence_number 재번호
    #    4c. meeting_bookmarks: 구간 내부 → destroy, 이후 → 시프트
    #    4d. chat_messages 마커 보정
    #    4e. @meeting.summaries.destroy_all
    #        @meeting.action_items.where(ai_generated: true).destroy_all
    #        @meeting.decisions.where(ai_generated: true).destroy_all
    #    4f. @meeting.update_column(:brief_summary, nil)   ← 명시적 nil (meeting.rb:615 함정)
    #    4g. @meeting.update!(last_user_edit_at: Time.current)   ← D'Flow 재전송 신호

    # 5. 파일 교체를 트랜잭션 마지막에. 같은 디렉토리 내 mv = rename = 사실상 원자적
    FileUtils.mv(path, backup)
    FileUtils.mv(tmp_out, path)
  end
rescue StandardError
  FileUtils.mv(backup, path) if File.exist?(backup)   # 롤백 시 원본 복구
  FileUtils.rm_f(tmp_out)
  raise
end

# 6. 백업 파기는 rescue **밖**에서. begin 블록 안에 두면 안 된다 —
#    커밋이 끝난 뒤 rm_f 가 실패했을 때 rescue 가 돌아 백업을 되살리고,
#    "전사는 지워졌는데 기밀 오디오는 복원된다"가 된다. 위에서 금지한 바로 그 방향이다.
FileUtils.rm_f(backup)

# 7. @meeting.refresh_audio_duration!   ← ffprobe 실측. audio_duration_ms는 전사 ms 파생이 아니다 (meeting.rb:117-132)
# 8. @meeting.reconcile_embeddings!     ← split과 동일 (transcripts_controller.rb:230)
# 9. 브로드캐스트
```

**왜 이 순서인가**: 파일 rename이 트랜잭션 안 마지막에 있으면
- rename 실패 → 트랜잭션 롤백 → 아무것도 안 변함 (원본 오디오 온전)
- rename 성공 후 커밋 실패 → rescue가 백업에서 복구 → 아무것도 안 변함

반대 순서(DB 커밋 후 교체)는 교체 실패 시 **전사는 지워졌는데 기밀 오디오는 남고, 사용자는 UI에서 재시도할 행조차 없어** 조용히 기밀이 살아남는다. 그 방향은 허용하지 않는다.

### 오디오 절단 명령

`-c copy`는 안 된다 (부록 확정). 남길 세그먼트를 concat한다:

```
ffmpeg -y -loglevel error -i <src> \
  -filter_complex "[0:a]asplit=2[s0][s1]; \
                   [s0]atrim=start=0:end=41.25,asetpts=N/SR/TB[a0]; \
                   [s1]atrim=start=68.9:end=121,asetpts=N/SR/TB[a1]; \
                   [a0][a1]concat=n=2:v=0:a=1[out]" \
  -map "[out]" -c:a libmp3lame -b:a <MP3_BITRATE> <tmp_out>
```

`asplit=N`은 **명시한다**. ffmpeg 5.1.10에서는 `[0:a]`를 여러 `atrim`에 그대로 재사용해도 동작함을 실측했지만(10초 소스, 3–6초 절단 → 7.027초), 버전에 따라 입력 pad 재사용에 split을 요구한다. 실서버는 WSL2로 dev(macOS)와 ffmpeg 빌드가 다르다.
`N`은 **남길 세그먼트 수**다 (절단 구간 수가 아니다).

기존 관행을 따른다: `system(...)`에 argv 배열로 넘긴다(셸 문자열 금지). 참고 `audio_upload_job.rb:30-37`, `meetings_audio_controller.rb:136-156`.
코덱·비트레이트는 **원본 확장자에 맞춘다** — `.mp3`면 `libmp3lame` + `AudioUploadJob::MP3_BITRATE`, `.webm`이면 `libopus`(merge 경로와 동일).

### 파기 대상 아티팩트 전체 (V1~V3 실측 확정)

`meeting.audio_file_path` 하나만 자르면 기밀이 남는다. 절단이 처리할 대상:

| 대상 | 처리 |
|---|---|
| `meeting.audio_file_path` 가 가리키는 파일 **하나** | **절단** |
| 그 외 `storage/audio/<meeting_id>.*` 오디오 (고아) | **삭제** (아래 참조) |
| 각 오디오의 `<path>.peaks.json` | **삭제**. 파일 존재 여부로만 캐시 판정하므로 안 지우면 절단 전 파형이 영구 노출 (V2) |
| `storage/audio/<meeting_id>_parts/` | **디렉토리째 삭제, 트랜잭션 전에** (V3, V6-b) |
| `storage/audio/<meeting_id>*.merged.*` | **삭제**. merge 실패 시 정리 안 되는 임시파일 (V3) |
| `storage/stt_chunks/<meeting_id>/` | **디렉토리째 삭제, 트랜잭션 전에**. 원시 PCM, 정리가 6시간 시간 기반 스위퍼뿐 (V1) |
| `storage/audio/<meeting_id>.*.redact-backup` (이전 절단의 잔존 백업) | **삭제, 트랜잭션 전에**. 아래 참조 |

**잔존 `.redact-backup` 스윕이 필요한 이유.** 커밋 **후** `FileUtils.rm_f(backup)`이 실패하면 백업 파일이 남는다. 복구하지 않는 것은 맞지만(그 방향은 금지) **파기도 안 된다** — 그 파일은 절단 **전** 오디오 전체, 즉 기밀 원음이다. 그리고 절단 대상 글롭(`<id>.*`)에서 `.redact-backup`을 제외하므로(작업 중인 백업을 자기가 자르면 안 되니까) 이후 절단에서도 영원히 잘리지 않는다.

→ 절단은 시작할 때 **자기 것이 아닌 잔존 `.redact-backup`을 먼저 지운다**. `_parts/`·`stt_chunks/`와 같은 자리(트랜잭션 전)에서, 같은 이유로: 본 오디오에 대해 중복이고 남겨두는 쪽이 위험하다.
반증 테스트: 이전 절단이 남긴 `.redact-backup`이 있는 상태에서 절단하면 그 파일이 사라진다. *(반증: 스윕을 빼면 기밀 원음이 디스크에 영구히 남는다)*

**"다음 절단"만으로는 회수가 안 된다.** 대부분의 회의는 절단이 두 번 일어나지 않는다. 기밀 파기 기능이 스스로 만든 기밀 사본을 회수하지 못하는 건 수용 대상이 아니다.

→ 두 겹으로 닫는다:
- `drop_backups!` 실패를 `Rails.logger.error` + 응답의 `backup_retained` 플래그로 **노출**한다(조용히 넘어가지 않는다).
- 이미 매시간 도는 `SttChunkStorage.sweep!` 안에서 `storage/audio/*.redact-backup`도 스윕한다(`older_than: 1.hour`). `config/recurring.yml`은 커맨드 문자열로 그 메서드를 직접 부르므로 **스케줄 설정 변경이 없고**, 스키마 변경도 없다.

⚠️ **테스트 오염 함정**: `AUDIO_DIR` 미설정 시 기본값이 **프로덕션** `storage/audio`다. 오디오 스윕을 `sweep!`에 붙이면 기존 `stt_chunk_storage_spec.rb`가 스위트를 돌 때마다 실제 파일을 지운다. 스펙에 `AUDIO_DIR` 격리를 넣는 것에 더해, **메서드 자체가 `Rails.env.test? && AUDIO_DIR.blank?`이면 0을 반환**하게 한다(미래의 스펙까지 막는 구조적 방어선 — `ROOT`가 test에서 갈라지는 것과 같은 논리).

`_parts/`·`stt_chunks/`·`.merged.`는 절단이 아니라 **삭제**다 — 부분 파일이라 타임라인 매핑이 없고, 본 오디오에 이미 병합되어 있다.

**고아 오디오도 자르지 않고 지운다 (설계 수정).** 초안은 `<id>.*` 오디오 **전부를 절단**하라고 적었다. 틀렸다 — 자를 세그먼트 목록은 `audio_file_path` 기준 타임라인인데, V3가 절단 대상이라 지목한 "webm+mp3 공존"은 정확히 **길이가 다른** 두 파일이다(`save_or_merge_audio`가 새 확장자로 dest를 잡고 옛 파일을 안 지운다). 짧은 쪽에 같은 세그먼트를 적용하면 뒤쪽 kept 구간이 통째로 잘려 길이 검증에 걸리고 → **그 회의는 영구히 절단 불가**가 된다.
고아 파일은 `audio_file_path`가 가리키지 않는 **참조 없는 절단 전 기밀 오디오**다. 지우는 것이 기밀 목적에 부합하고, 덤으로 `AudioUploadJob`이 stale 고아를 집어 갈 경로도 사라진다.
반증 테스트는 **길이가 다른 두 파일**로 픽스처를 만들어야 한다 — 같은 소스에서 트랜스코딩하면 잘못된 구현도 통과한다.

**타이밍이 중요하다.** `_parts/`와 `stt_chunks/`는 **트랜잭션·ffmpeg보다 먼저** 지운다. 커밋 후로 미루면 그 사이 `finalize`가 잘리지 않은 청크로 오디오를 재구성할 수 있다 (V6-b — `finalize`에 상태 가드가 없다). 롤백 시 이들이 사라져도 무해하다: 본 오디오에 이미 병합된 중복 사본이다.
**본 오디오 교체만** 백업/복구 대상이다.

## 마커 보정

### 대상 컬럼 (실측 확정)

| 컬럼 | 처리 |
|---|---|
| `summaries.notes_markdown` | 마커 보정 **안 함**. 행 자체를 `destroy_all` (부록 확정 — append형 요약이라 전사를 지워도 텍스트가 남기 때문) |
| `chat_messages.content` | **마커 보정** (아래) |

`summaries.key_points`/`decisions`/`discussion_details`, `action_items.content`, `decisions.content`, `transcripts.content`, `blocks.content`은 인용 지시문을 받지 않아 마커가 없음을 확인했다.
`meetings.brief_summary`는 저장 전 마커가 제거되지만(`meeting.rb:618-620`) 본문이 stale이므로 nil 처리 대상이다.

### 마커 문법 두 가지

```
회의 스코프:      ⟦t:<ms>/s:<화자>⟧            frontend/src/lib/citationMarkers.ts:3
폴더·프로젝트:    ⟦m:<회의id>/t:<ms>/s:<화자>⟧   frontend/src/lib/citationMarkers.ts:6
```

주의 3가지:
- 구분자가 `/` 또는 `|` 둘 다 허용된다 (`[|/]`).
- 시간이 `12345`(ms)뿐 아니라 `mm:ss`·`hh:mm:ss` 콜론 형태일 수 있다 (`\d+(?::\d+)*`, `markerTimeToMs` `citationMarkers.ts:9-15`). **시프트하려면 파싱해야 한다** — Ruby 등가 함수가 필요하다.
- `FOLDER_CITATION_RE`를 `CITATION_RE`보다 **먼저** 매칭해야 오매칭이 없다 (`ChatMarkdown.tsx:7-12` 참조).

### 보정 규칙

각 마커의 ms에 대해:
- 어떤 절단 구간 **내부** → 마커 **제거**(빈 문자열로 치환). `speakerAtMs` 폴백이 조용히 엉뚱한 발언으로 시크하는 걸 막는다.
- 절단 구간들 **이후** → `delta(ms)`만큼 당김. 콜론 형태였으면 **동일 형태로 재직렬화**한다.
- 첫 구간 **이전** → 그대로.

### 훑을 챗 행의 범위

```ruby
# 회의 스코프 — 전 사용자 (시스템 작업이므로 for_user 안 씀)
@meeting.chat_messages

# 폴더·프로젝트 스코프 — 이 회의를 인용한 것만
ChatMessage.where(scope_type: %w[folder project])
           .where("content LIKE ? ESCAPE '\\'", "%⟦m:#{@meeting.id}/%")
```
`ESCAPE '\'`는 이 리터럴에 `%`·`_`가 없어도 붙인다 — 하우스 룰(`reference_sqlite_like_escape`).
`|` 구분자 변형 때문에 LIKE는 `⟦m:<id>/` 접두만 거르는 **1차 필터**다. 실제 판정은 정규식으로 한다.

`chat_messages` 갱신은 `update!`가 아니라 `update_column`으로 충분한가? — `ChatMessage`에 FTS·임베딩 콜백이 걸려 있는지 구현 시 확인하고, 걸려 있으면 콜백이 도는 경로를 쓴다.

## 북마크

`meeting_bookmarks.timestamp_ms` (`schema.rb:178-185`):
- 구간 내부 → `destroy_all` (그 순간이 사라졌으므로 북마크도 무의미)
- 구간 이후 → `timestamp_ms - delta`

## 브로드캐스트 & 프론트 반영

`TranscriptPanel`은 **prop 배열**로 렌더하고 store는 content override만 준다 (`TranscriptPanel.tsx:14,42,58-74`).
split이 겪은 것과 **동일한 문제**다 — 행 개수가 바뀌는 구조 변경은 store만 갱신해선 화면에 안 나온다.

새 메커니즘을 만들지 않고 split의 것을 **일반화**한다:

- `transcriptStore.remoteSplitRevision` → **`remoteStructureRevision`으로 rename**
- `markRemoteSplit()` → **`markRemoteStructureChange()`로 rename**, split·절단 양쪽에서 호출
- `MeetingPage`의 재조회 이펙트(`MeetingPage.tsx:321-333`)는 그대로. 비교는 반드시 `useTranscriptStore.getState()`의 현재값으로 — 이펙트 클로저의 reactive 값을 쓰면 마운트마다 스퓨리어스 재조회 (split에서 1회 기대 → 3회 실측)
- 호출부·테스트 3곳(`transcription.ts`, `transcriptStore.test.ts`, `MeetingPage.test.tsx`)을 함께 갱신

브로드캐스트:
```ruby
ActionCable.server.broadcast(@meeting.transcription_stream, {
  type: "transcript_redacted",
  deleted_ids: [...],
  ranges: [...],
  audio_duration_ms: ...,
  client_id: params[:client_id]
})
```
로컬(자기 자신) 절단은 응답으로 직접 반영하고 카운터를 건드리지 않는다 — split과 동일하게 중복 재조회를 피한다.

**오디오 재로드**: 파일이 바뀌었으므로 `<audio>`가 캐시된 옛 오디오를 계속 쓰면 기밀이 화면(플레이어)에서 계속 들린다. 오디오 URL에 캐시 버스터를 붙여야 한다 — **V4 확인 항목**.

## UI

### 진입점

**`TranscriptPanel.tsx`에 다중 선택(체크박스 + 전체선택)을 새로 만들고** "기밀 구간 절단" 액션을 붙인다 (V5 참조 — `FullRecord`는 라이브/뷰어 화면 전용이라 절단이 거의 항상 409인 자리다).
선택 UI는 `FullRecord.tsx:20,68-95`의 `selected` Set / `toggleSelect` / `toggleAll` 패턴을 그대로 미러링한다 — 새 방식을 발명하지 않는다.
owner/admin이 아니면 버튼 자체를 숨긴다 (서버 403과 이중 방어).

### 확인 다이얼로그

**`window.confirm` 금지.** Tauri WKWebView에서 non-blocking이라 취소해도 이미 실행된다 — 기존 `confirmDialog` 헬퍼를 쓴다 (`reference_tauri_window_confirm_nonblocking`).

다이얼로그가 반드시 담아야 할 것:
- 잘라낼 구간 목록(시작–끝, 각 길이) + 총 길이
- **되돌릴 수 없습니다**
- 오디오도 함께 잘리며 재인코딩 손실이 있습니다
- 회의록·AI 생성 액션아이템·결정사항이 삭제됩니다 (다시 생성해야 합니다)
- **내 챗 기록에 인용된 내용은 남습니다** ← 이번 결정
- D'Flow에 이미 전송된 회의록은 남습니다 + 링크 (전송 이력이 있을 때만)
- 데스크톱에 업로드되지 않은 원음이 남아 있을 수 있습니다

### 절단 후

자동 재요약을 **걸지 않는다**. 부록의 "재요약을 유도한다"는 유도이지 자동 실행이 아니다 — LLM 비용이 들고 사용자가 원하지 않을 수 있다.
응답 수신 후 "회의록이 삭제되었습니다. 다시 생성하세요" 안내 + 기존 요약 버튼으로 유도한다.

## 구현 전 확인 항목 (**전부 실측 완료** — 답은 아래 "확인 결과" 절)

- **V1. `storage/stt_chunks/<meeting_id>/` 잔존 PCM.** `SttChunkStorage`가 원시 PCM을 디스크에 쓴다 (`stt_chunk_storage.rb`). 정리 시점이 언제인지, 절단 회의에 남아 있을 수 있는지 확인. 남는다면 **기밀 오디오 잔존 사본**이므로 절단이 함께 파기해야 한다.
- **V2. 파형(waveform) peaks 캐시.** `meetings_audio_controller.rb:165-168`이 ffmpeg으로 PCM을 뽑아 peaks를 만든다. 어딘가 캐시되면 절단 후 무효화 필요.
- **V3. 회의당 실제 오디오 파일 목록.** `<id>.webm`·`<id>.mp3`가 동시에 존재할 수 있는지, `cleanup_original`이 언제 도는지. 존재하는 모든 오디오 파일을 잘라야 한다.
- **V4. 오디오 URL 캐시 버스팅.** 프론트가 오디오를 어떤 URL로 받는지, 절단 후 재로드를 어떻게 강제할지.
- **V5. `TranscriptPanel` 다중 선택 존재 여부.** `destroy_batch`가 id 배열을 받으므로 있을 가능성이 높지만 확인. 없으면 이 작업에 포함.
- **V6. 오디오 파이프라인 진행 중 플래그.** `AudioUploadJob`/`FileTranscriptionJob` 진행 상태를 나타내는 기존 필드가 있는지 (진행 상태 가드에 추가할 것).
- **V7. `ChatMessage`의 저장 콜백.** FTS·임베딩 콜백이 걸려 있는지 (마커 보정 시 `update_column` 가부 판단).

## 확인 결과 (V1~V7 실측 완료 — 위 항목들의 답과 설계 수정)

### V1. `stt_chunks` 원시 PCM — **잔존 가능. 절단이 파기해야 한다.**

정리 경로가 **시간 기반 스위퍼뿐이다**. `TranscriptionJob`은 청크 성공·비재시도 에러 시에만 파일을 지우고, `TimeoutError`/`ConnectionError`로 재시도가 소진되면 **일부러 안 지운다** ("파일은 여기서 지우지 않는다 — sweeper 몫", `transcription_job.rb:11`).
백스톱은 `SttChunkStorage.sweep!` (매시간, `older_than: 6.hours`, `recurring.yml:19-21,39-41`) 하나이며 회의 상태와 무관하다. 전사 완료·회의 완료에 연동된 정리는 없다.

→ 완료된 회의에도 최대 ~6시간 원시 PCM이 남을 수 있다. **절단은 `storage/stt_chunks/<meeting_id>/`를 명시적으로 파기한다.**

### V2. 파형 peaks 캐시 — **무효화 필요. 안 하면 절단 전 파형이 영구히 보인다.**

`peaks_path = "#{path}.peaks.json"` 파일 캐시이고 판정이 `unless File.exist?(peaks_path)`다 (`meetings_audio_controller.rb:100-101`). HTTP 캐시 헤더는 없다.
현재 무효화는 `cleanup_original`이 webm→mp3 전환 시 옛 peaks를 지우는 것뿐 (`audio_upload_job.rb:41-45`). **같은 경로에 in-place 교체하는 절단은 이 경로에 걸리지 않는다.**

→ 절단은 대상 오디오마다 `"#{path}.peaks.json"`을 삭제한다.

### V3. 오디오 아티팩트 — 글롭만으론 부족하다

- `.webm`/`.mp3`는 정상 경로에선 공존하지 않지만(`cleanup_original`이 성공 시 원본 삭제), **재녹음 병합 시나리오에서 공존한다**: `save_or_merge_audio`가 dest 확장자를 **새 업로드 기준**으로 잡아(`meetings_audio_controller.rb:122-123`) 새 `<id>.webm`을 만들고 기존 `<id>.mp3`는 **손대지 않는다**. 전사 실패 시에도 webm이 영구히 남는다.
- **`storage/audio/<id>_parts/`** — `finalize`가 끝까지 안 돌면(크래시·중단 녹음) 원시 청크 파일이 **영구 잔존**한다. `rm_rf`는 `finalize` 안에만 있다 (`:71`).
- **`<id>.webm.merged.webm`** — merge 실패 시 정리되지 않는 임시 파일 (`:136-156`, 성공 분기에서만 `mv`).

→ 절단 대상 = `storage/audio/<meeting_id>.*` **전부** + 각각의 `.peaks.json` + `storage/audio/<meeting_id>_parts/` 디렉토리 **삭제**(절단이 아니라 삭제 — 이미 병합된 원본의 조각이므로 남길 이유가 없다) + 잔여 `*.merged.*` 임시파일 삭제.

### V4. 오디오 캐시 버스팅 — **존재하지 않는다. 신설 필요.**

```ts
const audioUrl = `${getApiBaseUrl()}/meetings/${meetingId}/audio`   // useAudioPlayer.ts:38
```
쿼리 파라미터 없음, 백엔드 `send_file`에 캐시 헤더 없음, 그리고 결정적으로 **effect deps가 `[meetingId]`뿐이다** (`useAudioPlayer.ts:135`). 서버 모드는 fetch→blob→`createObjectURL`이라 blob이 ref에 잡혀 언마운트까지 갱신되지 않는다.

→ 절단 후 플레이어가 **기밀이 들어 있는 옛 오디오를 계속 재생한다.** URL에 버전 토큰을 붙이고 effect deps에도 넣는다. 토큰은 `audio_duration_ms`가 아니라 **절단 시각**을 쓴다 — 길이는 우연히 같을 수 있다. `meetings.updated_at` 또는 응답의 절단 타임스탬프를 쓰되, 구현 시 어느 값이 프론트에 이미 내려오는지 확인해 재요청 없이 되는 쪽을 택한다.

#### V4-b. 브로드캐스트 발화 트리거가 없다 (수용 — 사용자 결정)

`MeetingPage`는 ActionCable 전사 채널을 **구독하지 않는다**. `useTranscription(meetingId)` 호출부는 `useLiveRecording.ts:125`와 `MeetingViewerPage.tsx:41` 둘뿐이다.
따라서 `remoteStructureRevision` 재조회 이펙트도, 오디오 캐시 버스터도 **구현은 맞지만 원격 신호로는 발화하지 않는다**. 머지된 split의 원격 동기(`MeetingPage.tsx:311`)도 같은 이유로 죽어 있다 — 이번 작업의 회귀가 아니라 사전 존재 갭이다.

**영향 범위**: 절단한 본인 화면은 응답 경로로 갱신되므로 정상이다. 영향은 **동시에 같은 회의를 보고 있는 다른 사용자**에 한정되며, 새로고침하면 해소된다. 그 사용자는 이미 해당 오디오 접근 권한이 있던 사람이다 (챗 히스토리 결정과 같은 논리).

**결정: 이번 범위에 넣지 않고 한계로 명시한다.** `useTranscription(meetingId)` 한 줄로 살아나는 구조지만, 그 훅은 녹음용(`sendChunk`·하트비트)이라 부수효과 검증이 선행돼야 하고, 기밀 기능 안에서 사전 존재 버그를 고치면 리스크를 같이 진다. Task 9·10은 설계대로 넣는다 — 구독이 붙는 순간 바로 동작한다.

→ 후속으로 분리: "`MeetingPage`에 전사 채널 구독 추가 (split 원격 동기도 함께 복구)".

### V5. 진입점 — `TranscriptPanel`에 다중 선택 **신규 구현** (설계 2회 수정)

`TranscriptPanel.tsx`에는 다중 선택이 **없다**. 행별 액션은 split 버튼뿐 (`:216-229`).
기존 다중 선택 + `destroy_batch` UI는 `FullRecord.tsx`에 있다 (`:20` `selected` Set, `:68-95`).

**1차 수정은 "그럼 진입점을 `FullRecord`에 두자"였다. 이것도 틀렸다.** 렌더 경로를 추적하니:

```
FullRecord ← RecordTabPanel ← MeetingLivePage(녹음 중) · MeetingViewerPage(라이브 뷰어) · useLiveMobileTabs
MeetingPage ← buildMeetingDetailTabs + TranscriptPanel + useAudioPlayer
```

즉 `FullRecord`와 `MeetingPage`는 **다른 화면**이다. 기존 다중 선택 삭제 UI는 라이브/뷰어 화면에만 있고, 종료된 회의를 보는 상세 화면엔 없다.
그런데 절단은 `recording?`/`transcribing?`일 때 409다 — `FullRecord`에 두면 버튼이 **거의 항상 막힌 상태**로만 보인다.

→ **`TranscriptPanel`에 다중 선택을 새로 만들고 진입점을 거기 둔다** (사용자 결정). 오디오 플레이어와 전사 뷰가 있는 `MeetingPage`가 절단의 자연스러운 자리다. 절단은 본질적으로 회의 종료 후 작업이다.

`TranscriptPanel`은 **prop 배열** 기반이므로 로컬 절단이라도 `MeetingPage`의 `transcripts` state를 직접 갱신해야 한다 (split의 `handleTranscriptSplit`과 동일 패턴, `MeetingPage.tsx:353-366`).

### V6. `AudioUploadJob` 경합 — **가드 필요. 스키마 변경 없이 처리한다.**

`AudioUploadJob`에 대응하는 상태 플래그가 **없다**. `FileTranscriptionJob`·`ReDiarizeJob`은 기존 `transcribing?`로 커버되지만, `stop` 액션이 즉시 `status: :completed`로 전이한 뒤(`meetings_controller.rb:404`) `AudioUploadJob`이 비동기로 계속 돌 수 있다 (`audio_upload_job.rb` 전체에 상태 컬럼 갱신 없음).

**왜 위험한가**: 전사 중인 ffmpeg은 열린 fd를 잡고 있다. 우리가 `mv`로 교체해도 그 프로세스는 **옛 inode**를 계속 읽어 절단 안 된 mp3를 만들고, 이어서 `set_audio_file!` + `cleanup_original`이 우리가 절단한 webm을 지운다 → **기밀이 복원된다.**

**해결 — 쓰는 쪽에서 막는다. 진입 가드로는 못 막는다.**

먼저 안 되는 방법부터. "미완료 `AudioUploadJob`이 큐에 있으면 409"는 **보증이 되지 않는다**:
- 위험한 job은 이미 claim되어 **실행 중**인 job이다. 검사 시점에 ffmpeg이 이미 돌고 있고, `set_audio_file!`·`cleanup_original`은 ffmpeg이 **반환한 뒤**에 실행된다 → 검사와 `mv` 사이에 시작하거나 진행 중인 job이 절단을 덮어쓴다.
- dev은 큐 어댑터가 `:async`라(`development.rb:57`) `solid_queue_jobs` 테이블을 안 쓴다 → **정확히 개발·테스트하는 환경에서 가드가 아예 없다.**

**실제 해결**: `AudioUploadJob`이 **덮어쓰기를 거부**하게 한다. `set_audio_file!` 직전에, 자기가 전사한 소스 파일이 시작할 때와 **같은 파일인지** 검증한다(mtime + size, 또는 inode). 다르면 결과물을 버리고 `set_audio_file!`·`cleanup_original`을 하지 않고 경고 로그 후 종료.
몇 줄이고, 마이그레이션이 없고, **쓰기를 소유한 쪽**에서 경합을 닫는다.

**검사만으로는 부족하다 — 임시 경로로 인코딩해야 한다.** 현재 `audio_upload_job.rb:15-17`은 `transcode_to_mp3(src, mp3_path)`로 **최종 `<id>.mp3`에 직접 쓰고** 그 다음에 `set_audio_file!`을 부른다. 즉 identity 검사 시점 이전에 절단 전(기밀) 오디오가 이미 정식 파일명으로 디스크에 있다. 그 사이 프로세스가 죽으면(배포·OOM·워커 재시작) 검사가 영영 돌지 않아 기밀 mp3가 남는다. V3의 webm+mp3 공존에서는 방금 절단한 `<id>.mp3`를 미절단본으로 덮어쓴 뒤 검사가 그걸 `File.delete`해 `audio_file_path`가 없는 파일을 가리키는 상태까지 된다.

→ `#{mp3_path}.upload-tmp`로 인코딩 → identity 검증 통과 후에만 `FileUtils.mv(tmp, mp3_path)` → `set_audio_file!`. 실패 시 tmp만 rm.

`SolidQueue` 조회는 **값싼 조기 409로만** 유지한다 — 보증이 아니라 UX다. 문서·주석에 그렇게 적는다.

**필수 테스트**: 절단 중 in-flight `AudioUploadJob`이 완료되는 상황을 시뮬레이션하고, **절단된 오디오가 살아남는지** 단언한다. *(반증: 소스 identity 검증을 제거하면 이 테스트가 실패해야 한다)*

### V6-b. `finalize`가 절단본을 되돌릴 수 있다 (실측 추가 확인)

`meetings_audio_controller.rb:53-75` `finalize`에는 **회의 상태 가드가 없다.** parts가 비었는지만 본다.
`<id>_parts/`가 남아 있는 상태에서 finalize가 호출되면 잘리지 않은 청크로 `<id>.webm`을 **재구성**하고 `set_audio_file!` + `AudioUploadJob` enqueue까지 한다 → **기밀 복원.**

→ 그래서 `_parts/`·`stt_chunks/` 삭제는 **트랜잭션 전에**, ffmpeg보다도 먼저 한다 (아래 순서 참조). 이 둘은 본 오디오에 이미 병합된 **중복 사본**이라 롤백 시 잃어도 무해하고, 남겨두는 쪽이 위험하다. 삭제 실패 시 요청을 실패시킨다.

`finalize`에 `completed?` 거부 가드를 추가하는 것은 이 작업 범위 밖이다 — `stop`이 `completed`로 전이한 뒤 프론트가 finalize를 부르는 순서일 수 있어 정상 녹음을 깰 위험이 있다. 별도 후속으로 남긴다.

### V7. `ChatMessage` 콜백 — **없다. `update_column` 안전.**

`chat_message.rb`에 `FtsIndexable`·`Embeddable` include 없음, 콜백 매크로 전무. 스킵할 부수효과가 없으므로 마커 보정에 `update_column`을 쓴다.

## 테스트

### 백엔드 (`backend/spec/requests/api/v1/transcripts_spec.rb`에 추가)

split 스펙의 구조를 따른다 (정상 / 검증 / 진행 상태 가드 / 잠금 / 권한 / FTS 정합성).

반드시 포함할 **반증 가능한** 케이스:
- **FTS 정합성**: 절단 후 잘라낸 행의 텍스트로 검색해 0건. *(반증: `destroy_all`을 `delete_all`로 바꾸면 이 테스트가 실패해야 한다)*
- **다중 구간 누적 delta**: 구간 2개 이상, 마지막 구간 뒤 행의 ms가 두 구간 길이의 합만큼 당겨진다. *(반증: 누적 대신 단일 delta를 쓰면 실패)*
- **경계 클램프**: 이웃 행과 gap이 있을 때 절단 경계가 행 ms가 아니라 중간점이다. *(반증: 클램프를 제거하면 실패)*
- **겹침 완전성 409**: 구간에 걸치는 행을 id 목록에서 빼면 409이고 **아무 행도 변하지 않는다**.
- **동시 split 409** ⭐: 선택 행을 split 한 뒤 옛 경계로 절단을 요청하면 409이고 아무 행도 변하지 않는다. *(반증: `expected_bounds` 검사를 제거하면 절반만 잘리고 기밀 텍스트가 살아남는다 — 겹침 완전성만으로는 이 케이스가 통과한다는 것을 이 테스트가 못 박는다)*
- **`expected_bounds` 누락 422**: 파라미터를 빼면 422다(조용히 가드 없이 진행하지 않는다).
- **콜론 형태 마커 시프트**: `⟦t:2:05/s:화자1⟧`가 올바른 ms로 파싱·시프트·재직렬화된다. *(반증: 숫자만 처리하면 실패)*
- **구간 내부 마커 제거**: 절단 구간 내부를 가리키던 챗 마커가 사라진다.
- **폴더 스코프 마커**: `⟦m:<id>/t:..⟧`가 같은 회의를 인용한 폴더 챗에서 보정된다. `|` 구분자 변형 포함.
- **`brief_summary` nil**: 절단 후 `nil`. *(반증: `update_column(..., text) if text.present?` 경로에 의존하면 실패)*
- **북마크**: 구간 내부 북마크는 사라지고 이후 북마크는 시프트된다.
- **롤백 원자성**: DB 변경을 강제 실패시키면 오디오 파일이 **원본 그대로**다 (백업 복구 경로).
- **권한**: 협업자는 403 (split과 다른 티어임을 못박는 테스트).
- **오디오 미변경 경로**: ffmpeg 실패 시 DB 무변경 + 5xx/422.
- **peaks 캐시 무효화**: 절단 후 `<path>.peaks.json`이 존재하지 않는다. *(반증: 삭제를 빼면 실패 — 안 지우면 절단 전 파형이 영구히 서빙된다)*
- **부산물 파기**: `<id>_parts/`·`storage/stt_chunks/<id>/`가 절단 후 사라진다.
- **오디오 파일 복수**: `<id>.webm`과 `<id>.mp3`가 둘 다 있을 때 **둘 다** 잘린다. *(반증: `audio_file_path` 하나만 처리하면 실패)*
- **`AudioUploadJob` 인플라이트 409**: 해당 회의의 미완료 `AudioUploadJob`이 큐에 있으면 409이고 아무것도 변하지 않는다. (조기 UX 가드 — 보증은 아래 테스트가 한다)
- **`AudioUploadJob` 클로버 거부** ⭐: 절단이 끝난 뒤 in-flight `AudioUploadJob`이 완료되는 상황을 시뮬레이션하고, **절단된 오디오가 살아남고 `audio_file_path`가 안 바뀌는지** 단언한다. *(반증: 소스 identity 검증을 제거하면 실패해야 한다 — 이게 이 기능 전체에서 가장 중요한 반증 테스트다. 이 경로가 뚫리면 기밀 오디오가 조용히 복원된다)*
- **`_parts/` 선삭제 타이밍**: 절단 후 `<id>_parts/`가 없고, 그 상태에서 `finalize`를 호출하면 422 "No audio chunks"다 (오디오 재구성 불가). *(반증: 삭제를 커밋 후로 옮기면 재구성 창이 열린다)*

### 프론트 (vitest)

- 확인 다이얼로그가 `confirmDialog`를 쓰고, 취소 시 API가 **호출되지 않는다**. *(반증: `window.confirm`을 쓰면 Tauri에서 깨진다 — 테스트로는 헬퍼 호출 여부로 확인)*
- 원격 `transcript_redacted` 수신 시 `remoteStructureRevision`이 증가하고 재조회가 1회 나간다 (3회 아님).
- 로컬 절단은 카운터를 건드리지 않는다.
- 비owner에게 버튼이 보이지 않는다.
- **오디오 재로드**: 버전 토큰이 바뀌면 `useAudioPlayer`가 오디오를 다시 받는다. *(반증: deps를 `[meetingId]`로 되돌리면 실패 — 이게 없으면 절단 후에도 기밀이 들어 있는 옛 오디오가 계속 재생된다)*

### 검증 게이트

- `cd backend && bundle exec rspec` 전체 통과 (착수 전 기준선 2158 examples / 0 failures)
- `cd backend && bundle exec rubocop` — **"no offenses"가 기준이 아니다.** 저장소에 `Layout/SpaceInsideArrayLiteralBrackets` 사전 존재 offense가 538건 있다(`.rubocop.yml`에 이 cop을 끄는 블록이 **주석 처리**된 채 남아 있다 — 저장소 스타일과 omakase 기본값의 불일치). 기준은 **총계 538 불변**이다.
- `cd frontend && npx tsc -p tsconfig.app.json` 에러 0 *(bare `tsc`는 루트 `files: []`라 거짓 green — `reference_frontend_real_typecheck`)*
- `cd frontend && npx vitest run` 전체 통과 (사전 존재 uncaught exception 2건 제외: `AiChatPanel.test.tsx`, `MeetingLivePage.test.tsx`)

## 하지 않는 것 (YAGNI)

- 되돌리기(undo). 파괴적 파기가 목적이다.
- `redacted_ranges` 테이블 / 구간 필터 인프라 (부록 확정)
- "이 구간 삭제됨" UI 표시 · 감사 로그 (별개 이유로 필요해지면 그때)
- 자동 재요약 트리거
- 오디오만 절단 / 전사만 삭제 분리 모드
- 챗 히스토리 삭제 (위 결정)
- 백엔드 기존 4곳의 마커 정규식 통일 (후속)
- 데스크톱 로컬 원음 원격 파기
- `finalize`에 `completed?` 거부 가드 추가 (후속 — 정상 녹음 순서를 깰 위험이 있어 별도 확인 필요, V6-b)
- `SttChunkStorage` 스위퍼를 회의 완료 이벤트에 연동 (후속 — 절단과 무관하게 원시 PCM이 6시간 남는 일반 문제, V1)

## 개발 환경 제약

- **dev 서버가 떠 있다.** 마이그레이션이 필요하면 `db/migrate`에 파일을 두는 순간 러닝 Rails dev의 모든 요청이 500이 된다 (`PendingMigrationError`). 이 설계는 스키마 변경이 **불필요**하므로 해당 없음 — 구현 중 스키마 변경이 필요해지면 먼저 보고할 것.
- 러닝 dev 서버에 실제 절단 요청을 **날리지 않는다**. 파괴적이고 되돌릴 수 없다. 검증은 spec으로만.
- 명시 요청 없이 커밋·푸시하지 않는다.
