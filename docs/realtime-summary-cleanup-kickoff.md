# 킥오프 — 델타(op) 폐기 수술 + 압축율 선택 기능

> 컨텍스트 클리어 후 새 세션에 아래 붙여넣기. (2026-06-11 결정: 델타 실측 이득 미미 → 폐기, 출력 압축율 선택이 주 레버)

---

델타(op) 작업 폐기 수술 시작한다. 브랜치 `feat/realtime-summary-hybrid`, 전부 미커밋 작업트리.

**사용자 결정**: 델타(op) 경로 실측 결과 이득 미미(틱 23~70s, 출력 871~1582자 — 구독 CLI haiku 33tok/s에선 델타도 느림). **델타 전부 버리고, 델타 무관 실버그 수정 3건만 유지.** 그 후 새 기능 = 요약 출력 압축율 사용자 선택.

## 1단계: 마이그레이션 롤백 (코드 삭제 전에 먼저!)
```bash
cd backend && bundle exec rails db:migrate:down VERSION=20260611000001 && RAILS_ENV=test bundle exec rails db:migrate:down VERSION=20260611000001
```
(meeting_minute_items 테이블 + meetings.minutes_op_fallback_at 컬럼 제거. schema.rb 자동 갱신 확인.)

## 2단계: 삭제 (델타 전용 파일)
- `backend/db/migrate/20260611000001_create_meeting_minute_items.rb`
- `backend/app/models/meeting_minute_item.rb`
- `backend/app/services/minute_items_renderer.rb`
- `backend/app/services/minute_items_merger.rb`
- `backend/spec/models/meeting_minute_item_spec.rb` ← 안의 **Meeting#active_summary 테스트 2개(completed final-우선/recording 최신-우선)는 삭제 전에 `spec/models/meeting_summary_spec.rb`(신규)로 이전** (유지 버그수정 ③의 테스트)
- `backend/spec/services/minute_items_renderer_spec.rb`, `minute_items_merger_spec.rb`, `backend/spec/factories/meeting_minute_items.rb`

## 3단계: 부분 원복 (델타 부분만 걷어내고 버그수정은 유지)

### `backend/app/services/llm_prompts.rb`
- `OP_SYSTEM_PROMPT` 블록 삭제.

### `backend/app/services/llm_service.rb`
- `generate_ops` 메서드 삭제.
- **유지**: `refine_notes`의 `"ok" => true/false` 플래그(버그수정①, rescue 시 ok:false 반환).

### `backend/app/jobs/meeting_summarization_job.rb`
- 삭제: `op_mode_enabled?`, `generate_minutes_realtime_op`, realtime의 op/whole 분기 디스패치(→ `generate_minutes_realtime_whole` 내용을 `generate_minutes_realtime` 단일 메서드로 환원), final의 `SUMMARY_OP_MODE_ENABLED` reparse+clear_op_fallback 블록.
- **유지(버그수정①)**: whole 경로 `if result["ok"] && notes_markdown.present?` 가드 + `elsif !result["ok"]` 미소비 로그, final의 `unless result["ok"] ... return` 가드.
- **유지(버그수정②)**: perform의 final lock-busy 30초 재enqueue 분기.

### `backend/app/models/meeting.rb`
- 삭제: `has_many :meeting_minute_items`, `op_mode?`, `enter_op_fallback!`, `clear_op_fallback!`, `current_notes_markdown`의 items 게이팅(→ 원래 `active_summary&.notes_markdown.to_s` 단일 환원), `purge_transcription_content!`의 `meeting_minute_items.destroy_all`.
- **유지(버그수정③)**: `active_summary` — completed?일 때만 final 하드 우선, 아니면 `order(generated_at: :desc, id: :desc)` 최신(reopen stale 방지).

### `backend/app/controllers/api/v1/meetings_controller.rb`
- 삭제 5곳: reset_content의 `minutes_op_fallback_at: nil`, regenerate_stt의 `minutes_op_fallback_at: nil`, regenerate_notes의 `meeting_minute_items.destroy_all`+`update!(minutes_op_fallback_at: nil)`, feedback·update_notes의 `enter_op_fallback!("user_edit")`.

### `backend/spec/jobs/meeting_summarization_job_spec.rb`
- 삭제: op 경로 describe 3블록(realtime op path / op 통짜→op 시드 / final reparse+clear 테스트).
- **유지**: flag OFF 통짜 2테스트(ok:false 미소비 포함), final ok:false 미소비 테스트, final lock contention 2테스트.

### `backend/spec/services/llm_service_op_spec.rb`
- `#generate_ops` describe 삭제, `#refine_notes ok flag` describe만 남기고 파일명 `llm_service_spec.rb`로 변경(또는 그대로 두고 generate_ops 부분만 삭제).

## 4단계: 검증
```bash
cd backend && bundle exec rspec   # 기대: 전부 green (기존 무관 stale 1건 default_user_lookup_spec 제외)
git diff --stat                    # 남은 변경 = 버그수정 3건 + 그 테스트만인지 확인
```
- 백엔드 재시작(tmux ddobak:0): `SERVER_MODE=true bin/rails server -p 13323 -b 0.0.0.0` (플래그 불필요 — op 코드 없음).

## 5단계(별도 지시 후): 압축율 선택 기능 — 설계 확정본
- `users.summary_verbosity` string default "standard", 값 concise|standard|detailed. 권위=meeting.creator.
- 프롬프트 분량지시 주입: concise="각 항목 1문장, 표 최소, 분량 표준의 1/3" / detailed="맥락·근거 충실, 표 적극". `LlmPrompts::VERBOSITY_INSTRUCTIONS` → `refine_notes`(+ file_transcription_job 경유 호출 포함) system에 append.
- 설정 API: 기존 user 설정 컨트롤러(api/v1/user/llm_settings_controller.rb 또는 언어설정 패턴) 확장. 프론트: `frontend/src/components/settings/UserLanguageSettings.tsx` 선례로 3옵션 select("간결(빠름)/표준/상세"), SettingsContent 등록. Tailwind 함정: 시맨틱 토큰 무효 — 주변 명시색 따라할 것.
- 마이그레이션 함정: dev 서버 가동 중 파일 추가→전요청 500. 생성 즉시 migrate.

## 제약
- 커밋·푸시 금지(명시요청만). 문서(docs/realtime-summary-hybrid-*.md)와 tasks/ 로그는 기록으로 보존 — 삭제 금지.
- 참고 문서: `docs/realtime-summary-hybrid-decisions.md`(D0~D11 + 폐기 결정), `tasks/realtime-summary-hybrid/log.md`.
