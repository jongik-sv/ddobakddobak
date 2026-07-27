# D'Flow(wbs-web) 작업 지시 — 회의록 외부 API `folder_path` 지원 (2026-07-27)

> 수신: D'Flow 개발 담당 (팀장 경유)
> 이 파일 1개로 착수할 수 있다 — 외부 문서 내용은 본문에 인라인했다.
>
> **W 번호 표기 규약** ⚠️ — 이 문서의 `W1`·`W6`·`W10` 등은 **모두 D'Flow(wbs-web) 작업**이다. 또박또박 측 작업은 반드시 **`ddobak-W`** 접두로 쓴다(`ddobak-W12` 등). 두 프로젝트가 각자 `W1~`으로 번호를 매기므로, 접두 없는 `W`를 보면 **D'Flow 작업**으로 읽으면 된다. 이 문서의 D'Flow 번호는 `W1`~`W10`·`W18`~`W23`이며 **`W11`~`W17`은 결번**이다(누락된 작업이 아니다).
>
> **참조 문서**
> - `folder-compat-review-2026-07-27.md` — 배경 갭 분석 + 결정 D1~D6의 SSOT. **(내부 문서 · 미첨부 — 필요한 내용은 본문 §0.1·§11에 인라인)** (본문에서 「배경 검토서 §…」로 인용)
> - `ddobak-folder-path-worklist-2026-07-27.md` — 또박또박 측 작업지시(ddobak-W1~W17). **(내부 문서 · 미첨부 — 필요한 내용은 본문 §0.1·§11에 인라인)** (본문에서 「또박또박 작업지시 §…」로 인용)
> - `docs/design/dflow-minutes-upload-api-spec.md` — **기존 API 계약(정본은 wbs-web 레포 사본, v2.2)**. ⚠️ 이 계약서는 아직 `folder_path`를 모르고, 이번 변경과 **정면 충돌하는 문장 3개를 살아 있는 채로 담고 있다.** 또박또박 측 사본과도 이미 갈라져 있다 → **§4 「⚠️ W8」 블록을 착수 전에 읽을 것.**

---

## 0. 한 줄 요약

또박또박이 회의 폴더 경로를 `folder_path` 배열로 함께 보낸다. D'Flow는 이걸 받아 **팀 루트 아래에 같은 폴더 트리를 만들어 편철**한다.

**`folder_path` 필드 자체는 선택 필드**라, 미전송 시 현행 동작(팀 루트 편철)과 100% 동일하다 — **필드 도입만으로는 또박또박 배포 순서를 강제하지 않는다.**

> ⚠️ **다만 “배포 순서 제약이 전혀 없다”는 뜻은 아니다.** 이 문서의 범위가 `folder_path` 계약을 넘어 **일괄 재편철(§8)·연결 초기화(§9)·폴더 중심 UI 재편(§6)** 까지 확장되면서 상호 의존이 생겼다:
> - **W8**(계약서 개정)은 **착수 전 선행**이다(§4).
> - D'Flow **W6**(배치 엔드포인트)이 나와야 또박또박 3차(재편철)가 돌아간다.
> - D'Flow **W10**(연결 초기화)이 나와야 또박또박 4차의 **자동 링크(`ddobak-W15`·`ddobak-W16`)**를 켤 수 있다 — 초기화가 오매칭의 유일한 되돌리기 수단이다(§9.5). (4차의 나머지 `ddobak-W14`·`ddobak-W17`은 D'Flow 의존이 0이다 — §11.2·§11.3 ⑦)
>
> 전체 차수와 상호 의존은 **§11.2** 참조.

---

## 0.1 결정 (D1~D6)

본문의 `(D1=B)`·`(D6)`·`D5 결정` 태그는 아래 표로 읽는다.

**D1~D6 전부 2026-07-27 사용자 결정으로 확정**됐다. 구현 중 임의로 다른 선택지를 취하지 말 것 — 뒤집으려면 §3.1·§3.4·§5·§8이 함께 바뀐다.

| 결정 | 내용 | 근거 |
|---|---|---|
| **D1 = (B) sync + 3값 규약**<br>✅ **확정(2026-07-27)** | 재전송(`replace`) 시 **또박또박이 폴더 위치의 SSOT**다 — 재전송마다 D'Flow 위치를 갱신한다. 단 3값으로 구분: **키 부재** = 기존 위치 유지 · **`[]`** = 팀 루트로 되돌림 · **비어있지 않은 배열** = 그 경로로 이동.<br>(기각된 대안 (A) sticky = 현행 유지, D'Flow 수동 이동을 존중하고 또박또박 재편을 미반영) | `[]`를 “미전송과 동일”로 뭉개면 **폴더에서 빼는 조작만 영영 전파되지 않는다**. `meeting_id`의 `meetingIdProvided`와 동형이되 `[]`가 유의미한 값인 점이 다르다.<br>✅ **DB 변경 불필요(실측 정정)** — `update_minute_metadata_with_wiki_retraction` allowlist에 `folder_id`가 **이미 있고**(`0045_minutes_wiki.sql:1167` — 이하 이 문서에서 `0045:<행>`으로 줄여 쓴다) 적용 로직도 있다(`0045:1206-1208, 1321`). TS에서 metadata에 키만 넣으면 된다.<br>보너스: `v_index_content_changed`(`0045:1250-1256`)에 `folder_id`가 없어 **폴더 변경만으로는 위키 재빌드가 걸리지 않는다** |
| **D2 = (A) 접두 제거**<br>✅ **확정(2026-07-27)** | `folder_path`를 함께 보낼 때 또박또박이 **`<하위폴더명>-` 제목 접두를 붙이지 않는다**. 단 **기존 전송분 제목은 소급 수정하지 않는다**.<br>(기각: (B) 접두 유지) | 접두는 “D'Flow에 실폴더가 없으니 제목으로 폴더를 흉내낸다”는 전제(계약 §1.2)로 만든 우회책이고, 0040/0043 실폴더 도입으로 **그 전제가 소멸**했다. 소급 재작성은 `minute_versions` 히스토리를 오염시키고 위키 재빌드를 유발한다 |
| **D3 = (A) 400 거절**<br>✅ **확정(2026-07-27)** | 60자 초과 폴더명은 **400으로 거절**한다. 절단하지 않는다.<br>(기각: (B) 60자 절단) | 절단하면 `현장품질개선…`류 긴 이름끼리 **같은 60자로 뭉개져 서로 다른 폴더가 한 폴더로 합쳐지는 조용한 사고**가 난다. 거절하면 사용자가 또박또박에서 이름을 줄이면 된다 |
| **D4 = (B) 한 칸 내림**<br>✅ **확정(2026-07-27)** | 또박또박 루트가 팀코드가 **아니면**, `[team, ...path]`로 **팀 루트 아래로 한 칸 내려 편철**한다.<br>(기각: (A) 현행대로 전송 실패(`TeamRequiredError`) / (C) 매핑 테이블) | 또박또박 폴더 구조를 자유롭게 두면서 D'Flow의 `team_code` 축을 지키는 **유일한 방법**. 루트 자동 생성을 허용하면 = 팀을 만들 수 있다 = D'Flow 대시보드·칸반·진척 전 화면에 새 축이 튀어나온다. (C)는 팀 5개 고정이라 관리 비용 대비 이득이 없다.<br>이 규칙이 상세화된 것이 **§3.2 ①②③** |
| **D5 = (A) 노출 안 함**<br>✅ **확정(2026-07-27)** | `GET /api/v1/minutes/meta`에 **폴더 목록을 노출하지 않는다.** 폴더 조회 엔드포인트(`GET /api/v1/minutes/folders`)도 신설하지 않는다.<br>(기각: (B) 폴더 목록 API 신설) | 하위 폴더는 blind 자동 생성이라 **항상 성공**한다 → 사전 미리보기가 없어도 전송이 실패하지 않는다. 루트 검증엔 기존 `teams`로 충분.<br>⚠️ **대가**: 사전 미리보기를 포기했으므로 **응답 에코(§3.3)가 유일한 사후 피드백 경로**가 된다. 그래서 또박또박 ddobak-W8(응답 `folder_path` 표시)의 ‘권장 → 필수’ 승격을 요청한다(§11.3 ②) |
| **D6 = (C) 폴더 중심 전면 재편**<br>✅ **확정(2026-07-27)** | D'Flow 자체 UI를 폴더 중심으로 재편한다 — 업로드·수정 모달에서 **담당(team)·하위 구분을 삭제**하고 선택 폴더 기준으로 생성, 회의록·폴더 **드래그앤드롭 이동**(폴더 D&D는 `pmo_admin` 전용).<br>(기각: (A) 방치 / (B) 트리 피커만 교체) | 현재 UI는 (팀, 하위 구분) **2단 모델**이라, 3단 이상 편철분을 열어 팀/하위를 바꿔 저장하면 `subgroupFolderId()`가 루트 직계 자식 id를 반환해 **2단으로 강등·경로 소실**된다(`MinuteMetaModal.tsx:85-89`). `folder_path`로 3단 이상이 들어오는 순간 재현 가능한 버그가 된다.<br>⚠️ **“담당 삭제”는 `team_code` 삭제가 아니다** — 컬럼은 유지하고 **폴더에서 파생**한다. 그러려면 “모든 폴더는 시드 팀 루트의 서브트리” 불변식이 필요한데 지금은 사용자 루트 폴더 생성이 열려 있어(`createMinuteFolder`가 `parentId null` 허용) **선행 마이그레이션이 필수**.<br>상세 = **§6** |

---

## 1. 왜 필요한가

- 0040/0043으로 D'Flow에 실폴더 트리가 생겼지만, 외부 업로드 API는 아직 0040 이전 모델이라 **`resolveTeamRootFolderId`로 팀 루트 1곳에만 평평하게 떨군다**(`route.ts:164`). 또박또박 폴더 계층은 **전송 순간 전부 소실**되고 2단째 폴더명만 제목 접두 `<하위폴더명>-`로 남는다.
- 그 접두 규칙은 “실폴더가 없으니 제목으로 흉내낸다”는 전제(계약 §1.2)의 우회책이었다. 전제가 소멸해 지금은 실폴더 `영업` 안에 제목이 `영업-주간회의`인 **이중 라벨** 상태다. (`meetingBodyOf`는 탐색기에서 퇴역했고 `src/lib/minutes/export.ts:60,122` zip 그룹핑 2곳에만 남아 있다.)
- 재전송(`replace`)도 폴더가 안 따라온다 — `handleExisting`의 `metadata`에 `folder_id`가 없다(`route.ts:86-95`). **TS 누락일 뿐 DB는 이미 지원**(allowlist·적용 로직 모두 있음 — `0045:1167, 1206-1208, 1321`). 마이그레이션 불필요.

---

## 2. 반드시 지켜야 할 제약 (이미 검증된 함정들)

| # | 제약 | 근거 | 어기면 |
|---|---|---|---|
| C1 | **`team_code`를 `folder_path`로 대체하지 말 것** | `minutes.team_code` `not null`(0021:15) · `minutes_team_date_idx` · `minute_versions.team_code` `not null`(0045:105) · 위키 파이프라인 `teams where t.active` 검증(0045:1218) · `GET ?team=` 필터 | 위키 인덱싱·팀 필터·버전 테이블 전부 깨짐 |
| C2 | **루트 폴더를 외부 API가 만들지 말 것** | 0043이 루트를 팀코드 5축 시드(`created_by is null`)로 고정. `folders.ts:14`가 그 조건으로 스쿼팅을 막음. `sort 0~4` 정렬 전제 | 팀 축이 무한 증식 → 대시보드·칸반·진척 전 화면에 새 축 등장 |
| C3 | **폴더 생성에 `ON CONFLICT` 금지** | `minute_folders_child_name_uniq`가 **부분 인덱스**(`where parent_id is not null`) → conflict 대상 추론 실패로 `42P10` | 동시 전송 시 500. minutes upsert가 이미 같은 함정을 겪고 사전 select로 우회 중(`route.ts:260` 주석) |
| C4 | **자동 생성 폴더의 `created_by`를 null로 두지 말 것** | null은 **시드 표식**. `resolveTeamRootFolderId`·0043 재실행이 이 값으로 시드를 식별 | 스쿼팅 방어 무력화 + 0043 재실행 오작동 |
| C5 | **폴더명 60자 사전 검증** | `minute_folders.name check (length(btrim(name)) between 1 and 60)` (또박또박은 100자 허용) | 23514로 폴더 생성 전체 실패 |
| C6 | **깊이 5 존중** | `MINUTE_FOLDER_DEPTH_MAX = 5`는 **앱 상수, DB 제약 아님** (`src/lib/domain/minutes.ts:203`) | UI가 만들 수 없는 깊이의 폴더가 생겨 탐색기 “하위 폴더 만들기”가 비활성인 채 트리만 깊어짐 |

---

## 3. 계약 변경

### 3.1 요청 — `POST /api/v1/minutes`

