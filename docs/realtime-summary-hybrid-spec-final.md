# 실시간 요약 하이브리드 — 최종 구현 계약 (Stateless, Rails-only)

> 확정 설계. D6(사이드카 폐기→stateless) 반영. 결정 근거=`realtime-summary-hybrid-decisions.md`.
> 기존 plan(`realtime-summary-hybrid-plan.md`)의 items/op/렌더 골격은 유효, 사이드카(§3·§4.1·§4.4a) 부분만 stateless로 대체.
> 핵심 불변식: **items(`meeting_minute_items`) = 유일 정본. LLM = DB상태의 순수함수 → ops. 세션 없음.**

---

## 0. 아키텍처 (1-스토어)

```
매분 cron(SummarizationJob, 기존) → MeetingSummarizationJob(realtime)
  op_mode?(meeting) && SUMMARY_OP_MODE_ENABLED:
    delta = transcripts(applied_to_minutes:false)
    manifest = MinuteItemsRenderer.manifest(meeting)        # active tip + superseded skeleton
    ops = LlmService.generate_ops(manifest, delta, sections_prompt)   # call_claude_cli, ops JSON
    ok==false → transient fallback(아래), transcript 미소비
    MinuteItemsMerger.apply(meeting, ops, batch_seq)         # 트랜잭션·체인무결성·item_key 발급·row lock
      키미스(update/supersede/remove 타겟 부재) → 그 meeting sticky 강등 + 이 틱 통짜
    notes_markdown = MinuteItemsRenderer.clean(meeting)      # items→markdown
    summaries(realtime).notes_markdown = notes_markdown      # 캐시 (트랜잭션 내)
    broadcast meeting_notes_update / transcripts_applied
  else (강등/플래그OFF/사이드없음):
    기존 refine_notes(Mode A 통짜) — 단 ok:false 시그널 추가
```

매 틱 DB 재그라운드(매니페스트 주입) = 사이드카 cold경로를 항상 수행하나 입력이라 쌈. warm/cold·generation·needs_anchor·세션 전부 불요.

---

## 1. DB (Phase 1)

### 마이그레이션 `create_meeting_minute_items`
```ruby
create_table :meeting_minute_items do |t|
  t.references :meeting, null: false, foreign_key: true
  t.string  :section,   null: false              # 자유라벨(sections_prompt 섹션명). 데이터=스키마 아님.
  t.string  :item_key,  null: false              # meeting내 유니크 영속키. Rails 발급. 세션 추측 금지.
  t.text    :text,      null: false              # 블록 markdown(표/mermaid 자유). op 입자=블록.
  t.string  :status,    null: false, default: "active"   # active|superseded|removed
  t.string  :superseded_by                       # 번복한 신규 item_key (supersede 체인)
  t.string  :supersede_reason                    # 시각/사유 라벨 (취소선 → 뒤 주석)
  t.integer :position,  null: false, default: 0  # 섹션내 순서. 권위=Rails.
  t.integer :last_op_seq, null: false, default: 0 # per-item stale 가드(GREATEST). batch_seq<=이값 → no-op.
  t.timestamps
end
add_index :meeting_minute_items, [:meeting_id, :item_key], unique: true   # 키권위·멱등 머지 DB방어선
add_index :meeting_minute_items, [:meeting_id, :section, :position]       # 렌더 정렬·position max 조회
add_index :meeting_minute_items, [:meeting_id, :status]
add_index :meeting_minute_items, :superseded_by

# meetings에 단일 강등 술어 추가
add_column :meetings, :minutes_op_fallback_at, :datetime   # nil=op가능, set=통짜강등(sticky)
```
> dev=sqlite. 추가만 해도 러닝 dev서버 PendingMigrationError(메모리 feedback_rails_pending_migration_trap) → Orchestrator가 적용·검증.

### `MeetingMinuteItem` 모델
- `belongs_to :meeting`
- `validates :section,:item_key,:text, presence: true`
- `validates :item_key, uniqueness: { scope: :meeting_id }`
- `validates :status, inclusion: { in: %w[active superseded removed] }`
- scope `active`, `renderable`(not removed), `ordered`(section, position)
- `active_chain_tip` — superseded_by 따라 최신 active까지 walk (D8 id-C2: stale 가드가 이 tip 기준).

