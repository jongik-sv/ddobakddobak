# Task: dflow-meeting-select — 회의록 업로드 시 D'Flow 회의 선택·등록

- status: in_progress (또박또박 구현 완료·미커밋. 잔여: D'Flow 측 스펙 전달·구현, 수동 E2E)
- created: 2026-08-06
- target_repo: (또박또박) /Users/jji/project/ddobakddobak — 구현 승인 시
- 외부 스펙 대상: D'Flow(wbs-web) — 스펙 문서만 산출, 구현은 D'Flow 측 LLM
- workers_approved: (없음 — Orchestrator 내부 추론만 사용)

## 목표

또박또박 D'Flow 전송 다이얼로그에서:
1. D'Flow 프로젝트 → 회의를 선택해 회의록을 회의에 연결 (선택 사항)
2. 선택할 회의가 없으면 다이얼로그 안에서 신규 회의 등록(제목·날짜·구분)까지

## 확정 결정 (2026-08-06 사용자 확인)

- 회의 연결 = **선택** (미연결 전송 허용, 기존 플로우 하위호환)
- 탐색 = **프로젝트 → 회의 2단** (D'Flow 회의는 프로젝트 스코프)
- 신규 등록 필드 = **제목·날짜·구분(category)** 최소 3종
- 회의 생성 API = **A안: POST /api/v1/minutes inline `meeting` 객체** (원자적, 고아 회의 방지, dedup 멱등)

## 산출물

- `artifacts/dflow-meeting-create-spec.md` — D'Flow(wbs-web) 구현 스펙 (계약 v2.5, LLM 즉시 구현용)
- `artifacts/ddobak-meeting-select-design.md` — 또박또박 구현 설계

## 전제 (조사 실측 2026-08-06)

- D'Flow는 `meeting_id` 선택 연결·3값 규약(부재=유지/null=해제/uuid=변경)·occurrence 파생을 **이미 구현** (`src/app/api/v1/minutes/route.ts:337-383`)
- `GET /api/v1/minutes/meta?project_id=`가 회의 목록 `{id,title,date}` **이미 반환** (`meta/route.ts:42-50`)
- D'Flow에 없는 것 = 외부 API 회의 **생성** + meta 회의 필드 확장
- 또박또박에 없는 것 = 회의 선택 UI 전체 + meeting_id 전송 + 연결 상태 저장
