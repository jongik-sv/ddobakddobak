# 또박또박 → D'Flow 전송 기능 구현 스펙

- 버전: **v1.1 (2026-07-27 개정)** — §1.3 team 판정 완화 · §1.4 제목 접두 폐기 · **§1.6 `folder_path` 전송 신설**. 개정 근거: `ddobak-folder-path-worklist-2026-07-27.md` §3(계약 변경)·§4(W1~W7). v1 = final draft, 2026-07-19.
- 대상 독자: 또박또박 개발측 (이 레포)
- **계약**: D'Flow API의 필드·에러·의미는 `dflow-minutes-upload-api-spec.md` §3~§7이 단일 출처다. 본 문서는 그 계약을 소비하는 또박또박 내부 구현만 다룬다. 인용된 파일:줄은 전부 이 레포 실코드 기준.

---

## 개발 기능 요약 (한눈에)

| # | 기능 | 내용 | 주요 신규 파일 |
|---|---|---|---|
| T1 | 전송 식별자 | `meetings.public_uid` (UUIDv7, 최초 전송 시 발급·불변) + `dflow_synced_at`·`dflow_url` | 마이그레이션 1 |
| T2 | 전송 기능 | **회의록 내보내기 메뉴 안** "D'Flow로 전송" — Rails가 export md를 D'Flow `POST /minutes`로 upsert | `DflowClient`, `DflowUploadService`, 컨트롤러, `SendToDflowDialog`, `ExportButton` 수정 |
| T3 | 설정·자동 판정 | D'Flow URL·시크릿(관리자, settings.yaml). team = **최상위 폴더명 자동**(meta.teams 대조, 실패 시 다이얼로그에서 사용자 선택 — 전송 차단 아님), 제목 = **접두 없는 원제목**(v1.1), 폴더 체인은 `folder_path`로 동반 전송(§1.6) — **수동 매핑 없음** | `DflowSettingsPanel`, 설정 탭 |
| T4 | 연결 관리 | public_uid 보기/수동 입력/해제/재발급 + D'Flow 기존 레코드 검색·연결(claim) | 다이얼로그 내 연결 관리 섹션 |
| T5 | 상태 표시 | 회의 상세 배지(전송됨/재전송 필요), "D'Flow에서 보기" 링크 | `MeetingActionHeader` 수정 |
| T6 | export 호환 | 회의/폴더/프로젝트 export(tgz)·JSON export에 public_uid·매핑 포함, import 시 충돌 처리 | `meeting_restorer` 수정, `MeetingExportSerializer` 수정 |

범위 제외(v1): 자동 전송(회의 완료 시 자동 업로드 — v1.1 후보, 폴더 단위 opt-in으로), 첨부 전송, 전송 이력 테이블, **D'Flow 회의 연결(`meeting_id`)** — 계약상 선택 필드지만 또박또박 v1은 보내지 않는다(payload에 미포함, D'Flow 측은 nullable이라 무해. 연결이 필요하면 D'Flow UI에서 수동 지정).

---

## 1. 데이터 모델

### 1.1 마이그레이션 (1개 파일)

`backend/db/migrate/2026XXXXXXXXXX_add_dflow_fields.rb` (파일명 타임스탬프·`add_column`+`add_index` 페어 관례 — `20260718000002_add_llm_profile_refs_to_users.rb` 스타일):

```ruby
class AddDflowFields < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :public_uid, :string          # UUIDv7, 최초 D'Flow 전송 시 발급
    add_column :meetings, :dflow_synced_at, :datetime   # 마지막 전송 성공 시각
    add_column :meetings, :dflow_url, :string           # 전송 응답의 상세 페이지 링크
    add_index  :meetings, :public_uid, unique: true     # SQLite 부분 인덱스 불필요 — NULL 중복 허용됨
  end
end
```

폴더 매핑 컬럼은 **없다** — team·`folder_path`는 전송 때마다 폴더 구조에서 유도하고(§1.3·§1.6), 제목은 원제목 그대로(§1.4)라 저장할 매핑이 없음.

- `add_column`만 사용 — SQLite 테이블 재생성 없음(rename/FK/NOT NULL 아님 → CASCADE 함정 무관).
- ⚠️ **적용 절차**: 러닝 dev 서버가 있으면 마이그레이션 파일 추가만으로 전 요청 500(PendingMigrationError). 파일 추가 → `./dev.sh down` → `./dev.sh up`(기동 시 자동 backup+migrate, `dev.sh` `ensure_db()`) 순서로.

### 1.2 public_uid 규칙 (계약 §10.1과 동일 — 재요약)