```jsonc
{
  "user_email": "hong@dongkuk.com",
  "date": "2026-07-27",
  "team": "MES",                                    // 기존. 필수. team_code 축 — 유지
  "folder_path": ["MES", "품질", "주간정례"],         // ★ 신규. 선택. root-first
  "title": "주간회의",                               // 접두 없는 원제목으로 바뀜(§3.4)
  "body_markdown": "...",
  "external_id": "ddobak:<uuid>",
  "on_conflict": "replace"
}
```

`folder_path` 검증:

- 타입: `string[]`. 배열이 아니면 400
- 각 원소: `btrim` 후 1~60자. 벗어나면 **400 거절**(절단 금지 — 긴 이름끼리 같은 60자로 뭉개지면 서로 다른 폴더가 한 폴더로 합쳐지는 조용한 사고)
- 상한: 정규화 후 5단으로 절단(§3.2-4)
- **키 부재 / `[]` / 비어있지 않은 배열을 3값으로 구분할 것** (`folderPathProvided` 플래그 + 값). 기존 `meetingIdProvided`와 동형이되, `[]`가 유의미한 값인 점이 다르다:

| 값 | 의미 | 신규(`insertNew`) | `replace`(`handleExisting`) |
|---|---|---|---|
| **키 부재** | 폴더 정보 미제공 (구버전 또박또박) | 기존 `resolveTeamRootFolderId` 폴백 | **기존 `folder_id` 유지** — metadata에 넣지 않음 |
| **`[]`** | 명시적 “폴더 없음” | 팀 루트 | **팀 루트로 되돌림** (metadata에 팀 루트 id) |
| **`["A","B"]`** | 그 경로 | 경로대로 편철 | 경로대로 **이동** |

> ⚠️ `[]`를 “미전송과 동일”로 뭉개면 안 된다. 또박또박에서 회의를 폴더 밖으로 뺀 조작이 **영영 전파되지 않는** 유일한 케이스가 된다.

**`date` 취급(기존 동작, 변경 없음)**: `replace`의 `metadata`에 `minute_date`가 이미 실려 있어 **재전송마다 또박또박 값으로 갱신**된다(`route.ts:87`). `folder_id`와 달리 `minute_date`는 `v_index_content_changed`(`0045:1250-1253`)에 **포함**돼 있어 날짜가 바뀌면 **위키 철회·재빌드가 걸린다**. D'Flow에서 날짜를 고쳐도 다음 재전송이 덮으므로, 날짜는 또박또박이 SSOT다.

### 3.2 정규화 규칙 (핵심)

또박또박 폴더 구조는 **자유**다. 루트명이 팀코드가 아닐 수 있다. 그래서 **한 칸 내려 편철**한다:

```
① path[0] === team                      (팀코드 캐시 조회 없음 — 단독 조건)
   → 편철 경로 = path 그대로

   또박또박:  MES / 품질 / 주간정례 / 2026-07
   D'Flow:    MES / 품질 / 주간정례 / 2026-07

──── 이하는 ①에 해당하지 않을 때(= path[0] !== team)만 판정한다 ────

② path[0] ∉ activeTeamCodesSync()   (= 팀코드가 아닌 자유 루트)
   → 편철 경로 = [team, ...path]

   또박또박:  신규TF / 킥오프 / 1차          (team=MES 로 전송)
   D'Flow:    MES / 신규TF / 킥오프 / 1차

③ path[0] ∈ activeTeamCodesSync()   (= 다른 팀의 팀코드)
   → 400 거절 (code: validation_failed)
   조용히 한쪽을 따르면 목록 필터(?team=)와 폴더 위치가 어긋난다
```

> ⚠️ **①에 팀코드 캐시 조회를 넣지 말 것.** `path[0] === team`이면 그 팀 루트로 편철하는 것이 정의상 맞으므로 캐시를 볼 이유가 없고, 넣으면 해롭다: 관리자가 팀을 **비활성화**하면(`0044_team_master.sql:7` `active` 컬럼 — `src/app/actions/teams.ts:62` `updateTeam(patch.active)`가 유일한 퇴역 수단이고 **삭제는 정책적으로 없다**: `teams.ts:4` “삭제는 없다: 비활성화(active=false)가 삭제다”) `team_code='MDM'`인 **기존 전송분**의 배치 재편철(§8)이 ①에서 탈락해 ②로 떨어져 `["MDM","MDM","품질"]`처럼 **루트 세그먼트가 중복**된다. `minute_folders_child_name_uniq`는 부분 인덱스라 이를 막지 못한다(C3).

4. 정규화 후 **깊이 5 초과분은 절단**하고 5단째에 편철. 실제 편철 결과를 응답에 에코(§3.3)
   - ⚠️ **정책 비대칭 — 별건(§12)**: 60자 초과는 400 거절(D3)인데 깊이 초과는 **무통보 절단**이다. 이 문서는 절단(현행)을 규정하고 최소 완화(응답 에코 표시)만 §11.3 ②로 요청한다
5. 정규화 후 `path[0]`에 해당하는 **시드 루트가 없으면 `null`(미분류) 폴백 + 로그**. 편철 실패가 등록 자체를 막으면 안 된다(현행 `resolveTeamRootFolderId` 관례 유지). **응답 값 규약은 §3.3 참조** — `folder_path`도 `null`이다

> **`activeTeamCodesSync()` 캐시 stale 주의.** 이 함수는 TTL 캐시 + `DEFAULT_TEAMS` 폴백이다(`src/lib/teams/master.ts`) — 콜드 스타트나 로드 실패 시 하드코딩 5팀만 돌려줄 수 있다. 캐시가 관여하는 범위:
>
> 1. **`path[0] === team`이면 캐시와 무관하게 ①.**
> 2. **캐시 판정은 ②/③ 분기에만 관여**하고, 안전한 쪽으로 degrade한다 — 캐시에 없는 값이면 `path[0] ∉ teams` → **②(한 칸 내림)**로 빠지지 ③(400)으로 가지 않는다. **이 방향을 뒤집지 말 것**: “모르는 값은 거절”이 아니라 “모르는 값은 자유 폴더로 취급”이 맞다.
> 3. ⚠️ 단 이 degrade는 **W1-b와 함께** 실효를 갖는다 — 지금은 `team` 검증이 하드코딩 5팀이라 6번째 팀코드가 ②/③에 닿기 전에 400으로 거절된다(§4 「⚠️ W1-b」).

### 3.3 응답 확장

```jsonc
{ "ok": true, "id": "...", "action": "created",
  "folder_id": "9f3c…",                                  // ★ 신규
  "folder_path": ["MES", "품질", "주간정례"],              // ★ 신규. 절단·한 칸 내림 반영된 실제 결과
  "title": "...", "date": "...", "team": "MES", "url": "...", ... }
```

또박또박이 “어디에 들어갔는지”를 전송 다이얼로그에 표시한다. `meta`에 폴더 목록을 노출하지 않는 대신(§5 · **D5** — §0.1) 이 에코가 유일한 피드백 경로다.

#### 미분류 폴백 시 응답 값 — ⚠️ 확정 필요

§3.2-5의 `null` 폴백이 발동하면 `folder_id`는 `null`이 되는데, `folder_path`를 `[]`로 두면 또박또박이 §3.1 3값 규약(`[]` = 팀 루트)대로 **“팀 루트에 편철됨”이라는 정반대 안내**를 한다.

**제안(확정 요청)**: `folder_id: null` + **`folder_path: null`** — `[]`(팀 루트 편철 성공)와 구분한다. 또박또박 측에 응답 타입 nullable(ddobak-W9)과 “미분류로 들어갔습니다” 문구를 요청한다(§11.3 ⑥).

수용 기준: **`folder_id: null` 응답 시 또박또박 다이얼로그가 “팀 루트”라고 말하지 않는다.**

### 3.4 제목 접두

또박또박이 `folder_path`를 보낼 때는 **`<하위폴더명>-` 접두를 붙이지 않는다**(또박또박 측 변경). D'Flow는 title 형식을 강제하지 않으므로 **API 코드 변경 없음**.

- **기존 전송분 제목은 소급 수정하지 않는다** — 재작성은 `minute_versions` 히스토리를 오염시키고 위키 재빌드를 유발한다
- 부수 영향: `export.ts`의 zip 그룹핑(`meetingBodyOf`)이 접두 없는 제목으로 묶이게 된다. 기능 저하는 아니지만 그룹 이름이 바뀐다

---

## 4. 구현 작업 목록

| # | 파일 | 작업 | 필수 |
|---|---|---|---|
| **W1** | `src/lib/minutes/externalApi.ts` | `ExternalMinutePayload`에 `folderPath: string[] \| null` + `folderPathProvided: boolean` 추가. `parseMinutePayload`에 §3.1 검증 추가.<br>**＋ `team` 검증에 활성 팀 목록 주입 1줄** — 아래 ⚠️ W1-b | ✅ |
| **W2** | `src/lib/minutes/folders.ts` | `resolveFolderPath(sb, teamCode, path)` 신설 — §3.2 정규화 + 경로 순차 해석. **한 번에 조회하고 부족분만 순차 생성**(깊은 경로에서 왕복 최소화). 생성은 pre-select → insert → `23505`면 재조회(C3). `created_by`는 전송 사용자 id(C4). 반환: `{ folderId, resolvedPath }`. 기존 `resolveTeamRootFolderId`는 폴백용으로 존치 | ✅ |
| **W3** | `src/app/api/v1/minutes/route.ts:164` | `insertNew`가 `resolveTeamRootFolderId` 대신 `resolveFolderPath` 호출. `folder_path` 미전송이면 기존 함수로 폴백 | ✅ |
| **W4** | `src/app/api/v1/minutes/route.ts:44-57` | `respondMinute`에 `folder_id`·`folder_path` 필드 추가. **두 필드 모두 nullable**(미분류 폴백 시 둘 다 `null` — §3.3, ⚠️ 확정 필요) | ✅ |
| **W5** | `src/app/api/v1/minutes/route.ts:86-95` | `handleExisting`의 `metadata`에 `folder_id` 추가. **`folderPathProvided`일 때만** 갱신, 부재면 기존 값 유지(§3.1 3값 표). **DB 변경 불필요** — `update_minute_metadata_with_wiki_retraction`의 allowlist에 `folder_id`가 이미 있고(`0045:1167`) 적용 로직도 있다(`0045:1206-1208, 1321`) | ⚠️ D1 |
| **W6** | `src/app/api/v1/minutes/folder/route.ts` **(신규)** | **일괄 마이그레이션 엔드포인트** — 기존 회의록 재편철용. 상세 §8 | ✅ |
| **W7 → W19·W20a** | — | 트리 피커 교체 권고는 **§6 폴더 중심 재편에 흡수**됐다(담당·하위 구분 삭제 + D&D). 아래 W18~W23 참조 | — |
| **W8** | `docs/design/dflow-minutes-upload-api-spec.md` | 계약 개정 — 범위 **§3·§8·§9**(§3만 아님). 또박또박 측 사본과 동기화. 아래 ⚠️ W8 블록 참조 | ✅ **착수 전 선행** |
| **W9** | `tests/` | `resolveFolderPath` 단위 테스트(정규화 3분기·절단·23505 재조회·60자 거절) + 배치 라우트·연결 초기화 테스트 | ✅ |
| **W10** | `src/components/minutes/MinuteMetaModal.tsx`<br>`src/app/actions/minutes.ts` | **연동 식별자 표시 + 연결 초기화**. 상세 §9 | ✅ |
| **W18~W23** | `actions/minutes.ts` · `MinuteUploadModal` · `MinuteMetaModal` · `MinutesExplorer` | **폴더 중심 UI 재편** — 담당·하위 구분 삭제, 폴더 기준 생성, 회의록·폴더 D&D(폴더는 관리자 전용). 상세 §6 | ✅ |

### ⚠️ W1-b — `POST /minutes`의 team 검증이 폐기예정 하드코딩 5팀을 쓴다 (코드 1줄)

`folder_path`와 무관한 기존 결함이고 수정이 한 줄이라 W1에 묶는다.

| 경로 | 무엇으로 team을 검증하나 | 근거 |
|---|---|---|
| `POST /api/v1/minutes` | `parseMinutePayload`가 `validateMinuteInput`을 **`teamCodes` 인자 없이** 호출 → 기본값 `TEAM_CODES = DEFAULT_TEAM_CODES` | `src/lib/minutes/externalApi.ts:156` 호출부 · `src/lib/domain/minutes.ts:134` 기본값(`teamCodes: readonly TeamCode[] = TEAM_CODES`) · 같은 파일 `:11` 상수 정의에 `@deprecated 기본 5팀 폴백 — 런타임 기준은 팀 마스터. 호출처에서 활성 팀 목록을 주입할 것.` |
| `GET /api/v1/minutes/meta` | `activeTeamCodesSync()` | `meta/route.ts:31` |
| `GET /api/v1/minutes?team=` | `activeTeamCodesSync()` | `route.ts:288` |

