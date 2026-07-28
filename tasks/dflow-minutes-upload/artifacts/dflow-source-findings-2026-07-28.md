# D'Flow 소스 실동작 조사 — ddobak-W8·W12·W13 차단 해제 판정 (2026-07-28)

> 대상: `/Users/jji/project/wbs-web` (읽기 전용, `git show`/`ls-tree`만 사용), ref = `origin/feat/minutes-folder-path` (HEAD `94e5eca`, `origin/main` 대비 13커밋 앞섬, **main 미머지·미배포**)
> ⚠️ **소스는 계약이 아니다.** 아래는 "현재 브랜치 구현 실측"이며, R1 배포 전 바뀔 수 있다. 이 문서를 근거로 코딩하면 드리프트 위험이 있다 — 계약 문서화(v2.4 정식 송부)는 별도다.

## 3줄 요약

- **`ddobak-W8`(배지) 착수 가능.** `folder_path_status`는 소스에 **존재**한다 — 등록 응답(`POST /minutes`)과 배치 `results[]` 양쪽 모두 4값(`exact`/`truncated`/`partial`/`unclassified`)으로 실린다.
- **`ddobak-W12`·`W13`(재편철) 착수 가능** — 배치 엔드포인트(`POST /minutes/folder`)의 요청/응답 스키마와 에러 처리(건별 실패, 전체 400 아님)를 소스에서 전량 확인했다.
- 단, **D'Flow가 아직 main에 머지·배포하지 않았고 런타임 스모크도 0건**이다(자체 인수인계 문서가 명시). 코딩 착수는 가능하나 **연동 테스트는 D'Flow 배포 전엔 불가능**하고, 플래그(`MINUTES_FOLDER_PATH_ENABLED`)가 꺼진 R1 상태에선 `folder_path` 관련 필드가 전부 "키 부재"로 접혀 배지가 항상 `exact`/`unclassified` 2값만 보게 된다.

---

## 1. 업로드 경로 (`POST /minutes`)

| 항목 | 실동작 | 근거 |
|---|---|---|
| `folder_path` 파싱·정규화 | ① `path[0] === team`이면 그대로 ② 활성 팀코드가 아니면 `[team, ...path]`로 한 칸 내림 ③ 활성 팀코드인데 다른 팀이면 400 거절. 깊이 5 초과분은 절단 | `src/lib/minutes/folders.ts#normalizeFolderPath` |
| 응답에 무엇을 싣는가 | `folder_id`(nullable) · `folder_path`(nullable, `string[]`) · `folder_path_status` 세 키 **항상** 포함. 키가 빠지는 조건 없음 | `src/app/api/v1/minutes/route.ts#respondMinute` |
| **`folder_path_status` 존재 여부** | **존재한다.** 응답 최상위 키. 값: `'exact' \| 'truncated' \| 'partial' \| 'unclassified'` | `src/app/api/v1/minutes/route.ts` (`type FolderPathStatus`, `respondMinute`) |
| 값의 의미 | `exact`=정규화 결과 그대로 편철(한 칸 내림 포함, 정상). `truncated`=깊이 5 초과 절단. `partial`=중간 폴더 생성 실패로 조상까지만 편철(종전엔 침묵하던 경로). `unclassified`=시드 팀 루트 부재로 미분류 | 동 파일 타입 주석 + `resolvePayloadFolder` |
| 폴더명 길이·정규화·중복 | 1~60자(`MINUTE_FOLDER_NAME_MAX`), 초과 시 **400 거절(절단 안 함)**. `btrim` + **NFC 정규화** 후 비교·생성(macOS NFD 대응). 동시 생성 경합은 `23505` 재조회로 흡수 | `src/lib/minutes/externalApi.ts#parseFolderPathValue`, `src/lib/minutes/folders.ts#createChildFolder` |
| 깊이 한도·절단 동작 | 최대 5단(`MINUTE_FOLDER_DEPTH_MAX`). 정규화 후 5단 초과분은 **무통보 절단은 아님** — `folder_path_status: 'truncated'`로 응답에 실려 호출자에게 알려준다 | `src/lib/minutes/folders.ts#normalizeFolderPath`, 동 status 매핑 |

**또박또박 영향**: `POST /minutes` 응답에서 `folder_path_status`만 읽으면 배지 4값 구현이 그대로 가능. 단 R1(플래그 false)에서는 `resolvePayloadFolder`가 `provided: false` 분기로 빠져 `folder_path_status`가 신규 등록은 `folderId===null ? 'unclassified' : 'exact'` 2값만 나온다(§4 참조) — `truncated`/`partial`은 플래그 `true`(R2) 이후에만 관측 가능.

