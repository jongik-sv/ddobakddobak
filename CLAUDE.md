# MultiAgent Orchestration — Operating Rules

## Architecture

```
Orchestrator (Claude Code session, internal reasoning)
└── Worker Pool (모두 외부 호출 — 승인 필요)
    ├── claude-main    메인 코딩 · 디버깅 · 설계 · 아키텍처 · 전략 · 보조 구현 · 코드 분석
    └── gemini         멀티모달 · 긴 문서 · 제3자 시각의 검토·비평
```

> **Worker pool 변경 이력**: codex(codex-main/codex-critic)는 워크스페이스 구독 만료(402 deactivated_workspace)로 제외. GLM은 미채택(사용 안 함). 현 풀은 claude-main + gemini 2워커. codex 복구(구독 갱신 또는 활성 계정 재로그인) 시 backends.json에 재추가 가능.

**중요**: Orchestrator의 내부 추론은 worker가 아님. claude-main worker 호출은 별도 모델 호출이므로 승인·쿼터 대상.

## Task Lifecycle

1. `tasks/<task-name>/task.md` 작성 (status: pending)
2. `_shared/routing.md` 참조 → 최소 worker set 결정
3. **target_repo 확인** (외부 산출물 작업인 경우):
   - 코드·문서·이미지를 만드는 작업이면 사용자에게 `target_repo` 경로를 묻는다 (어떤 worker도 직접 쓰지 않으므로, Orchestrator가 worker 산출 diff·patch를 승인 후 적용)
   - 사용자가 "없음"이라고 답하거나 분석·리뷰·요약·기획만 하는 작업이면 묻지 않고 `tasks/<task>/artifacts/`에 diff·patch로 산출
   - 사용자가 자연어 요청에 이미 경로를 포함했으면 다시 묻지 않음
4. 모든 worker(claude-main 포함) 사용 시 `task.md`의 `workers_approved`에 명시적 기록 필요
5. 각 worker의 brief를 **정확히 `tasks/<task>/workers/<role>/brief.md`** 에 작성 (≤ 1200자 한글 / 240단어 영문). 워커별 폴더로 분리할 것 — `<role>_brief.md`처럼 납작하게 만들지 말 것
6. worker 실행 → 원문을 **`tasks/<task>/workers/<role>/result.md`** 에 저장 (같은 워커별 폴더)
7. `result.md`의 Verification Checklist 실행
8. 검증 결과를 `log.md`에 append (`[VERIFICATION]` 태그). 작업이 끝나면 `task.md`의 `status`를 `done`으로 갱신
9. 완료 후 교훈 추가 (분류): **시스템 운영 자체**에 대한 일반 교훈 → `_shared/learnings.md`(추적·공개). **특정 외부 프로젝트 한정**(mat·hwpx 등) → `_local/learnings.md`(git 추적 안 함, 없으면 생성). `_local/learnings.md`는 명시 요청 없이는 로드하지 않는다.

> **기존 작업 재개 시**(새 세션 포함)는 1번부터가 아니라 `_shared/orchestrator-rules.md` §3 **재진입 프로토콜**을 먼저 따른다 (재정박 → 분기 → 에러 후 진행).

## Context Rules

| 파일 | 제한 (측정 가능 기준) | 목적 |
|------|------------------|------|
| `context.md` | ≤ 1500자 (한글) / ≤ 300단어 (영문) | 현재 스냅샷만. 히스토리 아님 |
| `brief.md` | ≤ 1200자 (한글) / ≤ 240단어 (영문) | worker가 실행에 필요한 것만 |
| `sources/` | 무제한 | 원본 자료. 경로로만 참조 |
| `artifacts/` | 무제한 | worker 산출물 원본 |

**측정 명령어**:
```bash
wc -m tasks/<task>/context.md   # 한글 글자수 (UTF-8 multi-byte)
wc -w tasks/<task>/context.md   # 영문 단어수
```

**context.md 초과 시**: 핵심만 남기고 나머지는 `log.md`에 append 후 초기화.  
**brief 작성 원칙**: 파일 내용을 inline 금지. 경로만 전달.

## Approval Gate

- `workers_approved`에 없는 worker 호출 금지 (claude-main 포함 전체 worker pool 적용)
- 작업당 첫 호출 전 사용자에게 확인 후 `task.md` 업데이트
- 예외: Orchestrator의 내부 추론은 worker 호출이 아니므로 승인 불필요

## Verification (결과물 수락 전 필수)

각 worker `result.md`에 포함된 Verification Checklist를 실행하고, 결과를 `log.md`에 `[VERIFICATION]` 태그로 기록.

기본 항목:
- [ ] output이 `brief.md`의 `output_format`과 일치
- [ ] 파일 경로가 실제 존재하는지 확인
- [ ] `task.md`의 constraints 충족
- [ ] Do NOT 항목 위반 없음

## log.md 규칙

- append-only. 수정/삭제 금지
- 형식: `[YYYY-MM-DD HH:MM] [ACTION] 내용`
- 기록 대상: worker 호출, 주요 결정, verification 결과, 에러

## Worker 파일 쓰기 정책

| Worker | 기본 쓰기 권한 | 외부 repo 쓰기 |
|--------|------------|--------------|
| claude-main | ❌ Orchestrator 경유 | ❌ |
| gemini | ❌ 응답을 Orchestrator가 기록 | ❌ |

**현 워커 풀은 어떤 worker도 파일을 직접 쓰지 않는다** — 전부 텍스트/diff를 반환하고 Orchestrator가 받아 기록·적용한다. (codex처럼 sandbox workspace-write로 직접 쓰던 worker가 빠졌기 때문.)

### `write_scope` 값 정의 (brief에 명시 — Orchestrator의 diff 적용 범위)

- `none` — 분석·리뷰·요약 (적용할 산출물 없음)
- `tasks-only` — 산출물을 `tasks/<task>/artifacts/`에만 (외부 repo 미적용)
- `"src/**, tests/**"` 같은 경로 패턴 — 외부 repo의 해당 경로. 아래 4조건 모두 충족 시에만 Orchestrator가 적용

### 외부 repo 적용 조건 (모두 충족 필수)

1. `brief.md`에 `target_repo: <절대 경로>` 명시
2. `brief.md`에 `write_scope: <허용 경로 패턴>` 명시 (예: `src/**`, `tests/**`)
3. `task.md`의 `workers_approved`에 해당 worker 항목이 있고, `write_scope`도 함께 승인됨
4. `log.md`에 `[APPROVAL]` 태그로 외부 쓰기 승인 별도 기록

위 4개 중 하나라도 누락 → `tasks/<task>/artifacts/`에만 diff·patch 보관 (사용자가 직접 적용).

Orchestrator는 `_shared/`, `_templates/`, 다른 작업 폴더에 worker 산출물을 적용하지 말 것.

## CLAUDE.md 적용 범위

이 파일은 **Claude Code를 `<설치한-폴더>/` 또는 그 하위에서 실행**할 때만 적용됨.

```bash
cd <설치한-폴더> && claude
```

다른 디렉토리에서 실행 시 적용 안 됨 (의도된 격리).  
전역 `~/.claude/CLAUDE.md`에 포함하지 말 것 — orchestration 규칙이 다른 프로젝트로 새어나감.