- 신규 팀 등록은 **설계된 워크플로**다 — `src/app/actions/teams.ts:21-58 addTeam`이 `teams` insert + **팀코드 동명 시드 루트 폴더(`created_by: null`) 생성**까지 한다.
- **결과: 6번째 팀을 등록하면 `meta`는 그 팀을 노출하는데 `POST`는 “잘못된 담당입니다” 400으로 전건 거절한다.** 또박또박은 계약대로 `meta`만 믿고 전송하므로, 신규 팀 회의록은 `folder_path` 유무와 무관하게 **한 건도 못 올라간다**.
- **수정**: `validateMinuteInput(..., activeTeamCodesSync())` — 인자 주입 한 줄.
- 부수: §3.2 각주의 stale-cache 안전 논증(“새 팀코드는 ②로 빠지지 ③으로 가지 않는다”)은 **이 수정 전에는 도달하지 않는 경로**를 근거로 삼고 있었다. W1-b가 그 논증을 처음 실효화한다.

### ⚠️ W8 — 계약서 사본이 이미 갈라져 있다. 착수 전에 정리할 것

계약서가 이 지시와 **정면 충돌하는 문장을 아직 담고 있다** — 또박또박 구현자가 자기 레포의 “API 계약 단일 출처”를 열면 모순된 지시를 읽는다.

