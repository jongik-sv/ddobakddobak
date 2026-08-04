# D'Flow 프로젝트 초대 — 착수 지시문

> **사용법 (다른 PC)**:
> 1. `project-invite-spec.md`를 wbs-web 레포에 `docs/project-invite-spec.md`로 저장
> 2. 레포 루트에서 `claude` 실행
> 3. 아래 `/loop` 블록 전체를 첫 메시지로 붙여넣기
>
> 쉼 없이 완주시키려면 `/loop` 대신 `/loop 1m`으로 시작 (인터벌 생략 = 자율 페이스, 반복 사이 20~30분 대기 가능).

---

/loop 프로젝트 초대 기능 구현을 진행해줘. 완성된 이식 스펙: docs/project-invite-spec.md
자기완결 스펙이고 적대 검증을 통과했다 — 원본 레포 접근 불필요, 설계 결정은 전부 확정돼 있으니 재설계 금지.

매 반복(iteration)마다:
1. 진행 상태 파일 docs/progress-project-invite.md 를 읽는다(없으면 스펙 §9의 T1~T8 체크리스트로 생성). 완료 표시된 태스크는 건너뛴다.
2. 의존성 순서(T1 → T2 → T3·T4 병렬 가능 → T5 → T6·T7 병렬 가능 → T8)에서 **다음 미완료 태스크 하나**를 서브에이전트로 실행한다. 모델 지정:
   - T1 마이그레이션: sonnet / T2 도메인 함수+테스트: sonnet / T3 관리 액션+게이트 테스트: sonnet
   - T4 redeem 액션 2종+테스트: opus (보안 민감 — 계정 생성·보상 롤백·원자 소비)
   - T5 middleware matcher 1줄: haiku (스펙 §5-1에 정확한 diff 있음)
   - T6 설정 UI: sonnet / T7 공개 초대 페이지: sonnet / T8 통합 리뷰: opus
3. 해당 태스크의 게이트(스펙 §9 표)를 실행·검증한다. 통과 시에만 진행 상태 파일에 완료 표시 + 게이트 증거(테스트 출력 요약) 기록. 실패 시 같은 태스크 안에서 수정 후 재검증(완료 표시 금지).
4. T8 게이트까지 전부 통과하면: 스펙 §10 수동 시나리오 M1~M12 중 자동 확인 가능한 것의 결과와 사람이 해야 할 잔여 목록을 진행 상태 파일에 정리하고, 루프를 종료한다.

주의사항 (스펙에도 있지만 재강조):
- 마이그레이션(0055)은 파일 작성만 — DB 적용은 사람이 Supabase Management API로 한다. 적용 시도 금지. 마이그레이션과 앱 코드는 같은 커밋에 담지 않는다.
- project_roles 추가는 반드시 `.upsert(..., { onConflict: 'project_id,user_id', ignoreDuplicates: true })` — ignoreDuplicates 빠지면 admin 강등 버그.
- src/middleware.ts matcher에 `invite/` 추가 누락 시 기능 전체가 죽는다 (슬래시 앵커 필수).
- memberships.role은 deprecated — 더미값 'team_editor'만 넣고 판정에 쓰지 말 것.
- 회의 초대 메일 관련 파일(meetingNotify.ts, lib/mail/meetingInvite.ts)은 무관 기능 — 수정 금지.
- 커밋·푸시는 사용자가 명시 요청할 때만.

---

사람이 할 일 (구현 완료 후): T1이 만든 `supabase/migrations/0055_project_invites.sql`을
Supabase Management API로 직접 적용 → 그다음 스펙 §10 수동 시나리오 검증.
