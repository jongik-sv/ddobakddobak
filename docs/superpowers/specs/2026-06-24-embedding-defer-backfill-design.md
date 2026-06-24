# 임베딩 지연·배치 백필 (라이브 녹음 DB락 끊김 수정)

**날짜**: 2026-06-24
**브랜치**: `feat/embedding-defer-backfill` (main 독립 분기)
**범위**: 100% 백엔드 (Rails, `backend/`). 프론트 무변경.
**기준선**: rspec 1347 green.

## 문제

라이브 녹음이 "DB락 모드"로 반복 끊김. 진단(2026-06-23, `backend/log/development.log`):

- 라이브 중 전사가 초당 쏟아짐 → 각 전사 `after_commit`이 `EmbedTranscriptJob`을 인라인 발사.
- 임베딩 INSERT(BLOB)가 실시간 전사 INSERT·녹음 하트비트 `update_column`과 **단일 SQLite writer 락**을 경합.
- 락이 걸리면 `audio_chunk`(케이블 스레드의 동기 DB쓰기)가 `busy_timeout`(5s)까지 블록 → `RAILS_MAX_THREADS=3`이 다 잡힘 → ActionCable이 연결을 못 챙김 → 클라 핑 타임아웃 → 끊김 → 다음 broadcast가 `Broken pipe`.
- **핵심**: 락이 소켓을 직접 자르는 게 아니라, 느린 동기 쓰기가 연결 스레드를 굶긴다.

### 틀린 레버 (적용 금지)

- `busy_timeout` 상향 → 케이블 스레드 더 오래 블록 → 핑 타임아웃 그대로 → 악화.
- 스레드 증가 → SQLite writer 1명 고정 → 대기자만 늘어 경합 심화.
- WAL(이미 on) → reader-writer만 분리, **writer-writer 경합은 안 풂** → 이 문제 못 고침.

근본 원인은 동시성 튜닝이 아니라 **임베딩이 라이브 핫패스에서 인라인 계산되는 것**. 임베딩은 폴더/프로젝트 챗 의미검색용 파생 인덱스 — 녹음 핫패스에 있을 이유가 없다.

## 진단 검증 (grep 확정)

- `EmbedTranscriptJob` 호출 = `app/models/concerns/embeddable.rb:20` **단 1곳** → 콜백 배선만 끊으면 인라인 완전 차단.
- 전사 생성 3경로: 라이브(`transcription_job.rb:30`, status=`recording`), 파일STT(`file_transcription_job.rb:160`, `transcribing`), 임포트(`project_importer.rb:290`, status=`completed`).
- content 변경(AR `update`) 경로: 단건 수동편집(`transcripts_controller.rb:93`), glossary 재적용(`meeting_glossary_applier.rb:50`이 변경된 전사마다 `record.update!` 루프 → `:update` 콜백 버스트).
- re_diarize(`re_diarize_job.rb:44`)는 `speaker_label`/`speaker_name`만 바꾸고 `content` 불변 → 임베딩 유효, 백필 불필요.

## 설계: 통합 임베딩 라이프사이클 (derived-index 모델)

**원칙**: 임베딩은 전사 `content`에서 파생된 검색 인덱스다. **행 콜백은 절대 인라인으로 임베딩을 계산하지 않는다.** 계산은 오직 `EmbedBackfillJob`이 "content 확정" 경계에서 **배치로** 수행한다. 행 콜백은 *무효화(invalidate)* 만 한다.

규칙 하나로 모든 버스트(라이브·파일STT·임포트의 create, glossary의 update)가 사라진다. 상태게이트·thread-local·import 특수처리 불필요. *"쓰면 무효화, 계산은 배치."*

### 1. `app/models/concerns/embeddable.rb` — 인라인 계산 제거

- 삭제: `after_commit :enqueue_embedding, on: [:create, :update]` (→ `EmbedTranscriptJob.perform_later` 발사).
- 신규: `after_update_commit :invalidate_embedding, if: :saved_change_to_embeddable_content?`
  - `invalidate_embedding` = 그 행의 stale 임베딩을 **삭제**(`TranscriptEmbedding.where(transcript_id: id).delete_all` — Transcript 측 hook로 위임; 로컬 write만, sidecar 호출 0).
  - create는 인라인 무동작 — 백필이 settle 경계에서 흡수.
- 무효화 대상 컬럼 감지는 concern이 generic하게: `embeddable_content_column`(이미 정의됨) 기준 `saved_change_to_attribute?`.
- **content 외 컬럼 update(speaker_label 등)는 무효화하지 않는다** — 임베딩은 content만 의존.

### 2. `app/jobs/embed_backfill_job.rb` — 회의 스코핑 + 활성 회의 제외