### `Meeting` 편집
- `has_many :meeting_minute_items, dependent: :destroy`
- `op_mode?` = `minutes_op_fallback_at.nil?` (D8 useredit-C2 단일술어. last_user_edit_at 의존 제거). 전역 게이트 `SUMMARY_OP_MODE_ENABLED`는 job에서 AND.
- `current_notes_markdown` (D8 useredit-C1): **op_mode? && items 존재 → `MinuteItemsRenderer.clean(self)`. 아니면(강등/플래그off) 기존 summaries 폴백**(사용자편집 보존).
- `purge_transcription_content!`에 `meeting_minute_items.destroy_all` 추가.
- 신규 헬퍼 `enter_op_fallback!(reason)` = `update_column(:minutes_op_fallback_at, Time.current)` + 로그/metric. `clear_op_fallback!` = nil 리셋.

---

## 2. 렌더 `MinuteItemsRenderer` (Phase 1, app/services)

- `clean(meeting)` → 사람용 markdown(UI/brief/broadcast/summaries 캐시).
  - `renderable.ordered`, section 그룹, 섹션순서=`sections_prompt_for(meeting_type)` 선언순(파싱), 외래섹션 뒤 append.
  - active 블록 = `item.text` 그대로(표/mermaid 보존).
  - superseded 블록 = `render_supersede(old,new)`: 한 줄이면 `~~A~~ → B (시각)`, 멀티라인/표면 수직배치(`> ~~(번복됨)~~\n옛\n\n새`). new는 흡수→consumed 마킹(중복 렌더 skip).
  - **렌더 가드(D8 id-C1)**: `lookup(superseded_by)` nil/removed → 그 superseded item을 active처럼 렌더(반쪽 취소선/크래시 금지).
