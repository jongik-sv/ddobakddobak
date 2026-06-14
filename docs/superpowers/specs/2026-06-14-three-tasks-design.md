# 설계·선택 근거 — 3개 과제 (2026-06-14)

브랜치 `feat/prev-meeting-reference`. 핸드오프: `docs/superpowers/2026-06-14-next-steps-handoff.md`.
조사는 read-only 서브에이전트 워크플로 2회로 수행(맵 3개 + Task2 근본원인). 본 문서는 **확정 설계 + 선택지·근거**.

커밋은 사용자 명시 요청 시에만. 검증 = backend `rspec`, sidecar `pytest`, frontend `vitest`+`vite build`.

---

## TASK 1 — STT 재실행 진행율 폴링

### 문제
`/transcribe-file` 은 동기 단일 HTTP. 진행율이 5→70→80→95→100 으로 점프(잡 단계 전환만 반영, STT 내부 진행 미표시).

### 확정 설계 (폴링)
**Sidecar** (`sidecar/app/routers/stt.py`)
- 모듈 레지스트리 `_FILE_PROGRESS: dict[int, dict]` (`{meeting_id: {"processed_ms", "total_ms"}}`) + `threading.Lock`.
- `transcribe_file` 엔드포인트: `total_duration_ms` 계산 직후 `meeting_id` 있으면 `{processed:0, total:total_duration_ms}` 등록. `try/finally` 로 종료 시 pop(정리).
- `_chunked_transcribe(..., meeting_id=None)` 인자 추가, 호출부(stt.py:138) 전달. 청크 루프에서 매 청크 처리 후 `processed_ms = int(end / bytes_per_sec * 1000)` 갱신.
- 신규 `GET /transcribe-file/progress/{meeting_id}` → 등록돼 있으면 `{processed_ms, total_ms}`, 없으면 `{}`(200).

**Rails**
- `SidecarClient#get_transcribe_progress(meeting_id)`: GET, 짧은 timeout(`PROGRESS_TIMEOUT=3`), `rescue→nil`(폴링 실패가 잡을 죽이지 않음).
- `FileTranscriptionJob`: `transcribe_file`(블로킹) 직전 폴러 `Thread` 기동.
  - 2초 간격, `get_transcribe_progress` → `total>0` 이면 `pct = (5 + processed.to_f/total*85).round.clamp(5,90)` → `broadcast_progress(pct, "음성 인식 중… N초/M초")`.
  - 본 잡이 `transcribe_file` 반환 시 `@stop=true` + `thread.join` → 종료. `ensure` 로 항상 정리.
  - **스레드는 HTTP + ActionCable broadcast만**(ActiveRecord 미접근) → 스레드 안전.
- **진행율 표 재조정**(`file_transcription_job.rb`): ffmpeg `5`(was 10) / STT폴러 `5~90`(반환 시 90 스냅) / transcript저장 `93`(was 80) / 화자분리·회의록 `99`(was 95) / 완료 `100`. broadcast 지점: line 13, 32, 37, 41, 45.

### 범위
`FileTranscriptionJob`(upload_audio + regenerate_stt)만. `ReDiarizeJob`·실시간·오프라인 제외.

### 검증된 전제 (구현 위험 해소)
- 모든 STT 어댑터가 `await loop.run_in_executor(None, self._infer, ...)` 로 컴퓨트 수행(`faster_whisper_adapter.py:82`, `qwen3_*`, `mlx_whisper_beam`) → STT 추론 중 **이벤트 루프 자유** → 동시 `GET /progress` 정상 처리. 폴링 설계 유효.
- `meeting_id` 는 `TranscribeFileRequest`(schemas.py)에 이미 존재, 잡에서 전달 중.

### 선택지·근거
- **폴링 vs sidecar→Rails push**: 폴링 채택. push는 신규 인증·콜백 URL 필요(핸드오프도 비추). 폴링은 기존 Rails→sidecar 방향 유지, 실패해도 graceful.
- **레지스트리 위치**: 인메모리 프로세스-로컬. sidecar 단일 프로세스(uvicorn 1 worker) 확인 → Redis/DB 불필요. `meeting_id` 키.
- **폴링 간격 2초**: fallback refetch(10초)보다 촘촘, 부하 무시할 수준(가벼운 GET).
- **비청크 경로**(`file_chunk_sec<=0`)는 청크 갱신 없음 → 폴러가 5%에서 대기하다 90 스냅. 파일 경로는 항상 `AUDIO_FILE_CHUNK_SEC=30(>0)` 전달이라 실질 무영향. 등록 시 `total` 즉시 세팅하므로 "N초/M초" 의 M은 표시됨.

