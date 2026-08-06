# D'Flow 스펙 — 외부 회의록 API의 회의 연결·생성 확장 (계약 v2.4 → v2.5)

- 버전: v1.0 (2026-08-06)
- 대상 repo: wbs-web (Next.js 15 App Router + Supabase)
- 발주: 또박또박 (회의록 업로드 클라이언트)
- 선행 계약: `docs/design/dflow-minutes-upload-api-spec.md` v2.4 — 이 문서는 그 증분(additive) 개정이다. 충돌 시 v2.4 조항이 우선하며, 충돌을 발견하면 구현을 멈추고 회신한다.

이 문서 하나로 구현이 가능하도록 현행 코드 기준점·검증 규칙·에러 규약·테스트·수용 기준을 모두 포함한다. 코드 인용 라인은 2026-08-06 HEAD 기준이므로 어긋나면 심볼명으로 찾는다.

---

## 0. 배경과 범위

또박또박 전송 다이얼로그에 "회의 연결(선택)" 기능이 추가된다. 사용자는 D'Flow 프로젝트를 고르고 그 프로젝트의 회의를 선택하거나, 없으면 그 자리에서 신규 회의를 등록한 뒤 회의록을 전송한다.

**D'Flow가 이미 갖춘 것 (구현 불필요 — 회귀 금지 대상):**

| 기능 | 위치 |
|---|---|
| `POST /api/v1/minutes`의 `meeting_id` 선택 필드 수신·존재 검증·project 파생 | `src/app/api/v1/minutes/route.ts:359-367` |
| replace 시 meeting_id 3값 규약 (키 부재=유지 / null=해제 / uuid=변경) | `route.ts:134-140, 169-173` (`p.meetingIdProvided`) |
| 회의 연결 시 `meeting_occurrence_date = date` 자동 파생 | `route.ts:171-173, 279` |
| `GET /api/v1/minutes/meta?project_id=`의 회의 목록 `{id,title,date}` | `src/app/api/v1/minutes/meta/route.ts:42-50` |

**이 스펙의 신규 작업 2건:**

- **W1** — meta 회의 목록 필드 확장: `category`, `recurrence` 추가
- **W2** — `POST /api/v1/minutes`에 inline `meeting` 객체: 회의 생성 + 연결을 한 요청으로

**비범위 (하지 말 것):**

- 회의 수정·삭제·참석자·시간·장소·반복(recurrence) 생성 — 외부 API로는 항상 `recurrence:'none'` 단발 회의만 생성
- 별도 `POST /api/v1/meetings` 엔드포인트 신설 — A안(inline) 채택으로 기각됨
- 신규 env 플래그 — 변경이 전부 additive라 불필요 (§7 배포 순서로 충분)
- 내부 UI(회의 페이지) 변경

---

## 1. 계약 변경 (v2.5)

### 1.1 `GET /api/v1/minutes/meta` — 회의 목록 필드 확장 (W1)

`project_id` 지정 시 `meetings` 항목이 다음으로 확장된다 (additive — 기존 3필드 유지):

```json
{
  "meetings": [
    {
      "id": "<uuid>",
      "title": "주간 정례",
      "date": "2026-08-04",
      "category": "routine",
      "recurrence": "weekly"
    }
  ]
}
```

- `category`: `'routine'|'general'|'kickoff'|'review'|'report'|'external'` (`src/lib/domain/meetings.ts:20` `MEETING_CATEGORIES`)
- `recurrence`: `'none'|'daily'|'weekly'|'biweekly'|'monthly'` — 반복 회의는 목록에 1행(첫 회차 date)만 나온다. 또박또박이 "반복" 배지 표시에 쓴다.
- 정렬 유지: `meeting_date` 내림차순 (`meta/route.ts:45`)

### 1.2 `POST /api/v1/minutes` — `meeting` 객체 (W2)

요청 바디에 선택 필드 `meeting`을 추가한다:

```json
{
  "user_email": "...", "date": "...", "team": "...", "title": "...",
  "body_markdown": "...", "external_id": "ddobak:...",
  "meeting": {
    "project_id": "<uuid, 필수>",
    "title": "킥오프 회의",
    "date": "2026-08-06",
    "category": "kickoff"
  }
}
```

**필드 규약:**

| 필드 | 필수 | 검증 |
|---|---|---|
| `meeting.project_id` | ✅ | uuid 형식 (`isUuid`), 실존 프로젝트 |
| `meeting.title` | ✅ | trim 후 비어있지 않음, ≤200자 (내부 `TITLE_MAX`와 동일) |
| `meeting.date` | ✅ | `YYYY-MM-DD` (`DATE_RE`) |
| `meeting.category` | — | 생략 시 `'general'`. 값이 있으면 `MEETING_CATEGORIES` 중 하나 |

**의미 규약:**

1. **상호배타** — `meeting`과 `meeting_id`를 동시에 보내면 400 `validation_failed` ("meeting과 meeting_id는 함께 보낼 수 없습니다."). 키 존재 기준으로 판정한다 (`meeting_id: null`과 `meeting` 동시 전송도 거절 — null 해제와 신규 연결 의도가 상충).
2. **처리 결과는 meeting_id 전송과 동일** — 서버가 회의를 확보(생성 또는 dedup 재사용)한 뒤, 이후 로직은 `meeting_id`가 전송된 것과 완전히 같게 동작한다: `meetingProjectId` 파생, `meeting_occurrence_date = date`, replace 시 `meetingIdProvided=true` 취급.
3. **dedup 멱등** — 같은 `(project_id, meeting_date, trim(title))` 회의가 이미 있으면 생성하지 않고 재사용한다. 복수 매칭 시 `created_at` 최신 1건. 또박또박 재시도(응답 유실 후 재전송)가 회의를 중복 생성하지 않게 하는 안전망이다.
4. **on_conflict=skip/error 시 회의를 만들지 않는다** — 기존 external_id 레코드가 있고 skip/error로 분기되면 회의 생성 없이 기존 규약대로 응답한다(§3 구현 순서 참조). skipped 응답에 `meeting_created`를 넣지 않는다.
5. **생성 속성 고정** — `body:''`, `recurrence:'none'`, `recurrence_until:null`, `start_time:null`, `end_time:null`, `location:null`, `created_by = user_email로 resolve된 auth user id`, `created_by_name = ResolvedUser.name` (`resolveUserByEmail` 반환값 — `route.ts:352` 참조).

**권한 규약:**

- 회의 생성은 프로젝트 멤버만 — `project_members`에서 `project_id = meeting.project_id AND user_id = <resolve된 user id>` 행 존재를 확인한다 (`user_id` 컬럼: `supabase/migrations/0019_project_member_user_link.sql`, NULL 허용이므로 계정 미연결 멤버는 매칭되지 않는다 — 의도된 동작, 내부 `requireProjectMember`와 동일 기준).
- 미달 시 **403 `not_project_member`** ("해당 프로젝트의 멤버가 아닙니다.") — 에러코드 신설. `apiFail(403, 'not_project_member', ...)`.
- dedup 재사용 경로에도 멤버십 검증을 **먼저** 적용한다 (비멤버가 dedup으로 타 프로젝트 회의에 연결하는 우회 차단).
- 참고: 기존 `meeting_id` 직접 전송 경로는 멤버십을 검증하지 않는 현행 규약을 유지한다(v2.4 하위호환 — 이번에 강화하지 않는다).

### 1.3 응답 확장

`meeting` 객체를 처리한 요청(created/replaced)의 응답에만 추가:

```json
{
  "meeting_id": "<확보된 회의 uuid>",
  "meeting_created": true
}
```

- `meeting_created: true` = 신규 생성, `false` = dedup 재사용
- `meeting` 미전송 요청에는 `meeting_created` 키 자체를 넣지 않는다 (기존 응답 불변 — 하위호환)
- `meeting_id` 필드는 기존에도 응답에 있다 (`respondMinute`, `route.ts:67`) — 값이 확보된 회의 id로 채워지는지만 확인