**계약 문서와 어긋나는 점**: 없음. 로컬 사본(v2.1)엔 이 필드가 아예 없어 "계약 미수령" 판단이 맞았으나, 소스 브랜치의 `docs/design/dflow-minutes-upload-api-spec.md`는 이미 **v2.4**로 이 필드를 문서화해 뒀다(§4 참조).

---

## 2. 배치 재편철 (`POST /minutes/folder`, `afc1943`)

| 항목 | 실동작 | 근거 |
|---|---|---|
| 라우트·핸들러 | `src/app/api/v1/minutes/folder/route.ts` — `POST` 함수, 건별 판정은 `processItem` | `src/app/api/v1/minutes/folder/route.ts#POST`, `#processItem` |
| 요청 스키마 | `dry_run?: boolean`(기본 **true** — 필드 부재=dry run), `overwrite_manual?: boolean`(기본 false), `items: BatchItem[]`(최대 200건) | `src/app/api/v1/minutes/folder/route.ts#parseBatchPayload`, `ITEMS_MAX=200` |
| `items[]` 구조 | `external_id: string`(필수, ≤128자) · `team?: string \| null`(생략 시 기존 `team_code` 사용) · `folder_path: string[]`(필수, 요소 1~60자 NFC) | 동 `parseBatchPayload` |
| `from`/`to` 의미·nullable | `from`: 이동 **전** 위치, **미분류였으면 `null`**(항상 배열이 아님 — §2-D 대비) · `to`: `moved` 상태일 때만 존재, 목표 경로 전체(절단·한 칸 내림 반영) | `interface ItemResult`, `processItem` |
| 응답 스키마 | `{ ok, dry_run, summary: {total,moved,already_correct,skipped,not_found,failed}, results: ItemResult[] }`. `ItemResult.status` enum: `'moved'\|'already_correct'\|'skipped'\|'not_found'\|'failed'`. `folder_path_status`는 **`moved`일 때만** 실림(dry-run 포함) | `POST` 핸들러 하단 `summaryOf`, `type ItemStatus`, `processItem` |
| 부분 실패 표현 | 건별 `status: 'failed'` + `reason` 문자열. 사유값: 파싱 실패(`validation_failed:...`), `team_mismatch`, `no_team_root`, `folder_error: ...`, `update_failed: ...` | `processItem` 전체 |
| 권한(`pmo_admin`) 게이트 | **있다.** `resolveUserRole(admin, user.id) !== 'pmo_admin'` → 403 `forbidden_role`. `user_email` 매칭 게이트(unknown_user) → role 게이트 순서 | `src/app/api/v1/minutes/folder/route.ts#POST` |
| dry-run 지원 | **지원.** `dry_run` 기본값이 **true**(명시적 `false`라야 실제 이동). dry-run 시 목표 폴더가 없으면 **생성하지 않고** `folder_id: null`로 보고 | `parseBatchPayload`(기본 true), `processItem`(`create: false`) |
| **에러: 타입 오류가 전체 400인가 건별 실패인가** | **건별 실패다.** `items[].team` 타입 오류·`items[].folder_path` 타입/형식 오류는 `parseBatchPayload`에서 `item.parseError`로만 기록되고 **`{error}`를 반환하지 않는다** — 전체 요청은 200으로 통과하고, 각 항목은 `processItem`에서 `status: 'failed', reason: item.parseError`로 개별 보고된다. **전체 400이 나는 경우**는 봉투(envelope) 오류뿐: `dry_run`/`overwrite_manual` 타입 오류, `items`가 배열이 아님/200건 초과, `items[].external_id` 누락/타입/길이 초과, `items[]` 원소가 객체가 아님 | `parseBatchPayload`(전체 반환 `{error}` 지점 4곳 vs `parseError` 지점 2곳), `processItem`의 `if (item.parseError) return {status:'failed', reason: item.parseError, ...}` |

**또박또박 영향**: `ddobak-W12`·`W13`이 "타입 오류 = 전체 400"을 전제로 설계돼 있었다면 그 전제는 **틀렸다** — `folder_path`/`team` 오타 1건이 나머지 199건을 막지 않는다. 클라이언트는 `results[]`를 순회해 `failed` 항목만 재작성 후 재전송하면 된다.