---

## TASK 2 — "오타 수정 적용" 버튼이 다 적용 안 됨

### 근본원인 (코드 확정)
`MeetingsController#feedback`(meetings_controller.rb:333-370)이 교정하는 곳:
- **active** summary `notes_markdown` (1개 행만)
- `transcripts.content` (전체)
- `meeting.brief_summary`(재계산)

**누락**(= 증상):
- summary 구조화 필드 `key_points` / `decisions` / `discussion_details` (TEXT에 JSON 저장, **요약 탭**·익스포트·FTS 노출)
- **비활성** summary 행의 `notes_markdown`(realtime/final 공존 시)
- `action_items.content` 레코드(별도 모델)
- `decisions.content` 레코드(별도 모델)
- (프론트) `handleApplyCorrections` 가 `refetch()` 안 함 → 요약 탭 stale

### 회의 109 재현 결과 (정직 보고)
DB 직접 조회: 회의 109는 `분목별`=0, `품목별`=14 (transcripts 12 / notes_markdown 1 / action_items 1). **현재는 깨끗** — 109는 구조화 필드가 비어 있어(0/0/0) 누락 경로를 안 건드림. 즉 109 단독으론 재현 안 됨. 하지만 위 누락은 **구조화 요약/액션아이템을 가진 회의**에서 그대로 "다 안 됨"으로 나타남. → 합성 회의로 TDD 재현 후 수정.

### 확정 설계
`feedback` 를 **회의의 모든 텍스트 표면**에 교정 적용:
1. `@meeting.summaries.find_each` — 각 summary 의 `notes_markdown, key_points, decisions, discussion_details` gsub(변경분만 `update!`, `generated_at` 갱신 → FTS 자동 재인덱스).
2. `@meeting.action_items.find_each` — `content` gsub.
3. `@meeting.decisions.find_each` — `content` gsub.
4. `@meeting.transcripts.find_each` — `content` gsub (기존).
5. `@meeting.blocks.find_each` — `content` gsub(블록 에디터 본문).
6. active notes 변경 시에만 `refresh_brief_summary!` + `meeting_notes_update` broadcast.

**프론트** `handleApplyCorrections`: 성공 후 `refetch()` 호출 → 요약 탭(구조화) 갱신.

### 선택지·근거
- **JSON 컬럼 gsub(raw) vs parse→치환→재직렬화**: raw gsub 채택. 교정어는 평문 한글(JSON 메타문자 없음) → 구조 보존·단순·안전. (메타문자 포함 입력은 현재 범위 밖, 문서화.)
- **`meeting.memo` 제외**: 사용자 본인 메모는 원문 보존 원칙([[project_memo_design]]). 자동 교정 안 함.
- **모든 summary 행 교정**(active만 X): 요약/익스포트/검색이 비활성 행도 노출 가능 → 일관성.
- **blocks 포함**: 블록 본문도 회의 텍스트. content 평문 → 안전. 미사용 회의엔 무영향.
- **gsub 전역**: 루비 `gsub` 는 기본 전역치환. "일부만" 버그는 대상 레코드 누락이지 gsub 자체 아님(확인).

---

## TASK 3 — 북마크 기본 라벨 = 트랜스크립트 내용 (재생 페이지만)

### 확정 설계
- 순수 헬퍼 `computeBookmarkLabel(transcripts, ts)` 신규(`frontend/src/lib/bookmarkLabel.ts`):
  - 덮는 transcript: `t.started_at_ms <= ts < t.ended_at_ms`.
  - 없으면(공백/무음) **시간상 가장 가까운** transcript(앞/뒤 무관, 구간까지 거리 최소).
  - 그래도 없으면(0개) `''`.
  - `content.trim()` → 40자 초과면 `slice(0,40)+'…'`. 화자 미포함.
- `MeetingPage.tsx handleOpenBookmark`(306): `setBookmarkLabel('')` → `setBookmarkLabel(computeBookmarkLabel(transcripts, currentTimeMs))`.
- `BookmarkPopover`: 신규 prop 불필요(label/onLabelChange controlled). 사용자 편집 가능.
- 백엔드 무변경(label optional). 라이브 페이지(MeetingLivePage) **제외**(사용자 결정).

### 선택지·근거 (사용자 확정)
- 형식 = **내용 앞 40자**(화자 미포함).
- 공백 시 = **가장 가까운 transcript**.
- 라이브 페이지 = **미적용**(범위 최소).

### 검증
vitest 단위테스트(cover / gap-nearest / 40자 truncate / 빈 배열) + `vite build`.
