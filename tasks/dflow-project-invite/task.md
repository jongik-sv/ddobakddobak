# dflow-project-invite

status: done
target_repo: 없음 (스펙 산출만 — artifacts/에 자기완결 스펙, 사용자가 D'Flow 세션에 전달)
created: 2026-08-03

## 목적

또박또박 "프로젝트 초대" 기능(초대 링크 생성 → 링크 redeem → 프로젝트 멤버 등록)을
D'Flow(wbs-web, Next.js 15 + Supabase)에 그대로 구현할 수 있는 자기완결 이식 스펙 작성.
각 구현 태스크마다 권장 모델(haiku/sonnet/opus) 명시.

## 산출물

- artifacts/dflow-project-invite-spec.md

## workers_approved

- (외부 워커 풀 미사용 — Claude Code 내장 서브에이전트만)

## constraints

- 스펙은 자기완결: 대상 세션은 또박 레포 접근 불가 전제, 값 전부 인라인
- 설계 결정은 스펙이 확정 (선택지 유보 금지)
- 적대 검증 통과 후 전달
