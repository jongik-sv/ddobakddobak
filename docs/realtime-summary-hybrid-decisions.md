# 실시간 요약 하이브리드 — 자율 결정 로그

> 사용자 자리비움(2026-06-11). "추가 결정은 합리적·시스템최적으로 스스로 판단, 근거 문서화, 끝까지 작업"
> 지시에 따라 Orchestrator(나)가 내린 결정과 근거를 여기 누적 기록. 사용자가 복귀 시 검토용.

작업 브랜치: `feat/realtime-summary-hybrid`
진행 방식: 멀티에이전트 Workflow(ultracode). 설계=fable / 구현=sonnet / 리뷰=fable·opus.
설계 확정본: `docs/realtime-summary-hybrid-plan.md` (결정 7건).

---

## D0. 운영 정책 결정 (사용자 자리비움 대응)

- **승인 게이트 위임**: 원래 "워커 diff → Orchestrator 적용 → 사용자 승인" 흐름에서 사용자 승인 단계를 내가 대행.
  Workflow 에이전트는 **파일 직접쓰기 금지**(CLAUDE.md 워커정책 유지) → 코드/diff를 구조화 출력으로 반환 → 내가 `feat/realtime-summary-hybrid` 작업트리에 적용 → git diff + 테스트로 검증.
- **커밋 보류**: `feedback_no_auto_commit`(명시요청 없이 커밋/푸시 금지)은 standing instruction. "끝까지 작업해"는 구현 완료를 뜻하지 커밋 명령 아님으로 해석.
  → 작업트리 적용·검증까지 수행, **커밋은 하지 않음**. 작업은 격리 브랜치에 있어 안전. 복귀 후 사용자가 검토·커밋.
- **백엔드 재기동 필요 시 `SERVER_MODE=true`** (project_hybrid_auth).

---

## D1. `meeting_minute_items` = 신규 테이블 (기존 `blocks`/`decisions`/`action_items` 재사용 안 함)

**결정**: 회의록 op-타겟 저장소 `meeting_minute_items`를 **새 테이블로 신설**. 기존 3개 테이블 어느 것도 확장/재사용하지 않음.

**근거** (각 기존 테이블 스키마 실측):
- `blocks` (block_type=text/heading/bullet/checkbox/quote/divider, parent_block_id, position float):
  노션식 **사용자 편집 에디터 프리미티브**. 섹션 라벨 없음, markdown 블록 단위 아님(에디터 원자단위). AI op로 사용자 편집블록을 건드리면 사용자편집/AI 머지 충돌 정책과 정면 엉킴.
- `decisions` (ai_generated, content, status, decided_at, participants):
  **결정사항만** 담는 좁은 추출 리스트. section 없음, markdown 블록(표/mermaid) 못 담음, item_key/superseded_by 체인 없음.
- `action_items` (assignee_id, due_date, status):
  **액션아이템만**. 동일하게 너무 좁음.

plan §4.3가 요구하는 것 = 섹션-제네릭(자유 라벨), text=블록 markdown(표/mermaid/중첩 그대로), op-타겟(안정 item_key + supersede 체인). 셋 다 이를 제공 못 함 → 신규 테이블이 정답.

**부수 결정**: 기존 `decisions`/`action_items`/`blocks`는 **건드리지 않음**(additive). 이들을 쓰는 기존 경로 보존. 설계/리뷰 phase에서 충돌 없음 재확인.

---

## D2. 항목 식별자(item identity) — 안정키 (advisor 지적 핵심 구멍)

**문제**: plan이 내부 모순. §4.2 op는 `id`("d-1")로 타겟, §4.3 머지는 `(section, item_key)`로 타겟.
불변식("세션=휘발, DB=정본, 축출 후 앵커재주입으로 복구")은 **`add`에서만** 성립. `update`/`supersede`/`remove`는
**DB에서 재구성 가능하고 새로 재주입된 세션에 보이는 안정 식별자**를 요구. id가 세션-휘발("d-1")이면 30분 축출 후 새 세션은 옛 세션이 만든 항목을 타겟 못 함 → supersede 조용히 깨짐.

**결정(설계 phase 1순위 산출물로 지정)**: op는 **DB에 영속하는 안정 `item_key`로 타겟**. items→markdown 앵커 렌더가 **블록마다 그 key를 임베드**(세션이 재주입 시 키를 보고 타겟). 세부 계약(키 생성/안정성 규칙, 렌더 임베드 방식)은 설계 에이전트가 확정, 적대적 리뷰 1순위 타겟.

