# backend-refactor — context (snapshot)

상태: 진행중 (2026-06-21, ultracode 세션). **worktree 격리**.

## 격리 (방금 frontend 레이스 충돌 교훈)
- worktree: `/Users/jji/project/ddobak-backend-refactor`
- 브랜치: `refactor/backend` (off main HEAD 58c5124)
- 다른 세션 = main tree에서 frontend 리팩토링 커밋 중 → 내 backend 작업과 파일·git 둘 다 격리.

## 목표
Rails backend god 파일 점진 구조분해. 철칙 = **behavior-change-0** (HTTP/JSON/side-effect/DB·broadcast 동일). 슬라이스 1개씩, rspec green 게이트, subagent-driven, 적대 verify.

## 기준선
- rspec baseline 측정중(buocni9f2). 결과 채워질 예정.

## 대상 god 파일 (줄수)
- meetings_controller.rb 701 (god 컨트롤러)
- llm_service.rb 601
- project_importer.rb 489
- settings_controller.rb 380 (≠ user/llm_settings_controller)
- meeting_summarization_job.rb 350 (로드맵 #2 summarizer)
- llm_prompts.rb 325

## 방법
1. Understand 워크플로 wf_780e2943: 6 god 매핑 → 추출안·public표면·리스크·순서
2. 슬라이스별 subagent 구현(서비스객체/concern 추출, public 계약 불변) + rspec green
3. 적대 verify: behavior-change-0(HTTP/JSON/side-effect 동일·순수이동)

## 금지/주의
- llm-settings 파일(user.rb·user/llm_settings_controller·관련 specs) 건드리지 마라 — 다른 작업 영역.
- `git add -A` 금지. 슬라이스 스코프만 stage. 커밋=사용자 명시승인.
