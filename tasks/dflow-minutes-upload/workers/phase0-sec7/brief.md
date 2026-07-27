# brief — Phase 0 묶음 A (§7 마이그레이션·자동링크)

target_repo: /Users/jji/project/ddobakddobak
write_scope: tasks/dflow-minutes-upload/artifacts/ddobak-folder-path-worklist-2026-07-27.md
output_format: 수정 후 변경 요약 (항목별 1줄 + 변경 위치)

## 대상 파일 (이것만 수정)

`tasks/dflow-minutes-upload/artifacts/ddobak-folder-path-worklist-2026-07-27.md` 의 **§7**

## 근거 문서 (읽기만)

- `ddobak-worklist-sync-gap-2026-07-27.md` — 갭 B-1·B-2·B-4·B-5·B-6, A③④
- `dflow-folder-path-worklist-2026-07-27.md` — D'Flow 확정본. **수정 절대 금지**

## 작업 6건

1. **D0-1** §7.2-2 — "team은 전송 때와 같은 규칙으로 판정"을 **"배치는 team을 보내지 않는다(§7.4 (a))"** 로 정정. 전송(W1)과 배치(W12)의 team 취급이 다름을 명시. 근거: D'Flow §8.2가 `items[].team`이 기존 `team_code`와 다르면 `failed(team_mismatch)`로 정의
2. **D0-8** §7.7 "대상 2" 판정에 `dflow_synced_at.present?` 추가 (§7.6-1과 동일 조건)
3. **D0-9** §7.7 C2에 "W2 **이전** 전송분은 접두 **포함** 변형으로 재생성, 두 변형 모두 시도" 명시
4. **D0-10** §7.2-5 로그 카테고리를 6종으로: `moved`/`already_correct`/`skipped(manual_placement|archived)`/`not_found`/`failed(team_mismatch|folder_name_too_long|validation_failed|no_team_root)`. `no_team_root`는 D'Flow §8.2-11 신규 — 시드루트 부재(거의 항상 0043 미적용), `folder_id` 미변경. ＋ §7.2-6·§7.3에 "`already_correct`가 `manual_placement`보다 먼저"(D'Flow §8.2-10)
5. **D0-12** ⚠️ §7.3에 미결 등재 — §8.3 판정기준이 dflow-W3 배포 후 거짓. 해소 (a)기준 교체 (b)3차를 2차 앞으로. **결론 금지, 선택지만**
6. **D0-13** ⚠️ §7.6 문구 완화 — `exists_on_dflow: false`는 초기화 전용 아님(archived 포함, `route.ts:304`). 복구 두 갈래가 둘 다 막힘. 문구를 "D'Flow에서 확인되지 않습니다(초기화·보관·삭제 중 하나)"로, 갈래에 "D'Flow에서 보관 해제 확인" 추가. (a)/(b) 확정은 **팀장 판단으로 남길 것**

## Do NOT

- §7 밖 절 수정 (다른 묶음이 처리)
- D'Flow 워크리스트·감사·갭 보고서 수정
- 미결 2건 임의 결론
- 커밋·푸시