---

## D3. 모델 배정 변경 — fable는 Workflow에서 사용 불가

**문제**: Workflow 1에서 `model:'fable'` 에이전트 3개 전부 동일 API 에러로 실패:
`400 tools.7.model: 'claude-opus-4-8' cannot be used as an advisor when the request model is 'claude-fable-5'`.
Workflow 서브에이전트에 advisor 툴(opus 백킹)이 자동 부착되는데, 요청모델이 fable이면 opus advisor를 거부. 스크립트에서 advisor 툴 비활성 불가.

**결정**: kickoff의 "설계=fable / 리뷰=fable·opus"에서 **fable→opus 대체**. 구현=sonnet 유지.
**근거**: opus·sonnet은 정상 작동. ultracode(비용 무제약·정확성 우선)이므로 더 강한 모델로 상향이 손해 없음. 모델 분리는 사용자 선호였고 하네스 제약이 우선. (시스템 최적 = 작동하는 최고 모델.)

## D4. 검증된 사실 (리뷰어 주장 → 코드 실측 확인)

- **실시간 트리거 = 매분(`every minute`)**, dev·prod 둘 다(`config/recurring.yml`). job 주석의 "5분 cron"은 stale 오류. → 델타 재생/크래시 herd 창 = **1분**. (replay·thundering-herd 분석 유효.)
- **`MeetingFinalizerService`**(app/services/) = stop 시 `MeetingFinalizerJob`이 호출, 독립적으로 `summarize_action_items`+`summarize`(stateless LLM) → `action_items`·`decisions` 테이블 기록. stop()은 `MeetingFinalizerJob` + `MeetingSummarizationJob(final)` **2잡 동시 발사**. 둘은 meeting별 동시성 키 공유 안 함.
- `summarize` 액션: completed?→final else realtime. `regenerate_notes`→final. `reset_content`→pending.

## D5. 설계 리뷰(opus 2렌즈)에서 확정한 핵심 수정 (corrected design로 반영)

opus 적대 리뷰가 plan의 구멍 12개를 잡음. 아래를 corrected design의 hard requirement로 박는다:

**identity/번복**:
1. **item_key 권위 = Rails(머지=정본)**. 세션은 add 시 키 제안만, Rails가 meeting-유니크 item_key 발급(`<section_slug>-<counter>` 또는 ULID) → 매니페스트로 세션 회신. op의 세션 `id`는 op 트랜잭션 내 임시 핸들로만, 영속 키와 분리.
2. **재앵커 = 머신리더블 매니페스트** `[{item_key, section, status, text, position}]` JSON 주입(+"이 키 그대로 재사용해 후속 op 발행" 규약). 깨끗한 markdown 단독 주입은 키 소실로 supersede 불능 → 폐기. summaries.notes_markdown용 클린 렌더와 앵커용 매니페스트 렌더 **둘 다 items에서 파생**(소스 1, 소비자 2).
3. **키-미스 정책**: supersede/update/remove 타겟 키가 없으면 → 로그+메트릭, **add 자동승격 금지**, 그 meeting **즉시 통짜 fallback 강등**(실시간 모순 노출 차단). add만 키-미스 허용.
4. **상태전이 멱등**: removed→update/supersede=no-op(거부+로그), active→superseded만 superseded_by 설정, superseded→supersede=체인 끝(최신 active) 리타겟. op에 단조 seq(델타 max sequence_number 차용) → 머지가 stale op 멱등 폐기.
5. **position 권위=Rails**, 매니페스트에 position 포함, 세션은 상대지시만.

