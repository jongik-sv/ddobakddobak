# Task: rewrite-personal-app-research

status: done
created: 2026-07-04
target_repo: 없음 (분석·기획 — 산출물은 artifacts/에만)

## Goal

또박또박을 "서버 개념 없는 개인용 회의 관리 앱"(macOS + Android, 단일 실행체)으로
재작성하는 방안을 다각 검토하고, **재작성 자체가 유리한지(타당성)** 를 포함한
보고서 문서를 작성한다.

## 사용자 요구 (원문 요지)

1. 완벽한 macOS 앱 + Android 앱으로 재작성하는 프로젝트를 만들고 싶다
2. AI 요약(mermaid) 부분은 지금 컴포넌트를 그대로 사용 — 웹뷰가 필요한지 확인
3. 서버/frontend 구분 없는 단 하나로 동작하는 구조
4. 여러 방법 검토 → 보고서 문서
5. (추가) 조사 필요하면 조사할 것
6. (추가) 재작성하는 것이 유리한지도 검토해서 보고서에 포함
7. (추가) 원하는 것 = 서버 개념 없이 개인적으로 회의를 관리하는 앱

## Constraints

- 산출물: 보고서 1건 → `artifacts/` (외부 repo 쓰기 없음)
- 코드 변경 없음 (read-only 분석)

## workers_approved

- (외부 worker pool 미사용 — claude-main/gemini 호출 없음.
  Orchestrator 내부 서브에이전트(Workflow)만 사용: 사용자 durable 지시
  "구현 실행은 무조건 서브에이전트 방식, 필요시 Workflow 병용, inline 묻지 말 것" + ultracode 세션)
