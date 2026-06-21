# backend-refactor — log (append-only)

[2026-06-21] [BASELINE] worktree rspec PASS 1216 (359s). = behavior-change-0 기준선.
[2026-06-21] [UNDERSTAND] wf_780e2943: 6 god 매핑. 순위 llm_service.rb(1,low,strong)·llm_prompts.rb(1,low) > meetings_controller(2,med,strong)·summarization_job(2,med,strong)·project_importer(2,med)·settings_controller(2,med).
[2026-06-21] [SLICE1] llm_service.rb(601) → LlmService::TextFormatter 추출(7 순수메서드: truncate_chars/format_transcripts/extract_json/strip_markdown_fence/fix_mermaid_quotes/quote_mermaid_labels/clean_label). B안=module_function+include로 spec .send 계약 보존. 호출처 11라인 TextFormatter.<m> 갱신. 601→525.
[2026-06-21] [VERIFICATION] SLICE1: 5 타겟 spec 40/0 · .send spec 2/2 · public누수0(rails runner 7개 private?=true) · mermaid체인 production 실증 · 독립 byte-identity 7/7 정규화 동일 · main tree 무변경 · 스코프 2파일. → behavior-change-0 확정.
[2026-06-21] [DEFER] streaming/CLI/UTF-8 유닛(CliStreamingBuffer+CLI call paths+strip_think)=과거 Critical 인코딩버그(baddee0) 구역, 단위테스트 미커버 → 최후 슬라이스 + 이빨char테스트(한글 멀티바이트 readpartial경계→strip_think) 선작성. seam 분리 금지(한 유닛).
[2026-06-21] [SLICE2] llm_prompts.rb(325→15) → 6 nested concern(Notes/Summarization/Compression/Citation/Chat/Agenda) re-include + char테스트 신규 spec.
[2026-06-21] [VERIFICATION] SLICE2: 80 spec 0fail(llm_prompts+relocation+5 llm_service) · cross-constant(FOLDER_CHAT_SYSTEM_PROMPT 보간) resolve ✅ · dual-access qualified+unqualified ✅ · 16상수 byte-identical(old vs new 직접대조) ✅ · seeded_merge_instruction ✅ · llm_service 무변경(mtime 10:53<11:08) · main tree 무변경. → behavior-change-0 확정. (주의: 1차 byte-identity 스크립트가 nesting 버그로 거짓DRIFT→수정후 클린.)
[2026-06-21] [SLICE3] llm_service.rb(525→493) → LlmService::ClientFactory(resolve_config/server_default_config/build_client 이동, nested module+module_function+include, CLI_PROVIDERS lexical resolve). max_output_tokens는 @config[:max_output_tokens] 런타임 접근자라 LlmService에 남김(call_llm_raw 기본인자 등). build_client는 @config→config param화(zero-arg 래퍼 보존).
[2026-06-21] [VERIFICATION] SLICE3: 40 spec 0fail · 3메서드 byte-identical(@config→config 정규화 후) · 델리게이션 확인(include+ClientFactory.build_client(@config)) · text_formatter/llm_prompts 무변경 · main 무변경. → behavior-change-0 확정.
[2026-06-21] [STATUS] 3 슬라이스 done. llm_service 601→493(-108), llm_prompts 325→15. 남음(llm_service): PromptBuilder·ErrorRecovery(중결합), [DEFER]streaming/CLI/UTF-8(char테스트 선작성). 그외 god: meetings_controller(701)·summarization_job·project_importer·settings_controller. 전부 미커밋(홀드).
[2026-06-21] [COMMIT-POLICY] feedback_no_auto_commit 존중 → 슬라이스 커밋 홀드(사용자 승인 대기). 격리 worktree branch라 미커밋 누적해도 main 무영향, 슬라이스별 byte-identity+spec게이트로 즉시 검출.
