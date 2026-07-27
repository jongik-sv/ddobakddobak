# 또박또박 ↔ D'Flow 회의록 폴더 구조 호환 검토 (2026-07-27)

> 대상: `~/project/wbs-web`(D'Flow) 회의록 저장 구조 변화 + 또박또박 전송 연동 호환성
> 기준 계약: `tasks/dflow-minutes-upload/artifacts/dflow-minutes-upload-api-spec.md`
> (D'Flow 사본: `wbs-web/docs/design/dflow-minutes-upload-api-spec.md`)
> 성격: **검토서** — 구현 지시 아님. 확정 시 api-spec 개정이 선행.

---

## 1. D'Flow 현재 저장 구조 (실측)

### 1.1 스키마

| 대상 | 사실 | 근거 |
|---|---|---|
| `minutes.team_code` | `not null`. 0044에서 CHECK 제거 → `teams` 마스터 테이블 검증으로 전환 | `0021_minutes.sql:15`, `0044_team_master.sql:18` |
| `minutes.folder_id` | nullable, `minute_folders(id) on delete set null`. **미분류 = 실제 행이 아니라 `folder_id is null`** | `0040_minute_folders.sql` |
| `minute_folders` | 자기참조 트리(`parent_id`, `on delete cascade`), `name` 1~60자 CHECK, `sort`, `created_by` | `0040_minute_folders.sql` |
| 이름 유니크 | 같은 부모 내 중복 금지 — **부분 unique 인덱스 2개**(루트용 `where parent_id is null` / 하위용 `where parent_id is not null`) | `0040` |
| 깊이 제한 | `MINUTE_FOLDER_DEPTH_MAX = 5` (앱 레벨. DB 제약 아님) | `src/lib/domain/minutes.ts:203`, `actions/minutes.ts:604` |
| 루트 폴더 | 0043에서 **팀코드 5축 고정**: PMO(0)·ERP(1)·MES(2)·가공(3)·MDM(4). 전부 시드(`created_by is null`) | `0043_minute_folder_hierarchy.sql` |
| 루트 하위 | 0040 시드 10구분 중 8개 재배치 — 영업/구매/관리회계 → ERP, 품질/생산계획/조업및표준화/물류/설비및L2 → MES | `0043` 2단계 |

### 1.2 “업무구분 밑에 바로” → 폴더로 바뀐 경위

- **이전**: `/minutes` 트리 뷰 = `team_code` → **회의체**(별도 엔티티 아님, **제목에서 파생**) → 회의록. 계약 §1.2가 이 전제로 쓰였다.
- **지금**: 0040(실폴더 도입) → 0043(루트=팀코드 재편). 탐색기는 `buildFolderTree(folders, leaves)`로 **실폴더 트리**를 그린다 (`MinutesExplorer.tsx:73`).
- **제목 파생 회의체는 브라우징에서 퇴역**했다. `meetingBodyOf()` 남은 사용처는 **export zip 그룹핑 2곳뿐** (`src/lib/minutes/export.ts:60,122`). 트리 뷰는 더 이상 쓰지 않는다.

> ⚠️ 이 한 줄이 이번 검토의 핵심 트리거다. 계약 §0 D10의 제목 규칙 `<하위폴더명>-<원제목>`은 **“실폴더가 없으니 제목으로 폴더를 흉내낸다”**는 전제로 만들어진 우회책이었다. 그 전제가 사라졌다.

### 1.3 외부 API(또박또박 전송 경로)의 현재 동작

`POST /api/v1/minutes` — `src/app/api/v1/minutes/route.ts`

| 항목 | 현재 |
|---|---|
| 페이로드 폴더 필드 | **없음**. `date/team/title/body_markdown/external_id/meeting_id/on_conflict/user_email` 뿐 (`externalApi.ts:parseMinutePayload`) |
| 신규 등록 편철 | `resolveTeamRootFolderId(admin, p.teamCode)` → **팀 루트 폴더 1곳에만**. 조회 실패·부재는 `null`(미분류) 폴백 | `route.ts:164`, `lib/minutes/folders.ts` |
| 재전송(`replace`) 편철 | `metadata` = `minute_date, team_code, title, meeting_id, project_id, meeting_occurrence_date` — **`folder_id` 없음** → 폴더 위치 **불변** | `route.ts:86-95` |
| `GET /meta` | `teams`, `projects`, `limits`(, `meetings`)만. **폴더 목록 미노출** | `meta/route.ts:30-39` |

즉 **D'Flow가 폴더 트리를 갖게 됐지만, 외부 API는 여전히 “팀 루트에 평평하게 떨구는” 0040 이전 모델**이다.

---

## 2. 또박또박 현재 구조 (실측)

| 항목 | 사실 | 근거 |
|---|---|---|
| `Folder` | 자기참조 트리. `name` **최대 100자**. **깊이 제한 없음** | `backend/app/models/folder.rb` |
| API 직렬화 `folder_path` | `folder.ancestors + [self]` = **root-first** | `concerns/meeting_serializable.rb:73` |
| 모델 내부 `dflow_folder_chain` | `[folder] + folder.ancestor_records` = **leaf-first** | `meeting.rb:601-605` |
| team 판정 | `dflow_root_folder_name` = `chain.last` (= 루트). `meta["teams"]`에 있으면 채택, 없으면 `TeamRequiredError` | `meeting.rb:388`, `dflow_upload_service.rb:75-83` |
| 제목 조립 | `dflow_sub_folder_name` = `chain[-2]` (= 루트 직계 자식) → `"<sub>-<원제목>"`, 200자 캡 | `meeting.rb:393-409` |
| 프런트 미리보기 | `folderPath[0]`=root, `folderPath[1]`=sub (root-first 배열 기준) | `frontend/src/lib/dflowAutoAssign.ts:16-23` |

> **순서 규약 확인**: 백엔드 모델은 leaf-first(`.last`/`[-2]`), API·프런트는 root-first(`[0]`/`[1]`). **각자 자기 배열에 맞게 올바르게 쓰고 있다** — 현재 버그 아님. 다만 두 규약이 공존하므로, 앞으로 `folder_path`를 전송 페이로드에 넣을 때는 **어느 순서인지 계약에 못박아야** 한다(권고: **root-first**, API 직렬화와 동일).

---

## 3. 불일치(gap) 목록

| # | 갭 | 결과 | 심각도 |
|---|---|---|---|
| G1 | **계층 소실** — 또박또박 3단 이상 폴더가 D'Flow에선 팀 루트 1곳에 전부 쌓임. 2단째만 제목 접두로 흔적 | 폴더 도입 효과가 전송분에만 미적용. 팀 루트가 잡동사니 통 | **높음** |
| G2 | **이중 라벨** — 실폴더 `영업` 안의 회의록 제목이 `영업-주간회의`. §1.2 전제 소멸로 접두가 의미 없어짐 | 목록 가독성 저하, 사용자 혼란 | 중 |
| G3 | **재전송해도 폴더 미동기** — 또박또박에서 회의를 다른 폴더로 옮기고 재전송해도 D'Flow 위치 불변 (`replace` metadata에 `folder_id` 없음) | 조직 재편이 영구 미반영 | **높음** |
| G4 | **이름 길이 불일치** — 또박또박 100자 vs D'Flow 60자 CHECK | 61~100자 폴더명은 표현 불가 → 절단 or 거절 결정 필요 | 중 |
| G5 | **깊이 불일치** — 또박또박 무제한 vs D'Flow 5단 | 6단 이상 경로 처리 규칙 필요 | 낮음 |
| G6 | **루트 자유도 불일치** — D'Flow 루트는 시드 5팀 고정, 또박또박 루트는 자유. 루트명이 팀코드와 다르면 `TeamRequiredError`로 **전송 자체 실패** | 신규 조직/실험 폴더는 수동 team 선택 강제 | 중 |
| G7 | **미리보기 불가** — `meta`에 폴더 목록 없어 전송 다이얼로그가 “어디로 들어갈지” 못 보여줌 | UX. 다만 하위 자동생성이면 항상 성공이라 치명 아님 | 낮음 |
| G8 | **D'Flow 자체 UI가 2단 모델** — `MinuteMetaModal`·`MinuteUploadModal`은 (팀, 하위 구분) 2단만 다룬다. 3단 이상 편철분을 열면 sub가 루트 직계 자식으로 보이고, 팀/하위를 **실제로 바꿔 저장하면** `subgroupFolderId()`가 루트 직계 자식 id를 반환 → **2단으로 강등, 3단 이하 경로 소실** (`MinuteMetaModal.tsx:85-89`) | 3단 이상 도입 시 D'Flow 안에서 조용히 뭉개짐. 무변경 저장은 `changed` 가드가 막아 안전 | **높음** (3단 이상 도입 시) |

---

## 4. 권고안 — `folder_path` 추가(additive)

### 4.0 전제: “또박또박 폴더 구조는 자유” (사용자 결정 2026-07-27)

자유도를 **층으로 나눠야** 한다. 두 층의 제약이 전혀 다르다.

**하위(2단 이하) — 이미 완전 자유.** `minute_folders`는 자기참조 트리로 5단까지 생성/개명/이동/삭제가 자유롭다. 외부 API가 `folder_path`를 받아 없는 폴더를 자동 생성하기만 하면 끝. 추가 제약 없음.

**루트(1단) — 자유롭게 할 수 없다.** 이유 3가지:

1. `minutes.team_code`는 `not null`이고, D'Flow 대시보드·칸반·진척·위키가 **전부 team 축을 쓴다**. 0043이 루트를 팀코드 5축에 맞춘 건 우연이 아니라 의도된 정렬이다.
2. 0044 이후 팀은 `teams` 마스터 **등록형**이다. 외부 API가 루트 폴더를 만들 수 있다 = 팀을 만들 수 있다 = **D'Flow 전 화면에 새 축이 튀어나온다**.
3. `resolveTeamRootFolderId`의 `created_by is null`(시드) 필터가 동명 사용자 루트의 스쿼팅을 막는 것도 같은 이유다.

**→ 해법: 또박또박 루트를 D'Flow에서 한 칸 내린다.**

```
또박또박:  MES / 품질 / 주간정례 / 2026-07
D'Flow:    MES / 품질 / 주간정례 / 2026-07          ← 루트가 팀코드 → 그대로 매핑

또박또박:  신규TF / 킥오프 / 1차
D'Flow:    <선택 team> / 신규TF / 킥오프 / 1차       ← 루트가 팀코드 아님 → 한 칸 내려 편철
```

**규칙 한 줄**: `folder_path[0] ∈ meta.teams` 이면 그대로 매핑, 아니면 `[team] + folder_path` **전체를 팀 루트 하위로** 편철한다.

이 규칙으로 **또박또박 폴더 구조는 완전히 자유**로워진다(루트명·깊이·개수 제약 없음). D'Flow 쪽에 남는 제약은 물리적 2가지뿐:

- **깊이 5단** (팀 루트 포함 → 또박또박 경로는 실질 4단까지 온전. 초과분 처리는 §4.2-5)
- **폴더명 60자** (또박또박은 100자 — §4.4 D3)

> 부수 효과: 이 규칙이 G6(전송 자체 실패)도 해소한다. 루트가 팀코드가 아니어도 team만 고르면 구조를 그대로 들고 들어간다. 기존 `TeamRequiredError`는 “team 미지정” 에러로 의미가 축소된다.

### 4.1 계약 변경 (POST /api/v1/minutes)

```jsonc
{
  "user_email": "...",
  "date": "2026-07-27",
  "team": "MES",                                  // 유지 (필수)
  "folder_path": ["MES", "품질", "주간정례"],       // 신규·선택. root-first
  "title": "주간회의",                             // 접두 없는 원제목
  "body_markdown": "...",
  "external_id": "ddobak:<uuid>",
  "on_conflict": "replace"
}
```

**호환성**: 필드 optional → 미전송 시 현행(`resolveTeamRootFolderId`)과 100% 동일. 배포된 또박또박은 무수정 동작.

### 4.2 D'Flow 측 해석 규칙 (지켜야 할 제약)

1. **`team`은 폐기하지 않는다.** `minutes.team_code`는 `not null`, `minutes_team_date_idx` 인덱스, `minute_versions.team_code` `not null`(`0045:105`), 위키 파이프라인의 `teams where t.active` 검증(`0045:1218`), `GET ?team=` 필터가 전부 여기 물려 있다. `folder_path`는 **team의 대체가 아니라 추가**.
2. **루트 자동 생성 금지 — 대신 한 칸 내린다(§4.0).** 0043이 루트를 팀코드 5축 시드(`created_by is null`)로 고정했고 `folders.ts:14`가 정확히 그 조건으로 스쿼팅을 막는다. 외부 API가 루트를 만들 수 있으면 이 불변식과 `sort 0~4` 정렬이 깨진다. 정규화 규칙:
   - `path[0] ∈ activeTeamCodesSync()` **그리고** `path[0] === team` → 편철 경로 = `path` 그대로
   - 그 외(팀코드 아님) → 편철 경로 = `[team, ...path]` (또박또박 루트가 D'Flow 2단이 됨)
   - `path[0]`이 팀코드인데 `team`과 **다르면** → **400 거절**. 조용히 한쪽을 따르면 목록 필터(`?team=`)와 폴더 위치가 어긋난다
   - 정규화 후 `path[0]`에 해당하는 시드 루트가 없으면 → `null`(미분류) 폴백 + 로그. 편철 실패가 등록 자체를 막으면 안 된다(현행 `resolveTeamRootFolderId` 관례 유지)
3. **루트를 제외한 전 구간 자동 생성.** 생성 시 `ON CONFLICT` **사용 금지** — `minute_folders_child_name_uniq`가 부분 인덱스라 `42P10`으로 실패한다(minutes upsert가 이미 겪은 함정, `route.ts:260` 주석). **사전 select → insert → 23505면 재조회** 패턴을 그대로 복사 (`route.ts:186-189`). 경로가 깊으면 이 왕복이 단계마다 발생하므로 **한 번에 조회하고 부족분만 순차 생성**할 것.
4. **깊이 5 초과분은 절단**하고 5단째에 편철. 응답에 실제 편철 경로를 에코해 또박또박이 표시. (`MINUTE_FOLDER_DEPTH_MAX = 5`는 앱 상수이지 DB 제약이 아니므로, 외부 API가 이를 무시하면 UI가 만들 수 없는 깊이의 폴더가 생겨 탐색기 “하위 폴더 만들기”가 비활성인 채 트리만 깊어진다.)
5. **이름 60자 초과** → §4.4 D3 결정. `minute_folders.name` CHECK 위반은 23514로 폴더 생성 전체가 실패하므로 **반드시 사전 검증**할 것.
6. 자동 생성 폴더의 `created_by`는 **null이 아니라 전송 사용자(`resolveUserByEmail` 결과)**로. null은 시드 표식이라 오염시키면 `resolveTeamRootFolderId`의 스쿼팅 방어와 0043 재실행이 오작동한다. 전송 사용자로 두면 그 사용자가 D'Flow UI에서 개명·삭제도 할 수 있다(0040 RLS `created_by = auth.uid() or pmo_admin`).

### 4.3 응답 확장

```jsonc
{ "ok": true, "id": "...", "action": "created",
  "folder_id": "...", "folder_path": ["MES","품질","주간정례"],  // 실제 편철 결과(절단 반영)
  ... }
```

### 4.4 결정 항목 — **D1~D6 전부 확정(사용자 결정 2026-07-27)**

> 아래 「권고」 열이 곧 확정안이다. D4·D6은 작성 시점에 이미 확정이었고, D1·D2·D3·D5는 2026-07-27 사용자 결정으로 확정됐다.

| 결정 | 선택지 | **확정** |
|---|---|---|
| **D1. `replace` 시 폴더 동기화** | (A) sticky — 현행. D'Flow에서 수동 이동한 걸 존중, 또박또박 재편 미반영 / (B) sync — 또박또박이 SSOT, 재전송마다 위치 갱신 | **(B) + 3값 규약**: 키 **부재**=기존 위치 유지 · **`[]`**=팀 루트로 되돌림 · **비어있지 않은 배열**=그 경로로 이동. `meeting_id`의 `meetingIdProvided`와 동형이되 `[]`가 유의미한 값인 점이 다르다 — `[]`를 “미전송과 동일”로 뭉개면 **폴더에서 빼는 조작만 영영 전파되지 않는다**. ✅ **DB 변경 불필요(2026-07-27 실측 정정)** — `update_minute_metadata_with_wiki_retraction`의 allowlist에 `folder_id`가 **이미 있고**(`0045:1167`) 적용 로직도 있다(`0045:1206-1208, 1321`). TS에서 metadata에 키만 넣으면 된다. 보너스: `v_index_content_changed`(`0045:1250-1256`)에 `folder_id`가 없어 **폴더 변경만으로는 위키 재빌드가 걸리지 않는다** |
| **D2. 제목 접두 제거** | (A) `folder_path` 전송 시 접두 생략 / (B) 유지 | **(A)**. §1.2 전제가 소멸했다. 단 **기존 전송분 제목은 그대로 둔다** — 소급 재작성은 `minute_versions` 히스토리를 오염시키고 위키 재빌드를 유발 |
| **D3. 60자 초과 폴더명** | (A) 400 거절 / (B) 60자 절단 | **(A) 거절**. 절단은 `현장품질개선…`류 긴 이름끼리 같은 60자로 뭉개져 **다른 폴더가 한 폴더로 합쳐지는** 조용한 사고를 만든다. 거절하면 사용자가 또박또박에서 이름을 줄이면 된다 |
| **D4. 루트가 팀코드가 아닐 때(G6)** | (A) 현행대로 전송 실패(`TeamRequiredError`) / (B) **한 칸 내려 편철** — `[team, ...path]` / (C) 매핑 테이블 | **(B) — 확정(사용자 결정 2026-07-27, §4.0).** 또박또박 폴더 구조를 자유롭게 두면서 D'Flow team 축을 지키는 유일한 방법. (C) 매핑 테이블은 관리 비용 대비 이득이 없다(팀 5개 고정) |
| **D5. `meta`에 폴더 목록 노출** | (A) 노출 안 함 / (B) `GET /api/v1/minutes/folders` 신설 | **(A)**. 하위는 blind 자동 생성이라 항상 성공 → 미리보기 없어도 실패하지 않는다. 루트 검증엔 기존 `teams`로 충분. 엔드포인트 1개 안 늘리는 게 낫다 |
| **D6. D'Flow 자체 UI의 2단 모델(G8)** | (A) 방치 / (B) 트리 피커 교체 / (C) **폴더 중심 전면 재편** | **(C) — 확정(사용자 결정 2026-07-27)**: 업로드·수정 모달에서 **담당·하위 구분을 삭제**하고 선택 폴더 기준으로 생성, 회의록·폴더 **드래그앤드롭 이동**(폴더는 `pmo_admin` 전용). ⚠️ **“담당 삭제”는 `team_code` 삭제가 아니다** — 컬럼은 유지하고 **폴더에서 파생**한다. 그러려면 “모든 폴더는 시드 팀 루트의 서브트리” 불변식이 필요한데 지금은 **사용자 루트 폴더 생성이 열려 있어**(`createMinuteFolder`가 `parentId null` 허용) 선행 마이그레이션이 필수. 상세 = D'Flow 문서 §6 |

### 4.5 기존 전송분 마이그레이션 — 재전송하면 안 된다

이미 D'Flow에 올라간 회의록(전부 팀 루트에 평평하게 쌓여 있음)을 실제 폴더 경로로 되돌려야 한다. **가장 쉬운 방법인 “전건 `on_conflict=replace` 재전송”은 금지.**

`commit_minute_body_version`은 **본문이 동일해도 무조건 새 버전을 append**한다 (`0045:1742` — `v_body_changed`는 위키 철회와 스냅샷 보존만 게이트하고 append 자체는 무조건):

| 재전송 방식 | 전용 폴더 엔드포인트 |
|---|---|
| 회의록 N건 → 버전 N개 신규(본문 전문 복사) | 버전 append 없음 |
| `runMinutePostProcessing(rematch:true)` + ingest + insights 전건 재실행 → **LLM 호출 폭주** | 후처리 없음 |
| `updated_at` 전건 갱신 → “전 회의록 방금 수정됨” | `updated_at` 불변 |

**폴더 변경 자체는 지극히 싸다** — `v_index_content_changed`(`0045:1250-1256`)에 `folder_id`가 없어 **위키 재빌드도 걸리지 않는다**. 기존 `moveMinuteToFolder`(`actions/minutes.ts:673-700`)가 이미 `update minutes set folder_id`만 하는 단순 경로다.

→ **`POST /api/v1/minutes/folder` 신설**(D'Flow 문서 §8, 또박또박 문서 §7). dry-run 기본, 200건 배치, 사람이 옮긴 건(`manual_placement`) 기본 skip.

부가 결정 2개:

- **`items[].team`은 선택 필드** — 또박또박은 전송 당시 사용자가 고른 team을 기록하지 않는다(`meetings`에 `dflow_synced_at`·`dflow_url`만). 생략 시 D'Flow의 기존 `team_code` 사용. 값이 주어졌는데 다르면 `team_mismatch`로 거절(팀 이동은 위키 재빌드 유발 — `0045:1252`)
- **제목 접두 정리는 미포함** — `title` 변경은 `v_index_content_changed`에 **포함**되어 위키 재빌드를 유발한다. 폴더 이동의 “공짜” 성질이 사라지므로 별건 처리

### 4.6 프로젝트별 작업 문서

구현 지시는 프로젝트별로 분리했다. 이 검토서는 **갭 분석·결정의 SSOT**이고, 아래 두 문서가 실행 목록이다.

- **D'Flow(wbs-web)**: `dflow-folder-path-worklist-2026-07-27.md` — 팀장/D'Flow 개발자 전달용. `folder_path`(§3) · 일괄 마이그레이션(§8) · **연동 식별자 표시/연결 초기화(§9)** 포함
- **또박또박**: `ddobak-folder-path-worklist-2026-07-27.md` — 자체 구현용. 전송(§3) · 일괄 재편철(§7.1~7.5) · **연결 해제 감지(§7.6)** 포함

추가 범위(2026-07-27 사용자 요청): **기존 회의 마이그레이션**이 3갈래로 확정됐다 — ①폴더 재편철(이미 전송된 것) ②연결 초기화(잘못된 연결 풀기) ③**미연결 회의 자동 링크**(D'Flow 수동 업로드분 ↔ 또박또박 회의를 `(날짜, team, 정규화 제목)` exact·유일 매칭으로 자동 claim). ③은 **D'Flow 변경 0** — 기존 `GET /minutes?linked=false` + `POST /minutes/link`로 충분하다. 확정된 안전장치 3가지:

- **②(초기화)가 ③의 유일한 되돌리기 수단**이다. 오매칭 시 이후 `replace`가 남의 본문을 덮어쓰는데, `external_id`를 뗄 방법이 초기화뿐. 배포 순서상 ②가 앞선다
- **초기화한 것을 ③이 되붙이지 않는다.** 초기화 결과 상태(`external_id is null`)는 ③의 매칭 대상 상태와 동일하므로, 초기화분은 **기본 제외**하고 `RELINK_RESET=1` 명시 시에만 재연결
- **제목 비교는 접두 제거 휴리스틱을 쓰지 않는다.** `meta`가 폴더 목록을 노출하지 않아(D5) 접두를 식별할 방법이 없고, 첫 하이픈 절단은 `설비-L2 점검`을 망가뜨린다. 수동 업로드분은 애초에 접두가 없고(`meetingBodyOf` 정규형 비교), 초기화분은 `dflow_auto_title`로 완전 재생성해 정확 비교

배치 실행 공통 전제: **`ACTOR_EMAIL`** — `/minutes/folder`·`/minutes/link` 둘 다 `user_email` 403 게이트가 있는데 rake엔 `current_user`가 없다. 필수 인자 + 배치 시작 전 프로브 검증(수백 건 전건 403 방지).

추가 발견: D'Flow UI에는 `external_id` 노출이 **전혀 없어**(components/minutes 참조 0건) 잘못된 연결을 D'Flow에서 풀 방법이 없다. 초기화 기능을 넣되 **한쪽만 끊긴다**는 점이 핵심 — 또박또박은 계속 “연결됨”으로 보이고 재전송하면 중복이 생긴다. 복구는 기존 `POST /minutes/link` claim 경로로 깨끗하게 된다(본문·`updated_at`·후처리 무영향).

---

## 5. 대안 — 아무것도 바꾸지 않는 운영안

계약 무변경. 또박또박 폴더를 **루트=팀코드 5축, 2단째=D'Flow 하위 구분명**에 맞춰 쓰도록 운영 규칙으로 강제하고, 3단 이상은 쓰지 않는다.

- 비용 0, 즉시 적용
- 대신 G1·G3 영구 방치. 폴더를 3단 이상 쓰는 순간 구조가 소리 없이 뭉개짐
- ~~권고하지 않음~~ → **기각(사용자 결정 2026-07-27)**: “폴더 구조는 자유롭게” 방침과 정면 충돌한다

---

## 6. 진행 순서

1. ~~§4.4의 D1~D6 결정~~ → **D1~D6 전부 확정(2026-07-27)**. 권고안이 곧 확정안이다
2. **api-spec 개정** — `dflow-minutes-upload-api-spec.md`에 `folder_path` 절 추가. 사본 2개(`wbs-web/docs/design/`, `ddobakddobak/tasks/.../artifacts/`) 동기화. 팀장 전달
3. **D'Flow 구현** — `dflow-folder-path-worklist-2026-07-27.md` 순서대로
4. **또박또박 구현** — `ddobak-folder-path-worklist-2026-07-27.md` §5의 **1차/2차 배치 순서**를 따를 것. 1차(W1·W4·W6·W7·W9~W11)는 D'Flow 배포 전 선행 가능하지만, **W2·W3은 D'Flow 배포 후**여야 한다 — W3 선배포분은 재전송으로 정리되지 않고 위치가 영구 고정된다
5. **E2E** — 계약 §14 스모크에 “4단 폴더 전송 → D'Flow 동일 경로 편철”, “또박또박 루트가 팀코드 아닐 때 한 칸 내려 편철”, “또박또박에서 폴더 이동 후 재전송 → D'Flow 위치 갱신” 3건 추가

---

## 7. 확인 필요 (미검증)

- **0043 운영 반영 여부.** `scripts/apply-0043.mjs` 주석이 “**코드 배포 전에** 적용”을 요구한다. 로컬 파일 존재만 확인했고 운영 DB 적용 여부는 미확인. 미적용이면 팀 루트가 없어 현재 전송분이 전부 **미분류(`folder_id null`)** 로 쌓이고 있을 수 있다 → 이 검토안보다 먼저 확인할 것
- 또박또박 실제 폴더 사용 깊이 분포(3단 이상이 얼마나 되는지) — G1의 실제 임팩트 크기