### 1.4 에러 규약 정리

| 상황 | status | code | 비고 |
|---|---|---|---|
| meeting 필드 형식·범위 위반 | 400 | `validation_failed` | `apiBadRequest` 재사용 |
| meeting + meeting_id 동시 전송 | 400 | `validation_failed` | |
| project_id 실존하지 않음 | 400 | `validation_failed` | "프로젝트를 찾을 수 없습니다." |
| user가 프로젝트 멤버 아님 | 403 | `not_project_member` | **신설** |
| (기존) meeting_id 실존하지 않음 | 400 | `validation_failed` | `route.ts:365` 현행 유지 |

---

## 2. 구현 지시 — 파일별

### 2.1 `src/lib/minutes/externalApi.ts` — payload 파싱 확장

`parseMinutePayload`(및 `ExternalMinutePayload` 타입)에 추가:

```ts
meetingProvided: boolean
meeting: { projectId: string; title: string; date: string; category: MeetingCategory } | null
```

- 검증 규칙은 §1.2 표 그대로. `MEETING_CATEGORIES`는 `@/lib/domain/meetings`에서 import (하드코딩 금지 — meta와 동일 소스).
- `meetingProvided && p.meetingIdProvided` → 파싱 단계에서 에러 반환 (상호배타).
- 기존 `meetingIdProvided`/`meetingId` 파싱과 같은 스타일(키 존재 여부 분리 추적)을 따른다.

### 2.2 신규 헬퍼 — `src/lib/minutes/meetings.ts` (신설)

```ts
export async function resolveOrCreateExternalMeeting(
  admin: AdminClient,
  m: { projectId: string; title: string; date: string; category: MeetingCategory },
  user: ResolvedUser,
): Promise<
  | { ok: true; meetingId: string; projectId: string; created: boolean }
  | { ok: false; status: 400 | 403 | 500; code: string; error: string }
>
```

순서:

1. `projects`에서 `id` 존재 확인 → 없으면 400 `validation_failed`
2. `project_members`에서 `project_id AND user_id = user.id` 존재 확인 → 없으면 403 `not_project_member`
3. dedup: `meetings` where `project_id`, `meeting_date = m.date`, `title = m.title(trim)` → `created_at` desc 1건 → 있으면 `{created: false}`
4. insert: §1.2 규약 5의 고정 속성으로 `meetings` insert → `{created: true}`
5. insert 성공 시 `revalidatePath('/p/' + projectId + '/meetings')`, `revalidatePath('/meetings')` — 내부 회의 페이지 캐시 갱신 (`src/app/actions/meetings.ts:71-74` `revalidateMeetings`와 동일 경로; route handler에서도 revalidatePath 호출 가능)
6. 조회·insert 에러는 '없음'으로 오인하지 말고 500으로 — 이 repo의 fail-closed 관례 (`route.ts:363` 주석, `meetings.ts:110-115` 주석 참조)

### 2.3 `src/app/api/v1/minutes/route.ts` — POST 본문 연결

현행 흐름 (`route.ts:337-383`): gate → user resolve → parse → meeting_id 존재 확인 → existing select → handleExisting | insertNew.

변경 — **회의 확보를 existing 분기 이후로 배치**해 skip/error 시 회의가 생기지 않게 한다:

```
gate → user resolve → parse (meeting 검증 포함)
→ existing select
→ existing && (archived_at ≠ null || on_conflict ∈ {skip, error})
    → 회의 생성 없이 기존 handleExisting 규약대로 응답 (409 archived / skipped / conflict — 계약 §1.2-4)
      (409 archived 분기가 회의 생성보다 먼저여야 실패 응답에 고아 회의가 안 생긴다)
→ p.meetingProvided (created 또는 replace 진입 확정 후)
    → resolveOrCreateExternalMeeting(...)
    → 실패면 해당 status/code로 즉시 응답
    → 성공이면 p.meetingId = meetingId, p.meetingIdProvided = true 로 주입
      (이후 handleExisting/insertNew는 무변경 — meetingProjectId도 반환된 projectId 사용)
→ 기존 흐름 계속
```