**concurrency/격리**:
6. **델타 멱등성**: 델타가 idempotency 키(배치 max sequence_number) 운반, 사이드카가 meeting별 last-applied 기록 → 재전송=no-op(빈/캐시 ops 반환). Rails는 **items 머지 + applied_to_minutes=true를 단일 트랜잭션**으로 커밋. consume된 델타를 post-guard가 무음 드랍 금지.
7. **세션 단일 잡클래스**: 사이드카 세션은 `MeetingSummarizationJob`만 건드림. `MeetingFinalizerService`는 stateless 유지(세션 라우팅 금지). DELETE/finalize는 in-flight 델타 있으면 reject/drain.
8. **finalize 비드랍**: final 잡은 try_lock→drop 아니라 획득까지 retry/blocking(또는 stop 시 pending realtime 취소).
9. **사이드카 세션맵 레이스**: get-or-create는 **생성 Promise를 맵에 저장**(원자적), in-flight refcount, eviction/DELETE는 refcount>0이면 reap 거부, lastActiveAt는 요청 **시작 시** 갱신.
10. **admission control**: 세션 생성(cold-start/앵커주입) 세마포어 K개 동시제한, 나머지 503→Rails backoff 재시도. cron herd jitter/배치. 사이드카 health 게이트.
11. **finalize fencing**: stop 시 meetingId 'finalizing' 마킹 → 이후/in-flight 델타 409 거부 → drain → DB items 클린 리드에서 풀패스 → 세션 파기.
12. **교차오염 차단**: 세션키 `String(meetingId)` 정규화, blank/unknown 거부(default 세션 없음), meeting당 세션객체 1개(프롬프트 스왑 공유 금지). 격리 테스트.

## D6. 【중대 결정 — fixed #3 재오픈】 사이드카 폐기, Stateless manifest-per-tick 채택

> 사용자 위임("추가 결정은 합리적·시스템최적으로 스스로, 근거 문서화")에 근거한 결정.
> **확정 결정 #3(Node 사이드카+세션맵)을 뒤집음.** 가역(flag-OFF + 격리 브랜치) — 사용자 반대 시 사이드카로 복귀 가능.

**판단 근거**:
1. **리뷰 발산**: WF1b가 12수정을 반영했는데 4렌즈 재공격이 ~30개 신규 결함(다수 breaks_invariant) 적출. 패치할수록 줄지 않고 새 구멍이 더 빨리 생성 = 아키텍처 자체 문제 신호.
2. **단일 root**: ~30개 중 ~20개가 동일 원인 = **2-스토어(휘발 LLM 세션 + 트랜잭션 DB)를 at-least-once 매분 cron 경계에서 동기화**. 중복add-on-rollback, refcount liveness, 세션맵 레이스, admission/herd, 축출, finalize 펜싱/draining, generation echo, needs_anchor — 전부 이 한 원인의 증상.
3. **싼 축 최적화 오류**: 내 측정(project_summary_llm_perf, plan §1) = **병목은 출력 생성**(시간 ∝ 출력토큰, 부팅/입력은 수초). 영속 세션의 유일 가치 = **입력 재prefill 절약** = 바로 그 *싸고 병목 아닌* 축. 2-스토어 전체 복잡도를 싼 축 위해 지불하는 구조.
4. **plan §4.1 비채택 근거가 역전됨**: 당시 stateless(`--resume`) 거부 이유="재prefill+부팅이 증분이점 반감". 그러나 재prefill=입력=쌈. 120초→10초의 반감도 6~8배 win. 그 거부는 리뷰가 복잡도 비용을 정량화하기 *전*. 리뷰가 cost-benefit을 뒤집음.

**채택안 (Stateless op-path)**:
- 세션·Node 사이드카 **없음**. 매 실시간 틱: DB items→매니페스트(active tip + superseded skeleton, 입력크기 prune) + sections_prompt + 델타 전사 → 기존 `LlmService.call_claude_cli`("ops JSON만 출력" 시스템프롬프트) → ops → `MinuteItemsMerger`가 items에 트랜잭션 적용(item_key=Rails 발급, 체인무결성) → items→markdown 렌더 → summaries.notes_markdown 캐시 → broadcast.
- **LLM = DB상태의 순수함수 → ops**. 1-스토어. 매 틱 DB에서 재그라운드(= 사이드카의 cold/재앵커 경로를 *항상* 수행, but 입력이라 쌈). warm/cold 구분·generation·needs_anchor 전부 불요.
- **자동 멱등**: 동일 델타 재전송(롤백으로 transcript 미소비) → LLM이 DB 재그라운드 → item 없으면 재add(정확), item 있으면 매니페스트가 보여줌→update/no-op. 2번째 기억이 "이미 add함" 주장하지 않으므로 중복 불가.
- 출력=작은 op → **속도 win 유지**(병목 축 해결). 입력=매니페스트(prune로 bound, 싼 축).
- finalize=기존 통짜 풀패스 유지(세션 드리프트 없으니 §5 드리프트교정 머신 불요).