- `manifest(meeting)` → LLM 주입용 JSON. active = `{item_key,section,status,text,position}`. superseded = **스켈레톤**(`{item_key,section,status:superseded,superseded_by}`, text 생략/축약 — D8 anchor-H6 입력 bound). removed 제외.
- `reparse(markdown, meeting)` → markdown→items 재구성. **fence-aware**(``` 추적, 펜스내 빈줄 무시 — D8 id-H4). `## 헤더`=section, 블록=item, item_key 전량 재발급, status=active. **입력은 LLM 풀패스 신선출력만**(render_supersede 가공물 절대 금지). finalize/명시재생성에서만 호출.

---

## 3. 머지 `MinuteItemsMerger` (Phase 1, app/services)

`apply(meeting, ops, batch_seq)`:
```
Meeting.transaction:                               # D8 conc-H6
  m = Meeting.lock.find(meeting.id)                # FOR UPDATE — web/job TOCTOU 차단
  return :reset if m.status changed / minutes_op_fallback_at set / last_reset_at moved   # 재확인 후 abort
  tmp_map = {}                                      # 이번 틱 add handle→item_key (intra-batch 참조는 미지원=무시)
  for op in ops:
    case op.type
    add:       item_key=issue_key(m, op.section); INSERT(active, position=max+1 or hint, last_op_seq=batch_seq); tmp_map[op.handle]=item_key
    update:    tip=resolve_tip(op.item_key)         # D8 id-C2
               next if tip.nil?  → keymiss          # D8 id-C3
               next if batch_seq <= tip.last_op_seq  # stale (GREATEST 의미)
               tip.update(text, last_op_seq:batch_seq)   # removed→no-op
    supersede: tip=resolve_tip(op.item_key); next if nil → keymiss; next if stale(tip)
               new_key=issue_key; INSERT new active(text, position≈tip.position, last_op_seq:batch_seq)
               tip.update(status:superseded, superseded_by:new_key, supersede_reason:op.reason, last_op_seq:batch_seq)
    remove:    item=find(op.item_key); next if nil → keymiss
               relink: where(superseded_by:item.item_key).update_all(superseded_by: item.superseded_by)  # D8 id-C1 고아방지
               item.update(status:removed, last_op_seq:batch_seq)
  if keymiss(update/supersede/remove 타겟 부재):     # D8 id-C3
     m.enter_op_fallback!("keymiss"); raise Rollback → 이 틱 통짜로 (add 키미스는 정상 허용)
  applied transcript ids → update_all(applied_to_minutes:true)   # 단일 트랜잭션 (D8 conc-C1)
  summaries(realtime).notes_markdown = MinuteItemsRenderer.clean(m)   # 캐시
# 커밋 후에만 broadcast
```
- `issue_key(meeting, section)` = `SecureRandom.hex(6)` (ULID gem 부재 → opaque 12hex. section rename·동시성 견고, 사람가독 불요=section 별컬럼). meeting-유니크 인덱스가 충돌 방어(희박, 충돌 시 재발급).
- 상태전이(D8 id-C2 표): removed→update/supersede=no-op+로그. active→supersede만 체인. superseded→supersede=tip 리타겟. stale=tip.last_op_seq 기준.

---

## 4. LLM op 생성 `LlmService` (Phase 2)

- `generate_ops(manifest, delta_transcripts, sections_prompt:, meeting_type:)` → `{ ops:, batch_seq:, ok: }`.
  - system = OP_SYSTEM_PROMPT(역할="증분 회의록 편집기, 전문 재작성 금지, 변경분만 ops JSON" + op 4종 규약 + "item_key는 매니페스트 값만 타겟, add는 키 없이, 새 키 발급 금지" + sections_prompt).
  - user = manifest JSON + 델타 전사. `call_claude_cli`(기존, 군살제거 유지) 호출.
  - 출력 파싱(extract_json 재사용) → ops 배열. 파싱 실패/LLM 에러 → **`ok:false`**(D8 anchor-C1).
- `refine_notes` 수정: 내부 rescue 시 현재 `{notes_markdown:current_notes}` 무음반환 → **`{notes_markdown:current_notes, ok:false}`** 추가. 성공 시 `ok:true`. (호출부가 ok:false면 transcript 미소비.)

---

## 5. Job / Controller 분기 (Phase 2)

### `MeetingSummarizationJob#generate_minutes_realtime`
- `if meeting.op_mode? && ENV["SUMMARY_OP_MODE_ENABLED"]=="true"`: op 경로(§0). `generate_ops` ok:false → transient(미소비, 다음 틱 재시도, 강등 안 함). 키미스 → merger가 sticky 강등(다음 틱 통짜).
- else: 기존 refine_notes 통짜. **ok:false면 notes 저장·applied_to_minutes·broadcast 안 함**(D8 anchor-C1 무음손실 차단).
- batch_seq = delta max(sequence_number). 진행 truth=applied_to_minutes(단일, D8 conc-C1).

### `generate_minutes_final`
- 기존 통짜 풀패스 유지(정본). 성공 시 `reparse`로 items 재구성(키 재발급, fence-aware) + `clear_op_fallback!`. **풀패스가 fallback(refine_notes)로 떨어져도 동일하게 reparse+clear**(D8 anchor-M9). final은 prod=limits_concurrency가 defer(드랍 아님), dev=realtime self-skip(completed?)로 보호 — MEETING_LOCKS blocking 안 함(D8 conc-M8).

### `meetings_controller`
- reset_content / regenerate_stt / regenerate_notes: 전부 `meeting_minute_items.destroy_all` + `minutes_op_fallback_at=nil`(D8 anchor-L11/useredit-L6 중앙화 — purge_transcription_content!에 items.destroy_all 넣고, regenerate_notes는 그걸 호출 안 하므로 명시 추가).
- update_notes / feedback: `last_user_edit_at` 세팅과 함께 `enter_op_fallback!("user_edit")` (D8 useredit-C2 sticky). reopen: 강등 해제 불필요(finalize가 clear). active_summary 정합(D8 useredit-M5) — op_mode면 최신 우선.

### `SummarizationJob`(cron)
- 변경 최소. (herd jitter는 stateless라 thundering 위험 작음 — 선택. 매분 유지.)

---

## 6. 검증 (Phase 1 유닛 — 실 LLM 없이 mock)

- merger 번복: add→supersede → old superseded+superseded_by, new active. 렌더 `~~A~~ → B`. 둘 다 active 아님.
- merger 체인무결성(id-C1): A→B→C 후 B(중간) remove → A.superseded_by=C(re-link), 렌더 고아 없음.
- merger stale(id-C2): tip last_op_seq 기준 폐기. 옛 superseded item 명명한 stale op이 tip 못 덮음.
- merger 키미스(id-C3): 없는 item_key supersede → 미적용 + 강등. add 키미스 정상.
- merger 멱등(conc-C1): 동일 batch_seq 재적용 → items 변화 0.
- merger row lock(conc-H6): reset과 동시 → 트랜잭션 abort(부분적용 0).
- renderer fence-aware reparse(id-H4): mermaid/표 내부 빈줄 1블록 유지. render_supersede 가공물 reparse 안 함.
- renderer 매니페스트 prune: superseded 스켈레톤.
- meeting op_mode/current_notes: 강등 시 summaries 권위(useredit-C1).
- refine_notes ok:false(anchor-C1): 내부실패 → transcript 미소비.
- 역호환: items 없는 기존 회의 summaries 폴백 렌더 정상. reset/regenerate가 items purge.

## 7. Phase 2 라이브 검증 (이 세션 범위 밖 — 기기/실회의 E2E 필요, flag-OFF 기본)
- `SUMMARY_OP_MODE_ENABLED=true` + 실회의 → op 생성 품질, 속도(출력 작아 빨라지는지), 번복 시나리오 실측.
- 사용자 승인·검증 후 활성. 미검증 상태로 "라이브 작동" 단언 금지.
