# 킥오프 프롬프트 — 실시간 요약 하이브리드 구현

> 컨텍스트 클리어 후 새 세션에 **아래 블록만 복사해 붙여넣기.**

---

실시간 요약 하이브리드(세션유지+델타/op) 구현 시작한다.

**먼저 읽어**: `docs/realtime-summary-hybrid-plan.md` (전체 설계·결정 7건 확정됨). 메모리 `project_summary_llm_perf`도 참조.

**상태**:
- 작업 브랜치 = `feat/realtime-summary-hybrid` (이미 생성됨, 여기서 작업).
- 설계 단계 끝. 결정 7건 전부 확정(plan §7). 이제 구현.

**진행 방식 = 멀티에이전트 Workflow (ultracode)**:
- route(a). CLAUDE.md 워커정책 준수: **워커 직접 파일쓰기 금지** → diff/코드 반환 → Orchestrator가 브랜치 적용 → 나(사용자) 승인.
- 모델 분리: **설계 phase=fable / 구현 phase=sonnet / 리뷰 phase=fable 또는 opus**.
- Workflow phase 구조:
  1. **설계(fable)** — `meeting_minute_items` 스키마, op 규약(add/update/supersede/remove), 사이드카 HTTP IF(delta/finalize/delete), 앵커 재주입 프로토콜, items↔markdown 렌더 규칙 확정. 구조화 출력으로 다음 phase에 핸드오프.
  2. **설계 리뷰(fable/opus, adversarial)** — 번복/격리/앵커/사용자편집충돌 구멍 잡기.
  3. **구현(sonnet)** — T1(DB 구조화: 마이그레이션+렌더, 기존동작 보존)·T2(Node 사이드카 골격: Agent SDK+세션맵+30분축출+OAuth) 병렬 → T3(op 머지 Rails, T1 의존)·T4(realtime/final job 분기, 통짜 fallback 유지) 직렬.
  4. **구현 리뷰** — 번복 시나리오(A안→B안) / 멀티회의 세션격리 / 30분 축출 후 앵커복구 / fallback 검증.

**제약(필수 준수)**:
- 커밋·푸시는 명시 요청 시에만(메모리 feedback_no_auto_commit).
- 백엔드 재기동 시 `SERVER_MODE=true` 필수(project_hybrid_auth).
- 워커 산출 diff는 `feat/realtime-summary-hybrid` 브랜치에만 적용.
- 2026-06-15부터 Agent SDK 구독사용분 별도 크레딧 차감 — 사이드카 인증 설계 시 주의.

**핵심 불변식**: 세션=휘발성 가속기, DB `meeting_minute_items`=정본. 세션 죽어도 무손실.

먼저 plan 문서 읽고, Workflow 설계 phase(fable)부터 띄워라.