**무력화되는(폐기) sidecar-only 결함**: conc-C2(2스토어)·C3(refcount)·H4(맵레이스)·H5(admission)·M7(meeting_id echo)·M8(blocking lock)·M9(캐시키); id-H3(intra-batch tmp)·M5(incremental)·M6(generation); anchor-H3(stop펜싱)·H6(매니페스트오버플로 일부)·M10(축출storm). 전부 stateless에서 존재 불가.

**남는 비용/주의**: 틱당 입력토큰↑(크레딧, 6/15 Agent SDK 차감은 기존 claude_cli와 동일 노출 — 신규 의존 없음). 매니페스트 크기 prune 필요(긴 회의). 이건 single-store라 단순.

## D7. Phasing — Phase1(즉시·검증가능) + Phase2(flag-OFF)

D6으로 **전체가 Rails-only**(Node 0)가 되어 단순화. 그래도 라이브 경로(실 LLM op 생성 품질)는 기기/실회의 E2E 없이 "작동" 단언 불가 → 안전 기본값으로 단계화:
- **Phase 1 (이 세션, 빌드+유닛테스트)**: 아키텍처-중립 Rails 기반. 마이그레이션+`MeetingMinuteItem`+`MinuteItemsRenderer`(items→markdown clean / items→manifest / markdown→items reparse fence-aware)+`MinuteItemsMerger`(ops→items 트랜잭션·체인무결성·item_key발급·키미스fallback·row lock)+Meeting 편집(op_mode?/current_notes/purge/reset 플래그). LLM mock으로 유닛테스트. 기존동작 보존(op_mode 기본 OFF).
- **Phase 2 (빌드, flag-OFF 기본)**: `LlmService` op 메서드(매니페스트+델타→ops, ok:false 시그널) + job op분기(op_mode→op경로 / else refine_notes 통짜 fallback) + 컨트롤러 reset경로 플래그. **`SUMMARY_OP_MODE_ENABLED` 기본 false** → 명시 활성+실회의 검증 전엔 프로덕션/dev 거동 불변. 폭발반경 ~0, 가역.

## D8. Surviving findings (아키텍처-중립, Phase1/2에 bake-in 필수)