- `meeting_id` 직접 전송 경로(`route.ts:359-367`)는 손대지 않는다.
- 응답에 `meeting_created` 추가: `respondMinute`에 선택 인자 `meetingCreated?: boolean`을 더하고, 값이 undefined면 JSON에 키를 넣지 않는다 (기존 응답 스냅샷 불변).

**알려진 잔여 위험 (수용됨 — 해결 시도 금지):** 회의 insert와 minutes RPC는 별개 DB 호출이라, 회의 생성 성공 직후 minutes RPC가 실패하면 회의만 남는다. 재시도가 dedup으로 같은 회의를 재사용하므로 중복은 없고, 잔존 회의는 D'Flow UI에서 정상 회의로 보인다(무해). 완전 원자화는 RPC 신설이 필요해 기각.

### 2.4 `src/app/api/v1/minutes/meta/route.ts` — W1

`meta/route.ts:43-49` select·매핑에 `category`, `recurrence` 추가:

```ts
.select('id, title, meeting_date, category, recurrence')
// → { id, title, date: meeting_date, category, recurrence }
```

### 2.5 계약 문서 개정

`docs/design/dflow-minutes-upload-api-spec.md`를 v2.5로 개정 — §1의 계약 변경분을 해당 문서의 기존 섹션 체계(§4 요청, §4.3 응답, §5.2 meta, §6 에러코드)에 맞춰 반영하고 개정 이력에 v2.5 항목을 추가한다.

---

## 3. 테스트

기존 외부 API 테스트 `tests/minutes/external-api.test.ts`(및 `tests/minutes/folder-path.test.ts`)의 스타일을 따른다. 실행: `npm test` (vitest run). 최소 케이스:

1. `meeting` 유효 → 201, 회의 생성됨, `meeting_id` 응답 일치, `meeting_created: true`, minutes의 `project_id`·`meeting_occurrence_date` 파생 확인
2. 같은 요청 2회(external_id 다르게) → 2회째 `meeting_created: false` (dedup)
3. `meeting` + `meeting_id` 동시 → 400 `validation_failed`
4. `category` 생략 → `'general'`로 생성 / 잘못된 category → 400
5. `project_id` 미존재 → 400 / 비멤버 user_email → 403 `not_project_member`
6. 기존 external_id + `on_conflict: 'skip'` + `meeting` → skipped 응답, **회의 미생성** 확인
7. replace + `meeting` → 회의 확보 후 연결 갱신 (`meetingIdProvided=true` 경로), 응답 `meeting_created` 존재
8. `meeting` 미전송 기존 요청 → 응답에 `meeting_created` 키 부재 (하위호환 스냅샷)
9. meta: `project_id` 지정 시 `category`·`recurrence` 포함, 미지정 시 `meetings` 키 부재 유지

---

## 4. 수용 기준

- [ ] §1 계약대로 요청·응답·에러가 동작 (테스트 9건 green)
- [ ] `meeting` 미사용 요청의 응답 JSON이 v2.4와 바이트 수준 동등 (키 추가 없음)
- [ ] 기존 테스트 전체 green (회귀 없음)
- [ ] `docs/design/dflow-minutes-upload-api-spec.md` v2.5 개정 완료
- [ ] `meeting_id` 직접 전송 경로 diff 없음

## 5. 배포 순서

**D'Flow 먼저 배포 → 또박또박 배포.** 역순이면 또박또박이 보낸 `meeting` 필드를 구버전 D'Flow의 `parseMinutePayload`가 무시하거나 거절할 수 있다(파서 구현에 따라 400) — 순서만 지키면 플래그 불요. 또박또박은 사용자가 회의 연결을 명시적으로 선택한 요청에만 `meeting`/`meeting_id`를 보낸다.