**계약 문서와 어긋나는 점**: `decisions-final-2026-07-27.md` §2-E 표 6번 항목은 "**현재 구현이 요청 전체 400**이라 계약과 어긋난다 — 코드 결함 수정" 필요라고 적어 뒀다. 그러나 **현재 브랜치 HEAD(`94e5eca`)의 실제 코드는 이미 건별 실패로 동작한다.** 이 결정 문서가 작성된 시점(07-27) 이후 커밋(`2192f06`/`f0d0b62`/`94e5eca` 등, "R1 결정 반영" 계열)에서 이미 수정이 반영된 것으로 보인다 — **§2-E ⑥ 항목은 소스 기준으로 이미 해소된 상태**다. (커밋별 diff까지는 대조하지 않았음 — "이미 해소돼 보인다"까지가 소스로 확정 가능한 선.)

---

## 3. 조상 규칙(§2-J) · 연결 초기화(`dflow-W10`)

| 항목 | 실동작 | 근거 |
|---|---|---|
| 조상 규칙 구현 여부 | **구현돼 있다.** 현재 위치(`row.folder_id`)가 목표 경로(`resolved.folderId`)의 **조상 집합**(자기 자신 포함, `null`도 조상 취급)에 속하면 이동 허용, 아니면(형제·자손·무관 가지) `skip(manual_placement)` | `src/lib/minutes/folders.ts#ancestorIdsOf`, `src/app/api/v1/minutes/folder/route.ts#processItem`(`const movable = row.folder_id === null \|\| ancestorIdsOf(...).has(row.folder_id)`) |
| `overwrite_manual` 관계 | `movable`이 아니어도 `batch.overwriteManual === true`면 강제 이동 허용(`!batch.overwriteManual && !movable` 조건) | 동 `processItem` |
| already_correct 우선순위 | 조상 판정보다 **먼저** 검사 — 이미 목표 위치면 `already_correct`(재실행 dry-run 오염 방지) | 동 `processItem` 주석("요건 10") |
| 테스트 존재 | `ancestorIdsOf`/`manual_placement` 커버 테스트 파일 확인됨 | `tests/minutes/folder-batch.test.ts`(파일 존재만 확인, 내용 미검토) |
| 연결 초기화가 지우는 것 | **`external_id`만 `null`로.** `folder_id`는 건드리지 않는다. 버전 append 없음, 위키 무영향(`external_id`는 `v_index_content_changed` 대상 아님). `updated_at`은 갱신함(대량 마이그레이션과 달리 사용자 조작이므로) | `src/app/actions/minutes.ts#clearMinuteExternalId`(`admin.from('minutes').update({ external_id: null, updated_at: ... })`) |
| 연결 초기화 권한 | **`pmo_admin` 한시 게이트**(결정 §3 R3). `ddobak-W14`(연결 해제 안내) 배포가 확인되면 원안(작성자 또는 `pmo_admin`)으로 되돌릴 예정 — 코드 주석에 되돌릴 지점 명시됨 | `src/app/actions/minutes.ts#clearMinuteExternalId`(`if (m.role !== 'pmo_admin') return {error:'연결 초기화는 현재 관리자만...'}`) |
| 재연결 경로 | D'Flow가 초기화 후 되돌리는 건 D'Flow 쪽 액션이 아니라 **또박또박 쪽에서** `POST /minutes/link`(claim)로 한다 | `src/app/actions/minutes.ts` 주석, `src/app/api/v1/minutes/link/route.ts` |

**또박또박 영향**: `ddobak-W15`·`W16`(§7.7 대상 2 판정)에 필요한 사실 — 연결 초기화는 **폴더 위치를 보존한다**(`folder_id` 무변경). "연결 끊긴 회의록이 폴더에서도 사라지는가"라는 질문이 있었다면 답은 **아니오**다.

**계약 문서와 어긋나는 점**: 없음. `pmo_admin` 한시 게이트는 결정 §3 R3과 일치.

---

## 4. 플래그 (`MINUTES_FOLDER_PATH_ENABLED`)

| 항목 | 실동작 | 근거 |
|---|---|---|
| 소스 존재 여부 | **존재한다.** `folderPathEnabled(): boolean { return process.env.MINUTES_FOLDER_PATH_ENABLED === 'true' }` | `src/lib/minutes/externalApi.ts#folderPathEnabled` |
| 기본값 | `false`(env 미설정 시 `=== 'true'`가 거짓) — `.env.local.example`에도 `# MINUTES_FOLDER_PATH_ENABLED=false`로 주석 처리돼 있음 | `.env.local.example:59`, 코드 자체 |
| 무엇을 껐다 켜는가 | **`POST /minutes`(등록/재전송)에서만** `folder_path` 처리를 게이트한다. 꺼져 있으면 `folder_path` 키를 **읽기 전에** 버려 "키 부재"와 완전히 동일하게 취급 — 검증(400)조차 하지 않는다. **배치(`POST /minutes/folder`)와 `include_archived`는 플래그와 무관하게 항상 활성** | `src/lib/minutes/externalApi.ts`(`folderPathProvided = folderPathEnabled() && b.folder_path !== undefined`), 코드 주석 |
| 플래그 `false`일 때 등록 경로 동작 | 신규 등록은 팀 루트로 자동 편철(`resolveTeamRootFolderId`), `replace`는 기존 위치 유지. `folder_path_status`는 `folderId===null ? 'unclassified' : 'exact'` 2값만 나옴 | `src/app/api/v1/minutes/route.ts#insertNew`, `#handleExisting` |

