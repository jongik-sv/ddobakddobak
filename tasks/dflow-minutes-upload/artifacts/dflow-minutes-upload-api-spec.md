# D'Flow 회의록 업로드 API 스펙 (또박또박 연동용)

- 버전: v2.1 (final draft, 2026-07-19) — **wbs-web 레포 코드 직접 조사 후 전면 개정 + 전 미결사항 확정**
- 작성 목적: 또박또박(로컬 회의 녹음·전사·회의록 앱)이 생성한 회의록 마크다운을 D'Flow(https://wbs-web.vercel.app) 회의록 화면에 **자동 등록**할 수 있도록, 양측이 **동시에 개발해 한 번에 통합**할 수 있는 완결 사양을 정의한다.
- 대상 독자: D'Flow 개발팀(팀장) + 또박또박 개발측
- 근거: wbs-web 레포(https://github.com/donseok/wbs-web) 전체 조사 기반. "확인"은 코드 인용이 있는 사실, "제안"은 신규 설계 요청.
- **문서 관계**: 본 문서가 **API 계약의 단일 출처(single source of truth)**다. 또박또박 측 상세 구현은 별도 문서(`ddobak-dflow-sender-spec.md`)가 다루되, 계약(필드·에러·의미)은 반드시 본 문서 §3~§7을 따른다. 계약 변경은 본 문서 개정 → 양측 반영 순서로만 한다.

---

## 개발 기능 요약 (한눈에)

**만드는 것**: 또박또박에서 완성한 회의록을 버튼 한 번으로 D'Flow `/minutes` 화면에 등록·갱신하는 연동. 같은 회의는 몇 번을 보내도 D'Flow에 1건만 유지(멱등), 또박또박에서 수정 후 재전송하면 D'Flow 기존 레코드가 갱신된다.

**D'Flow 측 개발** (§9 — 기존 파일 수정 0, 전부 신규):

| # | 기능 | 내용 |
|---|---|---|
| F1 | 업로드 API | `POST /api/v1/minutes` — JSON으로 회의록 수신, `external_id` 기준 upsert (생성/갱신/스킵) |
| F2 | 조회 API | `GET /api/v1/minutes` (external_id·기간·구분 필터), `GET /api/v1/minutes/meta` (구분·프로젝트·제한값) |
| F3 | 연결 API | `POST /api/v1/minutes/link` — D'Flow에 수동 업로드했던 기존 회의록에 `external_id`를 부여해 또박또박과 연결 |
| F4 | 인증 | env 시크릿(Bearer) + `user_email`→D'Flow 계정 매칭 (없으면 403 거부) |
| F5 | 스키마 | `minutes.external_id` 컬럼 + 부분 unique 인덱스 (마이그레이션 1개) |
| F6 | **MDM 팀 추가** | 구분(team)에 `MDM` 신설 — DB CHECK 2곳 + TS 타입/상수 + UI 색 토큰 (§9.8, 별도 선행 작업) |

**또박또박 측 개발** (`ddobak-dflow-sender-spec.md` — 별도 문서):

| # | 기능 | 내용 |
|---|---|---|
| T1 | 전송 식별자 | `meetings.public_uid` (UUIDv7, 최초 전송 시 발급·불변) — D'Flow `external_id`의 원천 |
| T2 | 전송 기능 | 회의 상세 "D'Flow로 보내기" — 서버(Rails)가 export md를 D'Flow API로 POST |
| T3 | 설정·자동 매핑 | D'Flow URL·시크릿(관리자). team은 **최상위 폴더명으로 자동 판정**(MES/PMO/ERP/가공/MDM), 제목은 `<하위폴더명>-<원제목>` 자동 조립 — 수동 매핑 설정 없음 |
| T4 | 연결 관리 | public_uid 보기/수동 입력/해제/재발급 + D'Flow 기존 레코드 검색·연결 (F3 사용) |
| T5 | 상태 표시 | 회의 상세에 전송됨/재전송 필요 배지, "D'Flow에서 보기" 링크 |
| T6 | export 호환 | 회의/폴더/프로젝트 export·import에 public_uid·매핑 포함 (다른 또박또박 인스턴스로 이동해도 D'Flow 연결 유지) |

**적용**: 양측 동시 개발 → §14 순서로 한 번에 통합 (D'Flow는 env 미설정이면 API 전체 404라 먼저 배포해도 무해).

---

## 0. 확정 사항 (미결 없음 — 그대로 구현)

| # | 항목 | 확정 내용 |
|---|---|---|
| D1 | 원본 .md 파일(`minute_files role='body'`) | **v1 생략.** 뷰어는 `body_md`만으로 완전 동작(확인). API가 만든 회의록은 external_id로만 갱신되고 UI 업로드 건과 섞이지 않으므로 "body 파일 1개" 관례와 충돌 없음. 원본 다운로드 필요 시 v1.1에서 서버 합성 추가 |
| D2 | 본문 한도 | **100,000자 고정** (`MINUTE_BODY_MAX` 그대로). 초과분 처리는 또박또박 책임 — 전송 전 검사해 초과 시 전송하지 않고 사용자에게 안내(자동 절단 금지) |
| D3 | `on_conflict=replace` 갱신 범위 | `minute_date, team_code, title, body_md, meeting_id, updated_at`만 갱신. **`created_by`/`created_by_name`은 최초 생성 시 값 유지** (재전송자가 달라도 소유권 불변) |
| D4 | 시간 보정 | API 경로는 `correctMinuteBodyTime` **미적용** (§1.4) |
| D5 | 인증 | env 시크릿(`MINUTES_API_ENABLED`+`MINUTES_API_SECRET`) + `user_email` 매칭. 사용자별 PAT는 v2 |
| D6 | 시크릿 전달 | D'Flow 관리자(팀장)가 생성(`openssl rand -base64 48`)해 Vercel env에 설정하고, 또박또박 관리자에게 보안 채널(대면/암호화 메신저)로 전달. 코드·문서·커밋에 평문 금지 |
| D7 | rate limit / multipart 첨부 / GET /minutes/{id} | v1 제외 (§13 단계표) |
| D8 | 적용 순서 | D'Flow 먼저 배포(env 미설정 상태 = 전 라우트 404라 무해) → env 설정 → 스모크 → 또박또박 설정 입력 → E2E (§14) |
| D9 | team 코드셋 | **5종: `PMO`·`ERP`·`MES`·`가공`·`MDM`** — MDM은 현재 D'Flow에 없어 F6(§9.8) 선행 추가 필요. 또박또박은 하드코딩하지 않고 `GET /minutes/meta`의 `teams`를 사용 |
| D10 | team·제목 자동 규칙 (또박또박) | team = 회의 폴더 체인의 **최상위 폴더명** (meta.teams에 있으면 자동, 없으면 다이얼로그 수동 선택). 전송 제목 = `<최상위 바로 아래 폴더명>-<원제목>` (하위 폴더 없으면 원제목 그대로), 다이얼로그에서 수정 가능. 프로젝트명은 양 시스템 동일 전제 — v1 전송엔 미사용, v1.1 meeting 자동 연결 시 이름 매칭에 사용 |

---

## 1. D'Flow 실제 구조 (코드 확인 사실)

### 1.1 회의록 저장 모델

`minutes` 테이블 (`supabase/migrations/0021_minutes.sql:12-22`, `0026_minute_share.sql`):

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `minute_date` | date not null | 목록 월별 그룹 기준 |
| `team_code` | text not null | CHECK `in ('PMO','ERP','MES','가공')` — **F6(§9.8)에서 MDM 추가 예정** |
| `title` | text not null | ≤ 200자 (앱 검증) |
| `body_md` | text not null | 마크다운 **원문 그대로** 저장 (파싱·블록 분해는 조회 시 파생 계산) |
| `meeting_id` | uuid null | FK → `meetings(id)` on delete set null. **프로젝트 연결은 이 경로뿐** |
| `created_by` | uuid null | FK → `auth.users(id)` |
| `created_by_name` | text null | 표시용 스냅샷 |
| `share_token` / `share_enabled` | | 공유 링크 (`/share/minutes/{token}`) |

- **`external_id` 같은 멱등키 컬럼 없음** (전 레포 grep 0건) — 신규 마이그레이션 필요.
- **`project_id` 컬럼 없음.** 회의록은 전역 아카이브이며 프로젝트 연결은 `meeting_id → meetings.project_id` 간접 조인뿐 (`src/lib/domain/types.ts:178-191`).
- 원본 파일: `minute_files` 테이블 + Storage `minutes` 버킷(비공개, 20MB). `role='body'`는 회의록당 **정확히 1개**(부분 unique index `minute_files_one_body_idx`), `role='attachment'`는 최대 10개.
- 앱 검증 상수 (`src/lib/domain/minutes.ts:3-7`): 본문 **100,000자**, 본문 .md 파일 1MB, 첨부 개당 20MB, 첨부 10개.
- 저장 후처리 (`src/app/actions/minutes.ts:95-98`): `ingestMinute`(임베딩) + `generateMinuteInsights`(AI 분류) 비동기 실행. 본문 교체 시 하이라이트 재매칭 포함 3단 (`minutes.ts:178-182`).

### 1.2 트리 뷰 = "폴더 구조"의 실체

`/minutes` 트리 뷰는 **구분(team_code) → 회의체 → 회의록** 2단 폴더다. 회의체 폴더는 별도 엔티티가 아니라 **제목에서 파생**된다 (`src/lib/domain/minutes.ts:57-83`, 스펙 `docs/superpowers/specs/2026-07-17-minutes-tree-view-design.md`):

- 제목을 `_`·공백으로 토큰화 → 노이즈 토큰(날짜형 `260716`·`2026-07-16`·`7.16` 등 5패턴, 회차형 `제3차`·`12차`, 요일 괄호 `(수)`) 제거 → 남은 토큰을 공백 결합한 것이 회의체 이름.
- 예: `물류공정_260716(수)` → 폴더 "물류공정". `주간정례 제12차 2026-07-16` → 폴더 "주간정례".

→ **또박또박이 "폴더 구조에 맞게" 넣으려면 별도 필드가 아니라 ① `team` 값 ② 제목만 지키면 된다.** 확정 규칙은 §0 D10: team = 최상위 폴더명 자동 판정, 제목 = `<하위폴더명>-<원제목>` (원제목 보존 우선 — 2단계 폴더가 회의별로 생기는 것은 의도된 동작).

### 1.3 외부 API·인증 현황

- 회의록 생성 경로는 Server Action `createMinute()`뿐 — **외부 호출 가능한 업로드 API 없음** (확인).
- 인증은 전부 Supabase 쿠키 세션. PAT/Bearer/API-key 관례 0건.
- 유일한 비세션 인증 선례: `api/chat/index/worker/route.ts` — env 시크릿 헤더(`x-cron-secret`)를 sha256+`timingSafeEqual`로 대조, env 미설정 시 404로 존재 은닉. **본 스펙의 인증은 이 선례를 확장한다** (§3).
- `middleware.ts`는 `/api/**`를 인증 리다이렉트에서 제외 — Route Handler가 자체 인증하는 구조 (확인).
- RLS: `insert_own_minutes`가 `created_by = auth.uid()` 강제 → API 경로는 `createAdminClient()`(service_role)로 우회하고 앱 코드가 인가를 대체해야 함 (기존 공유 페이지·worker route와 동일 패턴).

### 1.4 ⚠️ 시간 보정 함정 (반드시 반영)

`createMinute`/`replaceMinuteBody`는 본문에 `**날짜**:`·`**시간**:`·`**상태**:`·`**생성자**:` 4마커가 모두 있으면 `**시간**: HH:MM ~ HH:MM` 줄을 **+9h 자동 보정**한다 (`src/lib/minutes/timeFix.ts:41-54`). 이 4마커는 정확히 또박또박 export 헤더 포맷이다. 또박또박은 이미 올바른 KST를 보내므로, **API 경로가 기존 로직을 그대로 재사용하면 이중 보정으로 시간이 9시간 밀린다.** → API 경로는 `correctMinuteBodyTime` **미적용**이 기본이어야 한다 (§4.5).

### 1.5 또박또박 측에서 보낼 수 있는 것

또박또박은 회의별로 아래 데이터를 이미 보유·내보내기 가능하다 (`GET /api/v1/meetings/:id/export`, text/markdown 또는 JSON):

- 회의 제목, 날짜/시작·종료 시각, 생성자(이메일 계정), 참석자, 태그, 폴더, 프로젝트
- AI 회의록 전문(markdown), Action Items, 메모, 발화 원문(화자·타임스탬프)
- 마크다운 구조: `# 제목` → 메타데이터 목록 → `## AI 회의록` → `### Action Items` → `## 메모` → `## 원본 텍스트`

---

## 2. 설계 개요

- 스타일: REST, JSON 기본. Next.js **Route Handler**(`src/app/api/v1/**/route.ts`).
- Base URL: `https://wbs-web.vercel.app/api/v1`
- 인증: 서버 시크릿 + **사용자 이메일 매칭** (§3)
- 날짜 `YYYY-MM-DD`(Asia/Seoul), UTF-8.

| 메서드 | 경로 | 용도 | 우선순위 |
|---|---|---|---|
| POST | `/minutes` | 회의록 생성/갱신(upsert by `external_id`) | **v1 필수** |
| GET | `/minutes?external_id=` | 존재/동기화 확인, 연결 후보 검색 | **v1 필수** |
| GET | `/minutes/meta` | 구분·프로젝트·회의 목록 + 제한값 | **v1 필수** |
| POST | `/minutes/link` | 기존 D'Flow 회의록에 `external_id` 부여 (수동 연결) | **v1 필수** |
| GET | `/minutes/{id}` | 단건 조회 | v1.1 |
| POST | (multipart 첨부) | md 외 첨부 파일 | v1.1 |

---

## 3. 인증 — 2계층: 서버 시크릿 + 사용자 매칭

### 3.1 요구사항 (또박또박 측 정책)

**또박또박에서 보내는 사용자가 D'Flow에도 동일 계정(이메일)으로 존재해야 업로드가 허용**되고, 없으면 실패해야 한다. 업로드된 회의록의 작성자는 그 D'Flow 사용자로 기록된다.

### 3.2 계층 ① — 서버 간 시크릿 (요청 자체의 신뢰)

```
Authorization: Bearer <MINUTES_API_SECRET>
```

- env 2단 게이트 (기존 worker route 관례 그대로): `MINUTES_API_ENABLED=true` + `MINUTES_API_SECRET=<long-random>`. 미설정 시 라우트는 **404** (존재 은닉).
- 검증은 sha256 해시 후 `timingSafeEqual` 상수시간 비교 (`api/chat/index/worker/route.ts:30-36` 유틸 재사용).
- 이 시크릿은 또박또박 **서버(Rails 백엔드)**에만 저장 — 브라우저·개별 사용자에게 노출되지 않는다.
- 사용자별 PAT 테이블·발급 UI는 **v2로 연기** (레포에 선례가 없어 v1 부담이 크고, 현재 클라이언트는 또박또박 하나뿐).

### 3.3 계층 ② — 사용자 이메일 매칭 (작성자 귀속)

POST 요청 필드 `user_email`에 **또박또박에서 업로드를 실행한 사용자의 이메일**을 넣는다. D'Flow는:

1. `lower(trim(email))` 정규화 후 `auth.users`에서 조회 (`deleted_at is null` 계정만) — `0019_project_member_user_link.sql:51-61`의 기존 이메일 매칭 관례와 동일 규칙.
2. **일치하는 사용자가 없으면 `403` 실패** (레코드 미생성): `{ "error": "해당 이메일의 D'Flow 사용자가 없습니다.", "code": "unknown_user" }`
3. 일치하면 `created_by = 그 사용자의 uuid`, `created_by_name = 표시 이름` (기존 `displayNameFrom` 관례)으로 저장.

효과 (확인된 코드 기준): `created_by`가 실제 사용자이므로 그 사용자는 D'Flow 화면에서 자기가 올린 회의록을 **직접 수정·삭제**할 수 있다 (`canManage` 판정이 소유자 기준 — `(app)/minutes/[id]/page.tsx:24`). `created_by=null`로 넣는 대안은 pmo_admin 외에는 아무도 관리 못 하게 되므로 채택하지 않는다.

구현 힌트: 이메일→uuid 조회는 `admin.auth.admin.listUsers()`(`src/app/actions/accounts.ts:185`에서 이미 사용) 순회 또는 `security definer` SQL 함수 중 택일.

### 3.4 실패 응답

| 상황 | 응답 |
|---|---|
| env 미설정 | `404` |
| 시크릿 불일치/누락 | `401` `{ "error": "인증이 필요합니다." }` |
| `user_email` 누락 | `400` |
| 해당 이메일 사용자 없음/삭제됨 | `403` `{ "error": "...", "code": "unknown_user" }` |

---

## 4. POST /minutes — 회의록 생성/갱신

### 4.1 Content-Type

- v1: **`application/json`** (본문 마크다운 문자열 전송)
- v1.1: `multipart/form-data` (첨부 동반 시. 동일 필드 + `attachments[]`)

### 4.2 요청 필드

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `user_email` | string | ✅ | 업로드 실행 사용자 이메일 (§3.3). 미일치 시 403 |
| `date` | string `YYYY-MM-DD` | ✅ | → `minute_date` |
| `team` | string | ✅ | → `team_code`. 허용값 `PMO`·`ERP`·`MES`·`가공`·`MDM` (MDM은 F6/§9.8 선행 추가 후. 클라이언트는 하드코딩 대신 `GET /minutes/meta`의 `teams` 사용). ※ v1 스펙의 `category`에서 개명 — D'Flow `meetings.category`(general/routine/…)와 동명이의 충돌 방지 |
| `title` | string ≤ 200자 | ✅ | 트리 뷰 폴더가 제목에서 파생되므로(§1.2) 명시 전송. 또박또박 관례: `<하위폴더명>-<원제목>` (§0 D10 — D'Flow는 형식을 강제하지 않음, 200자 검증만) |
| `body_markdown` | string ≤ **100,000자** | ✅ | → `body_md` 원문 저장. 한도는 D'Flow 기존 검증 상수(`MINUTE_BODY_MAX`)와 정합 |
| `external_id` | string ≤ 128자 | ✅ | **멱등 키**. 또박또박은 `ddobak:<회의 UUIDv7>` — 최초 업로드 시 발급하는 불변 `public_uid` (§10). unique |
| `meeting_id` | uuid | — | D'Flow 회의 엔티티 연결(선택). 존재 검증 후 저장 (기존 `createMinute`와 동일). **프로젝트 연결은 이 필드 경유가 유일** |
| `on_conflict` | `replace`\|`skip`\|`error` | — | 기본 `replace` |

v1 스펙에 있던 `project_id`(minutes에 저장 컬럼 없음), `occurred_start_at/end_at`·`attendees`·`tags`(전부 minutes 컬럼 없음 — `meetings` 엔티티 속성), `external_source`·`external_instance`·`external_url`(컬럼 없음)은 **v1에서 제외**. 발신 시스템 식별은 `external_id`의 `ddobak:` prefix로 충분하다. 추가 메타 보존이 필요해지면 v1.1에서 `external_meta jsonb` 컬럼 1개로 수용(제안).

**`on_conflict` 의미** (동일 `external_id` 기존 레코드 존재 시):

- `replace`(기본): 본문·메타 갱신 + **후처리 파이프라인 재실행** (§4.5). → 또박또박 재전송 흐름
- `skip`: 변경 없이 기존 레코드 반환 (`action: "skipped"`)
- `error`: `409`

**기존 레코드가 없으면** `on_conflict` 값과 무관하게 **항상 신규 생성**(201 `created`)이다 (보장). 또박또박에 uuid가 이미 발급돼 있어도 D'Flow에 해당 `external_id` 레코드가 없는 상황(레코드 삭제됨, DB 초기화, 과거 전송 미도달)에서 전송하면 같은 `external_id`로 새 레코드가 만들어진다 — "이미 발급된 uuid인데 왜 없지"를 이유로 거부하지 말 것.

### 4.3 응답

**`201`** (신규) / **`200`** (replace·skip):

```json
{
  "ok": true,
  "id": "3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90",
  "action": "created",
  "title": "물류-물류공정_260716",
  "date": "2026-07-16",
  "team": "MES",
  "meeting_id": null,
  "external_id": "ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77",
  "created_by_name": "홍길동",
  "url": "https://wbs-web.vercel.app/minutes/3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90",
  "created_at": "2026-07-19T10:12:00+09:00",
  "updated_at": "2026-07-19T10:12:00+09:00"
}
```

- 모든 ID는 **UUID** (D'Flow PK 전부 `gen_random_uuid()` — 확인).
- `url`은 상세 페이지 `/minutes/{id}` — 실재하는 경로지만 **로그인한 사용자만 열람 가능** (middleware 리다이렉트 대상). 비로그인 공유가 필요하면 기존 공유 링크 기능(`/share/minutes/{token}`, opt-in)을 별도 사용.

### 4.4 요청 예시

```bash
curl -X POST https://wbs-web.vercel.app/api/v1/minutes \
  -H "Authorization: Bearer $MINUTES_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "jjinie73@gmail.com",
    "date": "2026-07-16",
    "team": "MES",
    "title": "물류-물류공정_260716",
    "body_markdown": "# 물류공정_260716\n\n- **날짜**: 2026-07-16\n- **시간**: 14:00 ~ 15:10\n...",
    "external_id": "ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77",
    "on_conflict": "replace"
  }'
```

### 4.5 서버 처리 규칙 (D'Flow 구현 요구)

1. 인증 2계층 (§3) → 입력 검증은 기존 `validateMinuteInput` 재사용 (단 `title` 필수화).
2. **`correctMinuteBodyTime`(+9h 보정) 적용 금지** — §1.4의 이중 보정 방지. 기존 `createMinute`를 그대로 재사용하지 말고 보정 단계만 제외한 공용 함수로 분리할 것.
3. `meeting_id` 있으면 `meetings` 존재 확인 (기존과 동일), 없으면 400.
4. `external_id` **사전 select 후 insert/update 분기** (DB `ON CONFLICT` upsert 구문 사용 금지 — 부분 unique 인덱스는 conflict 대상 추론에 매칭되지 않아 42P10 실패, §12 주의 참조). replace 시 `updated_at = now()`.
5. 원본 .md 파일: **v1 생략 확정** (§0 D1) — `minute_files`·Storage 접근 없음. 뷰어·트리·검색 모두 `body_md` 기준이라 기능 결손 없음.
6. replace 갱신 범위는 §0 D3 — `created_by`/`created_by_name` 유지.
7. 저장 성공 후 **후처리 파이프라인 실행** (누락 시 검색·AI 챗·인사이트가 낡은 본문 참조): 신규 = `ingestMinute` + `generateMinuteInsights`, replace = `rematchMinuteHighlights` → `ingestMinute` → `generateMinuteInsights` (기존 순서 그대로, `actions/minutes.ts:95-98`·`178-182`).

### 4.6 external_id 정밀 정의 (계약)

- **형식**: `ddobak:` + 소문자 UUID. 정규식 `^ddobak:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (총 43자).
- UUID는 또박또박이 발급하는 **UUIDv7** (RFC 9562, `SecureRandom.uuid_v7` — Ruby 4.0.2 확인). 회의당 1개, 최초 전송 시 발급, 이후 **불변**.
- **D'Flow는 이 값을 불투명(opaque) 문자열로만 다룬다** — 파싱·분해·형식 검증 금지, 정확 일치 비교만. 유일한 예외: 길이 ≤128 검사와 빈 문자열 거부. (또박또박이 아닌 다른 클라이언트가 향후 다른 prefix를 쓸 수 있도록)
- **발신 서버 무검증 (보장)**: replace는 `external_id` 일치만 본다. D'Flow는 "어느 또박또박 서버가 보냈는가"를 추적·검증하지 **않는다** — 의도된 설계다. 회의가 export/import로 **다른 또박또박 서버로 이동해도** 같은 uuid로 보내는 한 기존 레코드가 정상 갱신되어야 한다. 구현 시 발신 인스턴스 소유권 검사를 추가하지 말 것 (인증은 §3의 시크릿+이메일 매칭으로 충분).
- 발급·저장·재발급 규칙은 또박또박 책임 (§10 + `ddobak-dflow-sender-spec.md`).

## 4b. POST /minutes/link — 기존 회의록 수동 연결 (claim)

**용도**: 연동 이전에 D'Flow UI로 수동 업로드했던 회의록(= `external_id`가 null인 레코드)을 또박또박 회의와 연결한다. 연결되면 이후 또박또박의 재전송이 그 레코드를 갱신한다(중복 생성 방지).

요청 (`application/json`):

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `user_email` | string | ✅ | §3.3 동일 매칭. 없으면 403 `unknown_user` |
| `minute_id` | uuid | ✅ | 연결 대상 D'Flow 회의록 id |
| `external_id` | string | ✅ | 부여할 값 (§4.6 형식, 또박또박이 생성한 public_uid 기반) |

동작 (원자적으로):

1. `minute_id` 불존재 → **404** `{ "error": "...", "code": "not_found" }`
2. 대상의 `external_id`가 이미 **같은 값** → **200** `action: "linked"` (멱등 — 재호출 안전)
3. 대상의 `external_id`가 이미 **다른 값** → **409** `{ "code": "link_conflict" }` (기존 연결 보호 — 덮어쓰기 불가. 해제 API는 제공하지 않음, 필요 시 D'Flow DB에서 수동 처리)
4. 해당 `external_id`가 **다른 레코드에 이미 사용 중** → **409** `{ "code": "link_conflict" }`
5. 정상 → 대상 레코드에 `external_id` 세팅, **본문·메타는 변경하지 않음** (내용 갱신은 이후 POST /minutes replace가 수행) → **200**:

```json
{ "ok": true, "id": "<uuid>", "action": "linked", "external_id": "ddobak:0198..." }
```

콘텐츠는 건드리지 않으므로 후처리 파이프라인 불필요. 구현은 `update ... set external_id = $1 where id = $2 and external_id is null` + 영향 행 0이면 재조회로 사유 판별(unique 충돌은 DB 에러 코드 `23505`로 감지).

---

## 5. 조회 API

### 5.1 GET /minutes

| 파라미터 | 설명 |
|---|---|
| `external_id` | 정확 일치 (멱등 확인용 — 핵심) |
| `linked` | `true`=external_id 있는 것만, `false`=**없는 것만** (수동 연결 후보 검색용 — §4b) |
| `date_from` / `date_to` | 일자 범위 |
| `team` | 구분 필터 |
| `page` / `per_page` | 기본 20, 최대 100 |

응답: `{ "items": [...], "total": 27, "page": 1, "per_page": 20 }`

`items[]` 필드 (연결 후보 화면이 표시할 최소 집합): `id, title, date, team, external_id(null 가능), created_by_name, created_at, updated_at, url`. **본문 제외.**

### 5.2 GET /minutes/meta

```json
{
  "teams": ["PMO", "ERP", "MES", "가공", "MDM"],
  "projects": [ { "id": "<uuid>", "name": "D-CUBE 프로젝트" } ],
  "limits": { "max_body_chars": 100000, "max_request_bytes": 4194304, "max_attachments": 10, "max_attachment_bytes": 20971520 }
}
```

`teams`는 또박또박이 최상위 폴더명 자동 판정(§0 D10)의 기준으로 쓰므로, D'Flow에 팀이 추가/변경되면 이 응답만으로 또박또박이 무수정 추종한다.

- `teams`는 `TEAM_CODES` 상수(`src/lib/domain/minutes.ts:9`) 재사용.
- `projects`에 `status` 컬럼 없음 (확인).
- 회의 목록은 프로젝트 종속이므로 별도 파라미터: **`GET /minutes/meta?project_id=<uuid>`** 일 때만 `meetings: [{id, title, date}]` 포함 (기존 `fetchProjectMeetingsLite`가 projectId 필수 — 확인).

### 5.3 GET /minutes/{id} (v1.1)

4.3 응답 + `body_markdown`, `attachments[]`.

---

## 6. 오류 응답 규격

D'Flow 전 라우트의 기존 관례는 평면 `{ "error": string }` (공용 헬퍼 없음 — 확인). 신규 API도 **평면 유지 + 기계 판독용 `code` 추가**로 절충:

```json
{ "error": "team은 PMO, ERP, MES, 가공, MDM 중 하나여야 합니다.", "code": "validation_failed" }
```

| HTTP | code | 상황 |
|---|---|---|
| 400 | `validation_failed` | 필수 누락, 형식 오류, 허용 외 `team`, 본문 100,000자 초과, `meeting_id` 불존재 |
| 401 | `unauthorized` | 시크릿 없음/불일치 |
| 403 | `unknown_user` | `user_email`에 해당하는 D'Flow 사용자 없음 (§3.3 — **요구사항: 반드시 실패**) |
| 404 | `not_found` | env 미설정 (존재 은닉, code 없이 Next 기본 404) / link 대상 `minute_id` 불존재 |
| 409 | `conflict` | `on_conflict=error` + `external_id` 중복 |
| 409 | `link_conflict` | link: 대상이 이미 다른 `external_id`를 가짐, 또는 `external_id`가 타 레코드에 사용 중 (§4b) |
| 413 | `payload_too_large` | 요청 크기 초과 (※ Vercel 플랫폼이 라우트 도달 전에 자체 형식으로 응답할 수 있음 — 클라이언트는 상태코드만 신뢰) |
| 500 | `internal_error` | 서버 오류 |

Rate limit(429)은 **v1 제외** — 레포에 카운터 저장 인프라(Redis 등)가 없고 stateless serverless라 신설 비용이 큼. 필요 시 v2.

---

## 7. 제한 (D'Flow 실측 기준)

| 항목 | 값 | 근거 |
|---|---|---|
| `body_markdown` | **100,000자 (확정, §0 D2)** | `MINUTE_BODY_MAX` (`domain/minutes.ts:4`) — 기존 UI 경로와 동일 검증기 공유. 또박또박은 **원본 텍스트 제외 export**(`include_transcript=false`)가 기본이며 전송 전 길이 검사·초과 시 안내(자동 절단 금지) |
| 요청 전체 | 4MB | Vercel serverless 바디 한도(~4.5MB). `vercel.json` 없음(기본값 사용 중 — 확인) |
| 첨부 | 개당 20MB, 10개 | Storage 버킷 `file_size_limit` + `MINUTE_ATTACHMENTS_MAX_COUNT` (확인). v1.1 |

## 8. 보안

- HTTPS 전용. 시크릿 검증은 상수시간 비교, env 미설정 시 404 은닉 (기존 관례).
- `MINUTES_API_SECRET`은 충분히 긴 랜덤값, 또박또박 Rails 서버 credential로만 보관 (프런트 노출 금지).
- `user_email`은 신원 **선택**이지 인증이 아님 — 인증은 계층 ①이 담당. 시크릿 유출 시 임의 사용자 위장이 가능하므로 유출 시 즉시 회전. (사용자별 소유 증명이 필요해지면 v2 PAT로 승격)
- `body_markdown` 렌더링은 기존 뷰어 파이프라인 그대로 (react-markdown, raw HTML 미허용 — 기존과 동일).
- service_role 클라이언트 사용 라우트이므로 입력 화이트리스트 검증 필수 (기존 `parseBody` 수동 타입가드 스타일).
- CORS 불필요 (서버-투-서버).

---

## 9. D'Flow 측 작업 지시 (파일 단위)

전부 신규 파일 + env 추가. 기존 파일 수정은 **최대 1줄** — `rematchMinuteHighlights`(`actions/minutes.ts:45`, 현재 비-export)에 `export` 키워드 추가(로직 복제를 택하면 0줄). 기존 UI 업로드·Server Action 경로와 완전히 분리되어 회귀 위험이 없다.

### 9.1 신규 마이그레이션 — `supabase/migrations/0034_minutes_external_id.sql`

```sql
-- 외부 시스템(또박또박) 업로드 멱등키. UI 업로드 건은 null 유지.
-- share_token(0026)과 동일한 부분 유니크 인덱스 관례.
alter table minutes add column if not exists external_id text;
create unique index if not exists minutes_external_id_uidx
  on minutes (external_id) where external_id is not null;
```

컬럼 추가뿐이므로 기존 조회(`MINUTE_COLUMNS` 화이트리스트 select — `repositories/supabase/minutes.ts:18-21`)에 영향 없음(확인).

### 9.2 신규 공용 유틸 — `src/lib/minutes/externalApi.ts`

- `verifyApiSecret(req): boolean` — `api/chat/index/worker/route.ts:30-36`의 sha256+`timingSafeEqual` 로직을 복제(또는 해당 유틸을 export로 승격해 재사용). env: `MINUTES_API_ENABLED`, `MINUTES_API_SECRET`.
- `resolveUserByEmail(admin, email): Promise<{id, name} | null>` — `lower(trim(email))` 정규화 후 `admin.auth.admin.listUsers()` 페이지 순회(`actions/accounts.ts:185` 관례)로 `deleted_at` 없는 일치 사용자 검색. 표시 이름은 기존 `displayNameFrom` 관례 재사용.
- `parseMinutePayload(body: unknown)` — 수동 타입가드(레포 관례, zod 미사용). `validateMinuteInput`(`domain/minutes.ts:22-30`) 재사용 + `title`·`external_id`·`user_email` 필수 검사 추가. **`correctMinuteBodyTime` 호출 없음** (§0 D4).
- 후처리 재사용 주의: `ingestMinute`·`generateMinuteInsights`는 export 함수라 그대로 import 가능하나, **`rematchMinuteHighlights`는 비-export**(`actions/minutes.ts:45`) — `export` 승격(기존 파일 1줄 수정) 또는 로직 복제 중 택일해 명시적으로 처리.

### 9.3 신규 라우트 — `src/app/api/v1/minutes/route.ts` (POST + GET)

§12 골격대로. 핵심 흐름: env 게이트(404) → 시크릿(401) → JSON 파싱(400) → 사용자 매칭(403 `unknown_user`) → 검증(400) → `meeting_id` 존재 확인(400) → `external_id` 사전 select로 `on_conflict` 분기 → insert 또는 update(§0 D3 범위) → 후처리 파이프라인(§4.5-7) → 응답(§4.3). DB 접근은 전부 `createAdminClient()`.

### 9.4 신규 라우트 — `src/app/api/v1/minutes/meta/route.ts` (GET)

§5.2. `TEAM_CODES` 상수 + `admin.from('projects').select('id,name')` + (`project_id` 쿼리 시) 해당 프로젝트 meetings.

### 9.4b 신규 라우트 — `src/app/api/v1/minutes/link/route.ts` (POST)

§4b. 인증 2계층 동일 → `minute_id` 조회 → external_id null 검사 → 조건부 update. unique 위반(23505)은 409 `link_conflict`로 변환.

### 9.5 env — `.env.local.example` 추가 + Vercel 프로젝트 설정

```
MINUTES_API_ENABLED=true            # 미설정이면 API 전체 404 (존재 은닉)
MINUTES_API_SECRET=long-random      # openssl rand -base64 48
```

### 9.6 테스트 — `tests/minutes/external-api.test.ts` (vitest, 기존 `tests/minutes/` 관례)

최소 케이스: ① env 미설정→404 ② 시크릿 불일치→401 ③ 미지 이메일→403 `unknown_user` ④ 필수 누락·허용 외 team·100,000자 초과→400 ⑤ 신규→201 `created` ⑥ 같은 `external_id` 재전송→200 `replaced` + D3 범위만 갱신 ⑦ `on_conflict=skip`→200 `skipped` ⑧ `on_conflict=error`→409 ⑨ 본문에 4마커 있어도 시간 무보정(§1.4 회귀 방지 — **필수 케이스**) ⑩ link: null 레코드→200 `linked` / 같은 값 재호출→200 / 다른 값·중복 값→409 `link_conflict` / 불존재→404 ⑪ GET `linked=false` 필터.

### 9.7 규모 요약

| 구분 | 내용 | 규모 |
|---|---|---|
| 마이그레이션 | 0034 (컬럼 1 + 부분 unique 인덱스 1) | 소 |
| 신규 코드 | 유틸 1 + 라우트 3 (minutes, meta, link) | 중 (기존 파일 수정 최대 1줄 — export 승격) |
| env | 2개 | 소 |
| MDM 팀 추가 (§9.8) | 별도 작업 — API보다 논리적으로 선행 (같은 배포로 묶어도 무방) | 중 |
| 변경 없음 | 기존 Server Action·UI·RLS·다른 라우트 전부 | — |

### 9.8 MDM 팀 추가 (F6 — API와 별개의 선행 작업)

또박또박 최상위 폴더에 MDM이 실재하므로 D'Flow 구분에 MDM이 필요하다. 현재 team 코드셋은 **등록형이 아니라 3계층 하드코딩**이다 (실측):

| 계층 | 위치 | 수정 |
|---|---|---|
| DB CHECK 2곳 | `0014_rename_dt_to_gagong.sql:11` (`teams.code`), `0021_minutes.sql:15` (`minutes.team_code`) | 신규 마이그레이션 `0035_add_mdm_team.sql`: 두 CHECK 제약 drop 후 `in ('PMO','가공','ERP','MES','MDM')`로 재생성 + `insert into teams (code, name) values ('MDM','MDM')` |
| TS 타입·상수 | `TeamCode` 유니온(`types.ts:2`), `TEAM_CODES`(`domain/minutes.ts:9`), `KANBAN_TEAM_CODES`(`KanbanBoard.tsx:20`) | 각 배열/유니온에 `'MDM'` 추가 |
| `Record<TeamCode,…>` 리터럴 9곳 | `MinutesTree.tsx:11`(FOLDER_TINT), `wbs/shared.tsx:3`(TEAM 색), `MembersBoard.tsx:15`, `excel/export.ts:10`(TEAM_COL — **엑셀 컬럼 번호**), `repositories/supabase/wbs.ts:51`, `report/brand.ts:33`, `data/wbs.ts:62`, `domain/kanban.ts:22`, `domain/tree.ts:6` | `'MDM'` 추가 시 **tsc가 9곳 전부 컴파일 에러로 강제 열거** — 각 1줄(색·순서·컬럼) 추가. 누락 불가능 |
| CSS 색 토큰 | `globals.css:73-76`(라이트)·`:143-144`(다크) | 라이트 1줄(`--color-team-mdm` + `--color-team-mdm-weak` 2값) + 다크 1줄(`--color-team-mdm-weak` 1값) 추가 — 기존 팀당 패턴 동일 |

**부수효과 (팀장 확인 필요)**: WBS·칸반·근태·멤버 화면에 MDM 팀이 등장하고, **엑셀 import/export의 팀 컬럼(TEAM_COL)과 주간보고에 MDM 열이 추가**된다 — 기존 WBS 엑셀 템플릿을 쓰는 팀이 있으면 템플릿 정합 확인. minutes 한정 추가(반쪽)나 타입 분리(부채) 대안은 검토 후 기각 — 전 모듈 정식 추가가 비용 동일하면서 완전함.

## 10. 또박또박 측 연동 계획 (참고)

```
[또박또박] 회의 종료 · 최종 회의록 생성 (또는 "D'Flow로 보내기" 클릭)
   │
   ├─ 1. 자체 export (include_transcript=false 기본) → markdown 확보
   ├─ 2. GET /minutes/meta → teams 목록 확보 (자동 판정 기준 + 실패 시 다이얼로그 선택지)
   └─ 3. POST /minutes
          user_email    ← 또박또박 로그인 사용자의 이메일 (D'Flow 계정과 동일해야 함)
          date          ← meeting.started_at 날짜
          team          ← 최상위 폴더명 자동 판정 (meta.teams에 있으면 채택, 없으면 다이얼로그 수동 선택 — §0 D10)
          title         ← "<하위폴더명>-<원제목>" 자동 조립 (하위 폴더 없으면 원제목 그대로, 다이얼로그 수정 가능 — §0 D10)
          body_markdown ← 1의 markdown (KST 그대로 — D'Flow는 보정하지 않음 §4.5)
          meeting_id    ← (선택) v1 미전송 (또박또박 v1 범위 제외)
          external_id   ← "ddobak:<meeting.public_uid>"
          on_conflict   ← replace
```

### 10.1 public_uid / external_id 규칙 (정밀 정의)

- **정의**: `meetings.public_uid` = 회의당 1개의 **UUIDv7** (RFC 9562), 소문자 36자, `SecureRandom.uuid_v7`로 생성. nullable(미전송 회의는 null), 로컬 DB unique index. `external_id = "ddobak:" + public_uid` (§4.6 계약 형식).
- **왜 UUIDv7**: 전역 유일(서버 다중 운영·DB 백업 복제·리셋과 무관) + 시간순 정렬 가능(디버깅 편의). `설치ID+정수id` 조합은 백업 복제·autoincrement 재사용 시 충돌하므로 기각. 키에 제목·날짜 등 **편집 가능한 값 포함 금지**.
- **발급 시점**: 최초 전송 시(lazy). backfill 불필요.
- **발급 순서 (불변 규칙)**: ① `SecureRandom.uuid_v7` 생성 → ② 로컬 DB **커밋** → ③ D'Flow 전송. 전송을 먼저 하면 "전송 성공 후 로컬 저장 전 크래시" 시 다음 전송에서 새 uuid가 발급돼 D'Flow에 중복이 생긴다. 커밋 후 전송이면 재시도가 항상 같은 키를 재사용해 upsert로 안전.
- **불변성**: 한번 발급된 public_uid는 회의 수정·재전송·제목 변경과 무관하게 유지. 변경되는 경로는 §10.2의 명시적 수동 조작뿐.

### 10.2 이미 존재하는 회의록과의 연결 (수동 관리)

또박또박 회의 상세의 "D'Flow 연동" 관리 화면에서 처리하는 4가지 시나리오:

| 시나리오 | 상황 | 절차 |
|---|---|---|
| **A. uid 소실 복구** | D'Flow엔 올라가 있는데 또박또박 로컬 DB 재설치·복원으로 public_uid가 사라짐 | D'Flow 목록 검색(`GET /minutes?date_from=&team=` — 또박또박 백엔드가 프록시) → 해당 레코드 선택 → 그 레코드의 `external_id`(`ddobak:<uuid>`)에서 uuid를 **또박또박 public_uid로 역주입** 저장. 이후 재전송 = replace |
| **B. 수동 업로드분 연결** | 연동 전에 D'Flow UI로 손 업로드한 회의록(external_id null)을 또박또박 회의와 연결 | 목록 검색(`linked=false` 필터) → 선택 → 또박또박이 public_uid 발급(§10.1 순서)·저장 → **`POST /minutes/link`** 호출로 그 레코드에 external_id 부여 → 이후 재전송 = replace |
| **C. uuid 직접 입력** | 사용자가 external_id 값을 알고 있음 (예: D'Flow 담당자가 알려줌) | UUID 형식 검증 → `GET /minutes?external_id=` 존재 확인 → public_uid로 저장. 존재하지 않으면 경고(저장은 허용 — 다음 전송 시 신규 생성됨) |
| **D. 재발급/해제** | 잘못 연결됨, 새 레코드로 보내고 싶음 | "연결 해제"(public_uid → null) 또는 "재발급"(새 uuid). **경고 필수**: 다음 전송이 D'Flow에 **새 레코드를 생성**하며 기존 레코드는 남는다(고아). 기존 레코드 정리는 D'Flow에서 수동 삭제 |

원칙: **연결 상태의 진실은 또박또박 `public_uid`가 아니라 "D'Flow에 같은 external_id 레코드가 있는가"다.** 관리 화면은 열릴 때마다 `GET /minutes?external_id=`로 실제 존재를 확인해 표시한다(로컬 값만 믿지 않음).

**또박또박 측 추가 구현 목록** (상세는 `ddobak-dflow-sender-spec.md`):
- `meetings.public_uid` 컬럼 (nullable uuid)
- 설정: D'Flow URL·시크릿 (관리자) — 폴더 매핑 설정은 없음(자동 규칙 §0 D10)
- 전송은 Rails 백엔드에서 (시크릿 서버 보관)
- 사용자 이메일 불일치(403 `unknown_user`) 시 UI 안내: "D'Flow에 동일 이메일 계정 필요"

## 11. OpenAPI 3.1 요약

```yaml
openapi: 3.1.0
info: { title: D'Flow Minutes API, version: "2.0-draft" }
servers: [ { url: https://wbs-web.vercel.app/api/v1 } ]
components:
  securitySchemes:
    serverSecret: { type: http, scheme: bearer, description: "MINUTES_API_SECRET (env)" }
  schemas:
    Minute:
      type: object
      properties:
        ok: { type: boolean }
        id: { type: string, format: uuid }
        action: { type: string, enum: [created, replaced, skipped] }
        title: { type: string }
        date: { type: string, format: date }
        team: { type: string, enum: [PMO, ERP, MES, 가공, MDM] }
        meeting_id: { type: [string, "null"], format: uuid }
        external_id: { type: string }
        created_by_name: { type: [string, "null"] }
        url: { type: string, format: uri }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
    Error:
      type: object
      properties:
        error: { type: string }
        code: { type: string }
security: [ { serverSecret: [] } ]
paths:
  /minutes:
    post:
      summary: 회의록 생성/갱신 (upsert by external_id)
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [user_email, date, team, title, body_markdown, external_id]
              properties:
                user_email: { type: string, format: email }
                date: { type: string, format: date }
                team: { type: string, enum: [PMO, ERP, MES, 가공, MDM] }
                title: { type: string, maxLength: 200 }
                body_markdown: { type: string, maxLength: 100000 }
                external_id: { type: string, maxLength: 128 }
                meeting_id: { type: string, format: uuid }
                on_conflict: { type: string, enum: [replace, skip, error], default: replace }
      responses:
        "201": { description: created, content: { application/json: { schema: { $ref: "#/components/schemas/Minute" } } } }
        "200": { description: replaced/skipped, content: { application/json: { schema: { $ref: "#/components/schemas/Minute" } } } }
        "403": { description: unknown_user — user_email에 해당하는 D'Flow 계정 없음 }
        "4XX": { description: error, content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } } }
    get:
      summary: 존재/동기화 확인
      parameters:
        - { name: external_id, in: query, schema: { type: string } }
        - { name: date_from, in: query, schema: { type: string, format: date } }
        - { name: date_to, in: query, schema: { type: string, format: date } }
        - { name: team, in: query, schema: { type: string } }
        - { name: page, in: query, schema: { type: integer, default: 1 } }
        - { name: per_page, in: query, schema: { type: integer, default: 20, maximum: 100 } }
      responses: { "200": { description: list } }
  /minutes/meta:
    get:
      summary: 구분·프로젝트(·회의) 목록 + 제한값
      parameters:
        - { name: project_id, in: query, schema: { type: string, format: uuid }, description: "지정 시 해당 프로젝트의 meetings 포함" }
      responses: { "200": { description: meta } }
  /minutes/link:
    post:
      summary: 기존 회의록에 external_id 부여 (수동 연결)
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [user_email, minute_id, external_id]
              properties:
                user_email: { type: string, format: email }
                minute_id: { type: string, format: uuid }
                external_id: { type: string, maxLength: 128 }
      responses:
        "200": { description: linked (멱등 — 같은 값 재호출 포함) }
        "404": { description: minute_id 불존재 }
        "409": { description: link_conflict — 이미 다른 external_id 보유 또는 값이 타 레코드에 사용 중 }
```

## 12. 구현 힌트 (D'Flow, 실코드 기반)

```ts
// src/app/api/v1/minutes/route.ts — 기존 관례 조합
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateMinuteInput } from '@/lib/domain/minutes'
// 시크릿 검증: api/chat/index/worker/route.ts의 sha256+timingSafeEqual 유틸 추출 재사용

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // 1) env 게이트 — 미설정 시 404 (worker route 패턴)
  // 2) Bearer 시크릿 상수시간 대조 — 실패 401
  // 3) req.json() try/catch — 실패 400 (기존 관례: zod 없이 수동 타입가드)
  // 4) user_email → auth.users 조회 (lower/trim, deleted_at null) — 없으면 403 unknown_user
  // 5) validateMinuteInput 재사용 + title 필수 — 실패 400
  //    ⚠️ correctMinuteBodyTime 호출 금지 (이중 +9h 보정 방지, timeFix.ts:13 주석 참조)
  // 6) meeting_id 있으면 존재 확인 — 없으면 400
  // 7) external_id로 사전 select → 없으면 insert / 있으면 on_conflict 분기
  //    (replace = §0 D3 범위 update, skip = 기존 반환, error = 409)
  //    ⚠️ admin.from('minutes').upsert({...}, { onConflict: 'external_id' }) 사용 금지 —
  //    부분 unique 인덱스(where external_id is not null)는 ON CONFLICT (external_id) 대상 추론에
  //    매칭되지 않아 42P10 에러로 실패한다 (supabase-js onConflict는 index predicate 지정 불가)
  // 8) after(): ingestMinute + generateMinuteInsights (+replace 시 rematchMinuteHighlights 선행)
  //    ※ rematchMinuteHighlights는 비-export(actions/minutes.ts:45) — §9.2 참조 (export 승격 또는 복제)
  // 9) NextResponse.json({ ok: true, id, action, ... }, { status: created ? 201 : 200 })
}
```

- 컬럼 매핑: `date→minute_date`, `team→team_code`, `title→title`, `body_markdown→body_md`, `meeting_id→meeting_id`, `external_id→external_id`(신규).
- 응답 `url`: `${origin}/minutes/${id}`.
- 에러는 전부 `NextResponse.json({ error, code }, { status })` — 레포 평면 관례 유지.

## 13. 단계

| 단계 | 범위 |
|---|---|
| **v1 (최소)** | **MDM 팀 추가(§9.8, 선행)**, POST /minutes (JSON), POST /minutes/link, GET /minutes?external_id=, GET /minutes/meta, env 시크릿 + 이메일 매칭 인증, `external_id` 마이그레이션, 시간 보정 미적용, 후처리 파이프라인 |
| v1.1 | multipart 첨부(개당 20MB·10개), GET /minutes/{id}, `external_meta jsonb`(발신 서버 추적 등), body 파일 서버 합성 |
| v2 후보 | 사용자별 PAT 발급 UI(테이블+해시+revoke), rate limit, 웹훅, 삭제 API |

v1만으로 또박또박 자동 등록 흐름은 완성된다.

---

## 14. 통합 적용 순서와 E2E 검증 (양측 공통)

양측이 **동시에 개발**하고, 적용은 아래 순서로 한 번에 통합한다. D'Flow는 env 미설정 시 API 전체가 404이므로 **먼저 배포해도 아무 것도 노출되지 않는다** — 순서 의존성이 느슨해 안전하다.

### 14.1 적용 순서

1. **[D'Flow]** 마이그레이션 **0034 + 0035(MDM, §9.8)** 적용 + 코드 배포 (env는 아직 미설정 → 라우트 404, 무해)
2. **[D'Flow]** vitest 통과 확인 (§9.6 — 특히 시간 무보정 케이스)
3. **[D'Flow]** Vercel env 설정 (`MINUTES_API_ENABLED=true`, `MINUTES_API_SECRET=...`) 후 재배포
4. **[공통]** 아래 curl 스모크 4종 실행 (또박또박 없이 API 계약만 검증)
5. **[또박또박]** 설정 화면에 D'Flow URL·시크릿 입력 (매핑 구성 없음 — 자동 규칙)
6. **[공통]** E2E 시나리오 5종 (14.3)
7. 이상 없으면 완료. 문제 시 D'Flow env만 지우면 즉시 전체 차단(롤백 불필요)

### 14.2 curl 스모크 (D'Flow 단독 검증 — 팀장이 실행)

```bash
BASE=https://wbs-web.vercel.app/api/v1
SECRET=<MINUTES_API_SECRET>
EMAIL=<D'Flow에 실존하는 계정 이메일>

# S1. 인증 실패 → 401
curl -si $BASE/minutes/meta -H "Authorization: Bearer wrong" | head -1

# S2. meta → 200, teams 5종(MDM 포함) + projects + limits
curl -s $BASE/minutes/meta -H "Authorization: Bearer $SECRET"

# S3. 미지 이메일 → 403 {"code":"unknown_user"}, 레코드 미생성
curl -si -X POST $BASE/minutes -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"user_email":"nobody@nowhere.test","date":"2026-07-19","team":"PMO","title":"스모크_260719","body_markdown":"# t","external_id":"smoke:auth-test"}' | head -1

# S4. 생성 → 201 created / 같은 요청 재실행 → 200 replaced / GET ?external_id= 로 1건 확인
curl -s -X POST $BASE/minutes -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"user_email":"'$EMAIL'","date":"2026-07-19","team":"PMO","title":"스모크_260719","body_markdown":"# 스모크","external_id":"smoke:e2e-1"}'
curl -s "$BASE/minutes?external_id=smoke:e2e-1" -H "Authorization: Bearer $SECRET"
# 확인 후 D'Flow UI에서 스모크 레코드 수동 삭제
```

### 14.3 E2E 시나리오 (양측 연동)

| # | 시나리오 | 기대 결과 |
|---|---|---|
| E1 | 또박또박에서 회의록 최초 전송 | 201 `created` · D'Flow `/minutes` 목록·**트리 뷰의 의도한 구분/회의체 폴더**에 표시 · 작성자 = 전송 사용자 · 본문 `**시간**:` 값이 또박또박 원본과 **정확히 일치**(+9h 밀림 없음) · 또박또박 `meetings.public_uid` 저장됨 |
| E2 | 또박또박에서 회의록 수정 후 재전송 | 200 `replaced` · 중복 레코드 없음 · 본문 갱신 · 작성자 불변 · D'Flow AI 챗/검색이 새 본문 반영(임베딩 재색인) |
| E3 | D'Flow에 없는 이메일 사용자로 전송 | 403 `unknown_user` · D'Flow에 레코드 미생성 · 또박또박 UI에 "D'Flow에 동일 이메일 계정 필요" 안내 |
| E4 | D'Flow에 수동 업로드했던 회의록을 또박또박에서 검색·연결(claim) 후 재전송 | link 200 `linked` · 이후 전송이 그 레코드를 replace (중복 미생성) · 트리 위치는 갱신된 제목 기준 |
| E5 | 회의 tgz export → 다른 또박또박 인스턴스 import → 재전송 | public_uid 보존 · 재전송이 기존 D'Flow 레코드 replace (신규 생성 없음) |

### 14.4 계약 준수 체크리스트 (양측 개발 완료 선언 전 각자 확인)

- [ ] D'Flow: §9.6 테스트 11케이스 green, 기존 파일 수정이 export 승격 1줄뿐임을 확인 (`git diff --stat`)
- [ ] D'Flow: 시크릿이 로그에 찍히지 않음 (요청 로깅 시 Authorization 헤더 마스킹)
- [ ] 또박또박: uuid 발급 → 로컬 커밋 → 전송 순서 준수 (§10), 재시도가 같은 `external_id` 재사용
- [ ] 또박또박: 100,000자 사전 검사, 초과 시 미전송+안내 (§0 D2)
- [ ] 또박또박: 시크릿은 서버(Rails credential/env)에만, 프런트 미노출
- [ ] 공통: 필드명·에러 코드가 본 문서 §4·§6과 문자 단위 일치
