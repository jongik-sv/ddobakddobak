# 또박또박 작업 지시 — D'Flow 전송에 `folder_path` 추가 (2026-07-27)

> 배경 분석: `folder-compat-review-2026-07-27.md`
> 대응 문서: D'Flow 측 `dflow-folder-path-worklist-2026-07-27.md`
> 기존 구현 스펙: `ddobak-dflow-sender-spec.md` (§1.3 team 판정 · §1.4 제목 조립이 이번에 바뀐다)
>
> **W 번호 표기 규약** ⚠️ — 이 문서의 `W1`~`W19`은 **또박또박 작업**이다. D'Flow(wbs-web) 작업은 반드시 **`dflow-W`** 접두로 쓴다(`dflow-W6` 등). 두 프로젝트가 각자 `W1~`으로 번호를 매기므로 접두 없는 번호는 오독의 원인이다. **양쪽이 한 표에 섞이는 §5에서는 또박또박 것에도 `ddobak-` 접두를 붙인다** — 거기서 접두 없는 `W`를 보면 그 자체가 오류다. (대응 문서인 D'Flow 작업지시는 반대 규약을 쓴다: 접두 없는 `W` = D'Flow, 또박또박은 `ddobak-W`)

---

## 0. 한 줄 요약

회의 폴더 체인을 `folder_path` 배열로 함께 보내고, **제목 접두 `<하위폴더명>-`를 뗀다**. D'Flow가 그 경로대로 폴더를 만들어 편철한다. 또박또박 폴더 구조는 **자유**(루트명·깊이 제약 없음) — 루트가 팀코드가 아니면 D'Flow가 선택한 team 아래로 한 칸 내려 넣는다.

---

## 1. 지금 무엇이 잘못되고 있나

| 현상 | 원인 | 위치 |
|---|---|---|
| 3단 이상 폴더 구조가 D'Flow에서 전부 소실 | 페이로드에 폴더 정보가 `team`(=루트 폴더명) 하나뿐. 2단째는 제목 접두로만 흔적 | `dflow_upload_service.rb:44-52` |
| D'Flow 제목이 `영업-주간회의` (이중 라벨) | `dflow_auto_title`의 접두 규칙은 “D'Flow에 실폴더가 없다”는 전제로 만든 우회책. D'Flow가 0040/0043으로 **실폴더를 도입**해 전제가 소멸 | `meeting.rb#dflow_auto_title`(`:405-415`) |
| 회의를 다른 폴더로 옮기고 재전송해도 D'Flow 위치 불변 | D'Flow `replace` 경로가 `folder_id`를 갱신하지 않음 (`dflow-W5`에서 수정) | D'Flow `route.ts:86-95` |
| 루트 폴더명이 팀코드가 아니면 **team 자동판정이 안 되고**, 그렇게 보낸 건은 **팀 루트에 평평하게 안착** (전송 자체는 오늘도 성공한다) | 자동판정 실패 시 다이얼로그가 team 셀렉트를 노출하고, 사용자가 고른 값이 `team_override`로 실려 `resolve_team!`을 **건너뛴다**(즉시 반환). 폴더 정보는 페이로드에 없으니 팀 루트행 | `SendToDflowDialog.tsx#needsTeamSelect`(`:125-126`)·`#handleSend`(`teamOverride`, `:147`) · `dflow_upload_service.rb:75-76` |

---

## 2. 폴더 순서 규약 ⚠️

레포 안에 **두 가지 순서가 공존**한다. 지금은 각자 자기 배열에 맞게 올바르게 쓰고 있지만, `folder_path`를 전송할 때 헷갈리면 **모든 회의록이 조용히 엉뚱한 폴더로 들어간다.**

| 소스 | 순서 | 확인 |
|---|---|---|
| `Meeting#dflow_folder_chain` | **leaf-first** (`[folder] + folder.ancestor_records`) | `meeting.rb#dflow_folder_chain`(`:609-612`). 그래서 루트는 `.last`, 2단째는 `[-2]` |
| API 직렬화 `folder_path` | **root-first** (`folder.ancestors + [self]`) | `meeting_serializable.rb:73` |
| 프런트 `dflowAutoAssign.ts` | **root-first** (`[0]`=루트, `[1]`=2단째) | `dflowAutoAssign.ts:16-23` |

**전송 계약은 root-first로 확정한다** (API 직렬화·프런트와 동일). 서비스에서 모델 체인을 쓸 때는 반드시 `.reverse`.

---

## 3. 계약 변경 (D'Flow와 합의된 형태)

### 3.1 요청

```jsonc
POST <dflow>/api/v1/minutes
{
  "user_email": "...",
  "date": "2026-07-27",
  "team": "MES",                                   // 기존 유지 (필수)
  "folder_path": ["MES", "품질", "주간정례"],        // ★ 신규. root-first
  "title": "주간회의",                              // ★ 접두 제거된 원제목
  "body_markdown": "...",
  "external_id": "ddobak:<public_uid>",
  "on_conflict": "replace"
}
```

### 3.2 D'Flow의 편철 규칙 (또박또박이 알아야 할 부분)

```
① folder_path[0] 이 team 과 같으면      → 그대로 편철
② folder_path[0] 이 팀코드가 아니면     → [team, ...folder_path] 로 한 칸 내려 편철
③ folder_path[0] 이 다른 팀코드면       → 400 거절
```

→ **또박또박 폴더 구조는 완전히 자유.** 루트를 `신규TF`로 두든 5단을 파든 상관없다. 남는 제약은 D'Flow의 물리 한계 2개뿐:

| 제약 | D'Flow | 또박또박 | 대응 |
|---|---|---|---|
| 폴더명 길이 | 60자 | 100자 | 61자 이상이면 D'Flow가 **400 거절**. 전송 전 미리 검사해 안내 (§4 W4) |
| 깊이 | 5단 (팀 루트 포함) | 무제한 | 초과분은 D'Flow가 절단. 응답 `folder_path` 에코로 실제 결과 표시 |

### 3.3 응답

```jsonc
{ "ok": true, "id": "...", "action": "created",
  "folder_id": "...", "folder_path": ["MES","품질","주간정례"],  // 절단·한 칸 내림 반영된 실제 결과
  "folder_path_status": "exact",  // ★ 신규 확정 — 아래 3.3-b
  "url": "https://…/minutes/…", ... }
```

#### 3.3-b `folder_path_status` — 편철 품질 신호 ⚠️ 확정 (정본 §2-C)

깊이 5 초과 절단은 **유지 확정**한다(400 전환 안 함). 대신 등록 응답과 배치 `results[]`(§7.2) 양쪽에 **`folder_path_status: "exact" | "truncated" | "partial" | "unclassified"`** 를 싣는다 — "보낸 경로와 받은 경로를 비교하면 되지 않나"는 성립하지 않는다. 정상 편철(한 칸 내림)에서도 길이가 바뀌므로, 또박또박이 절단을 스스로 판정하려면 D'Flow의 정규화 규칙을 클라이언트에 재구현해야 하는데 이는 계약이 서버 쪽에만 두기로 한 것이다.

| 값 | 의미 |
|---|---|
| `exact` | 보낸 경로 그대로 편철 |
| `truncated` | 깊이 5 초과로 절단됨 |
| `partial` | 중간 폴더 생성 실패로 조상에 떨어짐 — **200 성공인데 목표보다 얕다**(지금은 완전히 침묵) |
| `unclassified` | 미분류(`folder_id: null`) |

**실측(`prod-survey-2026-07-27.md` §1)**: 실효 깊이 5단 이상 **0건**, 최대 **2**. 절단은 현재 데이터에서 한 건도 발생하지 않지만, 또박또박 폴더 깊이엔 상한이 없어 사용자가 언제든 더 깊게 만들 수 있으므로 신호 자체는 계속 필요하다 — **저비용으로 유지**.

#### 미분류 폴백 — `folder_id: null` ⚠️

