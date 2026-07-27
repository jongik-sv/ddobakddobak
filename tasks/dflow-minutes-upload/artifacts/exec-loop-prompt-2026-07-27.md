# 실행 루프 프롬프트 — `folder_path` 작업 (2026-07-27)

> 대상 워크리스트: `tasks/dflow-minutes-upload/artifacts/ddobak-folder-path-worklist-2026-07-27.md`
> 감사: `worklist-conflict-audit-2026-07-27.md`
> D'Flow 대조 결과: `ddobak-worklist-sync-gap-2026-07-27.md` ← **Phase 0 항목의 근거**
> 실행 가능 범위: **Phase 0(문서 정합 14건) + Phase 1(1차 코드 4건)**. 2차 이후는 D'Flow 미착수로 전면 블록.

---

## 사전조건 (루프 시작 전 1회, 사람이 처리)

1. `tasks/dflow-minutes-upload/task.md` 가 없다. CLAUDE.md §Task Lifecycle 위반 상태 — 루프가 서브에이전트를 부르려면 `workers_approved` 기록이 필요하다. 첫 tick이 이 파일을 만들고 **승인 요청 후 정지**하도록 설계돼 있다.
2. Rails dev 서버가 떠 있으면 그대로 둬도 된다 (이 작업은 `db/migrate` 파일을 만들지 않음).
3. **D'Flow 워크리스트는 확정본이다.** Phase 0는 또박또박 문서만 고친다 — `dflow-folder-path-worklist-2026-07-27.md`를 수정하지 말 것.

---

## 붙여넣을 프롬프트

