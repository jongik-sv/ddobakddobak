# Changelog

이 파일은 MultiAgent orchestration 시스템의 주요 변경을 기록한다.
형식은 [Keep a Changelog](https://keepachangelog.com/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따른다.

## [1.0.1] - 2026-06-01

모델·추론 정책 표기 정리(문서 patch). 동작 변경 없음.

### Changed
- **모델 식별자 별칭화** (`_shared/routing.md`): claude-main을 버전 문자열(`claude-opus-4-7` 등) 대신 별칭 `opus`로 표기 — 모델이 올라가도 문서 갱신 불필요. codex 예시 일반화, gemini는 `gemini-3.1-pro-low` 핀 유지 + "프록시 업그레이드 시에만 갱신" 노트.
- **claude-main 추론 강도(effort) 명문화**: `effort` 핀 없음 → 세션 `/effort` 상속(현 기본). 고정하려면 frontmatter `effort:`.

### Added
- **design-basis D7**: 모델 식별자 표기 정책(별칭 원칙 / gemini 핀 예외·세부는 D4 정본 / effort 비대칭 근거).

### Verification
- codex-critic adversarial 검수: 치명 0, 권장 3 반영(잔존 핀 제거 포함). INV9/INV10/INV11 PASS, 회귀 없음.

## [1.0.0] - 2026-06-01

첫 버전 태깅. 기존 실사용 시스템을 1.0.0 기준선으로 고정하고, harness(revfactory) 참고 버전 업그레이드를 함께 반영한다.

### Added
- **작업 재진입 프로토콜** (`_shared/orchestrator-rules.md` §3): 콜드세션이 끝난 작업에 다시 들어갈 때 재정박(re-anchor) → 6분기 판단 → 에러 후 진행. `status↔log 불일치`는 다른 분기보다 먼저 적용하는 정규화 단계로 명시.
- **토폴로지 4패턴표** (`_shared/routing.md`): Pipeline / Fan-out·Fan-in / Expert Pool / Producer-Reviewer + Fan-in 규칙.
- **CLAUDE.md** Task Lifecycle에 재진입 프로토콜 포인터.
- **불변식 INV11** (`_shared/system-invariants.md`): 재진입·토폴로지 규정 자동 자가점검(11a/b/c).
- **design-basis D6**: 4패턴 채택 + Supervisor·Hierarchical Delegation 배제 근거.

### Excluded (설계 결정)
- Supervisor·Hierarchical Delegation 패턴: 단일 orchestrator·worker간 무통신·file-as-memory와 충돌하여 미채택 (근거 D6).

### Baseline (1.0.0 시점 핵심 구조)
- 고정 4-worker pool (claude-main / codex-main / codex-critic / gemini), Claude Code 세션 = orchestrator.
- file-as-memory (런타임 상태 0): task / context / log / brief / result.
- 승인 게이트(`workers_approved`), 외부 쓰기 4조건, progressive disclosure(게이트 로드), 권위 우선순위(CLAUDE.md > routing/approval/orchestrator-rules > 매뉴얼).

### Verification
- 배선(INV11a/b/c) PASS · 회귀 없음, 탁상 분기 커버리지, 실전 콜드세션 3/3 PASS, codex-critic adversarial 리뷰 5 ISSUE 반영.

[1.0.1]: https://github.com/netwaif/multi-agent-starter/releases/tag/v1.0.1
[1.0.0]: https://github.com/netwaif/multi-agent-starter/releases/tag/v1.0.0
