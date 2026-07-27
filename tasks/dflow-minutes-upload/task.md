# task: dflow-minutes-upload

status: in_progress
created: 2026-07-19
updated: 2026-07-27

## 목표

또박또박 회의록을 D'Flow(wbs-web)에 업로드하는 연동. 현 단계는 **`folder_path` 폴더 계층 전송**으로,
D'Flow가 또박또박 폴더 트리를 그대로 재현해 편철하게 만든다.

## 현재 단계 — 워크리스트 정합화 + 1차 구현

D'Flow 측 워크리스트(`dflow-folder-path-worklist-2026-07-27.md`)는 적대 감사를 반영한 **확정본**이고,
또박또박 측(`ddobak-folder-path-worklist-2026-07-27.md`)은 **감사 이전 원본**이다.
대조 결과 D'Flow가 명시 요청한 7건(§11.3) 반영 0건 + 미전달 계약 6건 + 누락 작업 1건.

- Phase 0 (**done** 2026-07-27) — 문서 정합. 385 → 518행, W 항목 17 → 19개, 배포 차수 4 → 6단. 미결 4/4 유지
- Phase 1 (**done** 2026-07-27) — 1차-a 코드 4건. W10은 backend만(frontend spec은 2차분 — 통째 완료 표기 금지)
- 1차-b (**W17 done** 2026-07-27) — 덮어쓸 D'Flow 회의록 제목·날짜 표시
- **Phase 2 (진행 중)** — 결정 정본 `decisions-final-2026-07-27.md` 수령(2026-07-27). 미결 4건 전부 확정
- Phase 3+ (블록) — D'Flow R1 배포 대기

### 결정 정본 반영 (진행 중)

**정본이 결정 권한이다.** `decisions-proposed`와 어긋나면 정본이 이긴다(전제 3개가 뒤집힘 — `handoff-2026-07-27.md` §2).

1. **`ddobak-W14`** — B-4가 (a)로 확정 + `include_archived`가 dflow-R1에 포함 → 1차-b에서 완결 가능.
   §7-3 ①(status 호출에 `include_archived=true`)과 **한 몸**이다
2. **워크리스트 미결 4건 해제** + §5 배포표를 정본 §3 순서로 교체 + `ACTOR_EMAIL` + 재편철 6단계
3. **D'Flow 회신** — 정본 §7의 11건 중 8·9·10은 Phase 0에서 이미 완료(D'Flow가 모름), 1은 답 확정(배포 안 됨)
4. **실서버 읽기 전용 조회 대기** — §7-2 폴더 깊이 분포 · §7-7 `[]` 건수 · §7-11 중복 · §8 부록 19건 `to`

실행 원장: `artifacts/exec-state.md`
실행 절차: `artifacts/exec-loop-prompt-2026-07-27.md`

## workers_approved

| worker | 승인일 | 범위 | write_scope |
|---|---|---|---|
| claude-main (서브에이전트 dispatch) | 2026-07-27 | Phase 0 문서 정합 14건 · Phase 1 코드 4건 | `tasks/dflow-minutes-upload/artifacts/**` (Phase 0)<br>`backend/app/services/**`, `backend/spec/**`, `frontend/src/api/**` (Phase 1) |
| claude-main (서브에이전트 dispatch) | 2026-07-27 | 1차-b `W17` | `backend/app/controllers/**`, `backend/spec/**`, `frontend/src/api/**`, `frontend/src/components/meeting/**` |
| claude-main (서브에이전트 dispatch) | 2026-07-27 | Phase 2 — `W14`＋`include_archived` · 워크리스트 결정 반영 · D'Flow 회신문 | `backend/app/controllers/**`, `backend/spec/**`, `frontend/src/api/**`, `frontend/src/components/meeting/**`, `tasks/dflow-minutes-upload/artifacts/**` |

사용자 승인: 2026-07-27 "task.md 만들고 Phase 0 시작해줘" · "W17만 먼저 진행해줘" · "이 후 진행해"(결정 정본 반영)

## constraints

- ⛔ 또박또박·D'Flow 어느 쪽에서도 회의(회의록) 삭제 금지 (사용자 결정 2026-07-28, 예외 없음)
- 커밋·푸시 금지 (명시 요청 없이)
- `dflow-folder-path-worklist-2026-07-27.md` 수정 금지 (D'Flow 확정본)
- Phase 2 이후 항목 착수 금지 (D'Flow 미배포)
- ⚠️ 미결 2건(D0-12 §8.3 판정기준 · D0-13 archived 오진)은 선택지 등재만. 임의 결론 금지
- 러닝 dev 서버 실요청 / 실 `settings.yaml` 변경 금지
- 메인 스레드 직접 Edit 금지 — 서브에이전트 dispatch만

## Do NOT

- 워크리스트 원문을 Phase 0 항목 외의 이유로 고쳐 쓰기
- `db/migrate`에 파일 추가 (러닝 Rails dev 전 요청 500)
- 감사 보고서·갭 보고서 수정 (근거 문서)

## artifacts

| 파일 | 성격 |
|---|---|
| `dflow-minutes-upload-api-spec.md` | 계약 사본 v2.1 (정본 = wbs-web v2.2, 동기화 대기) |
| `ddobak-dflow-sender-spec.md` | 또박또박 전송 구현 스펙 |
| `folder-compat-review-2026-07-27.md` | 배경 갭 분석 · 결정 D1~D6 SSOT |
| `dflow-folder-path-worklist-2026-07-27.md` | **D'Flow 작업지시 — 확정본. 수정 금지** |
| `ddobak-folder-path-worklist-2026-07-27.md` | 또박또박 작업지시 — **Phase 0 수정 대상** |
| `worklist-conflict-audit-2026-07-27.md` | 두 지시서 상충 감사 (생존 34건) |
| `ddobak-worklist-sync-gap-2026-07-27.md` | D'Flow 대조 갭 보고 — Phase 0 근거 |
| `exec-loop-prompt-2026-07-27.md` | 실행 절차 · 체크리스트 원본 |
| `exec-state.md` | 진행 원장 |
