# log — realtime-summary-hybrid (append-only)

[2026-06-11] [START] 킥오프. plan/kickoff/memory 정박 완료. 코드 정박: meeting_summarization_job.rb, llm_service.rb, summaries/meetings/transcripts schema, PromptTemplate.sections_prompt_for, SummarizationJob(5분 cron 트리거).
[2026-06-11] [DECISION] D1 meeting_minute_items=신규 테이블(blocks/decisions/action_items 재사용 안 함). 근거=docs/...-decisions.md.
[2026-06-11] [DECISION] D2 op 타겟=안정 item_key(세션휘발 id 아님). 앵커 렌더에 key 임베드. 설계 1순위.
[2026-06-11] [DECISION] D0 사용자 자리비움 → 승인 게이트 Orchestrator 대행, 커밋 보류, 워커 직접쓰기 금지 유지.
[2026-06-11] [APPROVAL] workers_approved = Workflow 도구(ultracode), 사용자 kickoff 명시 승인.
[2026-06-11] [WORKFLOW] WF1(wc8eiqq5t) 설계+리뷰 완료. fable 3에이전트 실패(advisor툴 opus충돌). opus 리뷰 2렌즈 성공=구멍 12개(identity broken/concurrency fixable) 적출.
[2026-06-11] [VERIFICATION] 리뷰어 주장 코드실측: recurring.yml=every minute(dev+prod, 주석 "5분" 오류), MeetingFinalizerService 독립 stateless→action_items/decisions, stop=2잡 발사. 전부 확인.
[2026-06-11] [DECISION] D3 fable→opus 대체(Workflow advisor충돌). D4 검증사실. D5 corrected design 12수정 확정. docs/...-decisions.md.
[2026-06-11] [WORKFLOW] WF1b 재실행: 설계(opus, 12수정 bake-in) + 4렌즈 적대리뷰(opus) on 신규 스펙.
[2026-06-11] [WORKFLOW] WF1b(w6k8org9p) 완료: corrected 스펙 + 4렌즈 재공격 = ~30 신규결함(다수 breaks_invariant).
[2026-06-11] [ADVISOR] root=2-스토어(사이드카세션+DB) 비조율이 ~20결함 원인. 측정상 병목=출력생성, 세션은 입력재전송(싼축)만 절약. → stateless 권고.
[2026-06-11] [DECISION] D6 사이드카 폐기→stateless manifest-per-tick(fixed#3 재오픈, 가역 flag-OFF+브랜치). D7 phasing(P1 Rails기반 즉시+유닛테스트 / P2 op경로 flag-OFF). D8 surviving findings(아키중립) bake-in. 전체 Rails-only(Node 0).
[2026-06-11] [DECISION] item_key=SecureRandom.hex(6)(ULID gem 부재). 테스트=RSpec.
[2026-06-11] [DOC] docs/realtime-summary-hybrid-spec-final.md = 최종 구현계약(stateless Rails-only).
[2026-06-11] [WORKFLOW] WF2 Phase1 구현(sonnet): 마이그레이션+모델+Meeting편집 / 렌더러 / 머저 / specs 병렬 → opus 리뷰. 코드 반환→Orchestrator 적용·테스트.
[2026-06-11] [WORKFLOW] WF2(wfv2q489v) 완료: 빌드4(sonnet) 성공, 리뷰=머저정확성(opus) 성공·integration-backcompat(opus) API Overloaded 실패(일시).
[2026-06-11] [REVIEW] 머저리뷰 critical 적중=update/supersede nil-tip 크래시(active_chain_tip이 끊긴체인 nil→tip.status NoMethodError). +medium(removed→no-op vs 끊긴→keymiss 구분) +low(테스트 사각).
[2026-06-11] [PROCESS] 빌드 에이전트가 신규파일 직접 씀(no-write 지시 위반, Workflow 기본에이전트 Write 보유). 거버넌스 보정: Orchestrator가 전 파일 read+수정+테스트로 in-place 리뷰 → "리뷰 후 적용" 취지 유지.
[2026-06-11] [APPLY] 산출물 적용: 마이그레이션·모델·렌더러·머저(nil-tip 수정)·meeting.rb 3편집·specs(회귀테스트 추가). nil-tip→removed면 no-op/끊긴체인이면 keymiss.
[2026-06-11] [FIX] 모델스펙 active_chain_tip 테스트 2개 오계약 수정(끊긴체인→nil 정답; 렌더-as-active는 렌더러 자체walker 담당).
[2026-06-11] [VERIFICATION] db:migrate OK. rspec 신규 76/76 + 회귀(exporter/finalizer/meetings/export) 80/80 = 전부 green. Phase1 완료.
[2026-06-11] [PHASE2] 인라인 구현(D10): OP_SYSTEM_PROMPT + LlmService#generate_ops + refine_notes ok플래그; job realtime 분기(op_mode_enabled?=ENV SUMMARY_OP_MODE_ENABLED && op_mode?)→통짜/op, final reparse+clear_op_fallback; controller reset3경로 강등해제 + update_notes/feedback enter_op_fallback.
[2026-06-11] [VERIFICATION] Phase2 specs 13/13(llm op + job 분기). 전체 스위트 733 examples, 1 failure.
[2026-06-11] [VERIFICATION] 그 1 failure=default_user_lookup_spec(LOCAL "사용자" 기대 vs 코드 "관리자")=커밋 69df3a1 rename 때 미갱신된 STALE 테스트. 격리실행 동일실패+git blame 확인 → 내 변경과 무관. 미수정(스코프 밖).
[2026-06-11] [DECISION] D10 Phase2는 인라인 구현(고위험 통합=기존 테스트된 job/controller/llm 편집, 에이전트 직접쓰기 위험 회피). 그 후 opus 리뷰 워크플로우로 적대검증 예정.
[2026-06-11] [APPLY] WF3 구현리뷰(opus) 지적 6건 코드 수정 적용: R1 transcript_ids 스냅샷 소비(seq-range 대신 id 배열 전달), R2 통짜→op 전환 시 items 시드(reparse! 진입부 가드), R3 final ok 가드(ok:false 시 미저장·미소비·minutes_op_fallback_at 불변), R4 active_summary 상태 인지(completed?=final 하드우선, else 최신 우선), R5 tip remove 시 조상 폐쇄(removed로 일괄 마킹), R6 malformed op RecordInvalid→keymiss 강등(raise 방지). 기존 스위트 무변.
[2026-06-11] [VERIFICATION] 회귀 테스트 3건 추가(job spec: final ok가드·op 통짜→op 시드; model spec: active_summary completed/recording 시나리오 2건). 대상 파일 5개(merger/job/minute_item/renderer/llm_service_op) rspec = 99 passed, 0 failed. 전체 스위트 = 742 passed, 1 failed(default_user_lookup_spec stale 테스트 — 무관). 커밋 없음.
[2026-06-11] [DONE] 전 단계 완료. 최종: rspec 742 중 741 green(1=무관 stale). 커밋 안 함(명시요청 대기). 메모리 project_summary_llm_perf 갱신.
[2026-06-11] [LIVE-E2E] flag ON 실회의(171, 유튜브): op 경로 작동 — items 28 active 4섹션 분류, keymiss/강등 0. 틱 실측 23.5~70.5s(출력 871~1582자, CLI 고정비+편차 지배). 구조적 이점=출력 평탄(통짜는 회의길이 비례→타임아웃).
[2026-06-11] [BUG-FIX] 실전 재현: stop 직후 realtime 틱 락 점유→final try_lock 무음 드랍(WF1 conc-H3 적중, 내 D8 conc-M8 판단 오류). 수정=final lock busy 시 30s 재enqueue. 회귀테스트 2개, job spec 10/10.
[2026-06-11] [VERIFICATION] R3 가드 실전 작동: meeting 170 final transient failure→미소비 로그 확인(무음손실 차단).
[2026-06-11] [RESEARCH] 6/15 크레딧 체계 확정(메모리 reference_agent_sdk_credits): -p/SDK만 차감, API직결 불가, 클레임 필수, op틱≈$0.5/회의시간.
[2026-06-11] [LIVE-E2E] 171 final 풀패스 완료: final summary 생성, items 49 active 중복0, unapplied 0, 강등해제. reparse 정상(논의사항 46블록). 동시 final 4회(Orchestrator cwd 오판으로 중복 발사, LLM ~3회분 낭비)에도 트랜잭션 수렴으로 무손상.
[2026-06-11] [DONE] 라이브 E2E 완료 항목: realtime op 경로/섹션분류/멱등/final 풀패스+reparse+강등해제/R3 가드/final 재enqueue 수정. 미검증 잔여: 번복(supersede) 시나리오(사용자 다음 테스트 예정).
[2026-06-11] [DECISION] 사용자: 델타(op) 이득 미미 → 폐기. 실버그 수정 3건만 유지(ok가드/final재enqueue/active_summary). 다음=출력 압축율 선택 기능. 수술 킥오프=docs/realtime-summary-cleanup-kickoff.md. 컨텍스트 클리어 예정.