리뷰 work는 낭비 아님 — 아래는 stateless에서도 살아있는 실제 결함:
- **id-C1** remove가 비-tip(누군가의 superseded_by 타겟) 제거 시 → 선행자 superseded_by를 제거노드의 superseded_by로 re-link(체인 붕괴 방지). 렌더 가드: lookup(superseded_by) nil/removed → active로 취급(반쪽 취소선 금지).
- **id-C2** supersede stale 가드는 **체인 TIP의 last_op_seq** 기준(명명된 옛 superseded item 아님). 먼저 active_chain_tip 해소 후 비교.
- **id-H4/useredit-H3** reparse는 **fence-aware**(``` open/close 추적, 펜스 내부 빈줄 무시). **render_supersede 가공 markdown은 절대 재파싱 금지** — reparse 입력=LLM 풀패스 신선출력만(finalize 종단). transient fallback은 reparse 안 함(items 유지, summaries 캐시만 갱신).
- **conc-C1/anchor-M8** 진행 truth **하나만**: `applied_to_minutes`를 단일 정본으로(이미 존재). last_op_seq는 per-item stale 가드(GREATEST, TIP 기준)로만 보조. 두 워터마크 분기 금지.
- **anchor-C1** `refine_notes`(및 op 경로)는 내부 LLM 실패 시 **`ok:false` 시그널** 반환(현재는 rescue로 current_notes 무음반환). fallback은 실제 신규 콘텐츠 생성 시에만 transcript 소비(applied_to_minutes/진행 advance). 0콘텐츠 무음손실 차단.
- **conc-H6** 머지 트랜잭션 + reset 경로(reset_content/regenerate)는 `Meeting.lock`(FOR UPDATE)로 web-thread↔job-thread TOCTOU 차단. 트랜잭션 내 status/reset/fallback 상태 재확인 후 쓰기.
- **useredit-C1** `current_notes`: op_mode?면 items 렌더 우선, **강등(op_mode false)이면 summaries.notes_markdown 권위**(사용자편집 보존). items-우선이 stale 편집전 내용으로 덮어쓰는 것 차단.
- **useredit-C2/anchor-M7** op_mode? = **단일 술어 `minutes_op_fallback_at.nil?`** + 전역 `SUMMARY_OP_MODE_ENABLED` 플래그(기본 OFF). 사용자편집(update_notes/feedback)은 minutes_op_fallback_at 세팅(sticky). last_user_edit_at 의존 제거(영구봉인 방지).
- **anchor-L11/useredit-L6** 모든 reset 경로(reset_content·regenerate_stt·regenerate_notes)가 minutes_op_fallback_at=nil + meeting_minute_items.destroy_all 일관 적용(중앙화).
- **anchor-H6(잔여)** 매니페스트 prune: superseded는 active tip + 스켈레톤(item_key+superseded_by, text 생략/축약)로 입력크기 bound.
- **useredit-M5** active_summary final-우선이 reopen 후 realtime items 캐시 가림 → op 활성 시 캐시 summary_type 정합(op_mode면 최신 우선) 또는 reopen이 summary 포인터 리셋.

## D9. Phase 1 완료 (2026-06-11) + 프로세스 보정

- **상태**: Rails 기반(마이그레이션·`MeetingMinuteItem`·`MinuteItemsRenderer`·`MinuteItemsMerger`·Meeting 편집) 적용 + 유닛테스트. **rspec 신규 76/76, 회귀 80/80 green.**
- **머저 critical 수정**(opus 리뷰 적중): `active_chain_tip`이 끊긴 체인(removed/고아/사이클)에 nil 반환인데 update/supersede가 `tip.status` 직접 접근 → NoMethodError 크래시([remove X→update X] 또는 고아 B 타겟 시 재현). 수정: 직접 지정 타겟이 `removed`면 no-op(강등 아님), `resolve_tip`이 nil이면 keymiss(롤백+강등). 회귀테스트 추가.
- **모델 계약 확정**: `active_chain_tip`은 끊긴 체인 → **nil**(머저가 keymiss로 처리). id-C1 "렌더-as-active"는 **렌더러의 자체 walker**(`resolve_tip_for_render`)가 담당 — 두 책임 분리.
- **프로세스 보정 기록**: Workflow 빌드 에이전트(sonnet)가 신규 파일을 **직접 Write**함(CLAUDE.md 워커 no-write 위반 — Workflow 기본 에이전트가 Write 툴 보유). Orchestrator가 **전 파일 read+수정+테스트로 in-place 리뷰** 수행해 "워커 산출→Orchestrator 검증 후 적용" 취지 유지. 향후 워크플로우 브리프에 "Write 금지, 반환만" 강조하거나 Read-only 에이전트 타입 사용 고려.
- **커밋 안 함**(명시요청 대기). 전부 격리 브랜치 작업트리.

## D11. 구현리뷰(WF3) 수정 6건 (2026-06-11)

opus 구현리뷰가 적출한 6건을 코드에 직접 적용하고 회귀 테스트 3건 추가. 기존 테스트 무변.

- **R1 id 스냅샷 소비**: merger 호출 시 `transcript_ids: applied_ids` 전달 — seq-range가 LLM 미전달 늦은 도착분을 무음 소비하는 손실 차단. `MinuteItemsMerger#apply`에 `transcript_ids:` 파라미터 추가, 소비를 id 배열로 한정.
- **R2 통짜→op 전환 시드**: `generate_minutes_realtime_op` 진입부에 `items.renderable.none?` 가드 추가 — 기존 summaries notes 있으면 `MinuteItemsRenderer.reparse!`로 시드 후 매니페스트 구성. 클로버(기존 회의록 전량 삭제) 방지.
- **R3 final ok 가드**: `generate_minutes_final`에서 `result["ok"]` false 시 저장·소비·강등해제 전부 건너뜀(return). transient LLM 실패가 stale notes로 전사를 영구 소비하는 무음 손실 차단.
- **R4 active_summary 상태 인지**: `Meeting#active_summary` — `completed?`일 때만 final 하드 우선, 아니면 `generated_at desc, id desc` 최신 우선. reopen 후 stale final이 fresh realtime을 가리는 문제 해결.
- **R5 tip remove 시 조상 폐쇄**: `MinuteItemsMerger` remove가 chain tip에 적용될 때 조상(superseded) 전체를 `removed`로 마킹 — 렌더러가 superseded 항목을 active로 부활시키는 경로 차단.
- **R6 malformed op 강등**: `MinuteItemsMerger`에서 `ActiveRecord::RecordInvalid` rescue → keymiss 강등(트랜잭션 롤백·op_fallback!)으로 처리. 빈 text 등 잘못된 op가 재시도 쐐기(wedge)가 되는 것 방지.

## (이후 결정 누적 — Workflow 진행하며 append)
