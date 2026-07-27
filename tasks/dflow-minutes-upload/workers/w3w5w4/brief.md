# brief — ddobak-W3 → W5 → W4 (team 완화 · 에러 매핑 · 길이/깊이 검사)

target_repo: /Users/jji/project/ddobakddobak
write_scope: `backend/app/services/dflow_upload_service.rb` · `backend/app/controllers/api/v1/meeting_dflow_controller.rb` · `backend/spec/services/dflow_upload_service_spec.rb` · `backend/spec/requests/api/v1/meeting_dflow_spec.rb` · `frontend/src/lib/dflowAutoAssign.ts`(+test) · `frontend/src/components/meeting/SendToDflowDialog.tsx`(+test)
output_format: 항목별 변경 · 핵심 diff · 검증 명령 실제 출력 · 브리프 이탈
근거: 워크리스트 §4 `W3`·`W4`·`W5` · §6 · `decisions-final-2026-07-27.md` §2-C

## ⚠️ 배포하지 않는다 — 구현만

2차 항목이다. **D'Flow R2(플래그 `true`) 이후 배포.** 지금은 브랜치 커밋만. `main` 병합 금지.

## ⚠️ 순서를 지켜라 — W3 → W5 → W4

워크리스트가 명시한다: **`W5`(에러 매핑)가 `W4`(에러를 던지는 검사)보다 먼저다.** 역순이면 새 에러가 rescue되지 않아 **500**이 난다.

---

## 1. W3 — `resolve_team!` 완화

현재(`dflow_upload_service.rb#resolve_team!`):
```
team_override 있으면 그대로 → 없고 루트명이 teams에 있으면 그것 → 아니면 TeamRequiredError
```

워크리스트 요구: "루트명이 `teams`에 있으면 그대로, 없으면 `TeamRequiredError` 대신 **다이얼로그 선택값을 요구**".
⚠️ 워크리스트가 **직접 못박는다**: "**override 경로는 이미 라이브다** — `W3`은 그 경로를 정식화하고 자동판정을 완화하는 작업이지 **새 능력을 여는 것이 아니다**."

→ **먼저 현재 동작이 이미 요구를 충족하는지 확인하라.** 프런트도 확인할 것 — `SendToDflowDialog.tsx`의 `needsTeamSelect`가 `detectDflowTeam` null을 이미 "선택 필요"로 다루는지.

**이미 충족한다면 코드를 억지로 바꾸지 말 것.** 대신:
- 에러 메시지·코드가 "실패"가 아니라 **"team 선택이 필요하다"**로 읽히는지 점검하고 필요하면 문구만 다듬어라
- **자유 루트 + override → 전송 성공**을 못박는 spec을 추가하라(현재 회귀 감지가 없다)
- 무엇이 이미 충족돼 있었는지 보고에 명시

`dflowAutoAssign.ts#detectDflowTeam`은 유지하되 "미판정 = 실패가 아니라 team 선택 필요"임이 주석·테스트로 드러나게 하라.

---

## 2. W5 — 에러 매핑 (W4보다 **먼저**)

`meeting_dflow_controller.rb#handle_upload_precondition_error`의 `case`에 **W4가 던질 새 에러**를 추가한다.
현재 매핑: `NotEnabledError`·`NotCompletedError`·`NotesBlankError`·`TeamRequiredError`·`BodyTooLongError`.

⚠️ `case`에 안 걸리면 `code`가 **`nil`로 조용히 렌더**된다(에러는 안 나고 프런트가 코드로 분기 못 함). 새 에러 클래스를 만들면 **반드시 여기 추가**.
⚠️ `rescue_from` 등록도 확인하라 — 컨트롤러 상단에 `DflowUploadService::…` rescue 목록이 있다. 새 에러가 거기 없으면 **500**이다.

---

## 3. W4 — 폴더명 길이 검사(차단) ＋ 깊이 경고(비차단)

### 3-a. 길이 검사 — **서비스에서 차단**

D'Flow는 폴더명 **61자 이상이면 400**을 낸다. 또박또박은 폴더명을 100자까지 허용한다.
전송 전에 `folder_path` 체인을 검사해 61자 이상이 있으면 **전용 에러로 중단**하고, **어느 폴더인지 이름을 담아** 안내하라. D'Flow 400을 그대로 노출하면 사용자가 원인을 못 찾는다.

### 3-b. 깊이 경고 — **차단하지 말 것.** 위치를 스스로 판단하라

정본 §2-C 확정: 깊이 5 초과는 D'Flow가 **절단**한다(400 아님). 또박또박은 **사전 경고만** 한다.
계산식(정본이 D'Flow 코드와 일치함을 확인해 준 것):
```
folder_path.length + (루트가 팀코드면 0, 아니면 1)   > 5  → 경고
```

⚠️ **팀 목록을 하드코딩하지 말 것** — D'Flow 팀은 런타임 마스터다. `GET /minutes/meta`의 `teams`를 쓸 것(프런트는 이미 `meta.teams`를 받아 온다).

⚠️ **설계 판단이 필요하다 — 근거와 함께 결정하고 보고하라.** 서비스는 "성공 아니면 예외"뿐이라 **비차단 경고를 실어 보낼 곳이 없다**(upload 응답에 값을 싣는 것은 `ddobak-W19` 소관이고 2차 미착수). 반면 다이얼로그는 `folderPath`와 `meta.teams`를 이미 갖고 있고, **team 선택이 끝난 시점**을 안다(워크리스트가 "`teamOverride` 확정 후 재평가"를 요구하는 지점이 정확히 여기다).
→ **권고: 깊이 경고는 프런트(전송 다이얼로그)에.** 계산 함수는 `dflowAutoAssign.ts`에 순수 함수로 두고 테스트하라. 다른 판단이 낫다고 보면 근거를 대고 그렇게 하되, **차단은 하지 말 것.**

⚠️ 실측상 **현재 발동 0건**이다(실효 깊이 최대 2, 5 초과 0건 — `prod-survey-2026-07-27.md` §1). 경고 경로가 실제로 뜨는지는 **테스트로만 확인**되므로 케이스를 반드시 넣어라.

---

## 검증 (TDD — 테스트 먼저)

- `cd backend && bundle exec rspec spec/services/dflow_upload_service_spec.rb spec/requests/api/v1/meeting_dflow_spec.rb`
  케이스: 자유 루트 + override → 성공 / override 없고 루트 미판정 → `team_required` / 폴더명 61자 → 전용 코드 ＋ **메시지에 폴더명 포함** / 60자 → 통과
  ⚠️ **WebMock 없음** — 기존 `instance_double` 관례를 따를 것
- `bundle exec rubocop <변경 파일>`
- `cd frontend && npx tsc -p tsconfig.app.json` ← **전체 0이 기준. bare tsc는 거짓 green**
- `npx vitest run src/lib/dflowAutoAssign.test.ts src/components/meeting/SendToDflowDialog.test.tsx`

## Do NOT

- `Meeting#dflow_auto_title`·`buildDflowTitle` 손대기 — **`W2`·`W6`가 방금 고친 자리다**(다른 에이전트). 읽기만
- `upload` 액션의 응답 조립 손대기 — `ddobak-W19`(2차) 소관
- `folder_path` 전송 로직(`dflow_folder_path_names`) 변경
- 깊이 초과를 **차단**하기 (정본 §2-C 위반)
- 팀 목록 하드코딩
- `main` 병합 · 커밋 · 푸시 · `db/migrate` 파일 추가 · 러닝 dev 서버 실요청
