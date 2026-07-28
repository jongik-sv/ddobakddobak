# D'Flow 드리프트 대조 — `94e5eca` → `origin/feat/minutes-folder-path`(`7823391`) (2026-07-28)

> 조사 범위: `/Users/jji/project/wbs-web` 읽기 전용(`git show`/`git diff`/`git grep <ref>`만 사용, 워킹 트리·브랜치 미변경).
> 대상 커밋: `999814e`·`c60a1c9`·`274e8c6`·`f3d1aef`·`7823391` (총 9커밋, `94e5eca..origin/feat/minutes-folder-path`).

## 3줄 요약

1. **우리 구현(코드) 수정 필요 — 3건, 전부 D'Flow 드리프트와 무관한 우리 쪽 기존 NFC 정규화 누락.** `94e5eca`→`7823391` 사이 D'Flow의 **API 응답·검증 로직은 무변경**이다 — `externalApi.ts`에 닿는 diff는 딱 한 줄이고 그마저 `seg.trim().normalize('NFC')` → `normalizeFolderName(seg)`로 바꾼 **결과 동일한 리팩터**다(실제 버그가 있던 `validateFolderName`은 D'Flow 자체 웹 UI 전용 함수라 API 경로가 import하지 않는다). 하지만 이번 조사 중 **드리프트와 무관하게 ddobak 쪽 기존 결함 3건**(길이 검사 1건 + team 매칭 2건, 전부 동일 원인)을 발견했다 — 아래 "조치 필요".
2. **배포 계획은 안 바뀐다.** `docs/design/ddobak-notice-2026-07-28.md`(D'Flow 송부 패킷, 미송부)가 정리한 차수표(R1→R2→R3→R4)와 우리 `exec-state.md`의 차수 배정이 어긋나는 곳은 없다. 단 §5 회신 요청 #4(`[]`로 나갈 회의 건수, **2차 배포 전** 게이트)는 우리 DB에서 자체 집계 가능한 항목이라 별도 확인 여지가 있다(상세 조사는 범위 밖).
3. **가장 위험한 1건**: §4.5-11 "`team`만 바뀐 재전송은 R1에서도 폴더를 새 팀 루트로 옮긴다"는 **코드 변경이 아니라 문서 정정**(`999814e`는 "코드 변경 0")이다. 우리 `dflow_upload_service.rb`는 `folder_path`를 항상 보내지만(플래그가 꺼져 있으면 D'Flow가 통째로 무시하므로 무관), `team` 값이 재전송 사이 바뀌면 이 예외가 발동한다 — **버그 아님(D'Flow 의도된 동작)**. 문제는 발동 시점이다: 재편철 대상 20건 중 17건이 사람이 정리한 하위 폴더에 있는데, 이 예외가 발동하면 **팀 루트로 되돌아가** 재편철이 되감으려던 바로 그 상태를 재생산한다. 각주만으로는 부족 — dry-run 대조표 작성 후 APPLY 전까지 team이 바뀐 재전송이 없었는지 확인하는 절차가 필요하다(조치 필요 ④).

---

## 드리프트 표

| 항목 | `94e5eca` 시점 우리 전제 | `7823391` 실제 | 우리 코드 영향 | 조치 필요 |
|---|---|---|---|---|
| §4.8 "R1은 `POST /minutes`를 1비트도 안 바꾼다" | 완전 무동작으로 전제(우리 계약 사본에 그 문장 그대로 있음) | 예외 1건 명문화: `folder_path` 미제공(=플래그 꺼짐이면 항상 이 상태) 재전송에서 `team`만 바뀌면 새 팀 루트로 이동(§4.5-11). **코드는 `94e5eca` 시점에도 이미 이랬다** — `999814e` 커밋 메시지 "코드 변경 0", 소스도 확인(`src/app/api/v1/minutes/route.ts#handleExisting`의 `if (!folderUpdated && p.teamCode !== existing.team_code)`, `folderUpdated`는 플래그가 꺼져 있으면 `folder.provided`가 항상 false라 이 조건이 곧 "team 값 변경 여부"로 단순화됨) | 없음(코드) — D'Flow 의도된 동작, ddobak 쪽은 `team` 값을 무엇을 보내느냐만 결정. 단 재편철 운영 절차에는 영향 있음(3줄 요약 #3) | 문서·절차: `dflow-minutes-upload-api-spec.md` W18 재동기화(⑤) + 재편철 절차에 team 변경 확인 단계 추가(⑥) |
| D'Flow 자체 UI `validateFolderName` NFC 버그(`src/lib/domain/minutes.ts#validateFolderName`) | (몰랐음 — D'Flow 자체 웹 UI 코드) | 60자 검증이 NFC 정규화 전 원문 길이를 재던 버그를 `c60a1c9`가 수정 | 없음 — 우리가 호출하는 `src/lib/minutes/externalApi.ts#parseMinutePayload`(폴더명 세그먼트 길이 체크)는 **애초부터** `normalizeFolderName`(NFC) 후 길이 비교였다(`94e5eca` 시점에도 `seg.trim().normalize('NFC')` 후 비교 확인) | 없음 |
| R4 D&D 게이트 `MINUTES_FOLDER_DND_ENABLED`(`src/lib/minutes/flags.ts#folderDndEnabled`) | (신설 전) | D'Flow 자체 웹 UI 드래그앤드롭만 잠그는 신설 서버 액션 가드(`src/app/actions/minutes.ts`, `src/components/minutes/MinutesExplorer.tsx`) | 없음 — 외부 API 경로(`POST /minutes`, `POST /minutes/folder` 등) 전혀 관여 안 함 | 없음 |
| §2-E 9건(조상규칙·`from` nullable·`folder_path_status`·`include_archived`·전환플래그·배치 건별실패·`pmo_admin`게이트·NFC·`team_inactive`) | 사본이 v2.1일까 우려 | 우리 계약 사본은 이미 v2.4(`f0d0b62` 기준) 동기화 완료 상태였고, 선행 조사(`dflow-contract-v23-delta-2026-07-28.md`)가 9건 전부 "충실 반영·왜곡 0건" 확인 | 없음(구현 완료·검증 완료) | 없음 — 재조사 불필요 |
| 배치 200건 상한·`dry_run` 기본 true·`pmo_admin` 게이트(`403 forbidden_role`) | 구현대로 | `src/`에 diff 없음(코드 무변경) | 없음 | 없음 |
| `from: string[] \| null`(`dflow_folder_migration_service.rb#build_item_summary`) | `key?` 판정만, `Array()` 강제 없음 | 코드 무변경 | 없음 | 없음 |
| `include_archived` 3건 중 ①③(`meeting_dflow_controller.rb#status`) | 이미 `list_minutes(..., include_archived: true)` 반영 | 코드 무변경, 이미 구현 확인 | 없음 | 없음 |
| `include_archived` ②(자동 링크 `linked=true` 페이지 순회) | 미착수(`W15`/`W16`, Phase 3+ 블록) | 코드 무변경 | 착수 전이라 해당 없음 | Phase 3+ 재개 시 반영 대상으로만 기록 |
| **[신규 발견] 폴더명 길이 사전검사 NFC 미적용** | 우리 계약 사본(`dflow-minutes-upload-api-spec.md` §4.2 표, "★v2.4: 클라이언트도 NFC 기준으로 사전 검사할 것")이 이미 이 요구를 명시하고 있었으나 미반영 | (D'Flow 측 `c60a1c9`와 별개 — 이건 D'Flow 소스가 아니라 **ddobak 쪽 기존 결함**을 조사 중 발견) | `dflow_upload_service.rb#validate_folder_path_names!`·`FOLDER_NAME_MAX_CHARS`, `dflow_folder_migration_service.rb#partition_by_folder_name_length` 둘 다 `name.to_s.strip.length`(NFC 미정규화)로 60자 판정. macOS에서 만든 NFD 한글 폴더명은 NFC 기준 60자 이내여도 우리 쪽에서 먼저 `FolderNameTooLongError`로 거절될 수 있다(D'Flow API 자체는 NFC 후 판정이라 통과했을 케이스를 우리가 선제 차단) | **조치 필요** |
| **[신규 발견] team 자동 판정·경로 미리보기의 NFC 미적용** | (동일 — 계약이 "전 경로 NFC" D20을 요구) | 같은 원인, **더 넓은 범위**. 허용 team 목록 `PMO`·`ERP`·`MES`·`가공`·`MDM` 중 `가공`이 유일한 한글 — 정확히 재현 가능한 케이스: (a) `dflow_upload_service.rb#resolve_team!`의 `teams.include?(candidate)` — `candidate`(ddobak DB, NFD 가능)와 `teams`(D'Flow `meta`, NFC 리터럴) 비교라 NFD "가공" 폴더는 team 자동판정 실패 → `TeamRequiredError`. (b) `dflowAutoAssign.ts#detectDflowTeam`의 `teams.includes(root)` — 동일 비교, 프런트 미리보기 경로. (c) `dflowAutoAssign.ts#dflowRootIsResolvedTeamRoot`의 `root === resolvedTeam` — 이 비교가 틀리면 `dflowEffectiveFolderDepth`(깊이 경고 +0/+1)와 `dflowFolderPreviewPath`(미리보기 문구)가 **함께 틀린다** — 이 함수의 주석이 막으려던 바로 그 실패 모드 | **조치 필요** — 아래 ③④ |

---

## 조치 필요 목록

① **`backend/app/services/dflow_upload_service.rb#validate_folder_path_names!`**(및 `FOLDER_NAME_MAX_CHARS` 비교부) — 길이 비교를 `name.to_s.strip.length` → NFC 정규화 후 길이(`.strip.unicode_normalize(:nfc).length`)로 변경. 우리 계약 사본이 이미 이걸 요구하고 있었다(§4.2 표 "★v2.4" 각주).
② **`backend/app/services/dflow_folder_migration_service.rb#partition_by_folder_name_length`** — ①과 동일 원인(같은 상수 재사용), 동일 수정.
③ **`backend/app/services/dflow_upload_service.rb#resolve_team!`**의 `teams.include?(candidate)` — `candidate`를 NFC 정규화 후 비교. NFD로 저장된 "가공" 폴더가 team 자동판정에서 누락되는 것을 막는다.
④ **`frontend/src/lib/dflowAutoAssign.ts#detectDflowTeam`**(`teams.includes(root)`)·**`dflowRootIsResolvedTeamRoot`**(`root === resolvedTeam`) — 두 비교 모두 NFC 정규화 후 비교로 변경. 이 두 함수를 `dflowEffectiveFolderDepth`(깊이 경고)·`dflowFolderPreviewPath`(편철 미리보기)가 공유하므로, 고치지 않으면 경고와 미리보기가 함께 틀린 값을 보여준다(함수 자체 주석이 막으려던 실패 모드).
⑤ **`tasks/dflow-minutes-upload/artifacts/dflow-minutes-upload-api-spec.md`**(W18 재실행) — `origin/feat/minutes-folder-path`의 `999814e`(스펙 파일을 마지막으로 건드린 커밋) 시점 원문(§4.8 예외 문단 포함)으로 raw replace. 절차는 `dflow-contract-v23-delta-2026-07-28.md` §3-3이 이미 권고한 그대로(원문 그대로 교체 + 동기화 출처 한 줄만 남김).
⑥ **`tasks/dflow-minutes-upload/artifacts/exec-state.md`**(또는 배포 검증 체크리스트, 재편철 실행 절차) — "R1 배포 후 `W1`은 완전 무해" 서술에 각주가 아니라 **절차**를 추가: "재편철 1회차 dry-run 대조표 작성 후 APPLY 전까지, 대조표에 포함된 회의 중 `team`이 바뀐 채로 재전송된 것이 있는지 확인한다 — 있으면 그 건은 팀 루트로 되돌아가 대조표가 낡은 상태다(§4.5-11, 결정 §6). 버그 아님, 재조회 후 진행."
⑦ *(낮은 우선순위, 이번 조사 범위 밖)* `docs/design/ddobak-notice-2026-07-28.md` §5 회신 요청 #4(`[]`로 나갈 회의 건수, 2차 배포 전 게이트)는 ddobak DB에서 자체 집계 가능 — 별도 작업으로 산정 여지 있음. §5-8 "차수 재배치 확정"(`W4`·`W6`·`W7`→2차, `W14`·`W17`→1차)이 우리 `exec-state.md`의 현재 차수 배정과 실제로 일치하는지도 문장 단위 재대조는 하지 않았다.

---

## 영향 없음 확인 목록

- **`ddobak-W8`** `folder_path_status` 4값·위치(등록 응답 최상위 / 배치 `results[]` `moved` 한정) — 계약·코드 불변, 우리 구현(`meeting_dflow_controller.rb#dflow_folder_echo_json`, `frontend/src/api/dflow.ts#DflowUploadResult`, `SendToDflowDialog.tsx`의 `FOLDER_PATH_STATUS_BADGE`)과 100% 일치.
- **`ddobak-W12`/`W13`** 배치 요청·응답 스키마·200건 상한(`BATCH_SIZE`)·`dry_run` 기본 true·`pmo_admin` 게이트(`403 forbidden_role` → `dflow.rake`에서 안내 메시지 분기)·건별 실패 — 코드 무변경, `dflow_folder_migration_service.rb`·`dflow.rake` 구현 그대로 유효.
- **`ddobak-W9`** `from: string[] | null` — `build_item_summary`가 `key?` 판정만 하고 `Array()` 강제가 없어 애초부터 정확했다.
- **`ddobak-W14`** `include_archived`/`archived` — `status` 액션이 이미 `include_archived: true`로 조회하고 `archived === true || false`일 때만 필드를 채운다(구버전 D'Flow 폴백 포함). 무변경.
- **R4 D&D 게이트**(`MINUTES_FOLDER_DND_ENABLED`) — D'Flow 자체 웹 UI 전용(`src/components/minutes/MinutesExplorer.tsx`·`src/app/actions/minutes.ts`). 외부 API 경로 무관, ddobak에 영향 없음.
- **`c60a1c9`의 정합성 결함 ①②③**(폴더 삭제 안내 문구 역전·NFC 60자 UI 버그·정규화 SSOT 중복) — 전부 D'Flow 자체 웹 UI 코드(`validateFolderName`, `src/lib/i18n/dict/minutes.ts`, 삭제 확인창). 우리가 호출하는 외부 API 경로(`externalApi.ts#parseMinutePayload`)는 애초부터 NFC 후 길이 비교였다(`94e5eca` 시점부터 동일).
- **`c60a1c9`의 검증 공백 2건**(team 변경 재전송 4케이스, `folder_path_status` 4값 POST 응답) — 테스트 **추가**일 뿐 동작 자체는 무변경. 오히려 우리 `W8`·"team 예외" 가정을 D'Flow 쪽 테스트로 뒷받침해준다(신뢰도 상승).
- **§4c.5 조상 규칙 개정**(v2.3→v2.4) — `94e5eca` 이전에 이미 반영 완료 상태(`dflow-contract-v23-delta-2026-07-28.md`에서 확인됨), `7823391`까지 재변경 없음.
- **계약 스펙 15행 변경분 전량** — `docs/design/dflow-minutes-upload-api-spec.md`의 §4.8 표에 행 1개 추가 + 경고 문단 신설(§4.5-11 예외 설명)이 전부. 그 외 조항 무변경 확인.

---

## ⚠️ 이번에도 확정 못 한 것

- **D'Flow R1이 실제 프로덕션에 배포됐는지** — git 이력만으로 판정 불가(`dflow-contract-v23-delta-2026-07-28.md`도 동일 결론). `ddobak-notice-2026-07-28.md`의 회신 요청 #1이 이걸 명시적으로 묻고 있다.
- **재편철 1회차 대조표(20건, 팀 루트 잔류 3건)의 최신 스냅샷** — 문서 스스로 "계속 움직이는 값, 요청 직전 재실측 필요"라고 경고한다.
- **ddobak 폴더명이 실제로 NFD 형태로 저장된 사례가 있는지**(발견한 결함의 실사용 재현 가능성) — 코드 레벨 결함은 확정이지만, 운영 DB에 이 케이스가 존재하는지는 조사하지 않았다(DB 조회 범위 밖).
- **§2-E 9건의 "실제 런타임 동작"**(계약 문언이 아니라 배포된 서버가 그대로 도는지) — `dflow-contract-v23-delta` 자신도 "D'Flow 런타임 스모크 0건"이라 명시했고, 이번 조사도 소스 코드 레벨 확인(`git show`)에 그쳤다.