| 사본 | 버전 | 상태 |
|---|---|---|
| `wbs-web/docs/design/dflow-minutes-upload-api-spec.md` | **v2.2** (D'Flow F1~F6 완료 반영) | **정본** |
| 또박또박 측 사본 (`tasks/dflow-minutes-upload/artifacts/`) | **v2.1** | 뒤따라 동기화 |

- 두 사본은 **이미 21행 갈라져 있다.**
- **둘 다 `folder_path` 언급이 0건이다.**
- **계약서 안에 살아 있는 충돌 문장 3개** — 개정에서 반드시 손볼 것 (아래 `§`는 **계약서**의 절번호다. 이 문서의 절이 아니다):
  1. **계약서 `§0 D10`** — “전송 제목 = `<하위폴더명>-<원제목>`” ↔ **이 문서 §3.4**(접두 제거 · §0.1 D2)와 정면 충돌
  2. **계약서 `§4.2`** 필드표 — `folder_path`가 없다 ↔ **이 문서 §3.1**
  3. **계약서 `§4b`** — “해제 API는 제공하지 않음” ↔ **이 문서 §9**(연결 초기화)
- **개정 범위는 이 문서 §3만이 아니라 §3·§8·§9다.** §3만 반영하면 신규 엔드포인트 `POST /api/v1/minutes/folder`(요청 필드·status 값 집합·200건 상한·`dry_run`·`overwrite_manual`)와 §9 연결 초기화가 계약 SSOT에 안 실린다. 또박또박 `ddobak-W12`·`ddobak-W13`은 그 엔드포인트를 **직접 호출**한다(§11.1).
- 정본은 **wbs-web v2.2 사본**이고, 또박또박 사본이 그것을 뒤따라 동기화한다(반대 방향 금지).

---

## 5. 하지 않는 것

- **`GET /api/v1/minutes/meta`에 폴더 목록 추가 안 함.** 하위 폴더는 blind 자동 생성이라 항상 성공한다 → 사전 미리보기가 없어도 전송이 실패하지 않는다. 루트 검증은 기존 `teams`로 충분. 응답 에코(§3.3)가 사후 피드백을 대신한다
- **기존 전송분 제목 소급 정리 안 함** (§3.4 · §8.4) — 폴더 재편철은 §8에서 하지만 제목은 건드리지 않는다
- **스키마 마이그레이션 없음**(컬럼·인덱스·제약 추가 없음) — `folder_id`는 metadata allowlist에 이미 있다(`0045:1167`). ⚠️ 단 **§6.7(W23)의 데이터 백필·사용자 루트 폴더 정리 SQL은 별건으로 필요하다** — §6 UI 전환의 선행 조건이다
- 신규 엔드포인트는 **`POST /api/v1/minutes/folder` 1개뿐**(§8). 그 외 추가 없음
- **`team_code` 컬럼을 제거하지 않는다.** §6에서 UI의 "담당" 입력만 없앨 뿐, 컬럼·인덱스·필터는 그대로 유지하고 폴더에서 파생한다(§6.3)
- **팀 간 폴더 이동은 v1 제외**(§6.5) — 서브트리 전체 `team_code` 변경 = 위키 전면 재인덱싱. 별도 티켓
- **드롭으로 형제 순서(`sort`) 변경은 v1 제외** — 부모 변경만

---

## 6. 폴더 중심 UI 재편 (W7 · W18~W23) — 사용자 결정 2026-07-27

### 6.1 요구

1. **회의록 업로드·수정 모달에서 “담당(team)”과 “하위 구분”을 삭제**하고, **선택된 폴더를 기준으로** 회의록을 만든다
2. 회의록을 **드래그앤드롭으로 폴더 이동**
3. 폴더도 **드래그앤드롭으로 이동**. 단 **권한은 관리자(`pmo_admin`)만**

이 요구가 기존 W7(트리 피커 교체) 권고를 **대체**한다 — 같은 문제의 더 큰 해법이다.

### 6.2 왜 지금 구조가 깨지는가 (D6이 대응하는 갭 — 배경 검토서에서 `G8`로 등재된 항목. 내용은 아래에 전부 옮겼다)

`MinuteMetaModal.tsx:80-93`:

```ts
const changed = init !== null && (team !== init.team || sub !== init.sub)
const needFolder = folders.length > 0 && (changed || minute.folderId == null)
const fid = needFolder
  ? (sub ? subgroupFolderId(folders, team, sub) : teamRootFolderIdOf(folders, team))
  : null
```

- `teamSubOfFolder()`는 체인을 올라가 시드 루트를 만나면 **루트 직계 자식**을 `sub`로 돌려준다. `MES/품질/주간정례/2026-07`에 있는 회의록은 `sub = "품질"`로 보인다
- 팀이나 하위 구분을 **실제로 바꿔 저장하면** `subgroupFolderId()`가 **루트 직계 자식 id**를 반환 → **2단으로 강등**. `주간정례/2026-07`이 소실된다
- 무변경 저장은 `changed` 가드가 막아 안전하다. 하지만 `folder_path`로 3단 이상이 들어오는 순간 이 강등은 재현 가능한 버그가 된다

### 6.3 ⚠️ 핵심 파급: “담당 삭제”는 team_code 삭제가 아니다

`minutes.team_code`는 **`not null`이고 지울 수 없다**(C1 — 인덱스·`minute_versions`·위키 파이프라인·`GET ?team=`가 전부 물려 있다). UI에서 입력만 없애고 **폴더에서 파생**한다.

파생 로직은 **이미 있다**: `teamSubOfFolder()`(`src/lib/domain/minutes.ts:95-115`)가 조상 체인을 올라가 시드 팀 루트를 만나면 그 폴더명이 곧 팀 코드다.

**하지만 이 파생이 성립하려면 불변식이 필요하다 — 모든 폴더는 시드 팀 루트 5개 중 하나의 서브트리에 있어야 한다.** 지금은 안 그렇다:

| 구멍 | 현재 | 조치 |
|---|---|---|
| **사용자 루트 폴더** | `createMinuteFolder`(`actions/minutes.ts:587-616`)가 `parentId === null`을 **허용**한다. 팀코드 동명만 막는다(598행) | **루트 생성 금지**로 변경. `parentId === null`이면 거절 (W18) |
| **미분류** (`folder_id is null`) | 실제 행이 아니라 null. team 파생 불가 | **업로드 시 폴더 선택 필수**(W19). 기존 미분류분은 §6.7로 편철 |
| 기존 사용자 루트 폴더 | 이미 존재할 수 있음 | §6.7 마이그레이션 |

> 이 불변식은 또박또박 `folder_path`의 “한 칸 내림” 규칙(§3.2 ②)과 정확히 같은 원리다 — 외부에서 들어오는 자유 루트도 팀 루트 아래로 들어간다. UI도 같은 규칙을 따르게 되는 것.

### 6.4 회의록 드래그앤드롭 (W20)

`moveMinuteToFolder`(`actions/minutes.ts:673-700`)는 지금 **`folder_id`만** 바꾼다. 폴더가 team의 유일한 출처가 되면 **team_code도 따라가야** 한다 — 아니면 “폴더는 MES인데 `team_code`는 ERP”인 불일치가 생기고, 목록 필터(`?team=`)와 트리가 서로 다른 답을 준다.

| 이동 | team_code | 처리 |
|---|---|---|
| **같은 팀 루트 안** (대부분) | 불변 | 현행 raw update 그대로. 위키 무영향, 싸다 |
| **다른 팀 루트로** | **바뀐다** | **`update_minute_metadata_with_wiki_retraction` RPC 경유 필수** — `team_code`는 `v_index_content_changed`(`0045:1252`) 대상이라 위키 재빌드·철회가 따라야 한다. raw update로 하면 위키가 옛 팀에 남는다. `updateMinuteMeta`(`actions/minutes.ts:230`)가 쓰는 그 경로를 재사용할 것 |

- 권한: 기존 `checkOwner`(작성자 또는 `pmo_admin`) **유지** — 사용자가 관리자 전용으로 지정한 건 **폴더** D&D다
- `archived` 회의록은 이동 불가 (`checkOwner`가 이미 막는다)
- 드롭 대상에 **미분류는 포함하지 않는다**(§6.3 불변식). 폴더에서 빼는 조작은 UI에서 제공하지 않음

### 6.5 폴더 드래그앤드롭 — 관리자 전용 (W21)

**`moveMinuteFolder` 액션은 현재 존재하지 않는다.** 신설.

권한: `role === 'pmo_admin'` **만**. RLS(`0040`)는 `created_by = auth.uid() or app_role() = 'pmo_admin'`이라 더 넓으므로, **서버 액션에서 좁혀야** 한다(RLS만 믿으면 폴더 작성자도 옮길 수 있다).

가드 5개 — 하나라도 빠지면 트리가 깨진다:

| # | 가드 | 이유 |
|---|---|---|
| M1 | **시드 팀 루트는 이동 불가** (`isTeamRootFolder`) | 0043 편철 앵커. 개명·삭제가 이미 금지돼 있다(`actions/minutes.ts:633, 663`) — 이동도 같은 이유로 금지 |
| M2 | **루트로 이동 불가** (`parent_id = null` 금지) | §6.3 불변식. 루트가 되는 순간 그 서브트리 회의록의 team 파생이 끊긴다 |
| M3 | **사이클 금지** — 자기 자신·자손 밑으로 이동 금지 | 대상이 이동 폴더의 서브트리에 속하면 거절. 서브트리 계산에 순환 가드 필요(또박또박 `Folder#subtree_ids` 선례) |
| M4 | **깊이 5 초과 금지** | `folderDepthOf(대상) + 이동 폴더의 서브트리 높이 ≤ 5`. ⚠️ `folderDepthOf`만으로는 부족하다 — **서브트리 높이를 따로 계산**해야 한다. 안 하면 UI가 만들 수 없는 깊이가 생긴다(C6) |
| M5 | **같은 부모 내 이름 중복** | `minute_folders_child_name_uniq`는 부분 인덱스 → `ON CONFLICT` 금지(C3). 사전 조회 + `23505` 폴백 |

#### ⚠️ 팀 간 폴더 이동은 v1에서 금지 (권고)

폴더를 **다른 팀 루트 밑으로** 옮기면 **서브트리의 모든 회의록 `team_code`가 바뀌어야** 한다. 그러면:

- 회의록 수백 건이 한꺼번에 `v_index_content_changed` 대상 → **드래그 한 번에 위키 전면 재인덱싱**
- `minute_versions.team_code`(not null, `0045:105`)와의 정합도 건별로 따져야 한다
- 실패 시 부분 적용 상태가 남는다(서브트리 일부만 이동)

→ **v1은 같은 팀 루트 서브트리 안에서만 이동 허용.** 다른 팀 루트로의 드롭은 UI에서 막고 “회의록을 개별로 옮기세요”로 안내. 팀 간 폴더 이동은 별도 티켓(대량 처리·진행률·롤백 설계가 따로 필요).

`sort` 처리: v1은 **부모만 변경하고 형제 내 순서는 말단 배치**(`sort = 100`, 사용자 생성 기본값). 드롭 위치로 순서까지 바꾸는 건 별건.

### 6.6 작업 목록

| # | 파일 | 작업 |
|---|---|---|
| **W18** | `src/app/actions/minutes.ts:587` | `createMinuteFolder` — `parentId === null` **거절**. 팀 루트 하위에서만 생성. 기존 팀코드 동명 가드(598행)는 그대로 두되 도달 불가가 되므로 정리 |
| **W19** | `src/components/minutes/MinuteUploadModal.tsx` | 담당·하위 구분 셀렉트 제거 → **폴더 트리 피커**. 폴더 **필수**. `team_code`는 선택 폴더에서 파생해 전송 |
| **W20a** | `src/components/minutes/MinuteMetaModal.tsx` | 담당·하위 구분 제거 → 폴더 트리 피커. `subgroupsOf`·`subgroupFolderId`·`teamSubOfFolder` 사용처 정리 |
| **W20b** | `src/app/actions/minutes.ts:673` | `moveMinuteToFolder` — **팀 넘어 이동 시 `team_code` 동반 갱신 + 메타 RPC 경유**(§6.4) |
| **W21** | `src/app/actions/minutes.ts` **(신규)** | `moveMinuteFolder(id, parentId)` — `pmo_admin` 전용, 가드 M1~M5, 팀 간 이동 차단 |
| **W22** | `src/components/minutes/MinutesExplorer.tsx` | 회의록·폴더 D&D. 드롭 가능 여부를 **드래그 중 시각 표시**(금지 대상은 드롭존 비활성) — 놓고 나서 에러 토스트로 알리는 UX 금지 |
| **W23** | 마이그레이션 | §6.7 |

`W7`(트리 피커)은 W19·W20a에 흡수된다.

### 6.7 마이그레이션 — 불변식 만들기 (W23)

UI를 바꾸기 **전에** 데이터가 불변식을 만족해야 한다. 아니면 team 파생이 조용히 null을 뱉는다.

```sql
-- ① 사용자 루트 폴더 조사 (시드 아닌 루트)
select id, name, sort, created_by,
       (select count(*) from minutes m where m.folder_id = f.id) as direct_minutes
from minute_folders f
where parent_id is null and created_by is not null
order by name;

-- ② 미분류 회의록 잔량
select team_code, count(*) from minutes
where folder_id is null and archived_at is null
group by team_code order by 2 desc;
```

- **①이 0건이 아니면**: 각 폴더를 적절한 팀 루트 하위로 이동(`parent_id` 지정)하거나 삭제. **관리자 판단 필요** — 자동 추정 금지. 이동 후 그 서브트리 회의록의 `team_code`를 새 팀에 맞춰 갱신
- **②는 0043 4단계와 같은 로직**으로 팀 루트에 백필: `update minutes m set folder_id = f.id from minute_folders f where m.folder_id is null and f.parent_id is null and f.name = m.team_code and f.created_by is null`. **`updated_at`은 건드리지 않는다**(0043 4단계 주석과 동일 이유 — 외부 연동 GET에 갱신으로 비치면 안 됨)
- 백필 후에도 남는 미분류(팀 루트가 없는 team_code)는 **fail-loud로 목록 출력**. 조용히 두면 UI 전환 후 편집 불가 상태가 된다

### 6.8 수용 기준 (§6)

- [ ] 업로드 모달에 담당·하위 구분 셀렉트가 없고, **폴더 미선택 시 저장 불가**
- [ ] 폴더 선택만으로 `team_code`가 올바르게 파생돼 저장된다
- [ ] 4단 폴더에 있는 회의록을 수정 모달에서 저장 → **경로 유지**(2단 강등 없음)
- [ ] 루트에 새 폴더 생성 시도 → 거절
- [ ] 회의록 D&D 같은 팀 내 이동 → `team_code` 불변, 위키 잡 신규 없음
- [ ] 회의록 D&D 다른 팀으로 이동 → `team_code` 갱신 **&&** 위키 철회·재빌드 발생
- [ ] 폴더 D&D: 일반 사용자 = 불가, `pmo_admin` = 가능
- [ ] 시드 팀 루트는 드래그 자체가 안 됨
- [ ] 자기 자손 밑으로 드롭 시도 → 드롭존 비활성(놓기 전에 차단)
- [ ] 이동 시 깊이 5 초과가 되는 조합 → 드롭존 비활성. **서브트리 높이까지 계산**하는지 3단 폴더를 3단 위치로 끄는 케이스로 검증
- [ ] 같은 부모에 동명 폴더 드롭 → 명확한 에러(23505 원문 노출 아님)
- [ ] 다른 팀 루트로의 폴더 드롭 → 차단 + 안내
- [ ] 마이그레이션 후 `parent_id is null and created_by is not null` = **0건**, 미분류 = 0건

---

## 7. 선행 확인 (구현 착수 전)

- **0043이 운영 DB에 적용되어 있는가.** `scripts/apply-0043.mjs` 주석이 “**코드 배포 전에** 적용”을 요구한다. 미적용이면 팀 루트 폴더 자체가 없어 현재 또박또박 전송분이 전부 **미분류(`folder_id null`)** 로 쌓이고 있을 수 있다. 이 작업보다 우선순위가 높다
- 확인 쿼리:
  ```sql
  select name, sort, parent_id, created_by from minute_folders
  where parent_id is null order by sort;
  -- 기대: PMO(0)·ERP(1)·MES(2)·가공(3)·MDM(4), created_by 전부 null

  select count(*) from minutes where folder_id is null and archived_at is null;
  -- 기대: 0에 가까움. 크면 0043 미적용 또는 백필 누락
  ```
- **계약서(`docs/design/dflow-minutes-upload-api-spec.md`) 개정 = W8도 착수 전 선행이다.** 사본 2개가 이미 갈라져 있고 이번 변경과 충돌하는 문장이 살아 있다 → §4 「⚠️ W8」 블록
- **§8.3의 ⚠️ 결정 필요 · §9.7의 ⚠️ 결정 필요 · §3.3의 ⚠️ 확정 필요** 3건은 구현 중 자연히 결론이 나지 않는다. **팀장 판단이 필요하므로 착수 시점에 함께 올릴 것**
- **또박또박 측 조치 요청 7건(§11.3)** 도 팀장 조율 대상이다. 특히 ①·⑦(차수 재배치)·②(ddobak-W8 필수 승격)·⑥(응답 타입 nullable)은 이 문서의 계약과 직접 맞물린다

---

## 8. 일괄 마이그레이션 — 이미 D'Flow에 있는 회의록 재편철 (W6)

### 8.1 왜 “재전송”으로 하면 안 되나

가장 쉬운 방법은 또박또박이 기존 회의를 전부 `on_conflict=replace`로 재전송하는 것이다. **하지 말 것.** `commit_minute_body_version`은 **본문이 동일해도 무조건 새 버전을 append**한다 (`0045:1742` — `v_body_changed`는 위키 철회와 스냅샷 보존만 게이트하고 append 자체는 무조건):

- 회의록 N건 → **버전 N개 신규 생성**, 각각 본문 전문 복사 (`minute_versions.body_md`)
- `route.ts:127-144`의 `runMinutePostProcessing(rematch: true)` + `ingestMinute` + `generateMinuteInsights`가 전건 재실행 → **LLM 호출 폭주**
- 사용자에게는 “전 회의록이 어제 수정됨”으로 보인다

반면 **폴더만 바꾸는 것은 지극히 싸다**:

- `v_index_content_changed`(`0045:1250-1256`)에 `folder_id`가 **없다** → 위키 재빌드 안 걸림
- 기존 `moveMinuteToFolder`(`src/app/actions/minutes.ts:673-700`)가 이미 `update minutes set folder_id`만 하는 단순 경로다

→ **전용 경량 배치 엔드포인트**를 만든다.

### 8.2 `POST /api/v1/minutes/folder`

기존 `/api/v1/minutes*` 관례를 그대로 따른다: `gateMinutesApi`(env 2단 + Bearer 시크릿) → `parseUserEmail` → `resolveUserByEmail`(403 `unknown_user`) → `createAdminClient`.

```jsonc
// 요청
{
  "user_email": "hong@dongkuk.com",
  "dry_run": true,                          // 기본 true — 실제 이동은 명시적 false 필요
  "overwrite_manual": false,                // 아래 §8.3
  "items": [
    { "external_id": "ddobak:018f…", "team": "MES", "folder_path": ["MES","품질","주간정례"] },
    { "external_id": "ddobak:018f…", "folder_path": ["신규TF","킥오프"] },   // team 생략
    { "external_id": "ddobak:018f…", "team": "MES", "folder_path": [] }
  ]
}
```

> **`items[].team`은 선택 필드다.** 생략하면 **해당 회의록의 기존 `team_code`를 그대로 쓴다.**
> 필요한 이유: 또박또박은 **전송 당시 사용자가 고른 team을 기록하지 않는다**(`meetings`에 `dflow_synced_at`·`dflow_url`만 있음). 루트가 팀코드가 아니었던 회의는 마이그레이션 시점에 team을 재판정할 수 없다. D'Flow에 이미 저장된 `team_code`가 그 시점의 정답이므로 그걸 쓴다.
> `team`이 **주어졌는데** 회의록의 기존 `team_code`와 다르면 → `failed` (`reason: "team_mismatch"`). 마이그레이션이 팀을 옮기는 도구가 되면 안 된다 — 팀 이동은 위키 재빌드를 유발한다(`0045:1252`).

```jsonc
// 응답
{
  "ok": true, "dry_run": true,
  "summary": { "total": 200, "moved": 173, "already_correct": 1, "skipped": 21, "not_found": 3, "failed": 2 },
  // total = moved + already_correct + skipped + not_found + failed (200 = 173+1+21+3+2). total은 요청 상한 200을 넘지 않는다
  "results": [
    { "external_id": "ddobak:018f…", "status": "moved",
      "from": ["MES"], "to": ["MES","품질","주간정례"], "folder_id": "9f3c…" },
    { "external_id": "ddobak:018f…", "status": "already_correct",
      "from": ["MES","품질"], "folder_id": "9f3c…" },
    { "external_id": "ddobak:018f…", "status": "skipped", "reason": "manual_placement" },
    { "external_id": "ddobak:018f…", "status": "not_found" },
    { "external_id": "ddobak:018f…", "status": "failed", "reason": "folder_name_too_long: 현장품질개선…(72자)" },
    { "external_id": "ddobak:018f…", "status": "failed", "reason": "no_team_root",
      "from": ["MES"] }        // ⚠️ to·folder_id 없음 — 이동하지 않았음을 형태로 드러낸다(요건 11)
  ]
}
```

구현 요건:

1. **`folder_path` 해석은 §3.2 정규화 규칙을 그대로 재사용** — `resolveFolderPath(sb, teamCode, path)`를 공유한다. 별도 구현 금지(두 경로가 갈라지면 마이그레이션 결과와 이후 전송 결과가 어긋난다).
   ⚠️ **시그니처 계약**: `teamCode`는 **필수·구체값**이다. `items[].team`이 선택인 것은 **배치 라우트의 책임** — 라우트가 먼저 team을 확정(주어짐 → 회의록의 `team_code`와 대조, 생략 → 회의록의 `team_code` 사용)한 뒤 확정값으로 공유 함수를 호출한다. 공유 함수 안에 `teamCode` 옵션 분기를 만들지 말 것(두 번째 정규화 구현이 생기는 통로다)
2. **`updated_at`을 갱신하지 않는다.** 0043 백필이 명시적으로 지킨 규칙이다 — “조직 백필이 외부 연동 GET `updated_at`에 갱신으로 비치면 안 됨”(`0043` 4단계 주석). `moveMinuteToFolder`는 `updated_at`을 갱신하지만 그건 단건 사용자 조작이라 다르다. **대량 마이그레이션에서 갱신하면 또박또박 목록이 전건 “방금 수정됨”으로 보인다**
3. **버전 append 없음.** `commit_minute_body_version` 경유 금지. `admin.from('minutes').update({ folder_id })` 직접
4. `archived_at is not null` → `skipped` (`reason: "archived"`)
5. **배치 상한**: `items` 최대 200건/요청. 초과는 400. 또박또박이 나눠 보낸다
6. **이미 목표 위치인 건은 `already_correct`** — `moved`에 섞지 말 것. 섞으면 재실행마다 `moved`가 전건으로 나와 진척 신호로 못 쓴다
7. 부분 실패는 전체를 롤백하지 않는다 — 건별 `results`로 보고. 재실행이 멱등이므로 실패분만 다시 보내면 된다
8. `dry_run: true`가 **기본값**. 필드 부재 = dry run
9. **`items: []`(빈 배열)은 유효 요청이다** — `200 OK` + **전 카운트 0인 summary**(`{ total: 0, moved: 0, already_correct: 0, skipped: 0, not_found: 0, failed: 0 }`)와 `results: []`를 돌려준다. 400으로 거절하지 말 것.
   - **이유**: 또박또박이 **배치 시작 전 `ACTOR_EMAIL` 검증 프로브**로 이 요청을 쓴다(빈 `items` + `dry_run: true` 1회). 잘못된 계정으로 수백 건을 전부 403으로 태우는 것을 막는 유일한 수단이다(요약 = **§11.1 「배치 실행 공통 전제 — `ACTOR_EMAIL`」**, 원문 = 또박또박 작업지시 §7.0 — rake에는 `current_user`가 없어 이메일을 인자로 받는다).
   - **게이트 순서**: `gateMinutesApi` → `parseUserEmail` → `resolveUserByEmail` → 페이로드 검증. 즉 **계정이 불량이면 `items` 길이를 보기 전에 이 프로브가 403 `unknown_user`를 먼저 낸다.** 그래서 프로브가 성립한다 — `items` 검증을 “비어있지 않은 배열”로 좁히면(흔한 기본값) 정상 계정에서도 400이 나와 또박또박의 “프로브 실패 시 중단” 규칙에 걸려 **마이그레이션 시작 자체가 불가**해진다.
10. **판정 선후 — `already_correct`가 `overwrite_manual` 판정보다 먼저다.** 현재 위치가 목표 위치와 **동일하면**, **§8.3 판정 표 전체보다 먼저** `already_correct`로 확정한다(표의 어느 행에도 걸리지 않는다 — 2행 「팀 루트」도 포함).
   - **이유**: 그러지 않으면 1차 APPLY로 하위 폴더에 옮긴 건들이 **재실행 dry-run에서 전부 `manual_placement`로 집계**된다(현재 `folder_id`만 보면 하위 폴더이므로). 또박또박은 그 수치를 `OVERWRITE_MANUAL` 켤지 말지의 판단 근거로 쓰므로(**dry-run으로 `manual_placement` 건수를 먼저 확인한 뒤 사용자에게 보고하고 결정** — ddobak-W13 · §11.1, 원문 = 또박또박 작업지시 §7.3), 판단 근거가 오염된다. 최악은 담당자가 그 수치를 보고 `OVERWRITE_MANUAL=1`을 켜서 **진짜 사람이 옮긴 건까지 덮는 것**이다.
11. **`status` 값 집합을 응답 예시가 아니라 계약으로 못박는다** — 구현자가 예시에서 유추하지 말 것:

    | `status` | `reason` | 의미 |
    |---|---|---|
    | `moved` | — | 목표 위치로 이동 완료(dry run이면 “이동 예정”) |
    | `already_correct` | — | 이미 목표 위치. `moved`에 섞지 말 것(요건 6·10) |
    | `skipped` | `manual_placement` | 사람이 옮긴 것으로 판정(§8.3) |
    | `skipped` | `archived` | `archived_at is not null`(요건 4) |
    | `not_found` | — | 그 `external_id`의 회의록이 없음 |
    | `failed` | `team_mismatch` | `items[].team`이 회의록의 기존 `team_code`와 다름 |
    | `failed` | `folder_name_too_long: <이름>(<n>자)` | 60자 초과(C5) |
    | `failed` | `validation_failed: <사유>` | `folder_path` 타입·§3.2 ③ 등 |
    | **`failed`** | **`no_team_root`** | ★ **신규.** 정규화 후 `path[0]`의 시드 루트가 없어 §3.2-5 `null`(미분류) 폴백이 발동한 경우 |

    ⚠️ **`no_team_root`를 `moved`로 집계하면 안 된다.** 배치는 ‘등록’이 아니라 **‘이동’**이다. 등록(`POST /minutes`)에서는 편철 실패가 등록을 막지 않도록 `null` 폴백이 옳지만, 배치에서 `folder_id`를 `null`로 만드는 것은 **회의록을 미분류로 빼내는 것**이라 목적과 반대다. `moved`로 집계하면 **리포트는 성공인데 트리엔 반영이 없는** 상태가 되고, 멱등 재실행마다 같은 건이 다시 `moved`로 나온다. → **폴백을 적용하지 말고(`folder_id` 변경 없음) `failed(no_team_root)`로 보고**한다. 이 카테고리가 나오면 원인은 거의 항상 **0043 미적용**이다(§7).

    ⚠️ **요건 1과 충돌하지 않게 읽을 것.** `resolveFolderPath`는 두 호출자에게 **동일하게** `folderId: null`을 반환한다 — 공유 함수 안에 호출자별 분기를 만들지 말 것(요건 1). **그 `null`을 어떻게 처리할지는 호출자가 정한다**: `POST /minutes`는 `folder_id: null`로 **등록**하고(§3.2-5 · 응답은 §3.3), 배치는 `folder_id`를 **건드리지 않고** `failed(no_team_root)`로 보고한다.

### 8.3 이미 수동으로 옮긴 회의록 (`overwrite_manual`)

D'Flow 사용자가 탐색기에서 직접 옮겨 둔 회의록을 마이그레이션이 덮으면 사람이 한 일이 지워진다. 판정 기준:

> ⚠️ **게이트**: 아래 판정은 **현재 위치 ≠ 목표 위치**일 때만 적용한다 — 동일하면 `overwrite_manual`·`manual_placement` 판정 이전에 §8.2-10에 따라 `already_correct`로 확정한다.

| 현재 `folder_id` | 해석 | `overwrite_manual: false`(기본) |
|---|---|---|
| `null`(미분류) | 아직 편철 안 됨 | **이동** |
| 팀 루트 = 외부 API가 자동 편철한 자리 | 자동 편철 그대로 — ⚠️ **W3 배포 후 이 전제가 거짓이 된다(아래 블록)** | **이동** (단 목표 위치와 동일하면 `already_correct` — §8.2-10) |
| 그 외(하위 폴더 어딘가) | 사람이 옮겼을 가능성 — ⚠️ **W3 배포 후에는 자동 편철분도 여기 섞인다(아래 블록)** | **skip** (`reason: "manual_placement"`)<br>단 **목표 위치와 동일하면 `already_correct`가 먼저다**(§8.2-10) |

`overwrite_manual: true`면 전부 이동. **dry run으로 `manual_placement` 건수를 먼저 확인한 뒤 결정**할 것.

> ### ⚠️ 이 표의 전제는 **W3 배포 후 거짓**이 된다 — 결정 필요
>
> 2행 “**팀 루트 = 외부 API가 자동 편철한 자리**”는 `insertNew`가 `resolveTeamRootFolderId`로 팀 루트에만 떨구던 세계의 명제다. **W3이 그것을 `resolveFolderPath`로 바꾸면 신규 전송이 하위 폴더에 직접 편철된다** → 그 순간부터 “**하위 폴더에 있지만 사람이 옮긴 게 아닌**” 회의록이 존재한다. 3행의 “사람이 옮겼을 가능성” 추론이 무너진다.
>
> **가정이 아니라 실제로 발생한다** — 배포 순서상 또박또박 **2차(전송 전환)가 3차(재편철)보다 앞이기 때문**이다(§11.2). 3차를 실행하는 시점에는 이미 2차가 만든 자동 편철분이 하위 폴더에 쌓여 있다.
>
> 구체 시나리오: 2차 후 `MES/품질/주간정례`에 자동 편철된 회의를 또박또박에서 `MES/품질/월간`으로 옮기고 **재전송은 안 한 채** 3차를 실행 → 하위 폴더라서 `manual_placement` skip → **D1=B(또박또박이 SSOT — §0.1)가 그 건에만 적용되지 않는다.** 반대로 담당자가 늘어난 skip 건수를 보고 `OVERWRITE_MANUAL=1`을 켜면 **진짜 사람이 옮긴 건(§6.4 D&D 포함)까지 덮인다.**
>
> **⚠️ 결정 필요 — 해소 선택지 2개:**
>
> | 안 | 내용 | 비용 |
> |---|---|---|
> | **(a)** 판정 기준 교체 | “현재 `folder_id`가 팀 루트냐”가 아니라 “**마지막 전송 시각 이후 D'Flow 쪽에서 이동이 있었는지**”로 판정 | D'Flow에 이동 시각·주체 흔적이 필요(현재 `minutes.updated_at`은 전송으로도 갱신되므로 그대로는 못 씀) → 설계 필요 |
> | **(b)** 순서 교체 | **재편철(또박또박 3차)을 전송 전환(2차)보다 앞세운다** | 문서 한 줄 + 팀장 조율. 단 3차는 D'Flow **W6** 배포가 전제이므로 D'Flow W6을 W1~W5와 함께(또는 먼저) 내야 한다 |
>
> (b)를 택하면 §11.3 ⑤(‘W3 선배포 금지’ 근거 정정)와 같은 결정이 되므로 **§11.2 차수표를 함께 개정**해야 한다. 두 절을 별개의 미결 항목으로 읽지 말 것.

### 8.4 제목 접두(`<하위폴더명>-`) 정리는 이 마이그레이션에 포함하지 않는다

- `title` 변경은 `v_index_content_changed`(`0045:1251`)에 **포함**된다 → **위키 재빌드 유발**. 폴더 이동의 “공짜” 성질이 사라진다
- `minute_versions`의 과거 행은 그때의 제목을 보존해야 맞다 — 소급 재작성은 히스토리 오염
- → **별건**으로 분리. 필요하면 폴더 마이그레이션 안정화 후 별도 판단

### 8.5 대안 — 또박또박 없이 D'Flow 단독 SQL

또박또박이 응답하지 않는 상황의 **보조 수단**: 제목 접두(`<하위폴더명>-`)에서 2단째 폴더명을 역파싱해 `minutes.folder_id`를 채운다. **접두는 2단째 하나뿐이라 3단 이상은 복원 불가**이고, 제목에 원래 `-`가 있으면 오파싱한다. **정본은 §8.2** — 진짜 경로는 또박또박만 안다.

⚠️ 또박또박 `ddobak-W6`(접두 제거)이 배포된 뒤 전송된 분은 **제목에 단서가 0**이라 이 방법이 아예 적용되지 않는다.

---

## 9. 연동 식별자 표시 + 연결 초기화 (W10)

### 9.1 배경

D'Flow UI에는 `external_id` 노출이 **전혀 없다** (`src/components/minutes/` 전체에 참조 0건). 그래서 D'Flow 사용자는:

- 이 회의록이 또박또박에서 온 것인지 알 수 없다
- 어느 또박또박 회의와 묶여 있는지 확인할 수 없다
- **잘못 연결된 것을 푸는 방법이 없다**

### 9.2 요구

회의 정보 수정 모달(`MinuteMetaModal`)에:

1. **연동 식별자 표시** — `external_id`가 `ddobak:` 프리픽스면 “또박또박 연동” 라벨 + uuid 부분(복사 버튼). 다른 값이면 원문 그대로. `null`이면 “연동 없음”
2. **연결 초기화 버튼** — `external_id`를 `null`로

### 9.3 초기화 = 연결 끊김. 그리고 **한쪽만** 끊긴다 ⚠️

| 대상 | 초기화 후 |
|---|---|
| D'Flow `minutes.external_id` | `null` — 멱등 키 소실 |
| 또박또박 `meetings.public_uid` · `dflow_synced_at` · `dflow_url` | **그대로 남는다.** 또박또박은 여전히 “연결됨”으로 표시 |
| 또박또박이 그 회의를 다시 전송하면 | `external_id` 매칭 실패 → **새 회의록 생성(중복)**. 초기화된 원본은 고아로 남음 |

**감지 경로는 이미 있다.** 또박또박 `GET /api/v1/meetings/:id/dflow/status`가 `list_minutes(external_id: "ddobak:<uid>")`로 존재를 확인해 `exists_on_dflow`를 반환한다 (`meeting_dflow_controller.rb:37-41`). 초기화 후 이 값이 `false`가 되므로 또박또박이 “D'Flow에서 연결이 끊겼습니다”를 안내할 수 있다 — 또박또박 측 대응은 **ddobak-W14**(또박또박 작업지시 §7.6, 요약 = §11.1)다.

> ⚠️ 단 `exists_on_dflow: false`는 **초기화 전용 신호가 아니다.** 보관(archive)만 해도 같은 값이 나오고, 그때는 또박또박이 안내하는 복구 두 갈래가 **둘 다 막힌다.** 상세·해소 선택지 = **§9.7**.

**복구는 깨끗하다.** `POST /api/v1/minutes/link`가 정확히 `external_id is null`인 회의록에 external_id를 부여하는 claim 경로다 (`link/route.ts`). 즉 또박또박의 **[D'Flow에서 찾기] → 해당 회의록 선택**으로 재연결된다. 이 경로는 **본문·`updated_at`·후처리 파이프라인을 건드리지 않는다**(라우트 주석 명시).

→ 정리: **초기화는 되돌릴 수 있다.** 단 되돌리는 조작은 또박또박 쪽에서 해야 한다. 확인 다이얼로그에 이 사실을 적을 것.

### 9.4 구현 요건

1. **`external_id`는 metadata allowlist에 없다** (`0045:1166-1167`) → `commit_minute_body_version` 경유 **불가**. `moveMinuteToFolder`(`actions/minutes.ts:673-700`)와 같은 **전용 server action**으로 직접 `update minutes set external_id = null`
2. **권한은 메타 수정과 동일** — `checkOwner(sb, minuteId, user.id, m.role)` (작성자 또는 `pmo_admin`)
3. `updated_at`은 **갱신한다** — 사용자 조작이므로 대량 마이그레이션(§8.2-2)과 다르다
4. **버전 append 없음, 위키 무영향** — `external_id`는 `v_index_content_changed` 대상이 아니다
5. **확인 다이얼로그 필수.** 문구에 (a) 또박또박과의 연결이 끊긴다 (b) 그 상태로 또박또박이 재전송하면 **중복 회의록이 생긴다** (c) 또박또박 [D'Flow에서 찾기]로 재연결 가능 — 3가지를 담을 것
6. **보관(archived) 회의록은 초기화 불가** — `link` 경로가 archived를 409로 막으므로(`link/route.ts`), 초기화만 되고 재연결이 안 되는 편도 상태를 만들지 말 것

### 9.5 자동 링크의 전제조건 — §9는 선택이 아니다

또박또박이 **미연결 회의 자동 링크**(`ddobak-W15`·`ddobak-W16`)를 붙인다: D'Flow에 수동 업로드된 회의록(`external_id is null`)과 또박또박 회의를 `(날짜, team, 정규화 제목)`으로 매칭해 `POST /minutes/link`로 claim한다. 규칙 요약은 **§11.1 「자동 링크」 행**, 원문은 또박또박 작업지시 §7.7.

- **D'Flow 측 추가 구현은 없다.** 단 `POST /minutes/link`는 `user_email` → `resolveUserByEmail` 403 게이트를 그대로 유지한다(또박또박이 rake 인자로 실행 주체 이메일을 받아 사전 검증). 그 계정은 D'Flow `auth.users`에 실재해야 한다.
-  기존 `GET /minutes?linked=false`와 `POST /minutes/link`로 충분하고, 배치 엔드포인트도 만들지 않는다(또박또박이 순차 호출)
- 자동은 **exact + 후보 유일**일 때만. 애매하면 사람이 고른다
- **초기화한 것을 다시 붙이지 않는다.** D'Flow에서 초기화한 회의록은 `external_id is null` 상태가 되는데, 이는 자동 링크의 매칭 대상 상태와 동일하다. 또박또박이 **기본적으로 제외**하고 `RELINK_RESET=1` 명시 시에만 재연결하도록 했다 — D'Flow에서 끊은 것이 다음 배치에 조용히 되붙는 일은 없다
- **다만 오매칭이 발생하면** 이후 또박또박 재전송(`replace`)이 **엉뚱한 회의록 본문을 덮어쓴다**. 되돌리려면 `external_id`를 떼야 하는데, **그 수단이 §9 초기화뿐이다**

→ **§9(연결 초기화)는 자동 링크의 안전장치다.** 이것 없이 자동 링크를 켜면 오매칭을 되돌릴 방법이 없다. W10을 자동 링크보다 **먼저** 배포할 것.

부수 요청 1건(**ddobak-W17** 관련 — 또박또박 측 작업번호다. 이 문서의 `W`와 별개, 머리말 「W 번호 표기 규약」 참조): D'Flow는 이미 `GET /minutes?external_id=`로 `title`·`date`를 돌려주므로 **추가 변경 없음**. 또박또박이 그 값을 자기 `status` 응답에 실어 "무엇을 덮어쓰는지" 보여준다.

### 9.6 수용 기준 (W10)

- [ ] `external_id`가 `ddobak:…`인 회의록에서 uuid가 보이고 복사된다
- [ ] `external_id`가 `null`인 회의록은 “연동 없음” 표시, 초기화 버튼 비활성
- [ ] 초기화 → `minutes.external_id` = null, `minute_versions` 행 수 불변, 위키 잡 신규 없음
- [ ] 초기화 후 또박또박 `dflow/status`가 `exists_on_dflow: false` 반환
- [ ] 초기화 후 또박또박 [D'Flow에서 찾기] → 해당 회의록 claim → 재연결 성공
- [ ] 작성자·`pmo_admin`이 아닌 사용자는 초기화 불가
- [ ] archived 회의록은 초기화 버튼 비활성

### 9.7 ⚠️ `exists_on_dflow: false`의 archived 오진 — 결정 필요

§9.3이 “초기화 감지 경로는 이미 있다”고 한 그 경로가 **초기화와 보관(archive)을 구분하지 못한다.**

**원인 (코드 근거)**: `GET /api/v1/minutes`의 쿼리가 `.is('archived_at', null)`을 **`external_id` 필터를 포함한 모든 질의에 무조건 적용**한다 — `src/app/api/v1/minutes/route.ts:304`에서 기본 쿼리에 붙고, 범위 초과 페이지의 PGRST103 폴백 카운트 쿼리(`:322-323`)에도 **다시 적용**된다. `external_id` 필터(`:305-306`)는 그 뒤에 붙으므로 archived 회의록은 어떤 조합으로도 조회되지 않는다.

**결과**: D'Flow에서 회의록을 **보관만 해도** 또박또박의 `dflow/status`가 `exists_on_dflow: false`를 돌려주고, 또박또박은 이를 **“D'Flow에서 연결이 초기화(해제)되었습니다”로 오진**한다(또박또박 작업지시 §7.6 = ddobak-W14). 초기화는 일어나지 않았고 `external_id`는 그대로 살아 있다.

**더 나쁜 건 또박또박이 안내할 복구 두 갈래가 둘 다 막히는 것이다**:

| 또박또박이 제시하는 갈래 | 보관분에서 어떻게 되나 | 근거 |
|---|---|---|
| **[D'Flow에서 찾기]로 재연결** (권장 갈래) | **불가.** 보관분은 `GET /minutes?linked=false` 목록에도 안 나온다 — 같은 `archived_at is null` 필터가 걸린다. 고를 대상이 화면에 없다 | `route.ts:304` |
| **[새로 전송]** | **불가.** 같은 `external_id`로 오면 `handleExisting`이 **409 `archived`** (“보관된 회의록입니다. 복원 후 다시 시도하세요.”)로 막는다 | `route.ts:68-70` |

즉 사용자는 “연결이 끊겼습니다 + 이렇게 고치세요” 안내를 받은 뒤 **양쪽 다 실패**한다. 진짜 해법(‘D'Flow에서 보관 해제’)은 어느 화면에도 안 적혀 있다.

부수 영향: 또박또박 자동 링크(ddobak-W15)의 `RELINK_RESET=1` 경로에서 **보관분이 ‘초기화분’으로 분류**돼, D'Flow에 원본이 살아 있는데도 엉뚱한 회의록을 재claim하러 들어간다.

**⚠️ 결정 필요 — 해소 선택지 2개:**

| 안 | 내용 | 비용·성격 |
|---|---|---|
| **(a) D'Flow가 보관 상태를 구분 노출** | `GET /minutes`에 `include_archived=true`(또는 `archived=only`) 파라미터를 추가하거나, `external_id` 정확 조회에서는 archived 필터를 걸지 않고 응답에 `archived: true`를 실어 준다. 또박또박은 “초기화됨” 대신 **“D'Flow에서 보관됨 — 복원 후 다시 시도”**를 안내할 수 있다 | D'Flow 코드 변경 필요(§5의 “신규 엔드포인트 1개뿐” 방침과 충돌하지 않음 — 기존 라우트 파라미터 추가). **원인을 없애는 안** |
| **(b) 또박또박 안내 문구 완화** | `exists_on_dflow: false`를 **“초기화됨”으로 단정하지 않고** “D'Flow에서 확인되지 않습니다(초기화·보관·삭제 중 하나)”로 바꾸고, 복구 갈래에 **“D'Flow에서 보관 해제 확인”**을 추가 | D'Flow 변경 0, 문구만. **오진을 못 없애고 사용자에게 전가하는 안** |

권고: **(a)** — (b)만 하면 자동 링크의 오분류(위 부수 영향)는 남는다. 다만 (a)는 D'Flow 작업이 늘어나므로 **팀장 판단 필요**. 어느 쪽이든 ddobak-W14 문구는 함께 손봐야 한다(§11.3 참조).

---

## 10. 수용 기준

> §6(폴더 중심 재편)·§9(연결 초기화)의 수용 기준은 각 절 안에 있다. 아래는 `folder_path`(§3)와 마이그레이션(§8)용.

- [ ] `folder_path` 키 부재 → 기존과 동일하게 팀 루트 편철 (회귀 없음)
- [ ] `folder_path: []` + `team=MES` → `MES` 팀 루트 편철
- [ ] (D1=B) 3단에 편철된 회의록에 `folder_path: []`로 재전송 → **팀 루트로 되돌아감**
- [ ] `["MES","품질","주간정례","2026-07"]` + `team=MES` → D'Flow에 동일 4단 경로 생성·편철
- [ ] `["신규TF","킥오프"]` + `team=MES` → `MES/신규TF/킥오프`로 편철, 응답 `folder_path`가 `["MES","신규TF","킥오프"]`
- [ ] `["ERP","영업"]` + `team=MES` → 400 (`validation_failed`)
- [ ] 6단 경로 → 5단으로 절단 편철, 응답 `folder_path`가 5개
- [ ] 61자 폴더명 → 400
- [ ] 동일 경로 동시 전송 2건 → 폴더 중복 생성 없음, 500 없음 (23505 재조회 경로 통과)
- [ ] 자동 생성 폴더의 `created_by`가 전송 사용자 (null 아님)
- [ ] (D1=B) 또박또박에서 폴더 이동 후 재전송 → D'Flow 위치 갱신
- [ ] (D1=B) `folder_path` 없이 재전송 → 폴더 위치 **유지**
- [ ] (D6) 3단 이상 편철분을 메타 모달에서 팀 변경 후 저장 → 경로 유지(강등 없음)
- [ ] **(§3.3 ⚠️ 확정 필요 — `folder_path: null`로 확정된 경우에 한함)** 시드 루트 부재로 미분류 폴백 → 응답이 `folder_id: null` **＋ `folder_path: null`**(`[]` 아님, §3.3). 또박또박 다이얼로그가 “팀 루트”라고 말하지 않음
- [ ] **비활성 팀(`active=false`) 시나리오** — `team_code='MDM'`(비활성) + `folder_path[0]==='MDM'` → `["MDM","MDM","품질"]`(= ①에서 탈락해 ②가 적용된 형태)류 **루트 세그먼트 중복 없이** `MDM` 루트 아래 `품질`로 편철(§3.2 ① `path[0] === team` 단독 조건)
- [ ] **(W1-b)** 6번째 팀을 `addTeam`으로 등록한 직후 그 `team`으로 전송 → **400 “잘못된 담당입니다” 아님**(`meta`가 노출하는 팀은 전부 `POST` 통과)

### 마이그레이션(§8)

- [ ] `dry_run` 기본값 true — `dry_run` 필드 없이 호출해도 **아무것도 이동하지 않음**
- [ ] dry run 결과의 `summary`가 실제 실행 결과와 일치
- [ ] 이동 후 `minute_versions` 행 수 **증가 없음** (버전 append 없음)
- [ ] 이동 후 `minutes.updated_at` **불변**
- [ ] 이동 후 `wiki_processing_jobs`·`wiki_project_rebuild_jobs` 신규 행 **없음**
- [ ] `overwrite_manual: false`에서 **목표 위치가 아닌** 하위 폴더에 있던 회의록은 `skipped(manual_placement)` (목표 위치와 같으면 `already_correct` — §8.2-10)
- [ ] `items[].team` 생략 → 기존 `team_code`로 편철 성공
- [ ] `items[].team`이 기존 `team_code`와 다름 → `failed(team_mismatch)`, **이동 안 됨**
- [ ] `archived_at` 있는 회의록 → `skipped(archived)`
- [ ] 201건 요청 → 400
- [ ] 같은 요청 2회 실행 → 결과 동일(멱등), 폴더 중복 생성 없음
- [ ] **`items: []` + `dry_run: true`** → **200 OK** + 전 카운트 0 summary (**400 아님** — 또박또박 `ACTOR_EMAIL` 프로브, §8.2-9)
- [ ] **D'Flow에 없는 `user_email`** + `items: []` → **403 `unknown_user`** (계정 게이트가 페이로드 검증보다 **먼저**)
- [ ] **APPLY 후 같은 요청 재실행 dry-run** → 방금 옮긴 건이 **`already_correct`** (`skipped(manual_placement)` 아님 — §8.2-10)
- [ ] **팀 루트에 있는 회의록 + 목표도 팀 루트**(`folder_path: []` 또는 `["MES"]`) → **`already_correct`** (`moved` 아님 — §8.3 게이트 · §8.2-10)
- [ ] **시드 팀 루트가 없는 회의록** → **`failed(no_team_root)`**, `folder_id` **변경 없음**(미분류로 빼내지 않음, `moved`로 집계하지 않음 — §8.2-11)

---

## 11. 또박또박 측 작업·배포 상호 의존

> ⚠️ 아래 `ddobak-W*`는 **또박또박** 작업, 접두 없는 `W*`는 **D'Flow(이 문서)** 작업이다.

### 11.1 또박또박 작업 요약 (ddobak-W1~W17)

| 묶음 | 내용 |
|---|---|
| **전송 계약** `W1`·`W2`·`W3`·`W6`·`W7`·`W9` | `folder_path` 조립(**root-first** — 모델 체인이 leaf-first라 `.reverse` 필수, 폴더 없으면 `[]`) · 제목 접두 제거 · team 판정 완화(자유 루트는 `team_override`) · 프런트 미리보기를 편철 경로 표시로 · 응답 타입에 `folder_id`·`folder_path`(⚠️ **nullable** — §3.3) |
| **사전 검증** `W4`·`W5` | 폴더명 61자 이상 전송 전 차단(D'Flow 400 원문 노출 금지) + 그 예외를 컨트롤러 `rescue_from`에 등록(미등록이면 500) |
| **표시** `W8` | 성공 응답의 `folder_path` 표시(절단·한 칸 내림 인지). 현재 ‘권장’ → **필수 승격 요청**(§11.3 ②) |
| **문서·테스트** `W10`·`W11` | 경로 조립·`reverse` 순서 고정·길이 검사 테스트 / 또박또박 sender-spec 개정 |
| **재편철** `W12`·`W13` | 이미 전송된 회의(`dflow_synced_at` 있음)를 `POST /api/v1/minutes/folder`로 **200건씩** 배치 재편철 + `rake dflow:migrate_folders`. dry-run 기본·멱등, `already_correct`를 `moved`에 섞지 않음 |
| **연결 해제 대응** `W14` | `exists_on_dflow: false`면 “연결이 해제되었습니다” 배지 + [전송] 즉시 실행 차단 + 두 갈래([D'Flow에서 찾기] 재연결 / 새로 전송). ⚠️ §9.7 archived 오진이 이 문구에 직결 |
| **자동 링크** `W15`·`W16`·`W17` | D'Flow 수동 업로드분(`external_id is null`)과 또박또박 회의를 `(날짜, team, 정규화 제목)` **exact + 후보 유일**일 때만 `POST /minutes/link` claim. 초기화분은 `RELINK_RESET=1` opt-in(기본 off — 사람이 끊은 것을 되붙이지 않는다). 감지는 회의별 `status` 호출이 아니라 `GET /minutes?linked=true` 페이지 순회 차집합. 롤백(`W16`)의 **D'Flow 절반은 §9 연결 초기화가 있어야** 한다. `W17`은 `status`에 덮어쓸 회의록 제목·날짜 표시(**D'Flow 변경 0** — §9.5) |

**배치 실행 공통 전제 — `ACTOR_EMAIL`** ⚠️: `POST /minutes/folder`·`POST /minutes/link` 둘 다 `user_email` 403 게이트가 있는데 rake에는 `current_user`가 없다. 또박또박은 이메일을 **필수 인자**로 받고 **배치 시작 전에 프로브 1회로 검증**한다(빈 `items` + `dry_run`). 그 프로브가 성립하려면 D'Flow가 **`items: []`를 유효 요청으로 받아야** 한다 → §8.2-9. 그 이메일은 D'Flow `auth.users`에 실재해야 한다.

### 11.2 배포 차수와 상호 의존

또박또박 측 권장 차수표(원문 = 또박또박 작업지시 §5)를 접두를 붙여 인라인한다.

| 차수 | 또박또박 항목 | 전제 조건 (D'Flow) |
|---|---|---|
| **1차** (또박또박이 “무해·선배포 가능”으로 분류) | `ddobak-W1` · `ddobak-W4` · `ddobak-W6` · `ddobak-W7` · `ddobak-W9` · `ddobak-W10` · `ddobak-W11` | 없음 — `folder_path`는 구버전 D'Flow가 무시한다.<br>⚠️ **`ddobak-W4`·`ddobak-W6`·`ddobak-W7`은 1차에서 빼야 한다 → §11.3 ①.** 그 3개를 빼면 1차에 남는 것은 `ddobak-W1`·`ddobak-W9`·`ddobak-W10`·`ddobak-W11`뿐이고, 그때 비로소 “무해”가 참이 된다 |
| **2차** | `ddobak-W2` · `ddobak-W3` · `ddobak-W5` | **D'Flow `W1`~`W5` 배포 확인 후** |
| **3차** — 폴더 재편철 | `ddobak-W12` · `ddobak-W13` | **D'Flow `W6` 배포 후** — 배치 엔드포인트 `POST /api/v1/minutes/folder`가 **없으면 아예 동작하지 않는다** |
| **4차** — 자동 링크 | `ddobak-W14` · `ddobak-W15` · `ddobak-W16` · `ddobak-W17` | **D'Flow `W10` 배포 후** — 연결 초기화가 **오매칭의 유일한 되돌리기 수단**이다(§9.5). 초기화 없이 자동 링크를 켜면 오매칭 복구 불가.<br>⚠️ 단 **D'Flow 의존이 실제로 있는 것은 `ddobak-W15`·`ddobak-W16`뿐**이다 — `ddobak-W14`가 쓰는 `exists_on_dflow`는 오늘 응답에 이미 있고 `ddobak-W17`도 D'Flow 변경 0(§9.5)이다. 아래 「잠금 해제」 표와 이 점에서 어긋나 보이는 것은 또박또박 원문 차수표를 그대로 인라인했기 때문이다 → **§11.3 ⑦** |

> ⚠️ **강조: 3차는 D'Flow `W6`가 전제다. 4차 중 `ddobak-W15`·`ddobak-W16`은 D'Flow `W10`이 전제다**(`ddobak-W14`·`ddobak-W17`은 D'Flow 의존 0 — 아래 참조). 이 두 개(`W6`·`W10`)가 또박또박 마이그레이션의 실질 전부를 잠그고 있다. 순서를 바꾸지 말 것.

#### D'Flow 개발자 관점 — 내 작업이 무엇을 잠금 해제하나

| 내 작업 (D'Flow) | 잠금 해제되는 또박또박 작업 | 그전까지 또박또박은 |
|---|---|---|
| **`W8`** (계약서 개정 · **착수 전 선행**) | 전 차수의 참조 기준 | 자기 레포의 계약 사본(v2.1)에서 **이번 변경과 모순된 지시**를 읽는다(§4 ⚠️ W8) |
| **`W1`~`W5`** (`folder_path` 코어 + 응답 에코 + `replace` 동기화) | **2차**: `ddobak-W2`(접두 제거) · `ddobak-W3`(자유 루트) · `ddobak-W5`<br>표시·타입: `ddobak-W8`·`ddobak-W9`가 실효를 가짐 | 접두를 못 뗀다(떼면 “접두도 없고 폴더도 안 잡힌” 상태). 폴더 이동이 재전송으로 전파되지 않는다 |
| **`W6`** (`POST /minutes/folder` 배치) | **3차**: `ddobak-W12` · `ddobak-W13` | 기존 전송분이 **팀 루트에 평평하게 그대로** 남는다. 정리할 수단이 없다 |
| **`W10`** (연동 식별자 표시 + 연결 초기화) | **4차**: `ddobak-W15` · `ddobak-W16` (자동 링크·롤백) | 자동 링크를 **켤 수 없다** — 오매칭 시 이후 `replace`가 남의 본문을 덮어쓰는데 `external_id`를 뗄 수단이 없다.<br>⚠️ **역방향 위험 — `W10`을 `ddobak-W14`보다 먼저 배포하면 창이 열린다.** D'Flow에서 초기화한 회의를 또박또박은 계속 ‘연결됨’으로 표시하고, 사용자가 재전송하면 **중복 회의록 생성 + 원본 고아**가 된다(§9.3). 자가 치유되지 않는다 → **§11.3 ⑦** |
| **`W18`~`W23`** (§6 폴더 중심 UI 재편) | 직접 잠금 해제하지는 않음 | ⚠️ **다만 §6 D&D를 3차보다 먼저 배포하면** 사용자들이 정리 차원으로 회의록을 옮기기 시작해 3차가 그 건을 전부 `manual_placement`로 skip한다 → **부분 일치 상태가 ‘마이그레이션 완료’로 보고된다.** §8.3 ⚠️와 같은 뿌리 |

### 11.3 또박또박 측 조치 요청 (팀장 조율 필요)

**또박또박 측** 수정 요청 7건이다. D'Flow 작업이 아니지만, **①·②·⑥·⑦은 D'Flow 계약·배포 순서와 직접 맞물려** 있어 팀장이 함께 전달해야 한다.

| # | 요청 | 근거 |
|---|---|---|
| **①** | **`ddobak-W4`·`ddobak-W6`·`ddobak-W7`을 1차 → 2차로 이동** | (a) **접두 제거의 실효 지점이 백엔드 `ddobak-W2`가 아니라 프런트 `ddobak-W6`이다** — UI 전송 경로의 title은 항상 프런트가 만든 값이 `title_override`로 실려 백엔드 자동 조립을 이긴다(실증 경로: `SendToDflowDialog.tsx:65` title 초기값=`buildDflowTitle(folder_path,title)` → `:126` 전송 시 `titleOverride: title` **무조건** 포함 → `api/dflow.ts:47` `titleOverride`→`body.title` → `meeting_dflow_controller.rb:31` `title_override` → `dflow_upload_service.rb:33` `title = @title_override \|\| @meeting.dflow_auto_title`. 전송 호출부는 이 다이얼로그 1곳뿐). 그래서 `ddobak-W6`을 1차에 내면 **그 즉시 접두가 사라지는데** 그 시점 D'Flow는 아직 `folder_path`를 무시하므로, 그 구간 전송분은 **“접두도 없고 폴더도 안 잡힌” 상태**가 된다 — 또박또박 작업지시 §5가 `ddobak-W2`에 대해 금지한 바로 그 상태를 1차가 스스로 만든다. 게다가 그 구간 분은 **§8.5의 D'Flow 단독 복구책(제목 접두 역파싱)이 원리적으로 적용 불가**해진다(제목에 단서가 0). 반대로 `ddobak-W2`만 내면 UI 제목은 하나도 안 바뀌어 “접두 없음” 수용기준이 실패로 보이고 QA가 엉뚱한 곳을 고친다. → 수용기준의 귀속도 `ddobak-W2` → `ddobak-W6`(또는 둘)로 정정 요청.<br>(b) **`ddobak-W4`(61자 사전 차단)가 `ddobak-W5`(예외 rescue 등록)보다 먼저 나가면 500이다** — 새 예외 클래스가 컨트롤러 rescue 목록에 없어 미rescue 500 → 프런트는 “전송에 실패했습니다”만 표시 → **원인 불명으로 2차까지 전송 불가**. 체인에 61자 폴더가 있는 회의는 **오늘은 정상 전송된다**(폴더명이 페이로드에 안 들어감). 게다가 1차 시점 D'Flow는 `folder_path`를 무시하므로 **60자 제약이 아예 적용되지 않는데도** 선제 차단하는 셈이다.<br>(c) `ddobak-W7` 미리보기는 그 시점 실동작(팀 루트 평평)과 **다른 계층**을 보여준다 — ‘표시 개선’이 아니라 미래 동작 선표시. 사용자는 계층 보존을 믿고 확인을 건너뛴다. `ddobak-W6`의 경로명 헬퍼에 의존하므로 함께 옮기는 것이 깔끔하다.<br>→ **1차에 남는 것은 `ddobak-W1`·`ddobak-W9`·`ddobak-W10`·`ddobak-W11`** — 사용자에게 보이는 것도, D'Flow에 저장되는 것도 바꾸지 않는 4개 |
| **②** | **`ddobak-W8`(응답 `folder_path` 표시)을 ‘권장’ → 필수(✅) 승격 + 차수 배정** (D'Flow `W4` 의존 표기) | **D5로 사전 미리보기를 포기했으므로 이 에코가 유일한 사후 피드백 경로**다(§0.1 D5 · §3.3). 현재 `ddobak-W8`은 ‘권장’이고 **또박또박 차수표 어디에도 없다** → 사전 미리보기(D5로 포기) + 사후 확인(미배정) **둘 다 없는 상태가 가능**하다. 그러면 6단 경로 절단과 ‘한 칸 내림’이 사용자에게 **영영 안 보인다**. `ddobak-W7` 미리보기는 **절단 전** 경로를 보여주므로 오히려 오해를 굳힌다.<br>부수 지적: **60자 초과는 400 거절(D3)인데 깊이 초과는 무통보 절단**이다 — `신규TF/A/B/C/D1`과 `…/D2`가 한 칸 내림 후 6단이 되면 둘 다 `MES/신규TF/A/B/C`로 **병합되는데 에러가 없다.** D3가 막으려던 조용한 병합이 깊이 축에서 재현된다. 최소 조치가 이 에코 표시다 |
| **③** | **또박또박 작업지시 §7.7 ‘대상 2’ 판정에 `dflow_synced_at.present?` 조건 추가** | 또박또박 작업지시 §7.6-1은 “`exists_on_dflow: false` **인데 `dflow_synced_at`이 있으면**”(조건 2개)인데 같은 문서 §7.7 대상 2는 “`public_uid`는 있는데 `exists_on_dflow: false`”(조건 1개)로 **같은 상태를 다르게 판정**한다. `public_uid`는 있는데 D'Flow에 없는 상태는 **초기화 말고도 정상 경로로 도달한다** — (i) **전송 실패**(`public_uid`는 커밋 후 유지) (ii) **수동 연결**(`PUT /dflow/link`가 설계상 `dflow_synced_at: nil`로 저장)(실증: (i) `meeting.rb:418-425` 주석 “전송이 실패해도 여기서 커밋된 public_uid는 유지된다” (ii) `meeting_dflow_controller.rb:68-69` “새 uid로 수동 연결 시 이전 전송 상태는 무효” → `dflow_synced_at: nil`). 결과: **실제로는 ‘한 번도 안 올라간’ 대상 1인데 대상 2로 분류돼 기본 실행에서 조용히 빠진다** — 링크가 가장 필요한 회의가 dry-run 집계에서도 ‘초기화분’으로만 보고된다. `RELINK_RESET=1`을 주면 반대로 **D'Flow에 원본이 없는 회의가 후보를 claim하러 들어가** 오매칭 확률이 오른다.<br>⚠️ **§9.7과 함께 볼 것** — archived도 같은 자리로 오분류된다 |
| **④** | **또박또박 작업지시 §7.7 C2 제목 비교를 전송 시점(`ddobak-W2` 전/후)으로 분기** | C2는 “`dflow_auto_title`을 재생성해 완전 일치 비교”라고 **메서드 이름으로** 지목하는데, `ddobak-W2` 이후 그 이름의 기본 동작은 **접두 없는** 제목이다. 문언 그대로 구현하면 **`ddobak-W2` 이전 전송분(= 오늘의 C2 모집단 전부)과 0건 매칭**한다. 반대로 `ddobak-W2` **이후** 전송분이 나중에 초기화되면 그때의 정답은 접두 **없는** 변형이다. → **“`ddobak-W2` 이전 전송분은 접두 포함 변형으로 재생성”** 1줄 + **두 변형을 모두 시도**하도록 명시 요청.<br>(실패 방향은 fail-safe — 불일치 시 `likely`/`none`으로 강등돼 사람 승인으로 간다. 사고가 아니라 명세 정밀도 문제) |
| **⑤** | **또박또박 작업지시 §5의 ‘`ddobak-W3` 선배포 금지’ 근거 정정** | 또박또박 작업지시 §5는 “`resolve_team!` 완화(`ddobak-W3`)가 **지금까지 막히던 전송을 성공시킨다**”를 근거로 선배포를 금지하지만, **사실이 아니다.** 자유 루트 전송은 **오늘도 성공한다** — 전송 다이얼로그가 team 자동판정 실패 시 team 셀렉트를 노출하고, 사용자가 고르면 `team_override`를 실어 보내며, 서비스는 override가 있으면 meta 조회 없이 즉시 채택한다(실증: `SendToDflowDialog.tsx:117-118` `detectDflowTeam`이 null이면 team 셀렉트 노출(`:253`) → 선택 시 전송 버튼 활성(`:334`) → `teamOverride` 전송(`:127`) → `dflow_upload_service.rb:75-76` `return @team_override if @team_override` — meta 조회 없이 즉시 채택). 즉 “**팀 루트에 평평하게 안착 + `replace`가 `folder_id` 미갱신이라 위치 영구 고정**”이라는 노출은 **`ddobak-W3`와 무관하게 이미 라이브**다. 노출을 만드는 것은 `ddobak-W1`도 `ddobak-W3`도 아니라 **현재 다이얼로그**다.<br>**왜 중요한가**: 근거를 그대로 두면 팀장이 “2차를 미뤘으니 안전”이라 **오판**한다. 실제로는 D'Flow `W1`~`W5` 배포 전까지 자유 루트 회의가 계속 평평하게 쌓인다. → 근거를 정정하고 **실제 조치**를 명시 요청: 그 기간 자유 루트 전송을 UI에서 보류시키거나, **3차 재편철로 정리한다**고 적을 것.<br>⚠️ 후자를 택하면 §8.3 ⚠️의 (b)안(3차를 2차보다 앞세움)과 **같은 결정**이 되므로 §11.2 차수표를 함께 개정해야 한다 |
| **⑥** | **`ddobak-W9` 응답 타입을 nullable로 + 미분류 안내 문구 추가** | §3.3 미분류 폴백 시 `folder_path: null`을 제안했다(`[]`와 구분). 또박또박이 타입을 `string[]`로 고정하면 런타임에서 깨지고, `[]`로 받으면 **“팀 루트에 편철됨”이라는 정반대 안내**를 한다. → 타입 `string[] \| null` + `folder_id: null`일 때 **“미분류로 들어갔습니다(D'Flow에서 편철 필요)”** 별도 문구 요청.<br>⚠️ 이 항목은 §3.3의 **⚠️ 확정 필요**와 한 쌍이다 — D'Flow가 `null`로 확정해야 요청이 성립한다 |
| **⑦** | **`ddobak-W14`·`ddobak-W17`을 4차 → 1~2차로 이동** | 둘 다 **D'Flow 변경이 0**이다 — `ddobak-W14`가 쓰는 `exists_on_dflow`는 오늘 응답에 이미 있고(`meeting_dflow_controller.rb:38-45`), `ddobak-W17`도 §9.5가 ‘추가 변경 없음’으로 확인했다. 반면 `ddobak-W14`는 D'Flow `W10`이 만드는 위험의 **완화책**이므로 지금 배치는 완화책이 위험보다 뒤에 있다 — **`W10` 배포 시점부터 `ddobak-W14`가 나올 때까지 창이 열린다**: D'Flow에서 초기화 → 또박또박은 계속 ‘연결됨’ 표시 → 사용자가 재전송 → **중복 회의록 생성 + 원본 고아**(§9.3). **자가 치유되지 않는다.**<br>(①과 함께 반영되면 1차 = `ddobak-W1`·`ddobak-W9`·`ddobak-W10`·`ddobak-W11`·`ddobak-W14`·`ddobak-W17`) |

---

## 12. 미해결·별건 (착수 전 인지)

이 문서에 규정하지 않은 항목이다. 구현 중 마주치면 **임의 판단하지 말고** 팀장에게 올릴 것.

| 항목 | 내용 |
|---|---|
| **깊이 절단 정책** | 60자 초과는 400 거절(D3)인데 깊이 초과는 **무통보 절단**이다. `신규TF/A/B/C/D1`·`…/D2`가 한 칸 내림 후 6단이 되면 둘 다 `MES/신규TF/A/B/C`로 병합되는데 에러가 없다 — D3가 막으려는 조용한 병합이 깊이 축에서 재현된다. 이 문서는 절단(현행)을 규정하고 최소 완화(응답 에코 표시)만 §11.3 ②로 요청했다. **정본 확정 필요** |
| **폴더 삭제 가드** (§6) | §6.3 불변식이 **삭제로 재파괴**된다. 외부 전송이 만든 폴더는 `parent_id not null`·`created_by=전송자`라 `isTeamRootFolder` 보호 밖 → 일반 사용자가 삭제하면 cascade + `folder_id set null` → 미분류 재발. §6.5의 “폴더 구조 변경은 관리자만”이 무의미해진다 |
| **오매칭 후 본문 복구** | “초기화 = 되돌리기 수단”이 되돌리는 것은 **연결**이지 **본문**이 아니다. 오매칭 `replace`가 남의 본문을 덮으면 원본은 `minute_versions`에 남지만 D'Flow 버전 패널에 **되돌리기 액션이 없다** |
| **배치 폴더의 `created_by`** | 재편철(§8)로 생성되는 폴더의 소유자가 `ACTOR_EMAIL` 계정이 된다. 전용 서비스 계정으로 돌리면 그 트리 전부를 일반 사용자가 개명·삭제할 수 없다. **어느 계정으로 돌릴지 사전 합의 필요** |
| **구버전 `replace`의 team 불일치** | 키 부재 경로에서도 `team_code`는 metadata에 항상 실려 갱신된다 → 구버전 클라이언트가 team만 바꿔 재전송하면 `team_code=ERP` + `folder_id`는 MES 서브트리 = **§6.4가 D&D에서 금지한 상태를 외부 API가 정상 경로로 만든다.** W5 처리 규정 대기 |
| **zip 그룹핑 분할** | 접두 제거의 부수영향은 “그룹 이름 변경”이 아니라 **분할**이다. `meetingBodyOf`는 `_`·공백만 토큰 구분자로 쓰므로 하이픈 접두가 살아남아 `품질-주간회의`와 `주간회의`가 다른 group이 된다 → 같은 시리즈가 두 폴더로 쪼개진다(데이터 손실 없음). D6 이후 zip 그룹핑이 `meetingBodyOf`의 **유일한 잔존 소비자**다 |
| **초기화분이 후보로 잔존** | 또박또박 자동 링크 가드는 ‘그 회의를 다시 붙이지 않는다’(회의 축)일 뿐 초기화된 minute을 **후보 풀에서 빼지 않는다.** 같은 (날짜·team·정규화 제목) 회의가 2건이고 하나가 초기화됐다면 나머지가 exact+유일로 판정돼 **방금 사람이 끊은 회의록을 claim**한다 |

---

## 부록. 구현 실행 — `/loop` 프롬프트

wbs-web 저장소에서 Claude Code를 열고 이 문서를 `docs/design/`에 둔 뒤, 아래를 그대로 붙여 넣는다.
간격 없는 `/loop` = 자체 페이싱(한 항목이 끝나면 다음 턴).

```
/loop 이 저장소(wbs-web)에서 docs/design/dflow-folder-path-worklist-2026-07-27.md 를 끝까지 구현한다.

[상태 원장]
docs/design/folder-path-progress.md 가 없으면 먼저 만든다 — 지시서 §4 표(W1·W1-b·W2~W10)와
§6.6 표(W18~W23)의 모든 항목을 체크리스트로 옮기고, 각 행에 상태(TODO/DOING/DONE/BLOCKED)
· 담당 파일 · 검증 결과 · 커밋 해시 열을 둔다. 매 턴 이 파일을 먼저 읽고 마지막에 갱신한다.
이 원장이 유일한 진행 기억이다.

[매 턴 절차]
1. 원장에서 TODO 항목 1개만 고른다 (아래 순서 제약 준수)
2. 지시서의 해당 절을 정독한다 — 요건을 임의로 줄이거나 넓히지 말 것
3. 테스트 먼저 쓰고 구현한다 (W9는 별도 항목이 아니라 매 항목의 일부로 취급)
4. 검증: npx tsc --noEmit && npm run lint && npm test
   라우트를 건드렸거나 마지막 항목이면 npm run build 도
5. 통과하면 그 항목만 커밋한다 (커밋 O, 푸시 X)
6. 원장 갱신 → 다음 턴

[순서 제약]
W8(계약서 개정)이 착수 전 선행이다. 그 다음 W1(+W1-b) → W2 → W3 → W4 → W5.
W6(POST /minutes/folder)은 W2 완료 후. W10(연결 초기화)은 W6과 독립.
W18~W23은 §6.7 조사 쿼리 결과를 원장에 적은 뒤 W18부터.

[절대 금지 — §2 C1~C6, §5]
- team_code 컬럼·인덱스·필터 제거 금지 (C1)
- 외부 API가 루트 폴더 생성 금지 (C2)
- 폴더 생성에 ON CONFLICT 금지 — 부분 인덱스라 42P10 (C3). pre-select → insert → 23505 재조회
- 자동 생성 폴더의 created_by를 null로 두지 말 것 (C4)
- 폴더명 60자 사전 검증, 절단 금지 (C5)
- 깊이 5 존중 (C6)
- 스키마 마이그레이션 추가 금지 — folder_id는 이미 metadata allowlist에 있다
- 신규 엔드포인트는 POST /api/v1/minutes/folder 1개뿐. 그 외 추가 금지
- 운영 DB·실서버에 아무것도 실행하지 말 것. §6.7·§7의 조사 쿼리는 SQL만 원장에 적고 사람에게 넘긴다

[BLOCKED 규칙 — 임의 결정 금지]
지시서에서 ⚠️ 결정 필요로 표시된 항목(§3.3 미분류 폴백 응답 값 · §8.3 manual_placement 판정 기준
· §9.7 archived 구분)과 §12 미해결 항목은 구현하지 말고 BLOCKED로 표시한 뒤,
원장 하단 "확인 필요" 목록에 질문을 적고 다음 항목으로 넘어간다.
같은 원인으로 2회 연속 실패하면 그 항목도 BLOCKED로 내리고 진행한다.

[종료]
모든 항목이 DONE 또는 BLOCKED가 되면 원장 맨 위에 최종 요약
(완료 N / 차단 M / 확인 필요 질문 목록 / 또박또박에 통보할 것 — §11.2 차수 기준)을 쓰고 루프를 끝낸다.
```
