# Task: 실시간 요약 하이브리드(세션유지 + 델타/op)

status: superseded — 델타 폐기 결정(2026-06-11), 수술 킥오프=docs/realtime-summary-cleanup-kickoff.md
branch: feat/realtime-summary-hybrid
mode: 멀티에이전트 Workflow (ultracode), route(a)

## 설계 확정본
- docs/realtime-summary-hybrid-plan.md (결정 7건)
- docs/realtime-summary-hybrid-kickoff.md
- docs/realtime-summary-hybrid-decisions.md (자율 결정 로그 — 사용자 자리비움 대응)

## workers_approved
- 진행방식 = Workflow 도구(ultracode 켜짐). 사용자가 kickoff에서 명시 승인.
- 모델 분리: 설계=fable / 구현=sonnet / 리뷰=fable·opus.
- 정책: Workflow 에이전트 **파일 직접쓰기 금지** → 코드/diff 반환 → Orchestrator가 작업트리 적용 → 검증.
- 커밋: 명시요청 시만(보류). 승인 게이트는 사용자 자리비움으로 Orchestrator 대행(docs/...-decisions.md D0).

## constraints
- 커밋·푸시 금지(명시요청 시만).
- 백엔드 재기동 시 SERVER_MODE=true.
- diff는 feat/realtime-summary-hybrid 브랜치에만.
- 핵심 불변식: 세션=휘발 가속기, DB meeting_minute_items=정본. 세션 죽어도 무손실.
- 신규 path는 additive. 기존 refine_notes(통짜 Mode A)=자동 강등 fallback 유지. 기존 테스트 green 유지.

## Do NOT
- 기존 blocks/decisions/action_items 테이블 변경 금지.
- 7개 확정 결정 재오픈 금지(설계 에이전트는 정확한 계약만 산출).
- summaries.notes_markdown 렌더 출력 중단 금지(UI·앵커·brief가 읽음).

## phases
1. [x] 설계(fable) + 적대적 리뷰(opus·fable) — Workflow 1
2. [x] 구현(sonnet): T1(DB)‖T2(사이드카) → T3(머지) → T4(job분기) — Workflow 2
3. [x] 구현 리뷰(opus·fable) — Workflow 3
4. [x] (유닛·회귀 완료 — 라이브 E2E는 flag ON 후 별도) 검증 + 문서/메모리 갱신