```
/loop ddobak-folder-path 워크리스트를 실행한다. 매 tick 한 항목씩.

## 상태 파일
tasks/dflow-minutes-upload/artifacts/exec-state.md
없으면 아래 "초기 체크리스트"로 생성하고 그 tick은 종료.

## 매 tick 절차
1. exec-state.md 읽기. 다음 미완(`[ ]`) 항목 1개 선택 — Phase 0 전부 → Phase 1 순서.
2. 남은 미완이 전부 Phase 2+ 이면 → ScheduleWakeup stop:true 호출하고 "D'Flow W1~W5 미배포로 대기" 보고 후 종료.
3. 선택 항목을 서브에이전트로 dispatch. 메인 스레드는 직접 Edit 금지 — 오케스트레이션만.
   - 문서 수정(Phase 0) = sonnet
   - 코드 구현(Phase 1) = sonnet, TDD (테스트 먼저)
   - 조사만 필요하면 haiku
   - 실패 시 재디스패치. 능력 부족이 원인이면 한 단계 승급, 2회 승급 후에도 실패면 보고하고 stop.
4. 검증 (아래 "검증 명령"). 실패하면 같은 항목을 fix 브리프로 재디스패치 — 인라인 수정 금지.
5. exec-state.md 항목을 `[x]`로 갱신 + 한 줄 근거(변경 파일·검증 결과).
6. tasks/dflow-minutes-upload/log.md 에 `[YYYY-MM-DD HH:MM] [ACTION]` append (append-only).

## 금지
- 커밋·푸시 (명시 요청 없이 금지)
- Phase 2 이후 항목 착수 (D'Flow 미배포)
- dflow-folder-path-worklist-2026-07-27.md 수정 (D'Flow 확정본)
- 러닝 dev 서버에 실요청 / 실 settings.yaml 변경
- ⚠️ 미결 2건(D0-12·D0-13)을 임의로 결론내기 — 선택지를 문서에 등재만 하고 팀장 판단으로 남긴다

## 검증 명령
- backend: `cd backend && bundle exec rspec spec/services/dflow_upload_service_spec.rb`
- frontend 타입: `cd frontend && npx tsc -p tsconfig.app.json`  ← 전체 0이 기준. bare tsc는 거짓 green
- frontend 테스트: `cd frontend && npx vitest run src/lib/dflowAutoAssign.test.ts src/components/meeting/SendToDflowDialog.test.tsx`
- Phase 0 항목은 코드 검증 없음 — 대신 수정 후 해당 절을 다시 읽어 D'Flow 문서의 대응 절과 문구가 어긋나지 않는지 확인

## 초기 체크리스트 (exec-state.md 최초 생성 내용)

### Phase 0 — 문서 정합 (또박또박 워크리스트만 수정)
대상: ddobak-folder-path-worklist-2026-07-27.md
근거: ddobak-worklist-sync-gap-2026-07-27.md (D'Flow 대조) + worklist-conflict-audit §F
우선순위 = 갭 보고서 §F 순서. D0-1·D0-2는 **작업 정의 자체가 바뀐다**, 나머지는 문서 편집.

- [ ] D0-1 (갭 B-1) **§7.2-2 team 취급 정정** ⚠️ 최우선 — 구현 즉시 터지는 함정.
      현재 §7.2-2 = "team은 전송 때와 같은 규칙으로 판정"인데 같은 문서 §7.4 결론은 "(a)로 간다 = team 생략".
      D'Flow §8.2가 `items[].team`이 주어졌는데 기존 `team_code`와 다르면 `failed(team_mismatch)`로 새로 정의했다
      → 문언대로 구현하면 W12가 team을 실어보내고 해당 건 전부 실패.
      §7.2-2를 "배치는 team을 보내지 않는다(§7.4 (a))"로 정정하고, 전송 경로(W1)와 배치 경로(W12)의
      team 취급이 다르다는 점을 명시.
- [ ] D0-2 (갭 C) **api-spec 사본 동기화 작업 신설** — 현재 워크리스트에 아예 없다.
      D'Flow W8이 정본을 `wbs-web/docs/design/dflow-minutes-upload-api-spec.md` v2.2로 지정했고
      또박또박 사본은 v2.1, 이미 21행 갈라져 있으며 **둘 다 folder_path 언급 0건**.
      살아 있는 충돌 문장 3개: `§0 D10`(제목 접두 규칙) · `§4.2`(필드표에 folder_path 없음) · `§4b`("해제 API 미제공").
      W11을 확장하거나 신규 W로 등재. **실행은 D'Flow W8 완료 후**(정본이 먼저) — Phase 2로 배정하되 항목은 지금 만든다.
      방향 고정: wbs-web → 또박또박. 반대 금지.
- [ ] D0-3 (갭 A①⑦ / 감사 F.0) **§5 배포표 재구성** — 1차를 `W1·W9·W10·W11`로 축소.
      W4·W6·W7은 2차로. W14·W17은 4차 → 1~2차로(둘 다 D'Flow 의존 0 — `exists_on_dflow`는 오늘 응답에 이미 있고
      W17도 D'Flow §9.5가 "추가 변경 없음" 확인).
      ＋ §8 수용기준 "전송 제목에 접두 없음"의 귀속을 **W2 → W6**(또는 W2+W6)으로 정정.
      근거: UI 전송 title은 항상 프런트 `titleOverride`가 이긴다(`dflow_upload_service.rb:33`).
- [ ] D0-4 (갭 A⑤ / 감사 C-1) **§5 "W3 선배포 금지" 근거 정정** + §1 표의 "루트가 팀코드가 아니면 전송 자체 실패" 정정.
      사실: `dflow_upload_service.rb:75-76`이 `@team_override`를 즉시 반환하고 `SendToDflowDialog.tsx:117-127`이
      team 셀렉트를 노출하므로 자유 루트 전송은 **오늘도 성공한다**. 평평 안착 노출은 W3와 무관하게 이미 라이브.
      실제 조치(그 기간 UI 보류 or 3차 재편철로 정리)를 명시할 것.
      ⚠️ 후자를 택하면 D0-12의 (b)안과 같은 결정이 되므로 §5 차수표를 함께 개정해야 한다.
- [ ] D0-5 (갭 A / 감사 A-6) §5 배포표의 모든 W 번호에 `ddobak-` / `dflow-` 접두.
      D'Flow 문서는 머리말에 표기 규약을 명문화하고 전 문서에서 지키고 있다 — 같은 규약을 따를 것.
- [ ] D0-6 (갭 A② ) **W8(응답 folder_path 표시)을 `권장` → `✅` 승격 + §5 배포표에 차수 배정**(dflow-W4 의존 표기).
      근거: D5로 사전 미리보기를 포기했으므로 응답 에코가 절단·한 칸 내림의 **유일한** 사후 피드백 경로.
      현재는 사전 미리보기(포기) + 사후 확인(미배정) 둘 다 없는 상태가 가능하다.
- [ ] D0-7 (갭 B-3 / A⑥) **미분류 폴백 응답값 `folder_path: null` 서술 추가** — §3.3에 null 케이스가 아예 없다.
      D'Flow §3.3이 `folder_id: null` + `folder_path: null`(⚠️확정 필요)로 제안했고 `[]`(팀 루트 편철 성공)와 구분한다.
      §3.4 3값 규약대로 `[]`로 렌더하면 미분류를 "팀 루트에 편철됨"으로 정반대 안내한다.
      ＋ W9 항목에 타입 `string[] | null`·`folder_id: string | null`과 "미분류로 들어갔습니다" 문구 요구 추가.
- [ ] D0-8 (갭 A③ ) §7.7 "대상 2" 판정에 `dflow_synced_at.present?` 추가(§7.6-1과 동일 조건).
      근거: `public_uid`가 있고 D'Flow에 없는 상태는 초기화 말고도 (i)전송 실패(`meeting.rb:418-425`)
      (ii)수동 연결(`meeting_dflow_controller.rb:68-69`, `dflow_synced_at: nil`)로 도달한다.
- [ ] D0-9 (갭 A④ ) §7.7 C2에 "W2 **이전** 전송분은 접두 **포함** 변형으로 재생성, 두 변형 모두 시도" 명시.
      C2가 메서드 이름으로 `dflow_auto_title`을 지목하는데 W2 이후 그 이름의 기본 동작은 접두 없는 제목이다
      → 문언대로 구현하면 오늘의 C2 모집단 전부와 0건 매칭.
- [ ] D0-10 (갭 B-2·B-4 / 감사 R2-10) **§7.2-5 로그 카테고리를 6종으로 확장 + 판정 선후 명시**.
      6종 = `moved` / `already_correct` / `skipped(manual_placement|archived)` / `not_found` /
      `failed(team_mismatch|folder_name_too_long|validation_failed|no_team_root)`.
      ★ `no_team_root`는 D'Flow §8.2-11이 새로 만든 status다 — 시드 루트 부재(거의 항상 **0043 미적용**)를 뜻하고
      `folder_id`를 건드리지 않는다. `failed` 뭉치에 섞으면 진짜 원인이 리포트에서 사라진다.
      ＋ §7.2-6·§7.3에 "`already_correct`가 `manual_placement`보다 **먼저**"(D'Flow §8.2-10) 반영 —
      그러지 않으면 재실행 dry-run에서 방금 옮긴 건이 전부 `manual_placement`로 집계돼
      `OVERWRITE_MANUAL` 판단 근거가 오염된다.
- [ ] D0-11 (갭 D-1~D-5) **인지 항목 5줄 등재**(§6 주의 절에 추가, 또박또박 작업은 없음):
      D-1 dflow-W1-b 전까지 6번째 팀 등록 시 `POST /minutes`가 400 전건 거절(`externalApi.ts:156` 하드코딩 5팀)
      D-2 접두 제거의 zip 부수영향은 이름 변경이 아니라 **분할**(`품질-주간회의` ≠ `주간회의`)
      D-3 초기화된 D'Flow 회의록이 **후보 풀에 잔존** — 다른 회의가 exact+유일로 claim할 수 있다
      D-4 배치 폴더 `created_by` = `ACTOR_EMAIL` 계정 → 어느 계정으로 돌릴지 **사전 합의 필요**
      D-5 dflow §6 D&D를 3차보다 먼저 배포하면 그 건들이 전부 `manual_placement` skip → 부분 일치가 '완료'로 보고
- [ ] D0-12 (갭 B-5) ⚠️ **미결 등재만** — §8.3 `manual_placement` 판정 기준이 dflow-W3 배포 후 거짓이 된다.
      해소 (a) 판정 기준 교체(마지막 전송 시각 이후 이동 여부) / (b) **3차를 2차보다 앞세움**.
      §5·§7.3에 ⚠️로 등재하고 **결론내지 말 것**. (b)는 D0-4와 같은 결정이다.
- [ ] D0-13 (갭 B-6) ⚠️ **미결 등재 + 문구 완화** — `exists_on_dflow: false`는 초기화 전용 신호가 아니다.
      `route.ts:304`가 `archived_at is null`을 `external_id` 필터 포함 모든 질의에 적용 → **보관만 해도** false.
      그때 §7.6이 제시하는 복구 두 갈래가 **둘 다 막힌다**([찾기]는 `linked=false` 목록에도 없음 / [새로 전송]은 409 archived).
      해소 (a) D'Flow가 보관 상태 구분 노출(권고) / (b) 또박또박 문구 완화.
      최소 조치로 §7.6·W14 문구를 "D'Flow에서 확인되지 않습니다(초기화·보관·삭제 중 하나)"로 바꾸고
      복구 갈래에 "D'Flow에서 보관 해제 확인"을 추가. (a)/(b) 확정은 팀장 판단으로 남긴다.
- [ ] D0-14 문서 정합 최종 확인 — Phase 0 완료 후 두 워크리스트의 §3(계약)·§5/§11.2(배포표)·§7/§8(마이그레이션)을
      나란히 읽고 남은 어긋남이 없는지 점검. 발견분은 exec-state.md 하단 "확인 필요"에 적는다.

### Phase 1 — 1차 코드 (D0-3 재구성 후의 "진짜 무해" 4건)
- [ ] W1 `backend/app/services/dflow_upload_service.rb:44-52` — 페이로드에 `folder_path: @meeting.dflow_folder_chain.reverse.map(&:name)`.
      ⚠️ `dflow_folder_chain`은 **leaf-first**(`meeting.rb:603-605`) → `.reverse` 필수. 계약은 root-first.
      폴더 없는 회의는 키 생략이 아니라 `[]` 전송(§3.4 3값 규약).
- [ ] W9 `frontend/src/api/dflow.ts` — 응답 타입에 `folder_id: string | null`·`folder_path: string[] | null` 추가.
      ⚠️ nullable 필수 — D'Flow §3.3이 미분류 폴백 시 **둘 다 null**로 제안했다(D0-7).
- [ ] W10 테스트 — `dflow_upload_service_spec.rb`에 (a) root-first 순서 고정 (b) 폴더 없음 → `[]` (c) 다단 체인 조립.
      ⚠️ 이 레포엔 WebMock 없음 — `instance_double(Net::HTTP)` 관례.
      길이 검사·team override 케이스는 W4·W3가 2차로 밀렸으므로 이번엔 제외.
- [ ] W11 `tasks/dflow-minutes-upload/artifacts/ddobak-dflow-sender-spec.md` §1.3·§1.4 개정.
      ⚠️ api-spec 사본 동기화는 **별개 항목**이다(D0-2) — dflow-W8 완료 후 Phase 2에서 수행.

### Phase 2+ — 착수 금지 (D'Flow 선행)
- 2차 W2·W3·W4·W5·W6·W7 — dflow-W1~W5 배포 후
- 2차 api-spec 사본 동기화(D0-2가 만든 항목) — **dflow-W8 완료 후**. 방향: wbs-web v2.2 → 또박또박
- 3차 W12·W13 — dflow-W6(`POST /minutes/folder`) 배포 후. ⚠️ D0-12가 3차를 2차 앞으로 당길 수 있다
- 4차 W15·W16 — dflow-W10(연결 초기화) 배포 후. 초기화가 오매칭의 유일한 되돌리기 수단
  (W14·W17은 D0-3에서 1~2차로 이동)
현재 wbs-web `main`에 folder_path 관련 커밋 0건. 위 전부 대기.
```

---

## 변형 — D'Flow 배포 폴링 루프

Phase 0·1을 끝낸 뒤 2차를 기다릴 때만 쓴다. 위 루프와 동시에 돌리지 말 것.

```
/loop wbs-web 레포에서 folder_path 구현 배포 여부를 확인한다.
cd /Users/jji/project/wbs-web && git fetch && git log --oneline origin/main -20 후
src/app/api/v1/minutes/route.ts 에 folder_path 처리가 들어왔는지,
docs/design/dflow-minutes-upload-api-spec.md 가 v2.3+로 개정됐는지(= dflow-W8) grep.
folder_path가 들어왔으면 또박또박 2차(W2·W3·W4·W5·W6·W7) 착수 가능,
api-spec이 개정됐으면 사본 동기화 착수 가능하다고 각각 보고하고,
둘 다 확인되면 ScheduleWakeup stop:true.
아직이면 아무것도 하지 말고 대기.
```

간격은 붙이지 말 것(dynamic pacing). D'Flow 배포는 사람 일정이라 자체 페이싱이 20~30분 tick으로 수렴한다.