- `SecureRandom.uuid_v7` (Ruby 4.0.2 표준, 확인 완료) 소문자 36자. `external_id = "ddobak:#{public_uid}"`.
- **발급 순서 불변 규칙**: uuid 생성 → `meeting.update!(public_uid:)` **커밋** → D'Flow 전송. 전송 실패해도 public_uid는 **유지**(재시도 시 같은 키 재사용 → upsert 안전). 코드상 이 순서를 바꾸는 리팩터링 금지 — `DflowUploadService`에 주석으로 근거 명시.
- 변경 경로는 T4의 명시적 수동 조작(입력/해제/재발급)뿐.

### 1.3 team 자동 판정 (최상위 폴더명) — **v1.1 개정: 판정 실패는 전송 차단이 아니다**

- **체인 구성 (정확 규칙)**: `chain = ([meeting.folder] + meeting.folder.ancestor_records)` — `ancestor_records`(`folder.rb:38-48`)는 **자기 자신을 제외한** 조상만(근접→원거리) 반환하므로 반드시 자기 폴더를 앞에 붙인다. 기존 선례 그대로 (`meeting.rb:403`, `meetings_controller.rb:959`의 `[folder] + folder.ancestor_records` 패턴). `root = chain.last`(최상위), `sub = chain.length >= 2 ? chain[-2] : nil`(최상위 바로 아래).
- `root.name`을 D'Flow `GET /minutes/meta`의 `teams` 목록과 대조 — 일치하면 그 값이 team (예: 폴더 `MES/물류/…` → chain=[물류, MES] → root=MES → team `MES`. 폴더 `MDM` 직속 → chain=[MDM] → root=MDM → team `MDM`, sub 없음).
- **하드코딩 금지**: team 후보를 코드에 박지 말고 항상 meta.teams 기준으로 판정 (D'Flow에 팀이 추가되면 또박또박 무수정 추종 — 계약 §0 D9).
- **판정 실패는 전송을 막지 않는다 (v1.1 개정 — 워크리스트 §4 W3 · 결정 D4)**: 최상위 폴더명이 meta.teams에 없어도(폴더 없음 포함 — 실데이터의 `임원 인터뷰`·`Master Plan 워크샵` 등) 전송은 계속된다. 다이얼로그가 meta.teams로 채운 select를 노출하고, 사용자가 고른 값이 `team_override`로 실려 `resolve_team!` 본체를 건너뛴다(`dflow_upload_service.rb:75-76` — override가 있으면 meta 조회 없이 즉시 채택. 그 회의 1회용, 저장 안 함).
  - `TeamRequiredError`는 "**판정 불가 → 선택 필요**" 신호이지 "전송 불가"가 아니다. override 없이 서비스에 도달했을 때만 던진다. UI 문구도 이 톤으로 (워크리스트 W7).
  - → **또박또박 폴더 구조는 자유다.** 루트명이 팀코드일 필요도, 깊이 제약도 없다. 남는 제약은 D'Flow의 물리 한계 2개(폴더명 60자·깊이 5단, §1.6)뿐.
- **루트가 팀코드가 아닐 때 D'Flow가 하는 일 (편철 규칙 — 워크리스트 §3.2)**: `folder_path[0]`을 team과 대조해
  ① `== team` → 그대로 편철 / ② **팀코드가 아님** → `[team, ...folder_path]`로 **한 칸 내려** 편철(team=MES 선택 + 루트 `신규TF` → `MES/신규TF/…`) / ③ **다른 팀코드** → **400 거절**.
  - ⚠️ ③은 다이얼로그가 team select를 노출하는 순간 가능해지는 조합이다(루트 `ERP/…` 회의를 team `MES`로 전송). 사용자가 원인을 알 수 있게 D'Flow 400 메시지를 삼키지 말 것.
- 프로젝트명은 양 시스템 동일 전제 — 전송엔 미사용, meeting 자동 연결(워크리스트 §7.7) 시 이름 매칭 키로 사용 예정.

### 1.4 전송 제목 규칙 — **v1.1 개정: 접두 폐기, 접두 없는 원제목**

```
title = meeting.title.strip[0, 200]     # 접두 없음
```

- **`<하위폴더명>-<원제목>` 접두 규칙은 폐기됐다 (결정 D2).** 접두는 "D'Flow에 실폴더가 없으니 계층을 제목으로 흉내낸다"는 전제 위의 우회책이었고, D'Flow가 0040/0043으로 **실폴더를 도입**해 그 전제가 소멸했다. `folder_path`(§1.6)를 함께 보내는 지금은 계층이 폴더로 표현되므로 제목에 라벨을 중복시키지 않는다(`영업-주간회의` 같은 이중 라벨 제거).
- **200자 캡은 유지**하되 이제 **원제목에 그대로** 적용된다 — 접두 자리를 남기는 길이 계산이 사라진다.
- 전송 다이얼로그에서 제목 수정 가능(기본값 = 접두 없는 원제목).

⚠️ **실효 지점은 백엔드 `dflow_auto_title`이 아니라 프런트 `buildDflowTitle`이다.**
UI 전송 경로의 title은 **항상 프런트가 만든 값**이 `title_override`로 실려 백엔드 자동 조립을 이긴다:
`SendToDflowDialog.tsx:65`(초기값 = `buildDflowTitle(folder_path, title)`) → `:126`(전송 시 `titleOverride: title` **무조건** 포함) → `api/dflow.ts:47`(`titleOverride` → `body.title`) → `meeting_dflow_controller.rb:31`(`title_override`) → **`dflow_upload_service.rb:33`**(`title = @title_override || @meeting.dflow_auto_title`). 전송 호출부는 이 다이얼로그 **1곳뿐**이다.
→ 접두를 실제로 없애는 것은 **`buildDflowTitle`(워크리스트 W6)**이고, `dflow_auto_title`(W2)만 고치면 **UI 제목은 하나도 안 바뀐다**. 두 작업은 같은 배포 차수에 함께 낸다(워크리스트 §5).

⚠️ **접두 조립 규칙과 헬퍼는 지우지 않는다 — legacy 제목 재생성용으로 보존한다.**
`dflow_sub_folder_name`(`meeting.rb`)·`dflowSubFolderName`(`dflowAutoAssign.ts`)와 접두 조립 경로를 삭제하면 자동 링크(워크리스트 §7.7 **C2**)가 구현 불가가 된다 — W2 이전 전송분의 D'Flow 제목은 접두를 **포함**하므로, 매칭 시 접두 **포함·미포함 두 변형을 모두 생성**해 대조해야 한다. 기본 경로에서 접두를 쓰지 않을 뿐이다.

⚠️ **기존 전송분의 D'Flow 제목은 소급 수정하지 않는다** (워크리스트 §7.5). 제목 변경은 D'Flow에서 **위키 재빌드를 유발**하고 `minute_versions` 히스토리를 오염시킨다. 이중 라벨은 남는다 — 폴더 마이그레이션 안정화 후 별건으로 판단.

### 1.5 재전송 필요 판정 (서버 계산, meeting JSON에 포함)

```ruby
def dflow_needs_resync?
  return false if public_uid.blank? || dflow_synced_at.blank?
  edited = [last_user_edit_at, active_summary&.updated_at].compact.max
  edited.present? && edited > dflow_synced_at
end
```

`notes_markdown` 변경 경로 중 `update_notes`·`feedback`·`reapply_glossary`·`apply_glossary_entry`(`meetings_controller.rb:687/512/558/577`)는 `last_user_edit_at` 또는 `summaries.updated_at`을 즉시 갱신하므로 **추가 훅 불필요**. 예외: `regenerate_notes`(`:485-497`)는 `summaries.destroy_all` 후 비동기 잡만 큐잉 — 잡이 새 final 요약을 저장하는 시점에 `summaries.updated_at`으로 반영되므로 **잡 완료 후에는 정확**하고, 재생성 진행 중 구간만 배지가 잠시 안 뜬다(허용 — 그 구간엔 보낼 확정 본문 자체가 없음). 추가 코드 불필요.

### 1.6 `folder_path` 전송 — **v1.1 신설**

폴더 체인을 페이로드에 함께 실어 D'Flow가 **실폴더로 편철**하게 한다(워크리스트 §3.1 · W1).

```jsonc
"folder_path": ["MES", "품질", "주간정례"]   // root-first
```

- **순서는 root-first다. ⚠️ 모델 체인은 leaf-first다.** `Meeting#dflow_folder_chain`(`meeting.rb:601-605`)은 `[folder] + folder.ancestor_records` = **leaf-first**(그래서 §1.3의 루트 도출이 `chain.last`, 하위가 `chain[-2]`인 것은 그대로 유효). 전송 시에는 **반드시 뒤집는다**: `@meeting.dflow_folder_chain.reverse.map(&:name)`. API 직렬화 `folder_path`(`meeting_serializable.rb:73`)와 프런트 `dflowAutoAssign.ts`는 이미 root-first라 그대로 쓴다. 순서를 틀리면 **모든 회의록이 조용히 엉뚱한 폴더로 들어간다** — spec으로 고정할 것(§5.1).
- **3값 규약 (요청 전용 — 워크리스트 §3.4)**: "폴더 없음"을 *표현할 수 있어야* 폴더 밖으로 뺀 조작이 D'Flow로 전파된다.

| 값 | 의미 | D'Flow 신규 | D'Flow `replace` |
|---|---|---|---|
| **키 부재** | 폴더 정보 미제공(구버전 또박또박) | 팀 루트 폴백 | **기존 위치 유지**(건드리지 않음) |
| **`[]`** | 명시적 "폴더 없음" | 팀 루트 | **팀 루트로 되돌림** |
| **`["A","B"]`** | 그 경로 | 경로대로 편철 | 경로대로 **이동** |

  → 또박또박 신버전은 **항상 이 키를 보낸다**(폴더 없으면 `[]`, **키 생략 아님**). 키 부재는 구버전 호환 전용 값이다.
  → ⚠️ **요청 값 집합은 위 3종뿐이며 `null`은 없다.** union을 넓히면 이 규약이 없애려던 모호함이 되돌아온다. `[]`를 "미전송과 동일"로 뭉개면 **폴더에서 빼는 조작만 영영 전파되지 않는다.**
- **응답 에코는 요청 규약과 별개다.** 응답의 `folder_id`·`folder_path`가 절단·"한 칸 내림"이 반영된 **실제 결과**를 알려준다. 둘 다 **nullable** — 정규화된 시드 팀 루트가 D'Flow에 없으면(원인은 거의 항상 0043 미적용) 등록은 되고 편철만 실패한다. 프런트 타입을 `string[]`로 고정하면 런타임에서 깨진다(워크리스트 W9).
  - **미분류 판정은 `folder_path`가 아니라 `folder_id == null`로 한다** — 응답 쪽 미분류 표현값(`null` vs `[]`)은 D'Flow 확정 대기지만 `folder_id: null`은 확정이다.
  - 그때 문구는 **"미분류로 들어갔습니다(D'Flow에서 편철 필요)"**. **"팀 루트에 편철됨"이라고 쓰면 정반대 안내**다(`[]` = 팀 루트 편철 **성공**, 미분류 = 어느 폴더에도 안 들어감).
- **D'Flow 물리 한계 2개** (워크리스트 §3.2):
  - 폴더명 **60자**(또박또박은 100자) — 61자 이상이 체인에 있으면 D'Flow가 **400 거절**. **전송 전에 어느 폴더인지 이름을 담아** 차단한다(W4·W5). D'Flow 400을 그대로 노출하면 원인 파악이 불가능하다.
  - 깊이 **5단**(팀 루트 포함) — 초과분은 D'Flow가 절단. 응답 에코로 실제 결과를 보여준다.
- ⚠️ **계약 사본에는 아직 `folder_path`가 0건이다.** 본 문서 머리말이 `dflow-minutes-upload-api-spec.md`를 단일 출처로 선언하지만, 그 사본 동기화는 **W18**(정본 개정 = `dflow-W8` 이후, 동기화 방향 wbs-web → 또박또박)이다. 그때까지 "사본에 없으니 틀렸다"는 이유로 이 절을 되돌리지 말 것.

---

## 2. 설정 저장 (관리자)

`settings.yaml`에 `dflow:` 섹션 (전역 서버 설정 — `AppSettings.load`, `backend/app/services/app_settings.rb:24` 경유):

```yaml
dflow:
  enabled: true
  base_url: "https://wbs-web.vercel.app"   # /api/v1 은 클라이언트가 붙임
  api_secret: "<MINUTES_API_SECRET>"        # LLM auth_token과 동일하게 평문 YAML (파일 보호 의존)
```

- 설정 API: `settings_controller`에 `dflow`(GET)/`update_dflow`(PUT) 액션 추가. **`require_admin!`** (`settings_controller.rb:9`의 `update_llm` 관례 동일).
- 응답 마스킹: `TokenMasking#mask_token` (`backend/app/controllers/concerns/token_masking.rb` — 앞4…뒤4). 원문은 `except`로 제외하고 `api_secret_masked`만 반환, 저장은 "present일 때만 갱신"(마스킹 값 재전송 방지, `settings_controller.rb:139` 관례).
- 폴더 매핑 설정 없음(§1.3·§1.6 자동 규칙). team 값 검증은 서버 하드코딩 대신 **D'Flow meta.teams 대조** — upload/claim 시 payload의 team이 meta.teams에 없으면 D'Flow가 400으로 거부하므로 이중 검증 불필요(다이얼로그 선택지 자체를 meta에서 채움). ⚠️ **단 team이 meta에 있어도 400이 날 수 있다** — `folder_path[0]`이 *다른* 팀코드면 D'Flow가 거절한다(§1.3 ③). "meta에 있으니 안전"으로 읽고 에러 노출을 생략하지 말 것.

---

## 3. 백엔드 구현 (파일 단위)

### 3.1 `backend/app/services/dflow_client.rb` — HTTP 클라이언트 (신규)

`SidecarClient` 패턴 복제 (`backend/app/services/sidecar_client.rb:5-9, 147-165` — 전용 에러 계층 + `with_connection` + 공통 응답 파싱):

```ruby
class DflowClient
  class Error < StandardError; end
  class ConnectionError < Error; end          # ECONNREFUSED/EHOSTUNREACH/SocketError
  class TimeoutError < Error; end             # Net::OpenTimeout/ReadTimeout
  class AuthError < Error; end                # 401 (시크릿 불일치) / 404 (미개통 — env 미설정)
  class UnknownUserError < Error; end         # 403 code=unknown_user
  class LinkConflictError < Error; end        # 409 code=link_conflict
  class ApiError < Error                      # 그 외 4xx/5xx — code·status 보존
    attr_reader :code, :status
  end

  # open_timeout 5s / read_timeout 20s (Vercel cold start 감안)
  def upload_minute(payload)       # POST /api/v1/minutes        → Hash(계약 §4.3)
  def list_minutes(params = {})    # GET  /api/v1/minutes        → Hash(계약 §5.1)
  def meta(project_id: nil)        # GET  /api/v1/minutes/meta   → Hash(계약 §5.2)
  def link_minute(minute_id:, external_id:, user_email:)  # POST /api/v1/minutes/link (계약 §4b)
end
```

- 헤더: `Authorization: Bearer <api_secret>`, `Content-Type: application/json`.
- 응답 처리: 2xx → JSON.parse. 그 외 → body의 `code` 필드로 위 도메인 에러 매핑(에러 메시지에 **시크릿 절대 포함 금지**).
- **404 처리 주의**: D'Flow는 env 미개통 시 모든 경로가 404다(계약 §3.2). 404를 "미개통 또는 URL 오류"로 안내(AuthError 계열).

### 3.2 `backend/app/services/dflow_upload_service.rb` — 전송 오케스트레이션 (신규)

```
call(meeting, user, team_override: nil, title_override: nil)
  1. 전제 검증: dflow.enabled, meeting.status == "completed", current_notes_markdown.present?
  2. team 판정 (§1.3: override 우선, 없으면 최상위 폴더명 ∈ meta.teams) → 둘 다 없을 때만 :team_required
     (= "다이얼로그에서 선택 필요" 신호. **전송 불가가 아니다** — override가 오면 자유 루트도 전송 성공)
     제목 (§1.4: override 우선, 없으면 **접두 없는** 원제목 200자 캡)
     폴더명 길이 사전 검사 (§1.6: 체인에 61자 이상 폴더명이 있으면 **그 이름을 담아** 전용 에러로 중단)
  3. body = MarkdownExporter.new(meeting, include_transcript: false).call   # markdown_exporter.rb — 반환은 순수 문자열
  4. body.length > 100_000 → :body_too_long 에러 반환 (전송 안 함, 자동 절단 금지 — 계약 §0 D2)
  5. public_uid 없으면: meeting.update!(public_uid: SecureRandom.uuid_v7)   # 커밋 후 전송 (§1.2)
     # 이미 있으면 그대로 재사용 — 재발급 절대 금지. D'Flow에 해당 레코드가 없어도(삭제·초기화·미도달)
     # 같은 external_id로 신규 생성됨(계약 §4.2 보장). "전송된 적 있는데 D'Flow에 없음"은 오류가 아니다.
  6. payload = { user_email: user.email, date: started_at KST YYYY-MM-DD, team:, title:,
                 folder_path: meeting.dflow_folder_chain.reverse.map(&:name),   # root-first, 폴더 없으면 [] (§1.6)
                 body_markdown: body, external_id: "ddobak:#{public_uid}", on_conflict: "replace" }
  7. DflowClient.new.upload_minute(payload)
  8. 성공 → meeting.update!(dflow_synced_at: Time.current, dflow_url: resp["url"]) → 결과 반환
     # 응답의 folder_id·folder_path(둘 다 nullable)는 그대로 반환해 다이얼로그가 편철 결과를 에코 표시(§1.6)
```

- 동기 실행(사용자가 다이얼로그에서 대기). 백그라운드 잡·자동 재시도는 v1 제외 — 실패는 다이얼로그에 표시하고 사용자가 재클릭(멱등이라 안전).

### 3.3 `backend/app/controllers/api/v1/meeting_dflow_controller.rb` (신규) + routes

```ruby
# routes.rb — meetings member 블록에.
# ⚠️ `post :upload`처럼 심볼만 쓰면 경로가 /meetings/:id/upload 가 됨 (기존 :start 라우트로 확인) —
#    dflow/ 프리픽스를 원하므로 반드시 문자열 경로로 선언:
member do
  post "dflow/upload", to: "meeting_dflow#upload"   # POST /meetings/:id/dflow/upload
  get  "dflow/status", to: "meeting_dflow#status"   # GET  /meetings/:id/dflow/status (D'Flow 실존재 확인 포함)
  put  "dflow/link",   to: "meeting_dflow#link"     # PUT  /meetings/:id/dflow/link { public_uid: "..." | null }
  post "dflow/claim",  to: "meeting_dflow#claim"    # POST /meetings/:id/dflow/claim { minute_id: "<dflow uuid>" }
end
# 네임스페이스 직하: get "dflow/minutes" / "dflow/meta" — D'Flow 조회 프록시 (시크릿을 프런트에 안 보내기 위함)
```

| 액션 | 동작 |
|---|---|
| `upload` | `DflowUploadService.call(meeting, current_user, ...)`. 권한: `meeting.editable_by?(current_user)` (`meeting_transfers_controller.rb:18` 선례) |
| `status` | `{ public_uid, dflow_synced_at, dflow_url, needs_resync }` + (연결 시) `DflowClient#list_minutes(external_id:)`로 실존재 확인 결과 `exists_on_dflow` (계약 §10.2 원칙: 로컬 값만 믿지 않음) |
| `link` | 수동 입력/해제. 입력값 UUID 정규식 검증 → `public_uid` 갱신. 다른 회의가 이미 사용 중이면 422. null이면 해제(+`dflow_synced_at`·`dflow_url`도 null) |
| `claim` | B 시나리오(계약 §10.2): public_uid 없으면 발급·커밋 → `DflowClient#link_minute(minute_id:, external_id:, user_email: current_user.email)` → 성공 시 `dflow_url` 갱신 |
| 프록시 2종 | `dflow/minutes`(파라미터 passthrough: `date_from/date_to/team/linked/page`), `dflow/meta`. 인증: 로그인 사용자면 허용 |

에러 매핑 (전 액션 공통 rescue): `UnknownUserError`→422 `{error: "D'Flow에 동일 이메일(<email>) 계정이 없습니다...", code: "dflow_unknown_user"}` / `LinkConflictError`→409 / `AuthError`→502 "D'Flow 인증 실패 — 관리자에게 시크릿 확인 요청" / `ConnectionError`·`TimeoutError`→502 / `ApiError`→502 (원 code 보존).

### 3.4 export/import에 public_uid 포함 (T6 — 사용자 요구)

**자동 포함 확인 (작업 불필요, 테스트만)**:
- 회의 tgz export: `Transfer::MeetingSerializer`가 `@meeting.attributes` 전 컬럼 직렬화 (`transfer/meeting_serializer.rb:23`) → 컬럼 추가만으로 `public_uid`·`dflow_synced_at`·`dflow_url` 자동 포함.
- 폴더·프로젝트 export: 동일 구조(exporter가 meeting_serializer 재사용) → 자동. (매핑 컬럼은 없으므로 폴더 쪽 추가 대상 없음 — team·제목이 폴더명에서 유도되므로 폴더 구조 자체가 export되면 충분)
- import 복원: `Transfer::Archive`가 `attrs.slice(*model_class.column_names).except("id","created_at","updated_at")` (`transfer/archive.rb:98`) → 신규 컬럼 자동 복원.

**필수 추가 작업 2건**:
1. `transfer/meeting_restorer.rb`: `public_uid` **unique 충돌 처리** — 복원 대상 uid가 로컬에 이미 존재(같은 아카이브 중복 import, 복사 목적 import)하면 `RecordNotUnique`로 전체 실패한다. 규칙: **충돌 시 `public_uid`·`dflow_synced_at`·`dflow_url`을 null로 복원**하고 결과에 경고 1줄 포함("D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정"). 사전 존재 검사(`Meeting.exists?(public_uid:)`) 방식으로 구현(예외 잡기보다 명시적).
   - **서버 이동 시나리오 (보장)**: 다른 또박또박 서버로 이동한 경우 그 서버엔 해당 uid가 없으므로 **그대로 보존**되고, 이동한 서버에서의 재전송이 같은 `external_id`로 D'Flow 기존 레코드를 갱신한다 — D'Flow는 발신 서버를 검증하지 않는다(계약 §4.6 보장, E2E E5). import 후 추가 조치 불필요.
2. `MeetingExportSerializer` (JSON export, `backend/app/services/meeting_export_serializer.rb`): 명시 필드 방식이므로 `public_uid` 키 추가.

**결정**: `MarkdownExporter`(md export)에는 uid를 넣지 않는다 — md는 D'Flow 본문으로 들어가므로 식별자가 사용자 노출 텍스트를 오염시킴. 식별자 운반은 tgz·JSON의 몫.

### 3.5 meetings#show JSON 확장

기존 회의 상세 serializer에 `public_uid, dflow_synced_at, dflow_url, dflow_needs_resync` 4필드 추가 (배지·다이얼로그 초기 상태용 — `status` 액션 재호출 없이 렌더).

---

## 4. 프런트 구현 (파일 단위)

관례 (조사 확인): ky `apiClient`(자동 인증 헤더·401 재발급, `frontend/src/api/client.ts`), react-query 미사용 — 로컬 `useState`(loading/error/success), 동기 액션 에러는 인라인 텍스트, `window.confirm` 금지 → `confirmDialog` 헬퍼(`frontend/src/lib/confirmDialog.ts:10-19`), 공용 `Dialog`(`components/ui/Dialog.tsx`), 한국어 하드코딩(i18n 없음).

### 4.1 `frontend/src/api/dflow.ts` (신규)

`uploadToDflow(meetingId, {teamOverride?, titleOverride?})` / `getDflowStatus(meetingId)` / `setDflowLink(meetingId, publicUid|null)` / `claimDflowMinute(meetingId, dflowMinuteId)` / `listDflowMinutes(params)` / `getDflowMeta()` / `getDflowSettings()` / `updateDflowSettings(...)` — 전부 `apiClient.<method>(...).json()`.

### 4.2 설정 탭 — `SettingsContent.tsx` `TABS` 배열에 `'dflow'`("연동") 추가 + `DflowSettingsPanel.tsx` (신규)

- 노출 조건: `showAdminSettings` (admin 또는 로컬 모드 — LLM 탭과 동일).
- 구성: enabled 토글, base_url 입력, api_secret 입력(마스킹 표시 `앞4…뒤4`, 빈칸 저장 시 미변경), **"연결 테스트"** 버튼(= `getDflowMeta()` 호출 → 성공 시 teams·projects 표시 / 401 "시크릿 불일치" / 404 "미개통 또는 URL 오류"). 폴더 매핑 UI 없음 — team·`folder_path`는 폴더 구조에서 자동 유도(§1.3·§1.6)이며, 규칙 안내 문구만 표시("최상위 폴더명이 구분(PMO/ERP/MES/가공/MDM)과 일치하면 자동 선택되고, 일치하지 않으면 전송 시 직접 선택합니다 — 폴더 구조 자체에는 제약이 없습니다").
- 패턴 선례: `LlmSettingsPanel`(패널) + 저장 시 present만 갱신.

### 4.3 `SendToDflowDialog.tsx` (신규) — 전송 다이얼로그

`ExportMeetingDialog` 선례(별도 모달, `Dialog` 래퍼). 열릴 때 `getDflowStatus` 호출.

- **미리보기**: 전송 사용자 email, **편철 경로**(`MES / 품질 / 주간정례` 형태 — 루트가 팀코드가 아니면 선택한 team이 앞에 붙는 모습 `MES / 신규TF / 킥오프`를 그대로 보여줄 것, §1.3 ②), 제목(§1.4 **접두 없는 원제목**, **수정 가능한 input**), 본문 길이/한도. team 자동 판정 실패 시 meta.teams로 채운 select 노출 — 문구는 "판정 불가 → 선택" 톤(전송 차단이 아니다).
- **전송 성공 후**: 응답의 `folder_path`를 표시해 절단·"한 칸 내림"을 사용자가 인지하게 한다. `folder_id == null`이면 **"미분류로 들어갔습니다(D'Flow에서 편철 필요)"** — **"팀 루트"라고 쓰지 않는다**(§1.6).
- **전송 버튼**: 로딩 → 성공 시 "전송됨 · D'Flow에서 보기(dflow_url 링크)" / 실패 인라인 표시. `dflow_unknown_user`(422)는 안내문 고정: "D'Flow에 동일 이메일 계정이 필요합니다. D'Flow 관리자에게 계정 생성을 요청하세요."
- 길이 초과: 전송 버튼 비활성 + "본문이 100,000자를 넘습니다. (전사 원문은 전송에서 제외됨)" — 자동 절단 없음.
- **연결 관리(접힘 섹션)**: public_uid 표시·복사, `exists_on_dflow` 상태, [수동 입력](UUID 정규식 검증 + 존재 확인, 미존재 시 경고 후 저장 허용 — 계약 §10.2 C), [해제]/[재발급](`confirmDialog` — "다음 전송 시 D'Flow에 새 회의록이 생성되고 기존 것은 남습니다. 계속할까요?"), [D'Flow에서 찾기] → 하위 목록 뷰: 기간·구분 필터 + "미연결만"(`linked=false`) 토글 → 행 선택 시 자동 분기: 후보에 `ddobak:` external_id 있으면 역주입(A), null이면 claim(B).

### 4.4 회의 상세 노출

- **진입점: 회의록 내보내기(`ExportButton.tsx`) 드롭다운 패널 하단** (사용자 확정) — 기존 포맷 선택(md/pdf/docx/prompt)·다운로드 구획 아래에 구분선 + "D'Flow로 전송" 항목 추가 → `SendToDflowDialog` 오픈. 항목 노출 조건: `meeting.status === 'completed'` && dflow 설정 enabled (미충족 시 항목 자체 숨김). `MeetingActions.tsx`는 수정 불필요 — ExportButton 내부만 변경.
- **패널 폭 확대** (사용자 확정): 현재 `w-64` (ExportButton.tsx 패널 클래스) → D'Flow 구획·상태 텍스트가 들어가므로 `w-80`(320px)으로 확대. 기존 포맷 버튼 그룹·체크박스 레이아웃이 넓어진 폭에서 어색하지 않은지 구현 시 확인.
- 전송 상태 요약(전송됨/재전송 필요)도 이 항목 옆에 작은 텍스트로 표시 가능(선택).
- 배지: `MeetingActionHeader.tsx:93-128` 배지 열에 pill 추가 — `dflow_synced_at && !needs_resync` → "D'Flow ✓" / `needs_resync` → "D'Flow 재전송 필요" (수정됨) / 미전송이면 배지 없음.

---

## 5. 검증

### 5.1 백엔드 (RSpec — `backend/spec/` 관례. HTTP 스텁은 **`instance_double(Net::HTTP)` 목킹** — `spec/services/sidecar_client_spec.rb:5-12` 관례 그대로. WebMock은 이 레포에 없음(Gemfile 미포함) — 도입하지 말 것)

| spec | 필수 케이스 |
|---|---|
| `spec/services/dflow_client_spec.rb` | 2xx 파싱 / 401→AuthError / 403 unknown_user→UnknownUserError / 409 link_conflict→LinkConflictError / 타임아웃·연결거부 / 에러 메시지에 시크릿 미포함 |
| `spec/services/dflow_upload_service_spec.rb` | ① 최초 전송: uuid 발급→**커밋 후** 전송(전송 스텁이 DB의 public_uid 확인) ② **전송 실패해도 public_uid 유지** ③ 재전송: 같은 external_id·replace ④ 100k 초과 → 미전송 ⑤ team 판정: 최상위 폴더명 ∈ meta.teams / **불일치·폴더 없음이어도 override가 있으면 전송 성공**(meta 조회 없이 채택) · override 없을 때만 :team_required ⑥ 제목: **접두 없는 원제목**, 200자 절단, override 우선 ＋ **legacy 접두 변형 재생성이 여전히 동작**(`dflow_sub_folder_name` 기반 `<하위>-<원제목>` — §7.7 C2 자동 링크의 전제. §1.4 ⚠️) ⑦ transcript 제외 export 사용 ⑧ **`folder_path`: root-first(`.reverse` 순서 고정), 폴더 없으면 `[]`(키 생략 아님), 체인에 61자 이상 폴더명이면 전송 전 중단** |
| `spec/requests/meeting_dflow_spec.rb` | upload/status/link/claim/프록시 — 권한(editable_by), link의 UUID 검증·중복 422, claim의 409 전파 |
| `spec/services/transfer/meeting_restorer_spec.rb` (추가) | **public_uid 포함 export→import 왕복 보존** / 로컬에 동일 uid 존재 시 null 복원+경고 (T6) |
| `spec/requests/settings_dflow_spec.rb` | admin 전용, 마스킹 응답, present만 갱신 |

### 5.2 프런트

- `vite build` + `tsc -p tsconfig.app.json` (신규 오류 0 — 기준선 ~24 유지).
- 수동 확인: 설정 탭 연결 테스트, 전송 다이얼로그 미리보기·전송, 배지 전이(전송→편집→재전송 필요→재전송→✓), 연결 관리 A/B/C/D 시나리오, Tauri에서 재발급 confirm 동작(confirmDialog 경유).

### 5.3 통합

계약 문서 §14의 적용 순서·curl 스모크·E2E 5종을 그대로 따른다. 또박또박 측 완료 선언 전 체크리스트는 §14.4.

---

## 6. 작업 순서 (권장)

1. 마이그레이션(§1.1) + 모델(needs_resync, team 자동 판정 §1.3 · 제목 규칙 §1.4 · `folder_path` 조립 §1.6) + RSpec — **D'Flow 없이 진행 가능**
2. `DflowClient` + `DflowUploadService` + 컨트롤러/routes + RSpec(`instance_double(Net::HTTP)` 스텁 — 계약 문서 §4·§4b·§6의 응답 예시를 픽스처로 사용)
3. transfer 왕복 보존 + restorer 충돌 처리 + JSON export 필드 (T6)
4. 설정 API·패널, 전송 다이얼로그, 배지 (프런트)
5. D'Flow 배포 후: 계약 §14 스모크·E2E

1~4는 D'Flow 완성과 **완전 병행 가능** — 유일한 접점이 HTTP 계약이고, 계약 응답은 전부 WebMock 스텁으로 대체되기 때문. 이것이 "동시 개발 → 한 번에 통합"의 근거다.