- `perform(batch_size: 64, meeting_id: nil)`.
- `pending_transcript_ids`에 `meeting_id` 옵션 추가: 주어지면 `Transcript.where(meeting_id: meeting_id)`로 스코핑한 뒤 동일 diff(현버전 임베딩 없는 전사) 적용.
- diff = 현버전 임베딩 없는 전사 → **신규 create + 무효화로 삭제된 행** 둘 다 자동 흡수. idempotent 유지.
- 글로벌(meeting_id nil) 동작은 그대로 — rake/recurring 안전망용.
- **활성 회의 제외(라이브 핫패스 보호, 필수)**: `pending_transcript_ids`는 `recording`/`transcribing` 상태 회의의 전사를 **항상 제외**한다. 전역(주기/수동) 백필이 진행 중인 녹음·전사 회의를 흡수하면, 이 변경이 제거하려던 writer-lock 경합을 그대로 재유발하기 때문. 종료 경계의 `meeting_id` 스코핑 호출은 회의가 이미 completed 라 무영향. 활성 회의 전사는 종료 후 reconcile/다음 백필이 흡수. (잡 레벨에서 강제 → recurring/rake 호출처 실수에도 견고.)

### 3. `app/models/meeting.rb` — `reconcile_embeddings!`

```ruby
# 이 회의의 전사 content가 확정된 시점에 임베딩을 일관되게 맞춘다(배치).
# 라이브/파일STT/임포트 핫패스에서 인라인 임베딩을 제거했으므로, 확정 경계에서 이 메서드로 흡수한다.
def reconcile_embeddings!
  EmbedBackfillJob.perform_later(meeting_id: id)
end
```

호출 경계 (content 확정):

| 경계 | 위치 | 비고 |
|------|------|------|
| 라이브 stop | `meetings_controller.rb` stop, `transcripts.exists?` 하 | `!skip_summary`와 **무관** — 검색용이라 요약 스킵해도 임베딩 |
| heal_stale_recording! | `meeting.rb`, `transcripts.exists?` 하 (이미 finalizer 거는 자리) | 비정상 종료 자가복구 |
| 파일 STT 완료 | `file_transcription_job.rb`, `update!(status: :completed)` 후 | 신규 업로드 + 재STT(regenerate_stt) 공통 |
| 임포트 완료 | `project_importer.rb`, 회의별 children 적재 후 | create 버스트 자연 해소 |
| glossary 재적용 | reapply_glossary / feedback apply 경로 | 무효화된 행 재계산 |
| 단건 수동편집 | `transcripts_controller.rb:93` update! 후 | 무효화된 1행 재계산 |
| re_diarize | **생략** | content 불변 → 임베딩 유효. 1줄 주석으로 이유 명시 |

### 4. 안전망

- rake `embeddings:backfill`(글로벌) 유지 — dev `:async`는 종료잡이 재시작에 소실되므로 수동 1차.
- `config/recurring.yml`에 `EmbedBackfillJob` 주기 실행 추가 — prod `solid_queue` 전용(dev `:async` 무영향). 무효화됐는데 reconcile 못 탄 행/소실잡 흡수.

### 5. 곁다리

- 미임베딩 전사 58개(227=4, 228=11 포함) → 코드 머지 후 `rails embeddings:backfill` 1회.
- 회의 228이 16:08 completed됐다가 16:48까지 재유입된 정합성(전사 분리/중복) → **read-only 조사**(코드 변경과 분리, 별도 todo).

## 테스트 (TDD)

### 단위
- `embeddable`:
  - create → 임베딩 행 0, EmbedTranscriptJob 미발사.
  - content update → 기존 임베딩 행 삭제(무효화).
  - 비-content 컬럼 update(speaker_label) → 무효화 안 함.
- `EmbedBackfillJob`:
  - `meeting_id` 스코핑 → 그 회의 pending만 처리, 타 회의 불간섭.
  - 무효화(삭제)된 행 재생성.
  - 기존 스펙(글로벌 백필·idempotent·구버전 재처리) 그대로 green.
- `Meeting#reconcile_embeddings!` → `EmbedBackfillJob`을 `meeting_id`로 enqueue.

### 통합
- stop/heal/파일STT/import 후 해당 회의 전사 전부 임베딩됨.
- 라이브 녹음(recording) 중 전사 create 시 임베딩 0, EmbedTranscriptJob 미발사.
- glossary 재적용 후 변경 전사 임베딩 일관(무효화→재계산).

### 회귀
- 전체 rspec 1347 green 유지.

## 비범위 (YAGNI)

- 동시성 튜닝(busy_timeout/스레드/WAL) — 틀린 레버, 손대지 않음.
- 임베딩 모델/sidecar 변경 — 무관.
- content 변경 staleness를 hash 컬럼으로 추적 — 무효화(삭제)+백필로 충분, 스키마 변경 회피.
- 프론트엔드 — 무변경.
- feat/background-recording(별개 끊김 모드, 100% 프론트) — 직교, 건드리지 않음.
