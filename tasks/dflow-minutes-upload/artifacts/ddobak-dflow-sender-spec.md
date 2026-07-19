# 또박또박 → D'Flow 전송 기능 구현 스펙

- 버전: v1 (final draft, 2026-07-19)
- 대상 독자: 또박또박 개발측 (이 레포)
- **계약**: D'Flow API의 필드·에러·의미는 `dflow-minutes-upload-api-spec.md` §3~§7이 단일 출처다. 본 문서는 그 계약을 소비하는 또박또박 내부 구현만 다룬다. 인용된 파일:줄은 전부 이 레포 실코드 기준.

---

## 개발 기능 요약 (한눈에)

| # | 기능 | 내용 | 주요 신규 파일 |
|---|---|---|---|
| T1 | 전송 식별자 | `meetings.public_uid` (UUIDv7, 최초 전송 시 발급·불변) + `dflow_synced_at`·`dflow_url` | 마이그레이션 1 |
| T2 | 전송 기능 | **회의록 내보내기 메뉴 안** "D'Flow로 전송" — Rails가 export md를 D'Flow `POST /minutes`로 upsert | `DflowClient`, `DflowUploadService`, 컨트롤러, `SendToDflowDialog`, `ExportButton` 수정 |
| T3 | 설정·자동 판정 | D'Flow URL·시크릿(관리자, settings.yaml). team = **최상위 폴더명 자동**(meta.teams 대조), 제목 = `<하위폴더명>-<원제목>` 자동 조립 — **수동 매핑 없음** | `DflowSettingsPanel`, 설정 탭 |
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

폴더 매핑 컬럼은 **없다** — team·제목은 폴더 구조에서 자동 유도(§1.3·§1.4)라 저장할 매핑이 없음.

- `add_column`만 사용 — SQLite 테이블 재생성 없음(rename/FK/NOT NULL 아님 → CASCADE 함정 무관).
- ⚠️ **적용 절차**: 러닝 dev 서버가 있으면 마이그레이션 파일 추가만으로 전 요청 500(PendingMigrationError). 파일 추가 → `./dev.sh down` → `./dev.sh up`(기동 시 자동 backup+migrate, `dev.sh` `ensure_db()`) 순서로.

### 1.2 public_uid 규칙 (계약 §10.1과 동일 — 재요약)

- `SecureRandom.uuid_v7` (Ruby 4.0.2 표준, 확인 완료) 소문자 36자. `external_id = "ddobak:#{public_uid}"`.
- **발급 순서 불변 규칙**: uuid 생성 → `meeting.update!(public_uid:)` **커밋** → D'Flow 전송. 전송 실패해도 public_uid는 **유지**(재시도 시 같은 키 재사용 → upsert 안전). 코드상 이 순서를 바꾸는 리팩터링 금지 — `DflowUploadService`에 주석으로 근거 명시.
- 변경 경로는 T4의 명시적 수동 조작(입력/해제/재발급)뿐.

### 1.3 team 자동 판정 (최상위 폴더명)