정규화 후 `folder_path[0]`에 해당하는 **시드 팀 루트가 D'Flow에 없으면** D'Flow는 등록은 시키고 폴더는 안 잡는다(D'Flow §3.2-5 — 편철 실패가 등록 자체를 막지 않는다). 원인은 거의 항상 **0043 미적용**이다. 배치 경로에서 같은 원인이 `failed(no_team_root)`로 나타난다(§7.2-5).

```jsonc
{ “ok”: true, “id”: “...”, “action”: “created”,
  “folder_id”: null, “folder_path”: null, “folder_path_status”: “unclassified”,   // ✅ 확정 — 정본 §2-D(B-1 승인)
  “url”: “https://…/minutes/…”, ... }
```

> ⚠️ **`null`을 `[]`로 뭉개면 안내가 정반대가 된다.**
>
> `[]` = “팀 루트에 **편철 성공**”, 미분류 = “**어느 폴더에도 안 들어감**”. 아래 §3.4의 3값 규약은 **요청** 계약이고 값 집합은 **키 부재 / `[]` / 배열** 3종뿐 — `null`은 없다. `null`은 **응답에만** 추가되는 값이다(요청 쪽 union을 넓히지 말 것. 넓히면 §3.4가 없애려던 모호함이 되돌아온다). 요청 규약을 응답 렌더에 그대로 끌어와 `null`을 `[]`로 취급하면 미분류를 **”팀 루트에 편철됨”으로 정반대 안내**한다.
>
> **판정은 `folder_path`가 아니라 `folder_id`로 한다.** `folder_path`의 미분류 표현값은 **`null`로 확정됐다**(정본 §2-D — 더 이상 D'Flow 확정 대기가 아니다). 미분류 시 `folder_id`가 `null`이라는 것은 §3.2-5의 귀결로 이미 서술돼 있으므로, `folder_id: null`을 트리거로 쓰면 그대로 옳다.
>
> **다이얼로그가 “팀 루트”라고 말하면 안 된다** — `folder_id: null`이면 “미분류로 들어갔습니다(D'Flow에서 편철 필요)”(W8·W9). `folder_path`도 이제 `null`로 확정됐으므로 값이 뒤늦게 `[]`로 바뀌는 일은 없다 — W8·W9는 이 값대로 구현하면 된다.
>
> **배치(§7.2·`ddobak-W9`) 응답의 `from`도 같은 이유로 nullable이다 — `string[] | null`(`null` = 이동 전 미분류).** 계약 예시가 전부 배열이라 `Array`로 타입 고정하면 깨진다(정본 §2-D). 상세는 §7.2.

### 3.4 `folder_path` 3값 규약 ⚠️

“폴더 없음”을 **표현할 수 있어야** 한다. 또박또박에서 회의를 폴더 밖으로 빼고 재전송했을 때 D'Flow가 팀 루트로 되돌려야 하기 때문이다. 그래서 **키 부재 / `[]` / 비어있지 않은 배열**을 전부 다르게 취급한다.

| 값 | 의미 | D'Flow 동작 (신규) | D'Flow 동작 (`replace`) |
|---|---|---|---|
| **키 부재** | 폴더 정보 미제공 (구버전 또박또박) | 기존 `resolveTeamRootFolderId` 폴백 = 팀 루트 | **기존 위치 유지** (건드리지 않음) |
| **`[]`** | 명시적 “폴더 없음” | 팀 루트 | **팀 루트로 되돌림** |
| **`["A","B"]`** | 그 경로 | 경로대로 편철 | 경로대로 **이동** |

→ 또박또박 신버전은 **항상 이 키를 보낸다**(폴더 없으면 `[]`). 키 부재는 구버전 호환 전용 값이다.

> `[]`를 “미전송과 동일”로 뭉개면 D1=B(폴더 동기화)를 켜도 **폴더에서 빼는 조작만 영영 전파되지 않는다.**

---

## 4. 구현 작업 목록

> ⚠️ **코드 인용은 심볼 기준.** 행 번호는 보조로만 적는다 — 이 문서 안 행 번호 인용은 별도 표기 없는 한 전부 **커밋 `0852ac4b` 기준**이다. 행은 썩는다(2026-07-27 하루에만 `status` 액션이 두 번 밀렸다 — W14 구현 후 한 번, `fix-guards`에서 또 한 번). `file#symbol`(`:행`) 형태를 쓰고, 심볼이 없는 JSX 블록 등은 가장 가까운 식별자(상태 변수명·문구 상수명)로 가리킨다.

| # | 파일 | 작업 | 필수 |
|---|---|---|---|
| **W1** | `backend/app/services/dflow_upload_service.rb:44-56` | 페이로드에 `folder_path: @meeting.dflow_folder_chain.reverse.map(&:name)` 추가. **폴더 없는 회의는 `[]`를 보낸다**(키 생략 아님) — §3.4의 3값 규약 참조<br>**구현 완료(커밋 `3c95e934`)** — `dflow_folder_chain`이 **private**(`meeting.rb#dflow_folder_chain`, `private` 선언 `:592`·정의 `:609-612`)라 위 리터럴 그대로 쓰면 `NoMethodError` → **`Meeting#dflow_folder_path_names`** 공개 접근자 신설(`meeting.rb#dflow_folder_path_names`, `:400-402`, `chain.reverse.map(&:name)`). 기존 `dflow_root_folder_name`(`.last`)·`dflow_sub_folder_name`(`[-2]`) 패턴과 동일 — leaf-first 풋건을 모델에 가둔다. 호출부(`dflow_upload_service.rb:53`): `folder_path: @meeting.dflow_folder_path_names` | ✅ |
| **W2** | `backend/app/models/meeting.rb#dflow_auto_title`(`:405-415`) | `dflow_auto_title` — `folder_path` 동반 전송 시 **접두 없이 원제목**. 기존 메서드를 지우지 말고 접두 없는 경로를 기본으로 전환(200자 캡은 유지) | ✅ |
| **W3** | `backend/app/services/dflow_upload_service.rb:75-83` | `resolve_team!` 완화 — 루트명이 `meta["teams"]`에 있으면 그대로, **없으면 `TeamRequiredError` 대신 다이얼로그 선택값(`team_override`)을 요구**. override가 있으면 자유 루트도 전송 성공(§3.2 ②).<br>⚠️ **override 경로는 이미 라이브다**(§5 「`ddobak-W3` 선배포 금지의 근거 정정」) — W3은 그 경로를 정식화하고 자동판정을 완화하는 작업이지 **새 능력을 여는 것이 아니다** | ✅ |
| **W4** | `backend/app/services/dflow_upload_service.rb` | 전송 전 폴더명 길이 검사 — 체인에 61자 이상이 있으면 전용 에러로 중단하고 **어느 폴더인지 이름을 담아** 안내(D'Flow 400을 그대로 노출하면 원인 파악 불가). **＋ 깊이 사전 경고(차단 아님, 정본 §2-C 확정)** — `folder_path.length + (루트가 팀코드면 0, 아니면 1)` 계산식으로 5 초과 예상 시 경고만(§6). ⚠️ **`teamOverride` 확정 후 재평가** — 루트가 팀코드인지는 team 선택이 끝나야 안다. ⚠️ **팀 목록 하드코딩 금지 — `GET /minutes/meta`의 `teams` 사용**(런타임 마스터라 6번째 팀이 등록되면 어긋난다) | ✅ |
| **W5** | `backend/app/controllers/api/v1/meeting_dflow_controller.rb#handle_upload_precondition_error`(`:171-180`) | W4 에러를 `handle_upload_precondition_error` 계열로 매핑 | ✅ |
| **W6** | `frontend/src/lib/dflowAutoAssign.ts` | `buildDflowTitle` 접두 로직 제거 또는 플래그화. `dflowFolderPathNames(folderPath)` 추가(root-first 그대로 `map(name)`). `detectDflowTeam`은 유지하되 **미판정이 실패가 아니라 “team 선택 필요”**임을 반영 | ✅ |
| **W7** | `frontend/src/components/meeting/SendToDflowDialog.tsx` | 미리보기를 **편철 경로 표시**로 변경 — `MES / 품질 / 주간정례` 형태. 루트가 팀코드가 아니면 `MES / 신규TF / 킥오프`처럼 **선택한 team이 앞에 붙는 모습**을 그대로 보여줄 것. `TEAM_REQUIRED_MESSAGE`(`:37`) 문구를 “판정 불가 → 선택” 톤으로 수정.<br>⚠️ **미리보기가 보여주는 경로는 ‘절단 전’이다** — 깊이 5 초과분은 D'Flow에서 **무통보로 잘려** 다른 경로에 안착한다(§6 「깊이 절단 정책」, **절단 유지 확정**). 최종 결과는 미리보기가 아니라 **`ddobak-W8` 응답 에코(`folder_path_status`)로 확인**한다 — 미리보기를 최종 결과처럼 쓰면 오해가 굳는다. `W4`의 깊이 사전 경고와 같은 시점(`teamOverride` 확정 후)에 재평가할 것 | ✅ |
| **W8** | `frontend/src/components/meeting/SendToDflowDialog.tsx` | 전송 성공 시 응답의 `folder_path`를 표시(절단·한 칸 내림이 있었으면 사용자가 인지) ＋ `folder_id: null`이면 미분류 문구(§3.3). **＋ `folder_path_status` 배지 신설(정본 §2-C 확정, 2차)** — `truncated`·`partial`·`unclassified`일 때 눈에 띄게 표시(§3.3-b).<br>**승격 근거**: D5 결정으로 사전 미리보기(폴더 목록 API)를 포기해 이 에코가 절단·“한 칸 내림”의 **유일한** 사후 피드백 경로다 — 권장으로 두면 사전 미리보기(포기)＋사후 확인(미구현) **둘 다 없는 상태**가 가능하다.<br>(전제: **`dflow-W4` ＋ `W19`** — D'Flow가 응답에 `folder_id`·`folder_path`를 실어도(`dflow-W4`) 또박또박 백엔드가 그걸 프런트로 넘기지 않으면(`W19` 없음) 표시할 값이 **도달하지 않는다**) | ✅ |
| **W9** | `frontend/src/api/dflow.ts` | 응답 타입에 `folder_id: string \| null`·`folder_path: string[] \| null` 추가 — **둘 다 nullable**(미분류 폴백 §3.3. `string[]`로 고정하면 런타임에서 깨진다) ＋ **`folder_path_status?: "exact" \| "truncated" \| "partial" \| "unclassified"`** 신설(정본 §2-C, §3.3-b). ＋ `folder_id: null`일 때 **“미분류로 들어갔습니다(D'Flow에서 편철 필요)”** 문구를 띄우고 **“팀 루트”라고 쓰지 말 것**을 요구(문구의 구현 위치는 W8, `api/dflow.ts`가 아님).<br>⚠️ **타입만으로는 값이 오지 않는다 — `W19`(백엔드 pass-through)가 있어야 실효**.<br>⚠️ **`dflow-W4` 배포 전에는 두 키가 응답에 없으므로(`undefined`) `?`(optional)까지 허용 — `string \| null \| undefined`. 필수로 고정하면 `ddobak-W8`이 `undefined.join`으로 깨진다.**<br>⚠️ **배치(§7.2) 응답의 `from`도 같은 규약** — `string[] \| null`(`null` = 이동 전 미분류, 정본 §2-D). 배치는 이 파일이 아니라 `DflowFolderMigrationService`(W12) 쪽 타입/파싱이지만 nullable 처리 원칙은 W9와 동일하므로 여기 명시한다<br>**구현 완료(커밋 `3c95e934`)** — 위 optional 요구가 실제 구현과 일치 확인(`dflow.ts#DflowUploadResult`, `:65-68`) | ✅ |
| **W10** | 테스트 | `dflow_upload_service_spec.rb`(경로 조립·reverse 순서·길이 검사·team override), `dflowAutoAssign.test.ts`, `SendToDflowDialog.test.tsx`(응답 `folder_path` 에코 표시 · `folder_id: null`이면 미분류 문구이고 “팀 루트”가 아닐 것 — §3.3)<br>**부분 완료** — `ddobak-W1` 몫(경로 조립·`.reverse` 순서·`[]` 전송)의 백엔드 spec만 완료(커밋 `3c95e934`). `dflowAutoAssign.test.ts`·`SendToDflowDialog.test.tsx`(길이 검사·에코/미분류 spec)는 2차분 — 지금 내면 아직 없는 코드의 spec이 CI를 붉힌다 | ✅ |
| **W11** | `tasks/dflow-minutes-upload/artifacts/ddobak-dflow-sender-spec.md` | §1.3(team 판정)·§1.4(제목 조립) 개정. **W18과 별개 작업이다** — 이쪽은 또박또박 전송 구현 스펙, W18은 D'Flow API 계약서 사본. 한쪽만 고치면 다른 쪽에 모순이 그대로 남는다<br>**구현 완료(커밋 `212d5519`)** | ✅ |
| **W12** | `backend/app/services/dflow_folder_migration_service.rb` **(신규)** | **기존 전송분 일괄 재편철** — 상세 §7 | ✅ |
| **W13** | `backend/lib/tasks/dflow.rake` **(신규)** | `rake dflow:migrate_folders` — W12 실행 진입점(dry-run 기본) | ✅ |
| **W14** | `frontend/src/components/meeting/SendToDflowDialog.tsx` | **`exists_on_dflow: false` 대응** — 상세 §7.6<br>**구현 완료(커밋 `3c95e934`)**:<br>· 백엔드 `meeting_dflow_controller.rb#status`(`:47-64`) — `list_minutes(external_id:, include_archived: true)`(`:50`) 호출, 응답에 `dflow_archived`를 **`item.key?("archived")`일 때만**(`:60`) 싣는다(R1 이전 구버전 응답이면 키 자체를 안 넣는다 — `false`로 채우면 "보관 아님"을 단정하게 된다).<br>· 타입 `dflow.ts#DflowMeetingStatusWithExists.dflow_archived?: boolean`(`:45`). `dflow.ts#DflowUploadResult`(`:65-68`)엔 없음.<br>· UI `SendToDflowDialog.tsx` — `dflowMissing`(`:130`, = `exists_on_dflow===false` ＋ `dflow_synced_at` 있음)이면 메인 [전송] 버튼(`:404`)을 `sendBlocked`(`:138`)로 차단 ＋ 안내(`:345-366`)에 갈래 2개: 「D'Flow에서 찾기로 재연결」(`:351`, 연결 관리를 펼치고 검색 패널 오픈) / 「새로 전송」(`:356-363`)은 `sendBlocked`를 받지 않고 `handleForceSend`(`:172-176`)로 `confirmDialog` 확인을 거친 뒤에만 `handleSend`를 호출.<br>`dflowArchived`(`:133`, = `exists_on_dflow===true` ＋ `dflow_archived===true`)는 "보관됨" 안내(`:339-343`)만 띄우고 **전송은 차단하지 않는다**.<br>· 설계 판단(근거): 보관분 [전송] 미차단 — ① D'Flow 409가 "보관된 회의록입니다. 복원 후 다시 시도하세요."를 정확히 실어 오므로 클라이언트가 선차단하면 그 안내 경로가 사라진다 ② 방금 D'Flow에서 보관 해제한 사용자가 stale 플래그로 락아웃된다.<br>· `include_archived`는 조회 프록시(`meeting_dflow_controller.rb#minutes`, `:117-120`)의 `params.permit`(`:118`)에도, 프런트 `dflow.ts#ListDflowMinutesParams`(`:123-129`)에도 넣지 않았다 — 살아 있는 유일한 호출자가 `linked=false` 후보 검색이고 그 조합은 금지(보관분은 claim 불가·409). `linked=true` 순회는 `W15`·`W16` 소관.<br>· 검증: rspec 75 pass · vitest 전체 1816 pass · `tsc -p tsconfig.app.json` 0 · rubocop/eslint clean | ✅ |
| **W15** | `backend/app/services/dflow_auto_link_service.rb` **(신규)** | **미연결 회의 자동 링크** — 상세 §7.7 | ✅ |
| **W16** | `backend/lib/tasks/dflow.rake` | `rake dflow:autolink` / `dflow:autolink_rollback` | ✅ |
| **W17** | `backend/app/controllers/api/v1/meeting_dflow_controller.rb#status`(`:47-64`) | `status` 액션이 이미 부르는 `list_minutes(external_id:)` 응답의 `title`·`date`를 `exists_on_dflow`와 같은 자리에 얹는다 — 키는 `dflow_title`·`dflow_date`, **`exists_on_dflow: true`일 때만 포함**(미존재 시 키 자체 생략). 자동 링크된 회의를 처음 전송할 때 "무엇을 덮어쓰는지" 보여주기 위함.<br>⚠️ **`dflow_status_json` 공용 헬퍼에 넣지 말 것** — `upload`·`link`·`claim`이 함께 쓰는데 그 셋에는 `list_minutes` 왕복이 없다. 넣으면 값 없는 필드가 따라붙거나 왕복이 3번 는다(`ddobak-W19`와 같은 함정)<br>**구현 완료(커밋 `3c95e934`)** — `dflow_title`/`dflow_date`는 `:57-58`. 백엔드 위치는 위 지시(⚠️ 문단)대로 `status` 액션에 얹었다 — 이 판단은 처음부터 이 행에 반영돼 있었다.<br>**새로 적는 위치 편차(정당, 이 행엔 없었다)** — 프런트 표시 위치가 연결 관리 `<details>`(`:413`, 기본 **접힘**) 안이 아니라 **[전송] 버튼(`:401-409`) 바로 위**(`:333-337` 덮어쓰기 안내)다. 접힌 곳에 두면 처음 전송하는 사용자가 펼치지 않는 한 경고를 **절대 못 본다** → W17 목적(전송 직전 오매칭 경고) 자체가 무너진다.<br>⚠️ **`W14`가 이 기능을 깨뜨릴 뻔한 지점** — `include_archived`가 붙으면 보관분도 `exists_on_dflow: true`가 되어 `:333`의 "덮어씁니다" 안내가 **거짓**이 된다(재전송은 409). → 덮어쓰기 안내에 **`status.dflow_archived !== true` 게이트**(`:333`)를 걸어 막았다. 함께 손본 곳: 연결 관리 존재 확인 표시를 **4분기**로(`:447-453`, 모름/존재함/존재함(보관됨)/존재하지 않음), 수동 입력 경고를 `missing`/`archived` 2분기로(`:509-518`), spec의 `.with(external_id:, include_archived: true)` 정확 매처 갱신(`backend/spec/requests/api/v1/meeting_dflow_spec.rb:144`) | ✅ |
| **W18** | `tasks/dflow-minutes-upload/artifacts/dflow-minutes-upload-api-spec.md` | **D'Flow API 계약서 사본 동기화**(또박또박 사본 = **v2.1**). 정본은 `wbs-web/docs/design/dflow-minutes-upload-api-spec.md`이고 동기화 방향은 **wbs-web → 또박또박. 반대 금지**. 두 사본은 **이미 21행 갈라져 있고 둘 다 `folder_path` 언급이 0건**이다.<br>⚠️ **정본은 v2.2가 아니라 v2.4다(확정, 정본 §2-E)** — `dflow-W8`로 v2.3 커밋(`4387576`)까지는 완료됐지만 또박또박에는 **아직 송부되지 않았다.** D'Flow가 조상 규칙(§2-J)·`folder_path_status`(§2-C)·`from` nullable(§2-D)·`include_archived` 규약(§2-B)·플래그 규약(§2-A)·배치 `pmo_admin` 게이트(§2-H)·NFC 정규화·비활성 팀 400 매핑 등 **9건을 한 번에 반영해 v2.4로 송부할 예정**이다. → **동기화 작업은 v2.4 도착 대기 상태로 표기**하고, 도착 전에는 v2.2/v2.3 기준으로 착수하지 말 것(개정 이력이 아니라 한 번에 받는다).<br>**이번 변경과 정면 충돌하는 문장 3개**를 반드시 걷어낼 것(아래 `§`는 **계약서**의 절번호다): ① `§0 D10` “전송 제목 = `<하위폴더명>-<원제목>`” ↔ 접두 제거(W2·W6) ② `§4.2` 필드표에 `folder_path` 없음 ↔ §3.1 ③ `§4b` “해제 API는 제공하지 않음” ↔ D'Flow §9 연결 초기화.<br>**동기화 범위 = 정본 개정 범위와 동일(계약서 §3·§8·§9).** 충돌 문장 제거만으로는 부족하다 — `POST /api/v1/minutes/folder`(요청 필드·status 값 집합·200건 상한·`dry_run`·`overwrite_manual`)는 **W12·W13이 직접 호출**하고, §9 연결 초기화는 **W14 안내·W16 롤백의 전제**다. 사본에 안 실리면 구현자가 코딩할 계약이 없다.<br>**실행 전제 = v2.4 도착 후**(정본이 먼저 나와야 한다) | ✅ |
| **W19** | `backend/app/controllers/api/v1/meeting_dflow_controller.rb#upload`(`:26-33`) | **upload 응답 pass-through** — `upload` 액션이 `DflowUploadService.call(...)`의 **반환값(`resp`)을 버리고** `dflow_status_json(@meeting)`(4필드)만 렌더한다. D'Flow 응답의 `folder_id`·`folder_path`를 upload 응답에 함께 실을 것.<br>⚠️ **`dflow-W4`가 배포돼도 이게 없으면 값이 프런트에 도달하지 않는다 — W8의 진짜 선행조건이다**(`ddobak-W8`의 전제 = `dflow-W4` ＋ W19).<br>⚠️ **병합 지점은 `upload`의 render 자리이지 `dflow_status_json`이 아니다.** 공용 헬퍼에 필드를 밀어 넣으면 편철 정보가 없는 `status`·`link`·`claim` 응답까지 따라붙어 **W9가 `DflowUploadResult`를 `DflowMeetingStatus`와 분리해 둔 이유가 무너진다**(타입이 거짓말이 된다). W17도 같은 헬퍼(`#dflow_status_json`, `:136-143`)를 다른 목적으로 고치므로 충돌 지점이다 | ✅ |

---

## 5. 배포 순서

> **이 절은 두 프로젝트의 W가 한 표에 섞인다.** 그래서 머리말 규약대로 **양쪽 모두 접두를 붙인다** — `ddobak-W*` = 또박또박(§4), `dflow-W*` = D'Flow(`dflow-folder-path-worklist-2026-07-27.md` §4·§6.6). 접두 없는 `W`가 보이면 오류다. 오독하면 D'Flow 미배포 상태에서 `ddobak-W2`·`ddobak-W3`를 내보내게 되는데, 그게 이 절이 막으려는 사고다.

### ⚠️ 배포는 이제 서버 플래그가 통제한다 — `MINUTES_FOLDER_PATH_ENABLED` (정본 §2-A 확정)

D'Flow는 `W1~W6·W24`를 **한 번에** 배포하고(`R1`), 신규 `dflow-W25`(서버 플래그, 코드 5줄)로 전환 시점을 쥔다. **R1(플래그 `false`)과 R2(env 전환, `true`)**로 나뉜다.

| 대상 | R1 (플래그 `false`) | R2 (플래그 `true`) |
|---|---|---|
| `POST /minutes`의 `folder_path` | **완전히 무시**(키 부재와 동일. 검증 400도 안 난다) | §3.2대로 편철 |
| 재전송(`replace`)의 폴더 갱신(`dflow-W5`) | **일어나지 않음** | 일어남 |
| `POST /minutes/folder`(배치·`dflow-W6`) · `include_archived`·`archived`(`dflow-W24`) | **활성**(R1에 포함) | 활성 |

→ **R1은 `POST /minutes` 동작을 1비트도 바꾸지 않는다.** 그래서 또박또박 **1차는 R1 이후 언제 내도 무해**하다 — "코드가 무해한가"가 아니라 "플래그가 켜졌을 때 무엇이 바뀌는가"로 배치 기준이 바뀐 것.

**지켜야 할 순서 제약은 3개뿐이다**(정본 §3):

1. **`dflow-W24` ≤ `ddobak-W14` ≤ `dflow-W10`** — 실질은 **R1 이후, R3 이전**(`dflow-W24`는 R1에 포함되므로)
2. **또박또박 2차는 R2(플래그 `true`) 이후**
3. **재편철 1회차는 R2 이전**

이 기준으로 걸러지는 항목이 아래 ⚠️ 묶음이다.

### ⚠️ 접두 제거의 실효 지점은 `ddobak-W2`가 아니라 `ddobak-W6`이다

UI 전송 경로의 title은 **항상 프런트가 만든 값**이 `title_override`로 실려 백엔드 자동 조립을 이긴다:

`SendToDflowDialog.tsx`의 `title` state 초기값(`:71`, `buildDflowTitle(folder_path, title)`) → `#handleSend`(`titleOverride: title`, `:146`) → `dflow.ts#uploadToDflow`(`titleOverride` → `body.title`, `:76`) → `meeting_dflow_controller.rb#upload`(`title_override`, `:31`) → `dflow_upload_service.rb:33`(`title = @title_override || @meeting.dflow_auto_title`). 전송 호출부는 이 다이얼로그 **1곳뿐**이다.

- `ddobak-W6`을 1차에 내면 **그 즉시 접두가 사라진다.** 그런데 그 시점 D'Flow는 아직 `folder_path`를 무시하므로 그 구간 전송분은 **“접두도 없고 폴더도 안 잡힌”** 상태가 된다 — 바로 아래에서 `ddobak-W2`에 대해 금지한 그 상태를 1차가 스스로 만든다. 게다가 그 구간 분은 제목에 단서가 0이라 **나중에 D'Flow 단독으로 복구할 수도 없다**(제목 접두 역파싱 불가)
- 반대로 `ddobak-W2`만 내면 UI 제목은 하나도 안 바뀌어 “접두 없음” 수용기준이 실패로 보이고 QA가 엉뚱한 곳을 고친다

→ **`ddobak-W2`와 `ddobak-W6`은 2차에서 함께** 나간다. §8 수용기준의 귀속도 이에 맞춘다.

### ⚠️ `ddobak-W4`는 `ddobak-W5`보다 먼저 나갈 수 없다

`ddobak-W4`(61자 사전 차단)가 만드는 새 예외 클래스가 컨트롤러 `rescue_from` 목록(`ddobak-W5`)에 없으면 **미rescue 500**이다. 프런트에는 “전송에 실패했습니다”만 뜨고 원인이 안 보여 **2차까지 전송 불가**가 된다. 게다가 1차 시점 D'Flow는 `folder_path`를 무시해 **60자 제약이 애초에 적용되지 않는다** — 체인에 61자 폴더가 있는 회의도 오늘은 정상 전송된다(폴더명이 페이로드에 안 들어가므로). 없는 제약을 선제로 차단하는 셈이다. → 둘 다 2차, 그 안에서 `ddobak-W5` → `ddobak-W4` 순.

### ⚠️ `ddobak-W7` 미리보기는 미래 동작의 선표시다

1차 시점의 실동작은 **팀 루트 평평**인데 미리보기는 계층을 보여준다 — ‘표시 개선’이 아니다. 사용자는 계층 보존을 믿고 확인을 건너뛴다. `ddobak-W6`의 경로명 헬퍼에도 의존하므로 함께 2차로.

### ⚠️ `ddobak-W2`도 D'Flow 배포 후

제목 접두를 먼저 떼면 그 사이 전송분은 접두도 없고 폴더도 안 잡힌 상태가 된다. (위 실효 지점 논의와 한 쌍 — 실제로 접두를 떼는 것은 `ddobak-W6`이다.)

### ⚠️ `ddobak-W3` 선배포 — **근거 정정, 조치는 플래그로 자동 해소** (확정, 정본 §2-A)

기존 근거 “`resolve_team!` 완화(`ddobak-W3`)가 지금까지 `TeamRequiredError`로 **막히던 전송을 성공시킨다**”는 **사실이 아니다. 자유 루트 전송은 오늘도 성공한다.**

실증 경로: `SendToDflowDialog.tsx`의 `needsTeamSelect`(`:125-126`, `detectDflowTeam`이 null이면 team 셀렉트 노출) → `select[aria-label="대상 구분"]`(`:290-301`) → `#handleSend`의 `disabled` 조건(`:404`, 선택 시 전송 버튼 활성) → `#handleSend`(`teamOverride: selectedTeam`, `:147`) → `dflow_upload_service.rb:75-76`(`return @team_override if @team_override` — meta 조회 없이 즉시 채택, `resolve_team!` 본체를 건너뛴다).

따라서 아래 노출은 **`ddobak-W3`와 무관하게 이미 라이브**다(이 프로젝트 착수 이전부터):

1. 루트가 `신규TF`인 회의가 `team=MES`로 전송됨(`folder_path`는 구버전 D'Flow가 무시)
2. → `MES` 루트에 **평평하게** 안착. `신규TF` 흔적 없음
3. → D'Flow 업그레이드 후 재전송해도 **위치가 안 바뀐다** — `replace`가 `folder_id`를 안 건드리는 게 `dflow-W5`로 고칠 갭이기 때문. **최초 전송이 위치를 영구히 고정한다**

**✅ 확정 — 플래그가 이 노출을 자동으로 가둔다.** R1 동안 `POST /minutes`의 `folder_path`는 **완전히 무시**되므로(§5 서두 플래그 표), 위 3항목은 `ddobak-W1`~`ddobak-W3` 배포 여부와 **무관하게 R2 전까지 오늘과 100% 동일하게** 동작한다 — 악화도 개선도 없다. "2차를 미루면 안전"이라는 옛 오판도 "R2 전까지 계속 쌓인다"는 옛 경고도 더 이상 별도로 관리할 대상이 아니다 — **R2 게이트 하나가 전부를 막는다.**

**조치 확정 — B-3 승인(정본 §1-③·§2-A)**: 전송 보류(UI 차단) 안은 **채택하지 않는다**(정상 업무를 막는 대가가 크고, 보류 기간이 D'Flow 일정에 종속돼 통제 불가). 대신 **3차 재편철로 정리**한다 — 자유 루트로 평평 안착한 기존 전송분은 재편철 1회차(§7)가 대조·처리하고, **재편철 1회차가 R2 이전에 끝나야 한다**(아래 표의 제약③). `ddobak-W3` 자체는 이미 라이브인 경로를 정식화하는 작업이라 2차 배치는 그대로 둔다.

> ⚠️ **진짜 위험은 `dflow-W3`가 아니라 `dflow-W5`다.** `folder_path`가 실려 오는 R2 이후, 재전송 1건마다 D'Flow 위치가 덮이고 또박또박에서 **폴더에 안 들어 있는 회의는 `[]`를 보내므로 팀 루트로 평평화**된다. 사람이 정리한 17건(`decisions-final-2026-07-27.md` §1-②)은 또박또박 2차가 아니라 **`dflow-W5`가 켜지는 순간(=R2)부터** 재전송 단위로 사라진다. **`overwrite_manual`은 배치 전용이라 이 재전송 경로를 못 막는다.** 그래서 §4(19건 대조)·재편철 1회차 APPLY가 **반드시 R2보다 앞서야** 한다 — 제약③의 실체가 이것이다.
>
> (이 조치는 §7.3의 **조상 규칙** 결정과는 별개다 — 여기는 재편철의 배포 순서를, §7.3은 재편철의 판정 기준 자체를 다룬다.)

### 배포 순서 표 (정본 §3 확정)

| 단계 | 항목 | 시점 / 사유 |
|---|---|---|
| **[D'Flow] R1** | 계약 v2.4 + `dflow-W1·W1-b·W2·W3·W4·W5·W6·W24` + `W25`(플래그) + 조상 규칙(§2-J) + 폴더 삭제 가드 + 배치 400 경계 수정 + NFC 정규화 → `MINUTES_FOLDER_PATH_ENABLED=false`로 배포 | `POST /minutes` 동작은 오늘과 100% 동일. 배치·`archived` 노출만 새로 열린다 |
| **0차** — 계약서 사본 | `ddobak-W18` | **v2.4 도착 후**(§4 W18) 착수. **3차 착수 전까지는 반드시** 완료 |
| **1차-a** — 무해 | `ddobak-W1` · `ddobak-W9` · `ddobak-W10`(일부) · `ddobak-W11` | **R1 이후 언제 내도 무해** — `folder_path`는 R1 동안 완전히 무시되고 나머지는 타입·테스트·문서다.<br>⚠️ **`ddobak-W10`은 테스트 대상과 같은 차수로 쪼개 낸다** — 1차엔 `ddobak-W1` 몫(경로 조립·`.reverse` 순서·`[]` 전송)만. 길이·깊이 검사·`dflowAutoAssign`·다이얼로그 에코/미분류 spec은 2차다. 통째로 1차에 내면 **아직 없는 코드의 spec이 CI를 붉힌다**.<br>`ddobak-W11`은 2차 동작을 미리 기술하지만 문서라 무해 |
| **1차-b** — 선행 완화 (**D'Flow 의존 0**) | `ddobak-W14` · `ddobak-W17` | 없음 — `exists_on_dflow`는 **오늘 응답에 이미 있고**(`meeting_dflow_controller.rb#status` 주석 `:38-45`), `ddobak-W17`도 D'Flow 변경 0(D'Flow §9.5 “추가 변경 없음” 확인). 늦어도 2차까지, 그리고 **반드시 `dflow-W10`(R3)보다 먼저** → 제약①, 아래 ⚠️ |
| **3차 dry-run — 재편철 1회차** | `ddobak-W12` · `ddobak-W13`(`dry_run:true`, `overwrite_manual:false`) | 배치 엔드포인트는 R1에 포함되므로 바로 쓸 수 있다 |
| **[양측]** 19건 대조표 정리 | §4(정본 §4) | 사람이 정리한 17건의 운명 확정 — **사람이 판단하는 유일한 구간** |
| **재편철 1회차 APPLY** | `ddobak-W12` · `ddobak-W13` | **R2 이전 필수**(제약③) — 위 ⚠️ `dflow-W5` 경고 참조 |
| **[D'Flow] R2** | 플래그 `true` 전환(코드 배포 없음, env 전환) | 이 시점부터 `folder_path` 편철·재전송 동기화(`dflow-W5`)가 살아난다 |
| **2차** — 전송 전환 | `ddobak-W2` · `ddobak-W3` · `ddobak-W4` · `ddobak-W5` · `ddobak-W6` · `ddobak-W7` · `ddobak-W8` · `ddobak-W19` ＋ `ddobak-W10` 잔여분 | **반드시 R2 이후**(제약②).<br>**차수 안에서의 순서**: `ddobak-W5` → `ddobak-W4`(역순이면 미rescue 500), `ddobak-W2`＋`ddobak-W6`은 동시, `ddobak-W19` → `ddobak-W8`(역순이면 표시할 값이 도달하지 않는다).<br>`ddobak-W8`의 전제는 **`dflow-W4`(응답에 `folder_id`·`folder_path`·`folder_path_status`) ＋ `ddobak-W19`(백엔드 pass-through)** 둘 다다(§4 W8·W19). `ddobak-W19`의 실효 전제는 `dflow-W4`.<br>**같은 줄기**: `ddobak-W9`(**1차-a** · 타입) → `ddobak-W19`(백엔드가 응답에 실음) → `ddobak-W8`(표시). 셋이 모여야 실효가 완성된다. (`ddobak-W9`를 2차로 옮기라는 뜻이 아니다. 타입은 값보다 먼저 나가도 무해하다) |
| **재편철 2회차** | `ddobak-W12` · `ddobak-W13` | `items`는 **창 구간 전송분만**(`dflow_synced_at` > 1회차 실행 시각) — 전량으로 돌리면 남은 `manual_placement`가 매번 재보고돼 담당자가 `OVERWRITE_MANUAL`로 떠밀린다 |
| **[D'Flow] R3** | `dflow-W10`(연결 초기화 + 연동 식별자 표시) | ⚠️ 연결 초기화 버튼은 `ddobak-W14` 배포 확인 전까지 `pmo_admin` 한정으로 연다 |
| **4차** — 자동 링크 | `ddobak-W15` · `ddobak-W16` | 착수 조건은 §6 — **초기화(R3)가 오매칭의 유일한 되돌리기 수단**이므로 R3 이후. §7.7 참조 |
| **[D'Flow] R4** | `dflow-W18`~`W23`(폴더 중심 UI D&D) | **재편철 1회차 완료 후**(C-2 승인) — §6 「부풀려 보고」 함정 참조 |

**지켜야 할 순서 제약은 3개뿐이다**(§5 서두와 동일):

1. `dflow-W24` ≤ `ddobak-W14` ≤ `dflow-W10` — 실질은 **R1 이후, R3 이전**
2. 또박또박 2차는 **R2 이후**
3. 재편철 1회차는 **R2 이전**

> ⚠️ **`ddobak-W14`는 `dflow-W10`(R3)보다 먼저 나가야 한다 — 완화책이 위험보다 뒤에 있으면 안 된다.** `dflow-W10`(R3) 배포 시점부터 `ddobak-W14`가 나올 때까지 창이 열리면: D'Flow에서 초기화 → 또박또박은 계속 ‘연결됨’ 표시 → 사용자가 재전송 → **중복 회의록 생성 + 원본 고아**. 자가 치유되지 않는다.

> `ddobak-W12`·`W13`(3차)·`W15`·`W16`(4차)은 D'Flow 배포에 각각 다른 R 단계가 걸려 있다 — 3차 dry-run은 **R1**(배치 엔드포인트 포함), 4차는 **R3**(연결 초기화)가 전제다. 위 표가 최종 순서이며 더 이상 조건부가 아니다.

---

## 6. 주의 (기존 함정 — 재발 방지)

- **`ensure_dflow_public_uid!` 순서 불변**(스펙 §1.2): uuid 생성 → 로컬 커밋 → 전송. 이번 변경이 이 순서를 건드리지 않게 할 것
- **`correctMinuteBodyTime`(+9h) 적용 금지**(스펙 §0 D4). 이번 작업과 무관하지만 `DflowUploadService` 본문 생성 경로를 만질 때 실수하기 쉬움
- **로그인 폴백 함정**: loopback + JWT 만료 시 `application_controller.rb#resolve_current_user`가 조용히 `desktop@local`로 폴백 → D'Flow가 `unknown_user` 403. 전송 테스트 실패 시 **1순위로 재로그인** 확인
- 또박또박 테스트는 WebMock이 없다 — `instance_double(Net::HTTP)` 관례

### D'Flow 쪽 사정 — 인지만 (또박또박 작업 없음)

아래 7건은 이 문서에 대응 작업이 **없다**. 다만 모르고 구현하면 증상을 엉뚱한 곳에서 찾게 된다.

- **`dflow-W1-b` 전까지 신규 팀 회의록은 한 건도 못 올라간다** — `POST /minutes`의 team 검증이 폐기예정 하드코딩 5팀(`externalApi.ts:156`)인데 `GET /minutes/meta`는 **활성 팀**을 노출한다. 6번째 팀을 등록하면 `meta`에는 보이는데 `POST`는 **400으로 전건 거절**한다. 또박또박은 계약대로 `meta`만 믿고 보내므로, 그 팀 회의록은 `folder_path` 유무와 **무관하게** 한 건도 안 올라간다. D'Flow가 인자 주입 한 줄로 고친다 (D'Flow §4 ⚠️W1-b)
- **접두 제거의 zip 부수영향은 “그룹 이름 변경”이 아니라 분할이다** — `meetingBodyOf`가 `_`·공백만 토큰 구분자로 쓰므로 **하이픈 접두가 살아남아** `품질-주간회의`와 `주간회의`가 서로 **다른 group**이 된다. `ddobak-W2`＋`ddobak-W6` 이후 같은 회의 시리즈가 **두 폴더로 쪼개진다**(데이터 손실은 없다) (D'Flow §12)
- **초기화된 D'Flow 회의록이 후보 풀에 잔존한다** — §7.7 자동 링크의 가드는 ‘그 회의를 다시 붙이지 않는다’(**회의 축**)일 뿐, 초기화된 minute을 **후보 풀에서 빼지는 않는다.** 같은 (날짜·team·정규화 제목) 회의록이 2건이고 그중 하나가 초기화됐다면 나머지 1건이 exact＋유일로 판정돼 **방금 사람이 끊은 회의록을 claim**한다 (D'Flow §12)
- **배치 재편철이 만드는 폴더의 `created_by`가 `ACTOR_EMAIL` 계정이 된다** — **✅ 계정 확정(§7.0)**: `donseok75@gmail.com`(실명, `pmo_admin`) 명의 유지. 실측상 41명 중 28명이 `pmo_admin`이라 손댈 수 없는 인구는 13명이고 그들도 요청 경로가 있어 **심각도는 "영구 소유권 사고"가 아니라 "수용 가능한 선택 + 별건 개선"**으로 재평가됐다(정본 §1-③) (D'Flow §12)
- **오매칭 `replace`가 실행된 뒤에는 본문이 복구되지 않는다** — 초기화·롤백이 되돌리는 것은 **연결**이지 **본문**이 아니다. 원본은 `minute_versions`에 남지만 D'Flow 버전 패널에 **되돌리기 액션이 없다.** (§7.7 「역연산」 서두 ⚠️와 **같은 사실**이다 — 별개 건으로 세지 말 것) (D'Flow §12 「오매칭 후 본문 복구」 — **별건 미정**)
- **깊이 절단 정책이 비대칭이다** — 폴더명 60자 초과는 **400 거절**인데 깊이 5 초과는 **무통보 절단**이다. `신규TF/A/B/C/D1`과 `…/D2`가 ‘한 칸 내림’ 후 6단이 되면 둘 다 `MES/신규TF/A/B/C`로 **조용히 병합**되는데 에러가 없다 — 60자 거절이 막으려던 사고가 깊이 축에서 재현된다. **✅ 확정(정본 §2-C)** — **절단 유지, 400 전환 안 함.** 대신 D'Flow가 등록 응답·배치 `results[]`에 **`folder_path_status`**(§3.3-b)를 실어 침묵을 깬다. 또박또박은 `ddobak-W4`(사전 경고)·`ddobak-W7`(미리보기 안내)·`ddobak-W8`(배지)로 대응한다(§4). **실측(`prod-survey-2026-07-27.md` §1): 실효 깊이 5단 이상 0건, 최대 2단 — 사전 경고 발동은 현 시점 0건이라 저비용이다.** (D'Flow §11.3 ②)
- **D'Flow §6 회의록 D&D가 또박또박 재편철보다 먼저 배포되면 마이그레이션 결과가 부풀려 보고된다** — 사용자들이 정리 차원으로 회의록을 옮기기 시작하고, 재편철(`ddobak-W12`)이 그 건을 전부 `manual_placement`(조상 규칙 §2-J 적용 후에도 남는 건)로 처리하므로 **부분 일치가 ‘마이그레이션 완료’로 보고**될 위험이 있었다. **✅ 확정(C-2 승인, 정본 §3 R4)** — D&D(`dflow-W18`~`W23`, **R4**)는 §5 배포 순서표에서 **재편철 1회차 완료 후에만** 배포하도록 고정됐다. 순서를 지키는 한 이 증상은 발생하지 않는다 (D'Flow §11.2)
- **⚠️ 신규 통보 사항(정본 §6, 「비활성 팀」 결정) — D'Flow에서 팀을 비활성화하면 그 팀 회의록의 재전송이 실패한다.** `replace`(메타 갱신 RPC)가 `t.active`를 요구해 실패하고 `insertNew`도 활성 팀 검증에서 걸린다(사실로 종결 — 「비활성 팀 시나리오」 수용기준의 귀속은 D'Flow §8 배치로 이관됨, 테스트 이미 존재). **현재는 500**이라 또박또박 사용자에게 원인 불명으로 보인다 — D'Flow가 **400 + 명시 사유로 매핑 예정**(v2.4 ⑨, §4 W18). 매핑 전까지는 "재전송 500"을 다른 원인으로 오인하지 말 것 — 팀 비활성화 여부를 1순위로 확인

---

## 7. 기존 회의 마이그레이션 (W12~W17)

이미 D'Flow에 올라간 회의록은 전부 **팀 루트에 평평하게** 쌓여 있다. 이걸 실제 폴더 경로로 되돌린다.

### 7.0 공통 전제: 실행 주체 이메일 ⚠️ 확정 (정본 §2-H)

`POST /minutes/folder`(W12)와 `POST /minutes/link`(W15)는 **둘 다 `user_email`을 요구**하고, D'Flow가 `resolveUserByEmail`로 매칭하지 못하면 **403 `unknown_user`** 다. 대화형 경로는 `current_user.email`을 쓰지만 **rake 태스크에는 `current_user`가 없다.**

- **✅ `ACTOR_EMAIL` = `donseok75@gmail.com` 확정** — 실명 담당자 계정, D'Flow `auth.users` 실재·`pmo_admin` 확인 완료. **전용 서비스 계정은 반대**(정본 승인) — 이 값을 예시가 아니라 기본값으로 쓸 것
- **✅ 배치 라우트에 `pmo_admin` 게이트 신설(D'Flow 측, 코드 3줄)** — role 미달이면 **`403 forbidden_role`**. 현재 게이트는 `auth.users` 실재만 보고 role은 안 본다 — `ACTOR_EMAIL` 오타가 실재하는 다른 직원을 가리켜도 배치가 성공해버리는 사고를 막는다. **프로브 검증(아래) 응답에 `403 forbidden_role`도 실패 케이스로 포함할 것** — `unknown_user`와 구분해 로그에 남기면 오타(이메일 불일치)와 권한부족(pmo_admin 아님)을 구분할 수 있다
- **✅ 배치가 만드는 폴더의 `created_by`는 ACTOR 명의 유지 확정** — 일괄 재편철이 만든 폴더임을 나타내는 **유일한 감사 표식**이다(item별 소유는 검토 후 기각 — 감사 표식 소실·소프트 삭제 계정 구멍·계약 되돌리기 대가로 인해). 개인별 권한 문제는 폴더 권한을 `created_by`에서 분리하는 **별건 티켓으로 등록**됐다(코드 변경 없음)
- 이 레포엔 같은 계열의 함정 기록이 있다: loopback + JWT 만료 시 `resolve_current_user`가 조용히 `desktop@local`로 폴백 → D'Flow가 전건 거부. rake는 그 폴백조차 없다
- **규칙**: `ACTOR_EMAIL=`을 **필수 인자**로 받고, **배치 시작 전에 프로브로 검증**한다(빈 `items`의 `dry_run` 요청 1회). 실패하면 **1번 항목을 보내기 전에 중단** — 수백 건을 전부 403으로 태우지 말 것
- 그 이메일은 **D'Flow `auth.users`에 실재**해야 한다(위 확정값 사용 시 이미 충족)
- 누락 시 즉시 실패. **기본값 추측 금지**

```
rake dflow:migrate_folders ACTOR_EMAIL=donseok75@gmail.com APPLY=1
rake dflow:autolink        ACTOR_EMAIL=donseok75@gmail.com APPLY=1
```

---

### 7.1 재전송하지 않는다 ⚠️

`POST /minutes` + `on_conflict=replace`로 전건 재전송하면 안 된다. D'Flow의 `commit_minute_body_version`은 **본문이 같아도 무조건 새 버전을 append**한다(`0045:1742`). 결과:

- 회의록 N건 → 버전 N개 신규 생성(본문 전문 복사)
- D'Flow가 하이라이트 재매칭 + AI ingest + insights를 전건 재실행 → **LLM 호출 폭주**
- D'Flow 사용자에게 “전 회의록이 방금 수정됨”으로 보임

→ D'Flow가 만드는 **전용 경량 엔드포인트 `POST /api/v1/minutes/folder`** 를 쓴다(D'Flow 문서 §8.2). 폴더만 바꾸고 버전·위키·`updated_at`을 건드리지 않는다.

### 7.2 `DflowFolderMigrationService` (W12)

대상: `Meeting.where.not(dflow_synced_at: nil)` — 이미 전송된 회의. `public_uid`로 `external_id = "ddobak:#{public_uid}"` 조립. ⚠️ **소프트 삭제된 회의는 제외**(요건 8 참조).

```
rake dflow:migrate_folders                    # dry-run (기본)
rake dflow:migrate_folders APPLY=1            # 실제 이동
rake dflow:migrate_folders APPLY=1 OVERWRITE_MANUAL=1
```

구현 요건:

1. **`folder_path` 조립은 W1과 동일 코드 경로를 쓴다** — `dflow_folder_chain.reverse.map(&:name)`. 별도 구현 금지(전송과 마이그레이션이 갈라지면 결과가 어긋난다)
2. **배치는 `items[].team`을 보내지 않는다** — D'Flow가 회의록의 기존 `team_code`를 그대로 쓴다(§7.4 (a)). **전송 경로(W1)와 배치 경로(W12)는 team 취급이 다르다**: W1은 전송 시점에 판정한 team을 항상 실어 보내지만, W12는 과거 전송 당시 team을 기록해두지 않아 재판정할 수 없으므로(§7.4) team을 생략하는 것이 기본이다. team을 실어 보냈는데 회의록의 기존 `team_code`와 다르면 D'Flow가 `failed(team_mismatch)`로 거부한다(D'Flow §8.2) — 마이그레이션이 팀을 옮기는 도구가 되면 안 되기 때문이다
3. **200건씩 배치.** D'Flow가 요청당 상한 200을 건다
4. **dry-run이 기본.** `APPLY=1` 없으면 D'Flow에 `dry_run: true`로 보내고 결과만 출력
5. 결과를 건별로 로그에 남긴다 — `moved` / `already_correct` / `skipped(manual_placement|archived)` / `not_found` / `failed(team_mismatch|folder_name_too_long|validation_failed|no_team_root)`. **`no_team_root`는 D'Flow §8.2-11 신규 status** — 정규화 후 시드 팀 루트가 없을 때(원인은 거의 항상 0043 미적용) `folder_id`를 건드리지 않고 실패로 보고한다. `moved`나 일반 `failed`에 뭉뚱그리면 진짜 원인이 리포트에서 사라진다
6. **멱등.** 중단 후 재실행 안전. 단 이미 옳은 위치인 건은 D'Flow가 `already_correct`로 응답한다 — `moved` 카운트에 섞지 말 것(섞으면 재실행마다 `moved`가 전건으로 나와 진척 신호로 못 쓴다). **`already_correct` 판정은 §7.3의 `manual_placement` 판정보다 먼저다**(D'Flow §8.2-10) — 현재 위치가 목표 위치와 동일하면 하위 폴더에 있어도 무조건 `already_correct`로 확정되고 `manual_placement`로 새지 않는다
7. 폴더명 61자 이상 회의는 **전송 전에 걸러 목록으로 보고** — D'Flow 400을 그대로 받지 말 것(W4와 동일 검사 재사용)
8. **⚠️ 신규 확정(실측 반영, `prod-survey` §3) — `items` 생성 시 또박또박에서 삭제된(soft delete) 회의를 제외한다.** 목표 경로를 만들 원본이 없다. 실측에서 이미 1건(`019f87db-c94d`) 발견됨 — 또박또박 원본(id 34)이 삭제되고 새 회의(id 96)로 재전송돼 D'Flow에 고아로 남았다. 대상 쿼리를 `Meeting.where.not(dflow_synced_at: nil).where(deleted_at: nil)`(또는 동등 스코프)로 좁힐 것
9. **응답 `from`은 `string[] | null`**(`null` = 이동 전 미분류, 정본 §2-D) — 로그 파싱에서 `Array` 고정 금지(§7.2 fields · §4 W9)
10. **`folder_path_status`가 있으면 함께 로그에 남긴다**(§3.3-b) — `truncated`·`partial`이 섞인 `moved`를 구분해야 재편철 완료를 과대평가하지 않는다

### 7.3 D'Flow에서 사람이 옮겨둔 회의록

D'Flow 사용자가 탐색기에서 직접 옮긴 회의록을 덮으면 사람이 한 일이 지워진다.

> ✅ **확정 — 판정 기준은 "조상 규칙"이다**(정본 §2-J, 신규 결정). 옛 초안은 (a)판정 기준 교체 / (b)순서 교체의 이지선다였는데, 정본은 그 사이에 빠져 있던 **(c) 조상 규칙**을 채택했다 — 스키마 변경 0·이력 테이블 불필요·순서 교체 불필요이면서 (a)가 노린 것을 대부분 얻는다. 판정축은 "팀 루트냐"가 아니라 **"현재 위치가 목표 경로의 조상이냐"**다:

| 현재 위치 | 판정(`overwrite_manual: false`) |
|---|---|
| 목표 위치와 **동일** | `already_correct`(최우선 판정) |
| **미분류**(`folder_id is null`) | 이동 |
| 목표 경로의 **조상**(팀 루트는 그 특수 케이스) | **이동** |
| 그 외(형제·자손·무관한 폴더) | `skipped(manual_placement)` |

예: 현재 `MES/물류`, 목표 `MES/물류/2026-07`이면 조상이므로 **이동**(더 깊게 넣는 것은 사람의 정리를 훼손하지 않는다). 현재 `MES/조업및표준화`, 목표 `MES/기타/…`면 조상이 아니므로 **skip**(사람이 다른 가지로 옮긴 것으로 보호). 현재 `MES/물류/주간`, 목표 `MES/물류`(얕은 쪽으로 되돌리기)도 조상이 아니므로 **skip**.

**또박또박 코드 변경은 0이다** — 계약 §4c.5 개정 + 배치 판정 코드는 **D'Flow 작업**이다. 다만 **dry-run 결과의 해석이 달라지므로**, 재편철 1회차 착수 전 이 규칙이 반영됐는지 확인할 것.

→ **반드시 dry-run으로 `manual_placement` 건수를 먼저 확인**하고, 사용자에게 보고한 뒤 `OVERWRITE_MANUAL=1` 여부를 결정한다. ⚠️ **이 건수를 `OVERWRITE_MANUAL`을 켜는 근거로 쓰지 말 것** — 조상 규칙 적용 후에도 몇 건은 정상적으로 남는다(사람이 다른 가지로 옮긴 건). 판단은 아래 §7.3-b ③ 사람 대조로만 한다.

### 7.3-b 재편철 1회차 운영 절차 (정본 §4, 신규)

19건은 자동화보다 **대조가 싸다** — 실측(`prod-survey` §3) 결과 오분류 0을 기대했던 자동 편철 전제가 깨졌고(19건 중 17건이 이미 사람이 정리한 하위 폴더), 조상 규칙 적용 후에도 6건은 사람 판정이 필요하기 때문이다.

| 단계 | 내용 | 주체 |
|---|---|---|
| ① | 19건 전량 `dry_run: true`, `overwrite_manual: false`로 **1요청**(배치 상한 200건, 19건이면 충분) | 또박또박 |
| ② | 응답의 `from`(현재 D'Flow 위치) / `to`(목표 경로) / `status` **대조표**를 D'Flow에 회신 | 또박또박 |
| ③ | `manual_placement`로 남은 건마다 **어느 쪽이 정답인지** 또박또박이 **수작업으로** 판정(조상 규칙 적용 후에도 남는 건 = 사람이 다른 가지로 옮긴 건). ⚠️ **사용자 결정(2026-07-28) — PMO 판정 요청에서 또박또박 수작업 매칭으로 변경.** D'Flow에는 결과를 통보한다 | 또박또박(수작업) |
| ④ | **D'Flow 위치가 정답인 건** → **또박또박에서 그 회의의 폴더를 D'Flow 위치에 맞게 옮긴다.** D'Flow만 고치면 다음 재전송에 다시 덮인다 | 또박또박 |
| ⑤ | **또박또박 위치가 정답인 건만** `items`에 담아 APPLY. 필요하면 그 요청에만 `overwrite_manual: true`(요청 단위라 **items 한정이 유일한 부분 적용 수단**) | 또박또박 |
| ⑥ | **`to == [팀코드]`인 항목**(= 또박또박에서 폴더 미소속 → `[]` 전송)을 따로 뽑아 **팀 루트 평평화 예정**으로 사전 공유 | 양측 |

> **실측(`prod-survey` §2): ⑥ 대상 = 0건.** 연동 18건 중 폴더 미소속 1건(`019f88d4-1aa4`)뿐이고 **D'Flow에서도 이미 PMO 팀 루트**라 `[]` 전송 시 위치가 그대로다 — **평평화 피해 0.** 2차(전송 전환) 배포에 이 사유로 인한 추가 제약은 없다.

**경고 4개 — 그대로 지킬 것**:

- ⚠️ **`manual_placement` 건수를 `OVERWRITE_MANUAL`의 근거로 쓰지 말 것** — 조상 규칙 적용 후에도 정상적으로 남는다(사람이 다른 가지로 옮긴 건). 켜면 사람 정리분을 덮는다
- ⚠️ **③~⑤는 R2(플래그 `true`) 전에** 끝내야 한다(§5 제약③) — `overwrite_manual`은 재전송 경로를 못 막는다
- ⚠️ **재전송으로 재편철하지 말 것**(§7.1과 같은 사고) — 버전 append·후처리 재실행·목록 전건 "방금 수정됨"
- ⚠️ **대조·`items` 생성은 실서버 기준이다. 로컬 dev DB로 판단하지 말 것**(`prod-survey` 머리말 참조) — 로컬 dev DB는 SQL 문법 검증에만 쓴다(전송분 1건뿐이라 대조 자체가 불가능)

**재편철 2회차**는 `items`를 **창 구간 전송분만**(또박또박 `dflow_synced_at` > 1회차 실행 시각)으로 한정한다(§5).

> **실측 대상표(`prod-survey-2026-07-27.md` §5, `to` 완성본)**: 19건 예상 판정 = `moved` 1 · `already_correct` 11 · `manual_placement` 6(사람 판정 대상) · **items에서 제외 1**(§7.2·§7.3-b 참조, 또박또박 원본 삭제됨). 실제 값은 dry-run 응답이 정본이다.
>
> ⚠️ **폴더명 불일치 1건(`prod-survey` §5 #2) — 재편철 1회차(③~⑤)보다 먼저 처리**: D'Flow `ERP/영업` vs 또박또박 `ERP/영업팀`. **폴더명 통일은 또박또박이 처리한다**(사용자 결정 2026-07-28). 이름만 다른 같은 조직이라 통일 전에 재편철하면 D'Flow에 `영업팀` 폴더가 새로 생겨 **중복 폴더 2개**가 된다. **통일 완료 → ③~⑤ 착수** 순서를 반드시 지킬 것
>
> ⚠️ **자유 루트 정리 권고(`prod-survey` §6)** — 또박또박 폴더 트리에 `ma`·`test` 루트가 있다(시험용으로 보임). 자유 루트는 D'Flow 정규화 ②(한 칸 내림)를 타므로, 전송되면 D'Flow에 `MES/ma` 같은 폴더가 생긴다. **2차(R2 이후) 전에 정리 권고** — 재편철 대상 19건에는 없어 1회차를 막지 않지만, 방치하면 2차부터 새 전송이 오염분을 만든다

### 7.4 루트가 팀코드가 아닌 회의 (자유 루트)

사용자가 다이얼로그에서 team을 골라 보낸 회의들이다(자유 루트라도 **막힌 적이 없다** — 셀렉트는 처음부터 있었다. §1·§5). **또박또박은 그때 사용자가 무엇을 골랐는지 기록하지 않는다.**

- 현재 `meetings` 테이블에 `dflow_synced_at`·`dflow_url`만 있고 **전송 당시 team이 없다**
- → 마이그레이션 시 team을 재판정할 수 없다

**대응 2가지 중 택1**:

| 방안 | 내용 | 비고 |
|---|---|---|
| **(a) D'Flow 현재값 사용** | `POST /minutes/folder` 요청에서 `team`을 생략하고, D'Flow가 **해당 회의록의 기존 `team_code`를 그대로** 쓰게 한다 | **권고·채택**. 추가 스키마 없음. **D'Flow §8.2가 `items[].team`을 이미 선택 필드로 계약했다** |
| (b) 전송 team 기록 추가 | `meetings`에 `dflow_team` 컬럼 추가 + 전송 시 저장. 마이그레이션은 그 값 사용 | 마이그레이션 시점엔 **과거 전송분에 값이 없다** → 결국 (a) 폴백 필요 |

→ **(a)로 간다. 이미 D'Flow §8.2에 수용됨** — `items[].team`을 **생략하면 회의록의 기존 `team_code`를 그대로** 쓰고, **주어졌는데 기존 `team_code`와 불일치하면 `failed(team_mismatch)`** 로 거부한다(마이그레이션이 팀을 옮기는 도구가 되면 안 되기 때문. §7.2 요건 2와 같은 규정). **추가 요청 사항 없음.**

### 7.5 제목 접두 정리는 하지 않는다

`영업-주간회의` 이중 라벨은 남는다. 제목 변경은 D'Flow에서 **위키 재빌드를 유발**하고(`0045:1251`) `minute_versions` 히스토리를 오염시킨다. 폴더 마이그레이션 안정화 후 별건으로 판단.

### 7.6 D'Flow에서 연결이 초기화된 경우 (W14)

D'Flow에 **연결 초기화** 기능이 새로 생긴다(D'Flow 문서 §9) — 회의록의 `external_id`를 `null`로 만드는 조작이다. **한쪽만 끊긴다**:

- D'Flow: `external_id` = null
- 또박또박: `public_uid`·`dflow_synced_at`·`dflow_url` **그대로 남음** → 화면에는 여전히 “연결됨”
- 이 상태로 재전송하면 → D'Flow에 **중복 회의록이 새로 생긴다**

**감지는 이미 가능하다.** `GET /api/v1/meetings/:id/dflow/status`가 `list_minutes(external_id:)`로 존재를 확인해 `exists_on_dflow`를 반환한다(`meeting_dflow_controller.rb#status`(`:47-64`), `list_minutes` 호출은 `:50`). 지금은 이 값을 UI가 활용하지 않는다.

> ⚠️ **`exists_on_dflow: false`는 초기화 전용 신호가 아니다.** D'Flow `route.ts:304`가 `archived_at is null`을 `external_id` 필터 포함 **모든** 질의에 적용하므로, D'Flow에서 회의록을 **보관(archive)만 해도** 같은 값이 나온다. 그리고 그때 아래 복구 갈래가 **둘 다 막힌다**:
> - **[D'Flow에서 찾기]** — 보관분은 `linked=false` 목록에도 안 나온다(같은 `archived_at is null` 필터).
> - **새로 전송** — 같은 `external_id`로 보내면 `handleExisting`이 **409 `archived`**로 막는다(`route.ts:68-70`).
>
> 즉 “초기화됨”으로 단정해 안내하면 사용자는 두 갈래를 모두 시도했다가 둘 다 실패한다.
>
> **✅ 확정 — (a) D'Flow가 보관 상태를 구분 노출한다**(정본 §2-B, B-4 승인). `GET /api/v1/minutes`에 **`include_archived`**(기본 `false` = 종전 동작, `true`면 보관분 포함) + 응답 `items[]`에 **`archived: boolean`** 상시 포함 — 구현·단위 테스트·계약(§5.1) 반영 완료(`dflow-W24`, **R1에 포함**). 기존 기본 동작은 바꾸지 않았으므로 또박또박이 아무것도 안 고쳐도 오늘과 동일하게 동작한다.
>
> **그래서 실효는 또박또박 호출부 수정에 달려 있다 — `dflow-W24`만으로는 죽은 기능이다** (정본 §2-B):
> - **상태 확인 호출(`list_minutes(external_id:)`)에도 `include_archived=true`가 필요하다** — 이게 없으면 보관분을 계속 못 찾아 `exists_on_dflow: false` 오진이 그대로 남고, 아래 "보관" 문구가 도달할 데이터 자체가 없다. 이 문서에 별도 W-번호는 없지만 W14가 의존하는 `status` 액션(§4 W17이 다루는 것과 같은 호출)의 전제다
> - §7.7의 `GET /minutes?linked=true` 순회에도 `include_archived=true` 필요(§4 W15·W16, §7 반영 항목)
>
> **문구를 초기화 / 보관 / 삭제 3분으로 확정.** `include_archived=true`로 재조회해 **`archived: true`로 찾아지면 "보관"으로 확정** 표시하고, 그래도 못 찾으면 "초기화 또는 삭제"(D'Flow가 이 둘은 구분 노출하지 않으므로 계속 묶어 안내). **보관이면 복구는 "D'Flow에서 보관 해제"뿐 — 재전송은 409로 막힌다.**
>
> 부수 영향: §7.7의 `RELINK_RESET=1` 경로도 `include_archived`를 켜지 않으면 보관분과 초기화분을 구분하지 못해 **보관분이 '초기화분'으로 오분류**될 수 있다 — D'Flow에 원본이 살아 있는데 엉뚱한 회의록을 재claim하러 들어간다.

**W14 요건**:

1. `exists_on_dflow: false`인데 `dflow_synced_at`이 있으면 → **”D'Flow에서 확인되지 않습니다(초기화 또는 삭제)”** 배지·안내(초기화로 단정하지 않는다). **`include_archived=true` 조회로 `archived: true`가 확인되면 별도로 “보관됨” 배지·문구로 구분 표시**(위 확정 사항)
2. 그 상태에서 [전송] 버튼을 **바로 누르지 못하게** 막고, 갈래를 제시:
   - **[D'Flow에서 찾기]로 재연결** — 기존 회의록을 claim (`POST /minutes/link`). 권장. 중복 안 생김
   - **D'Flow에서 보관 해제 확인** — 보관 상태라면 이 경로로만 복구된다(위 ⚠️ 참조)
   - **새로 전송** — 새 회의록 생성임을 명시하고 확인받기
3. 또박또박 쪽에서 완전히 끊으려면 기존 `PUT /dflow/link {public_uid: null}`(`meeting_dflow_controller.rb#link`, `:68-90`)로 해제 — 이미 구현돼 있다

### 7.7 미연결 회의 자동 링크 (W15·W16)

D'Flow에 **수동 업로드된 회의록**(external_id null)과 또박또박의 **아직 전송 안 한 회의**를 메타로 매칭해 자동으로 묶는다.

#### D'Flow 변경 불필요

기존 API 2개로 충분하다:

- `GET /api/v1/minutes?linked=false&team=&date_from=&date_to=&page=` — 미연결 회의록 수집. 응답에 `title`·`date`·`team`·`created_by_name` 포함(`route.ts:338-348`). ⚠️ **여기에는 `include_archived`를 절대 켜지 말 것**(정본 §2-B 호출 규약) — 보관분은 claim 대상이 아니다(`POST /minutes/link`가 409로 막는다). 라우트가 이 조합을 막지 않으므로 **호출 측 규약**으로 지킨다
- `POST /api/v1/minutes/link` — claim. **`external_id is null`인 회의록에만** 부여하고, 이미 다른 값이 있으면 409 `link_conflict`. **본문·`updated_at`·후처리 파이프라인을 건드리지 않는다**(`link/route.ts` 주석 명시)

또박또박엔 이미 프록시(`GET /api/v1/dflow/minutes`)와 claim 액션(`meeting_dflow_controller.rb#claim`, `:94-114`)이 있다. **배치 엔드포인트를 새로 만들지 않고 순차 호출**한다 — 일회성 작업이라 수백 건 × ~200ms면 충분하고, D'Flow 변경이 0이 되는 이득이 크다. 동시성은 1~2로 제한.

> ⚠️ **“D'Flow 변경 0”이지 “또박또박 기존 코드 그대로”가 아니다 — claim 액션은 재사용할 수 없다.** `meeting_dflow_controller.rb#claim`(`:94-114`)의 claim 액션은 `authenticate_user!`·`editable_by?`에 묶여 있어 **rake에서 호출할 수 없다.** 그렇다고 `DflowClient#link_minute`를 직접 부르면 **컨트롤러에만 있는 부수 로직 2개**가 빠진다 — `ensure_dflow_public_uid!`(`:105`) · `dflow_url` 조립(`:111`). 그러면 **자동 링크된 회의는 `dflow_url`이 nil이 되어 D'Flow 바로가기가 아예 안 생긴다**(연결은 됐는데 사용자가 건너갈 길이 없다).
>
> → **claim은 컨트롤러 액션이 아니라 공용 서비스 객체로 추출**해 rake와 컨트롤러가 같은 코드를 쓴다(`ensure_dflow_public_uid!` 호출 · `dflow_url` 조립 포함). 추출 시 **`ensure_dflow_public_uid!`의 발급 순서 불변(§6)** 을 그대로 지킬 것. uuid 취급은 아래 「대상」 1의 ⚠️ 그대로다 — **기존 `public_uid`가 있는 건은 그대로 재사용(새 uuid 발급 금지), 없는 건은 claim 시 신규 발급.**
>
> (목록 조회 쪽에도 같은 결의 함정이 있다 — 프록시 대신 `DflowClient#list_minutes` 직접 호출. 아래 「감지 방법」 참조.)

#### 매칭 규칙

공통 키: `date`(또박또박은 `kst_date` = `started_at`의 KST 날짜) · `team`(= `dflow_root_folder_name`).

**제목 비교는 두 케이스를 다르게 다룬다** — 제목의 출처가 다르기 때문이다.

| 케이스 | D'Flow 제목의 출처 | 비교 방법 |
|---|---|---|
| **C1. 한 번도 연결 안 됨** (D'Flow에 사람이 직접 업로드) | D'Flow 사용자가 타이핑 | `meetingBodyOf(또박또박 원제목)` vs `meetingBodyOf(D'Flow title)`. **접두 제거 안 함** |
| **C2. 전송했다가 초기화됨** | **또박또박이 만든 제목** | `@meeting.dflow_auto_title`(`meeting.rb#dflow_auto_title`, `:405-415`)을 재생성해 D'Flow title과 **완전 일치** 비교. 휴리스틱 불필요. ⚠️ **`ddobak-W2`(접두 제거) 이후 `dflow_auto_title`의 기본 동작은 접두 없는 제목**이므로, `ddobak-W2` **이전** 전송분(오늘 시점 C2 모집단 전부)은 접두 **포함** 변형으로 재생성해야 매칭된다 — **두 변형(접두 포함·미포함)을 모두 생성해 시도**한다(둘 다 안 맞아도 fail-safe로 `likely`/`none`으로 강등될 뿐이다) |

`meetingBodyOf`는 D'Flow의 `src/lib/domain/minutes.ts:194` 규칙을 그대로 포팅한다 — `_`·공백 토큰화 후 날짜형 5패턴·회차형(`12차`,`제3차`)·요일 괄호를 제거하고 공백 1칸으로 결합.

> ⚠️ **`<하위폴더명>-` 접두를 벗기는 규칙은 쓰지 않는다.** 접두를 식별할 방법이 없다 — D5 결정으로 `meta`가 폴더 목록을 노출하지 않으므로 또박또박은 어떤 문자열이 폴더명인지 알 수 없고, "첫 하이픈 기준 절단"은 `설비-L2 점검` 같은 정상 제목을 망가뜨린다. C1은 애초에 또박또박이 만든 제목이 아니라 접두가 없고, C2는 접두 포함 전체를 정확히 재생성할 수 있다.
>
> **착수 전 확인**: `GET /minutes?linked=false` 표본을 실제로 뽑아, 수동 업로드분 제목에 `<무언가>-` 형태가 실재하는지 눈으로 볼 것. 있으면 C1 규칙을 다시 정해야 한다.

| 등급 | 조건 | 처리 |
|---|---|---|
| **exact** | `date` 일치 **&&** `team` 일치 **&&** 정규화 제목 완전 일치 **&&** 후보가 **정확히 1건** | **자동 링크** |
| likely | 위 중 하나만 어긋남(날짜 ±1일 또는 제목 포함관계) **&&** 후보 1건 | 후보로 제시, **사람 승인 후** 링크 |
| ambiguous | 후보 2건 이상 | 목록만 출력, 자동 링크 **금지** |
| none | 후보 없음 | 스킵 |

**team을 판정할 수 없는 회의(루트가 팀코드 아님)는 자동 링크 대상에서 제외**한다 — 매칭 키가 하나 빠지면 오매칭 확률이 급등한다. 후보 목록으로만 제시.

#### 대상

**대상을 가르는 축은 `public_uid`가 아니라 `dflow_synced_at`이다.**

> ⚠️ **정정(실측 반영, `prod-survey-2026-07-27.md` §4) — 대상 1 판정은 `dflow_synced_at` 하나만으로 끝나지 않는다.** 실서버에 `dflow_synced_at`이 없으면서 **이미 D'Flow에 연결된**(`exists_on_dflow: true`) 회의가 **4건** 있었다 — 원인은 `claim` 경로(`meeting_dflow_controller.rb#claim`, `dflow_url` 갱신 `:111`)가 `dflow_url`만 갱신하고 `dflow_synced_at`은 건드리지 않기 때문(**정상 동작**, claim은 전송이 아니다). 대상 1을 `dflow_synced_at` 없음만으로 넓히면 이 4건이 후보로 잡혀 **다른 미연결 회의록에 재claim**될 수 있고, 그러면 기존 연결이 끊긴 **고아 + 오매칭**이 생긴다. → **대상 1 = `dflow_synced_at` 없음 AND `exists_on_dflow == false`로 확정.** `public_uid` 유무는 판정 기준이 될 수 없다(claim이 채우므로). **아래 「감지 방법」의 `already_linked` 게이트가 이미 이 조건을 구현하는 메커니즘이다** — 이번 정정은 그 메커니즘이 필수임을 대상 1 정의 자체에 명문화하는 것이다.

1. **`dflow_synced_at`이 없는 회의 — 한 번도 전송되지 않음, 그리고 `exists_on_dflow == false`.** `public_uid` 유무를 묻지 않는다. (i) `public_uid`도 없는 회의(한 번도 연결 안 됨) (ii) `public_uid`는 있으나 **전송에 실패한** 회의 (iii) **수동 연결**로 `public_uid`만 바뀐 회의(이전 전송 상태가 무효화돼 `dflow_synced_at: nil`) — 전부 여기 들어온다. **기본 실행 대상.** `exists_on_dflow == true`인 건(= 위 실측 4건과 같은 조건)은 아래 「감지 방법」의 `already_linked` 게이트로 **등급 판정 전에** 반드시 빠져야 한다.
   - ⚠️ **이미 `public_uid`가 있는 건을 claim할 때는 기존 `public_uid`를 그대로 쓴다 — 새 uuid를 발급하지 않는다.** 새로 발급하면 D'Flow의 `external_id`와 어긋나 이후 전송이 **중복 회의록을 만들고 원본을 고아로** 남긴다(§7.6과 같은 사고). 반대로 (i)(`public_uid` 없음)은 claim 시 uuid를 **새로 발급**한다 — 그 uid가 다음 실행의 `linked=true` 순회에 잡혀야 아래 게이트가 성립한다
   - ⚠️ **`public_uid`가 있으면서 `exists_on_dflow: true`인 건은 이미 D'Flow 회의록에 붙어 있다** — 수동 연결분, 그리고 **이전 rake 실행이 링크한 건**이 여기 해당한다. 등급 판정(exact/likely/…)에 넣지 말고 **그보다 먼저 `already_linked`로 확정**해 별도 집계한다(§7.2 요건 6의 `already_correct`가 `manual_placement`보다 먼저인 것과 같은 이유). 이 게이트가 없으면 **같은 rake를 두 번 돌렸을 때 1회차가 링크한 건이 2회차 후보로 다시 잡혀**, 다른 미연결 회의록을 claim하면서 로컬 `public_uid`를 조용히 덮고 1회차 링크를 고아로 만든다
2. **`dflow_synced_at`은 있는데 `exists_on_dflow: false`** — 전송 이력이 있는데 D'Flow에서 확인되지 않는 것(초기화·삭제. §7.6-1과 **정확히 같은 조건**). ⚠️ **`include_archived=true`로 순회하는 한 "보관"은 여기 안 걸린다** — 보관분은 `archived: true`로 순회 집합에 잡혀 이미 대상 2 차집합에서 빠졌다(위 「감지 방법」). **기본적으로 대상 제외.** `RELINK_RESET=1`을 줘야만 **기존 public_uid로 재claim**한다(새 uuid 발급 없음)

> ⚠️ **대상 1을 '`public_uid` 없는 회의'로 좁히면 사각지대가 생긴다.** `public_uid`는 있는데 D'Flow에 없는 상태는 초기화 말고도 정상 경로로 도달한다 — (i) **전송 실패**(`meeting.rb#ensure_dflow_public_uid!`, 주석 `:424-428` — 실패해도 커밋된 public_uid는 유지된다) (ii) **수동 연결**(`meeting_dflow_controller.rb#link`, `:87-88` — 새 uid로 수동 연결 시 `dflow_synced_at: nil`). 이 두 부류는 `public_uid`가 있으니 좁은 대상 1에 안 걸리고, `dflow_synced_at`이 없으니 대상 2에도 안 걸린다 → **링크가 가장 필요한 '한 번도 안 올라간' 회의가 통째로 빠지고 dry-run 집계에도 안 나온다.** 축을 `dflow_synced_at`으로 잡으면 미전송분이 전부 대상 1로 모이고 대상 2에는 '전송 이력이 있는데 D'Flow에 없음'만 남는다 (D'Flow §11.3 ③).

> ⚠️ **초기화와 자동 링크는 서로 싸운다.** §7.6 초기화는 D'Flow 사용자가 **의도적으로 연결을 끊은** 조작이다. 그 결과 상태(`external_id is null` + 또박또박에 `public_uid` 잔존)는 위 **대상 2**와 **정확히 같다.** 자동 링크가 이를 기본 대상으로 삼으면 **사람이 방금 끊은 것을 다음 rake 실행이 조용히 다시 붙인다.** `link/route.ts`의 `.is('external_id', null)` 가드는 이걸 못 막는다 — null이 바로 초기화 직후 상태이기 때문.
>
> 그래서 대상 2는 **명시적 opt-in(`RELINK_RESET=1`)** 으로만 동작한다. 기본 off.

**감지 방법 — 회의별 `status` 호출 금지.** `status`는 회의 1건당 `list_minutes(external_id:)` 왕복 1회다(`meeting_dflow_controller.rb#status`, `list_minutes` 호출 `:50`). 대신 **`GET /minutes?linked=true&per_page=100`을 페이지 순회**해 `ddobak:` external_id를 **한 번만** 모으고, 그 집합 하나로 두 판정을 다 낸다. O(회의수) → O(페이지수).

- **⚠️ 확정 — 이 순회에 `include_archived=true`를 추가한다**(정본 §2-B ②, §4 W15·W16). 응답 `items[].archived: true` 행은 **"존재함(보관)"으로 처리해 아래 대상 2(차집합)에서 제외**한다 — `include_archived` 없이 순회하면 보관분이 순회 집합에서 빠져 대상 2로 잘못 떨어지고, `RELINK_RESET=1`을 켰을 때 보관분이 초기화분처럼 재claim 시도된다(§7.6 부수 영향과 동일 사고)
- **대상 2** = `Meeting.where.not(dflow_synced_at: nil)` **−** 순회 집합(`archived: true`로 찾아진 것도 순회 집합에 포함해 뺀다). 쿼리에 `public_uid` 조건을 덧붙일 필요가 없다 — `dflow_synced_at`이 있으면 `public_uid`는 반드시 있다(`ensure_dflow_public_uid!`가 uuid 생성 → 로컬 커밋 → 전송 순서다. §6)
- **대상 1의 `already_linked` 게이트** = `Meeting.where(dflow_synced_at: nil).where.not(public_uid: nil)` **∩** 순회 집합. 여기 걸리는 건은 등급 판정 **전에** 빼낸다(위 대상 1 ⚠️ — `include_archived`가 켜져 있어야 이 게이트가 보관 중인 연결 건도 정확히 잡는다)

> 이때 **또박또박 프록시(`GET /api/v1/dflow/minutes`)를 쓰지 말 것** — `meeting_dflow_controller.rb#minutes`(`:117-120`)의 `params.permit`(`:118`)에 `per_page`가 없다. 서비스에서 `DflowClient#list_minutes`를 직접 호출한다(파라미터 그대로 통과).

전제: `status == "completed"` **&&** `current_notes_markdown` 있음 (전송 가능 조건과 동일).

#### ⚠️ 오매칭의 대가

잘못 링크되면 **다음 전송(`replace`)이 남의 D'Flow 회의록 본문을 통째로 덮어쓴다.** 링크 자체는 무해하지만 그 다음이 위험하다. 완화 4겹:

1. **자동은 exact + 유일 매칭만.** 애매하면 사람에게
2. **dry-run이 기본.** `APPLY=1` 없으면 매칭 결과만 출력
3. **자동 링크 후 자동 전송하지 않는다.** 링크만 걸고 끝. claim은 `dflow_synced_at`을 건드리지 않으므로(`meeting_dflow_controller.rb#claim`, `:94-114` — `dflow_url`만 갱신하는 `:111` 참조) "연결됨·미전송" 상태로 남는다 — **그런데 그 상태가 곧 대상 1 조건(`dflow_synced_at` 없음)이다.** 그래서 재실행 때 다시 잡히지 않게 하는 것이 위 대상 1의 `already_linked` 게이트다. 이 게이트 없이 3번만 지키면 링크 결과가 다음 실행의 후보로 되돌아온다
4. **첫 전송 시 대상 확인** — W17로 `status`에 연결 대상 회의록의 제목·날짜를 실어, 전송 다이얼로그가 "D'Flow의 `<제목>`(`<날짜>`)을 덮어씁니다"를 보여준다

#### 착수 조건 (v1, 정본 §6 — 신규 확정)

- **자동 링크 v1은 자동 `claim`을 끄고 dry-run 리포트 + 사람 승인만 허용한다.** 위 「완화 4겹」의 1번(exact + 유일)은 매칭 **등급** 판정 기준일 뿐, v1 **착수 조건**은 그보다 엄격하다 — **되돌리기 수단이 없는 상태에서는 exact 등급이라도 자동 claim을 켜지 않는다.** 미연결 21건 규모라 사람이 전량 검토해도 비용이 거의 없다. `APPLY=1`은 이 조건이 충족된 뒤(§5 4차, R3 이후)에만 쓴다
- **후보의 작성자가 또박또박 전송 계정이면 자동 claim 금지.** `GET /minutes?linked=false`가 반환하는 `created_by_name`이 또박또박이 D'Flow 전송에 쓰는 계정과 같으면 사람 승인으로 강등한다(등급이 `exact`여도)

#### 역연산 (W16)

> ⚠️ **역연산이 되돌리는 것은 ‘연결’이지 ‘본문’이 아니다 — 완전 복구가 아니다.** 오매칭 건에 이미 `replace` 전송이 한 번이라도 실행됐다면, 덮어쓴 D'Flow 본문은 아래 2단계 롤백으로 **복구되지 않는다** — 원본은 `minute_versions`에 남지만 D'Flow 버전 패널에 **되돌리기 액션이 없다**(D'Flow §12 「오매칭 후 본문 복구」 — **별건 미정**). 롤백의 범위를 연결 해제로 한정해 읽을 것.

rake가 링크 결과를 `tmp/dflow_autolink_<timestamp>.json`으로 남긴다(회의 id · public_uid · D'Flow minute_id · 등급). 오매칭 발견 시:

```
rake dflow:autolink_rollback FILE=tmp/dflow_autolink_20260727120000.json
```

→ 각 건에 대해 또박또박 `public_uid`/`dflow_url` 해제 + **D'Flow 쪽 초기화**(§7.6 · D'Flow 문서 §9)가 필요하다. 또박또박만 풀면 D'Flow에 external_id가 남아 재연결이 409로 막힌다. **양쪽을 다 풀어야 한다** — D'Flow 측 초기화 API가 없으면 롤백은 "또박또박 해제 + D'Flow에서 수동 초기화" 2단계다.

> 그래서 **D'Flow §9 연결 초기화는 자동 링크의 전제조건**이다. 초기화 수단 없이 자동 링크를 켜면 오매칭을 되돌릴 방법이 없다.

#### 실행

```
rake dflow:autolink                    # dry-run: 등급별 매칭 결과만
rake dflow:autolink APPLY=1            # exact 만 링크
rake dflow:autolink APPLY=1 FROM=2026-01-01 TO=2026-07-27
rake dflow:autolink APPLY=1 RELINK_RESET=1   # 초기화된 연결까지 재연결(기본 off)
```

---

## 8. 수용 기준

- [ ] `MES/품질/주간정례/2026-07` 폴더 회의 전송 → D'Flow에 동일 4단 경로로 편철
- [ ] 루트가 `신규TF`인 회의 + team=MES 선택 → D'Flow `MES/신규TF/…`로 편철, 다이얼로그가 그 경로를 미리 보여줌
- [ ] 폴더 없는 회의 전송 → `folder_path: []` 전송, D'Flow 팀 루트 편철
- [ ] 폴더에 있던 회의를 폴더 밖으로 빼고 재전송 → D'Flow에서도 팀 루트로 되돌아감 (`dflow-W5` 배포 후)
- [ ] 전송 제목에 `<하위폴더명>-` 접두 없음 (**`ddobak-W2`＋`ddobak-W6` 배포 후** — 실효 지점은 프런트 `ddobak-W6`다. `ddobak-W2`만 배포하면 UI 제목은 하나도 안 바뀌어 이 기준이 실패로 보인다. §5)
- [ ] 61자 폴더가 체인에 있으면 **전송 전에** 폴더명을 짚어 안내 (D'Flow 400 노출 아님)
- [ ] 폴더 이동 후 재전송 → D'Flow 위치 갱신 (`dflow-W5` 배포 후)
- [ ] `folder_path` 순서가 root-first (leaf-first로 뒤집히지 않았는지 spec으로 고정)
- [ ] **전송 성공 시 응답 `folder_path`가 다이얼로그에 표시된다**(절단·‘한 칸 내림’을 사용자가 인지) — `ddobak-W8`. **`dflow-W4` ＋ `ddobak-W19`(백엔드 pass-through) 배포 후**여야 값이 도달한다(§4 W19 · §5 2차)
- [ ] **`folder_id: null` 응답이면 “미분류로 들어갔습니다(D'Flow에서 편철 필요)” 문구** — **“팀 루트”라고 말하지 않는다**(D'Flow §3.3 수용기준). 판정은 **`folder_id`로만** 한다 — `folder_path`도 이제 `null`로 확정됐으므로(§3.3, 정본 §2-D) 값이 뒤늦게 `[]`로 바뀌는 일은 없다(§3.3 「미분류 폴백」)
- [ ] upload 응답 본문에 folder_id·folder_path·`folder_path_status`가 실린다 — 단 status·link·claim 응답에는 붙지 않는다(병합 지점 = upload render. §4 W19 · W17 충돌 지점)
- [ ] **`folder_path_status`가 `truncated`·`partial`·`unclassified`일 때 배지가 눈에 띄게 표시된다**(`ddobak-W8`, §3.3-b)

### 마이그레이션(§7)

- [ ] `rake dflow:migrate_folders` (APPLY 없음) → **아무것도 이동하지 않고** 예정 목록만 출력
- [ ] dry run 출력에 `manual_placement` 건수가 별도로 집계됨
- [ ] `APPLY=1` 실행 후 D'Flow 탐색기에서 또박또박과 동일한 트리 확인
- [ ] 61자 이상 폴더가 체인에 있는 회의는 **전송 전에** 목록으로 보고(D'Flow 400 아님)
- [ ] 중단 후 재실행 → 이미 옮긴 건 그대로, 남은 건만 처리(멱등)
- [ ] **`APPLY` 후 같은 요청을 재실행한 dry-run에서 방금 옮긴 건이 `already_correct`** — `skipped(manual_placement)`가 **아니다**(판정 선후 §7.2 요건 6 · D'Flow §8.2-10). `moved`에도 섞이지 않는다
- [ ] **시드 팀 루트가 없는 건은 `failed(no_team_root)`로 별도 집계** — `moved`·일반 `failed`에 섞이지 않고 **`folder_id` 변경도 없다**(§7.2 요건 5)
- [ ] 실행 후 D'Flow 회의록 목록의 `updated_at`이 **전건 그대로**(“방금 수정됨” 안 뜸)
- [ ] `ACTOR_EMAIL` 검증이 배치 시작 전에 이뤄진다(§7.0)
- [ ] `pmo_admin`이 아닌 계정을 `ACTOR_EMAIL`로 주면 **`403 forbidden_role`로 1번 항목 전송 전에 중단**된다(§7.0 확정, D'Flow 게이트)
- [ ] **소프트 삭제된 회의는 `items` 생성 대상에서 자동 제외**된다(§7.2 요건 8 · `prod-survey` §3 고아 사례)
- [ ] **조상 규칙 적용** — 현재 위치가 목표 경로와 동일하면 `already_correct`, 미분류 또는 목표의 조상이면 `moved`, 그 외(형제·자손·무관)면 `skipped(manual_placement)`(§7.3, 정본 §2-J)

### 연결 초기화 대응(§7.6 · W14)

- [ ] D'Flow에서 초기화(또는 삭제)한 회의를 또박또박에서 열면 **“D'Flow에서 확인되지 않습니다(초기화 또는 삭제)”** 안내가 뜬다 — “연결 해제되었습니다”처럼 **원인을 초기화로 단정하지 않는다**(§7.6, 확정)<br>⚠️ **`dflow-W10`(연결 초기화, R3) 배포 전에는 이 트리거를 만들 수 없다** — §5가 `ddobak-W14`를 1차-b, 즉 R3보다 **먼저** 내보내기 때문이다. 그 구간에는 **바로 아래 보관(archive) 케이스로 검증한다**(같은 `exists_on_dflow: false` 값이라 화면 동작이 동일하다). 미검증으로 남기거나 이 항목 때문에 배포를 대기시키지 말 것
- [ ] D'Flow에서 **보관(archive)만** 한 회의는 위와 **구분되는** “보관됨” 안내로 잡힌다(`include_archived=true` 재조회로 `archived: true` 확인, §7.6 확정) — “초기화 또는 삭제” 문구와 섞이지 않는다
- [ ] 그 상태에서 [전송]이 확인 없이 바로 실행되지 않는다
- [ ] [D'Flow에서 찾기] → 해당 회의록 claim → 재연결 성공, 중복 생성 없음
- [ ] 안내에 **D'Flow 보관 해제 확인** 갈래가 함께 제시된다(보관분은 [D'Flow에서 찾기]·새로 전송 **둘 다 막힌다** — §7.6 ⚠️)

### 자동 링크(§7.7 · W15 · W16 · W17)

- [ ] `ACTOR_EMAIL` 없이 실행 → **즉시 실패**(기본값 추측 없음)
- [ ] D'Flow에 없는 `ACTOR_EMAIL` → **1번 항목 전송 전에** 중단(전건 403 아님)
- [ ] `rake dflow:autolink` (APPLY 없음) → **아무것도 링크하지 않고** 등급별(exact/likely/ambiguous/none) 집계 ＋ 등급 판정 전에 빠진 `already_linked` 건수만 출력
- [ ] D'Flow에서 초기화한 회의는 **기본 실행에서 재연결되지 않는다**(`RELINK_RESET` 없이는 대상 제외)
- [ ] `RELINK_RESET=1`일 때만 초기화분이 기존 public_uid로 재claim
- [ ] `public_uid`는 있는데 `dflow_synced_at`이 없고 **`exists_on_dflow: false`**인 회의(**전송 실패분·수동 연결분**)가 **대상 1로 잡혀 기본 실행에서 링크된다** — `RELINK_RESET` 불필요(§7.7 대상, 정정된 정의)
- [ ] **`dflow_synced_at`이 없지만 `exists_on_dflow: true`인 회의(실측 4건과 같은 조건)는 대상 1에 잡히지 않는다** — `already_linked` 게이트로 등급 판정 전에 빠지고, 다른 미연결 회의록에 오매칭되지 않는다(§7.7 대상 1 정정, `prod-survey` §4)
- [ ] `dflow_synced_at`이 없으면서 `exists_on_dflow: true`인 회의(수동 연결분·이전 실행 링크분)는 등급 판정 **전에** `already_linked`로 빠진다 — 다른 회의록을 claim해 기존 연결을 덮지 않는다
- [ ] **같은 rake를 두 번 돌려도 1회차가 링크한 건이 2회차 후보로 잡히지 않는다**(멱등)
- [ ] 대상 판정(초기화분·이미 연결된 건)이 회의별 `status` 호출이 아니라 `linked=true` 페이지 순회 **1회**로 이뤄진다
- [ ] 같은 (날짜·team)에 제목이 같은 D'Flow 회의록이 2건이면 → `ambiguous`, 자동 링크 **안 됨**
- [ ] team 판정 불가 회의(루트가 팀코드 아님) → 자동 링크 대상에서 제외
- [ ] 제목 정규화가 D'Flow `meetingBodyOf`와 동일 결과 (`물류공정_260716(수)` → `물류공정`)
- [ ] C1(수동 업로드분)은 접두 제거 **없이** 비교, C2(초기화분)는 `dflow_auto_title` 완전 일치로 비교
- [ ] `설비-L2 점검` 같은 하이픈 포함 제목이 잘리지 않는다
- [ ] `APPLY=1` 후 해당 회의가 **연결됨·미전송**(`dflow_synced_at` nil) 상태 — 그리고 그 상태의 건이 **다음 실행에서 `already_linked`로 빠진다**(§7.7 대상 1 게이트. 이 두 항목은 한 쌍으로 확인할 것)
- [ ] 이미 다른 external_id가 있는 회의록 대상 → 409 `link_conflict` 처리, 중단 없이 다음 건 진행
- [ ] `public_uid`가 이미 있는 회의는 **대상 1이든 대상 2든 기존 public_uid로 재claim**(새 uuid 발급 없음)
- [ ] **자동 링크된 회의의 `dflow_url`이 채워진다**(D'Flow 바로가기가 실제로 동작) — `DflowClient#link_minute` 직접 호출로 끝내면 nil이 된다(§7.7 ⚠️ 공용 서비스 추출). `dflow_synced_at`만 보는 기준으로는 이 결손이 잡히지 않는다
- [ ] 결과 JSON 파일이 남고 `dflow:autolink_rollback`으로 또박또박 측 해제가 된다
- [ ] (W17) 자동 링크된 회의의 전송 다이얼로그에 **덮어쓸 D'Flow 회의록 제목·날짜**가 표시된다