**또박또박 영향**: R1 배포 직후(플래그 false)에도 배치 재편철(dry-run 포함)은 **즉시 사용 가능**하다 — D'Flow 인수인계 문서가 "3차(재편철)를 2차(전송 전환)보다 먼저"라고 명시한 것과 일치. `ddobak-W12`·`W13` 착수를 배치 쪽부터 시작해도 무방.

**계약 문서와 어긋나는 점**: 없음.

---

## 5. ⚠️ 추가 발견 — D'Flow 소스에 v2.4 계약 문서 자체가 이미 존재함 (범위 외지만 중대)

브리프 범위(코드 실동작)는 아니지만 W8·W12·W13 착수 가능성 판정에 직결되어 기록한다.

- `docs/design/dflow-minutes-upload-api-spec.md`가 소스 브랜치에 **v2.4(2026-07-27)**로 이미 존재한다. 문서 자체가 "⚠️ 또박또박 송부본은 이 v2.4다"라고 명시하고 있다.
- 우리 로컬 사본(`tasks/dflow-minutes-upload/artifacts/dflow-minutes-upload-api-spec.md`)은 **v2.1에서 멈춰 있다** — v2.2/v2.3/v2.4 3단계가 반영 안 됨. `folder_path_status`·배치 엔드포인트·연결 초기화·조상 규칙·전환 플래그가 전부 로컬 사본엔 없는 이유가 이것.
- D'Flow 자체 인수인계 문서(`docs/design/folder-path-handoff-2026-07-27.md`, 커밋 `94e5eca`)가 "또박또박에 보낼 것" 11건 중 1번으로 "계약 v2.4 송부(v2.3은 건너뜀), 우리 사본 v2.1 → v2.4 동기화"를 명시해 뒀다 — **아직 송부 전**이다.
- **배포 상태**: `feat/minutes-folder-path`는 `origin`에 푸시만 됐고 `main` 미머지. D'Flow 자체 원장에 "런타임 스모크 미실시"라고 적혀 있다. `main` 머지 시 Vercel env에 `MINUTES_FOLDER_PATH_ENABLED=false`를 명시 설정할 계획이며(기본값도 false), 재편철(배치)이 전송 전환(R2)보다 먼저 온다.

---

## ⚠️ 소스로도 확정 못 한 것

- **§2-E ⑥ 코드 결함이 "이미 해소됐다"는 판단은 브랜치 HEAD 스냅샷 비교일 뿐, 어느 커밋에서 고쳐졌는지 diff 추적은 안 했다.** D'Flow가 이 사실을 인지하고 있는지, 결정 문서(§2-E)를 갱신했는지는 소스로 확인 불가 — D'Flow에 재확인 필요.
- **v2.4 계약 문서가 우리에게 언제 정식 송부되는지**는 소스(D'Flow 인수인계 문서 §2-3 "배포 후 §4 통보")에 순서만 있을 뿐 날짜가 없다. main 머지·배포 일정 자체를 D'Flow에 물어야 한다.
- **`tests/minutes/folder-batch.test.ts`의 실제 assertion 내용**은 파일 존재만 확인했고 열어보지 않았다(브리프 범위 밖 판단, 시간 예산). 조상 규칙·건별 실패의 테스트 커버리지 세부는 미확인.
- **운영 DB의 실측값**(19건 폴더 배치 대상, `manual_placement` 예상 건수 등)은 소스 코드로 알 수 없다 — D'Flow 인수인계 문서 §2-4가 "재편철 1회차"를 "PMO가 사람이 판단하는 유일한 구간"으로 지목해 뒀다.
- **R1/R4 UI 분리 방식**(브랜치에 API와 D&D UI가 같이 있음)은 D'Flow 측 "판단 필요 2건" 중 하나로 미확정 — 우리 쪽 배포/사용 타이밍에 영향 줄 수 있으나 소스만으로는 언제 어떻게 나뉠지 알 수 없다.