- **체인 구성 (정확 규칙)**: `chain = ([meeting.folder] + meeting.folder.ancestor_records)` — `ancestor_records`(`folder.rb:38-48`)는 **자기 자신을 제외한** 조상만(근접→원거리) 반환하므로 반드시 자기 폴더를 앞에 붙인다. 기존 선례 그대로 (`meeting.rb:403`, `meetings_controller.rb:959`의 `[folder] + folder.ancestor_records` 패턴). `root = chain.last`(최상위), `sub = chain.length >= 2 ? chain[-2] : nil`(최상위 바로 아래).
- `root.name`을 D'Flow `GET /minutes/meta`의 `teams` 목록과 대조 — 일치하면 그 값이 team (예: 폴더 `MES/물류/…` → chain=[물류, MES] → root=MES → team `MES`. 폴더 `MDM` 직속 → chain=[MDM] → root=MDM → team `MDM`, sub 없음).
- **하드코딩 금지**: team 후보를 코드에 박지 말고 항상 meta.teams 기준으로 판정 (D'Flow에 팀이 추가되면 또박또박 무수정 추종 — 계약 §0 D9).
- 판정 실패 시(폴더 없음, 최상위 폴더명이 team이 아님 — 실데이터의 `임원 인터뷰`·`Master Plan 워크샵` 등): 전송 다이얼로그에서 사용자가 직접 선택(그 회의 1회용, 저장 안 함).
- 프로젝트명은 양 시스템 동일 전제 — v1 전송엔 미사용, v1.1 meeting 자동 연결 시 이름 매칭 키로 사용 예정.

### 1.4 전송 제목 규칙 (확정: `<하위폴더명>-<원제목>`)

```
sub   = §1.3의 chain[-2] — 최상위 바로 아래 폴더명 (3단계 이상이면 그 아래는 무시)
title = sub ? "#{sub.name}-#{meeting.title.strip}" : meeting.title.strip
```

- 예 (실데이터 검증): `물류공정_260716` @ `MES/물류` → `물류-물류공정_260716` / `기획팀 2026.07.09` @ `MES/APS/2026.07 1주차 인터뷰` → `APS-기획팀 2026.07.09` / `MDM 논의 2026.07.15` @ `MDM`(하위 없음) → 원제목 그대로.
- 하이픈(`-`) 결합 이유: D'Flow 회의체 파생은 `_`·공백 토큰화라 `물류-물류공정`이 한 토큰으로 유지되어 접두가 살아남고, 트리에서 같은 하위폴더 회의들이 이름순으로 나란히 정렬된다. 원제목이 살아 있으므로 2단계 폴더는 회의별로 생기는 것이 **의도된 동작**(사용자 확정 — 폴더 묶임보다 제목 가독성 우선).
- 전송 다이얼로그에서 제목 수정 가능(기본값 = 위 자동 조립).
- 200자 초과 시 원제목 쪽을 잘라 맞춘다.

### 1.5 재전송 필요 판정 (서버 계산, meeting JSON에 포함)

```ruby
def dflow_needs_resync?
  return false if public_uid.blank? || dflow_synced_at.blank?
  edited = [last_user_edit_at, active_summary&.updated_at].compact.max
  edited.present? && edited > dflow_synced_at
end
```

`notes_markdown` 변경 경로 중 `update_notes`·`feedback`·`reapply_glossary`·`apply_glossary_entry`(`meetings_controller.rb:687/512/558/577`)는 `last_user_edit_at` 또는 `summaries.updated_at`을 즉시 갱신하므로 **추가 훅 불필요**. 예외: `regenerate_notes`(`:485-497`)는 `summaries.destroy_all` 후 비동기 잡만 큐잉 — 잡이 새 final 요약을 저장하는 시점에 `summaries.updated_at`으로 반영되므로 **잡 완료 후에는 정확**하고, 재생성 진행 중 구간만 배지가 잠시 안 뜬다(허용 — 그 구간엔 보낼 확정 본문 자체가 없음). 추가 코드 불필요.

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
- 폴더 매핑 설정 없음(§1.3·§1.4 자동 규칙). team 값 검증은 서버 하드코딩 대신 **D'Flow meta.teams 대조** — upload/claim 시 payload의 team이 meta.teams에 없으면 D'Flow가 400으로 거부하므로 이중 검증 불필요(다이얼로그 선택지 자체를 meta에서 채움).

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
  2. team 판정 (§1.3: 최상위 폴더명 ∈ meta.teams, override 우선) → 판정 불가면 :team_required 에러 반환
     제목 조립 (§1.4: "<하위폴더명>-<원제목>", override 우선)
  3. body = MarkdownExporter.new(meeting, include_transcript: false).call   # markdown_exporter.rb — 반환은 순수 문자열
  4. body.length > 100_000 → :body_too_long 에러 반환 (전송 안 함, 자동 절단 금지 — 계약 §0 D2)
  5. public_uid 없으면: meeting.update!(public_uid: SecureRandom.uuid_v7)   # 커밋 후 전송 (§1.2)
     # 이미 있으면 그대로 재사용 — 재발급 절대 금지. D'Flow에 해당 레코드가 없어도(삭제·초기화·미도달)
     # 같은 external_id로 신규 생성됨(계약 §4.2 보장). "전송된 적 있는데 D'Flow에 없음"은 오류가 아니다.
  6. payload = { user_email: user.email, date: started_at KST YYYY-MM-DD, team:, title:,
                 body_markdown: body, external_id: "ddobak:#{public_uid}", on_conflict: "replace" }
  7. DflowClient.new.upload_minute(payload)
  8. 성공 → meeting.update!(dflow_synced_at: Time.current, dflow_url: resp["url"]) → 결과 반환
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
- 구성: enabled 토글, base_url 입력, api_secret 입력(마스킹 표시 `앞4…뒤4`, 빈칸 저장 시 미변경), **"연결 테스트"** 버튼(= `getDflowMeta()` 호출 → 성공 시 teams·projects 표시 / 401 "시크릿 불일치" / 404 "미개통 또는 URL 오류"). 폴더 매핑 UI 없음 — team·제목은 자동 규칙(§1.3·§1.4)이며, 규칙 안내 문구만 표시("최상위 폴더명이 구분(PMO/ERP/MES/가공/MDM)과 일치하면 자동 선택됩니다").
- 패턴 선례: `LlmSettingsPanel`(패널) + 저장 시 present만 갱신.

### 4.3 `SendToDflowDialog.tsx` (신규) — 전송 다이얼로그

`ExportMeetingDialog` 선례(별도 모달, `Dialog` 래퍼). 열릴 때 `getDflowStatus` 호출.

- **미리보기**: 전송 사용자 email, 대상 team(자동 판정 결과)·제목(§1.4 자동 조립, **수정 가능한 input**), 본문 길이/한도. team 자동 판정 실패 시(최상위 폴더명이 team 아님) meta.teams로 채운 select 노출.
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
| `spec/services/dflow_upload_service_spec.rb` | ① 최초 전송: uuid 발급→**커밋 후** 전송(전송 스텁이 DB의 public_uid 확인) ② **전송 실패해도 public_uid 유지** ③ 재전송: 같은 external_id·replace ④ 100k 초과 → 미전송 ⑤ team 판정: 최상위 폴더명 ∈ meta.teams / 불일치 시 :team_required / override 우선 ⑥ 제목 조립: `하위-원제목`, 하위 없음→원제목, 3단계 폴더→2단계 채택, 200자 절단, override ⑦ transcript 제외 export 사용 |
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

1. 마이그레이션(§1.1) + 모델(needs_resync, team 자동 판정 §1.3·제목 자동 조립 §1.4) + RSpec — **D'Flow 없이 진행 가능**
2. `DflowClient` + `DflowUploadService` + 컨트롤러/routes + RSpec(`instance_double(Net::HTTP)` 스텁 — 계약 문서 §4·§4b·§6의 응답 예시를 픽스처로 사용)
3. transfer 왕복 보존 + restorer 충돌 처리 + JSON export 필드 (T6)
4. 설정 API·패널, 전송 다이얼로그, 배지 (프런트)
5. D'Flow 배포 후: 계약 §14 스모크·E2E

1~4는 D'Flow 완성과 **완전 병행 가능** — 유일한 접점이 HTTP 계약이고, 계약 응답은 전부 WebMock 스텁으로 대체되기 때문. 이것이 "동시 개발 → 한 번에 통합"의 근거다.
