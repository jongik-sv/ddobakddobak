# 회의 카드·목록 D'Flow 연결 상태 표시 + 필터

- 날짜: 2026-07-29
- 상태: 설계 승인됨 (사용자 승인 "가자")

## 목표

회의 목록(카드 그리드 / 테이블)에서 각 회의의 D'Flow 전송 여부를 한눈에 보이게 한다. 추가로
D'Flow 전송 상태로 목록을 필터링할 수 있게 한다.

현재는 상세 화면 헤더(`MeetingActionHeader.tsx:67-71`)에서만 배지가 뜬다. 목록 API 응답에는
`dflow_*` 필드가 아예 없어서(`meeting_serializable.rb:79-81`이 `full: true` 블록 안) 프론트만
고쳐서는 그릴 수 없다.

## 범위 결정 (사용자 확정)

- **배지 상태**: `전송됨` + `재전송 필요` 2종만. 미전송 회의는 배지 없음 (상세 헤더 규칙과 동일).
- **필터**: 3값 (`전송됨` / `재전송 필요` / `미전송`) + `전체`.
- 카드 배지는 링크가 아니다 (클릭 시 기존대로 회의 열기).

## 아키텍처

### 1. 백엔드 — 직렬화 (`app/controllers/concerns/meeting_serializable.rb`)

`dflow_synced_at`, `dflow_needs_resync` 두 필드를 `full` 블록 밖(항상 노출)으로 옮긴다.
`summarizing`이 받은 것과 같은 처리 — "목록(full:false)에도 노출" 주석 관용구를 따른다.

`public_uid`, `dflow_url`은 `full` 블록에 그대로 둔다 (카드가 링크를 걸지 않으므로 불필요).

### 2. 백엔드 — N+1 제거 (`app/models/meeting.rb`)

`dflow_needs_resync?`(`meeting.rb:427-431`)는 `active_summary`를 호출하고,
`active_summary`(`meeting.rb:374-381`)는 `summaries.find_by` / `summaries.order(...)`로
매번 SQL을 친다. **`includes(:summaries)`만 추가해서는 해결되지 않는다** — 두 호출 모두
association이 loaded여도 새 쿼리를 낸다.

`active_summary`를 loaded-aware로 만든다 (`meeting_attachments.loaded?` 기존 관용구와 동일 패턴):

- `summaries.loaded?`가 아니면 기존 SQL 경로 그대로.
- loaded면 in-memory 분기를 쓰되 **SQL 분기와 결과가 정확히 일치해야 한다**:
  - `completed?` → `summary_type == "final"` 중 **최소 id** (bare `find_by`의 rowid/id 순서를 미러링),
    없으면 fallback으로.
  - fallback → `max_by { [generated_at, id] }` (`order(generated_at: :desc, id: :desc).first`와 동일).

`active_summary`는 `notes_markdown`(`meeting.rb:384`)과 상세 직렬화도 쓰므로 동작 변화가
없어야 한다. 기존 `meeting_spec.rb`의 active_summary 케이스를 loaded/unloaded 양쪽에서 돌린다.

컬렉션 직렬화 경로에 `:summaries` preload를 추가한다. 대상은 `meeting_json`을 컬렉션으로
호출하는 두 곳뿐:

- `meetings_controller#index` (`:79`) — 현재 `includes(:creator, :tags, :meeting_attachments)`
- `meetings_controller#scheduled` (`:96`) — 동일 includes

나머지 `meeting_json` 호출부는 전부 단일 레코드라 대상 아님.

### 3. 백엔드 — 필터 (`app/controllers/api/v1/meetings_controller.rb#index`)

파라미터: `dflow_status` ∈ `synced` | `needs_resync` | `not_sent`. 그 외 값·빈 값은 무시(전체).

**적용 위치가 핵심**: `folder_id`/`project_id`/`important`와 같은 자리, 즉
`status_counts = scope.group(:status).count` **앞**의 `scope`에 건다. 뒤에 붙이면 상태 탭
카운트와 실제 행이 어긋난다.

부작용 1건을 주석으로 명시한다: `scope.where(status: :recording).find_each(&:heal_stale_recording!)`도
같은 `scope`를 쓰므로, `dflow_status` 필터가 걸린 요청은 stuck recording 회의를 치유하지 않는다.
기존 "보이는 것 기준으로 청소" 주석과 일관하며, 필터 없는 다른 요청이 치유하므로 수용한다.

스코프는 `Meeting`의 named scope로 둔다 (컨트롤러 인라인 SQL 금지):

```ruby
scope :dflow_synced,      -> { where.not(dflow_synced_at: nil) }
scope :dflow_not_sent,    -> { where(dflow_synced_at: nil) }
scope :dflow_needs_resync, -> { ... }   # 아래 SQL
```

`needs_resync` SQL은 EXISTS 형태를 먼저 시도한다:

```sql
public_uid IS NOT NULL AND dflow_synced_at IS NOT NULL AND (
  last_user_edit_at > dflow_synced_at
  OR EXISTS (SELECT 1 FROM summaries s
             WHERE s.meeting_id = meetings.id AND s.updated_at > meetings.dflow_synced_at)
)
```

이 SQL이 Ruby `dflow_needs_resync?`와 갈리는 경우는 **비활성 요약이 동기화 이후 갱신될 때**뿐이다
(completed 회의의 realtime 요약이 나중에 수정되거나, final이 여러 개인 경우). 실측 확인:
realtime 저장 경로는 저장 직전 `meeting.reload` 후 `meeting.completed?`면 스킵한다
(`meeting_summarization_job.rb:206-211`) — 도달 경로가 사실상 없다.

**그래도 추정으로 끝내지 않는다.** request spec으로 다음 매트릭스에서
`필터 결과 집합 == dflow_needs_resync?가 true인 회의 집합`을 단언한다:

1. 미전송 (`dflow_synced_at` nil)
2. 전송 후 무변경
3. 전송 후 `last_user_edit_at` 갱신
4. 전송 후 final 요약 수정
5. completed + final/realtime 요약 공존, realtime만 전송 후 수정
6. reopen (completed → recording 복귀) 후 realtime 갱신

어긋나는 행이 나오면 그때 `active_summary` 선택 규칙을 SQL로 미러링한다(CASE rank 정렬).
관측 가능한 버그는 "재전송 필요" 필터가 초록 `D'Flow ✓` 배지를 단 행을 반환하는 것.

### 4. 프론트 — 공용 배지 컴포넌트

`MeetingActionHeader.tsx:67-71`의 삼항 로직을 공용 컴포넌트 `DflowSyncBadge`로 추출한다
(`components/meeting/MeetingListUI.tsx`의 `StatusBadge` 옆, 또는 별도 파일).

- 우선순위: `dflow_needs_resync` > `dflow_synced_at` > null(렌더 안 함).
- `전송됨`: `D'Flow ✓`, emerald 계열, title `D'Flow로 전송된 회의입니다`
- `재전송 필요`: `D'Flow 재전송 필요`, amber 계열, title `회의록이 마지막 전송 이후 수정되었습니다`
- `compact` prop으로 크기 변형 (목록: `px-1.5 py-0 text-[10px]`, 헤더: 기존 `isDesktop` 분기 유지).

소비처 3곳: `MeetingActionHeader`(기존 로직 대체), `MeetingCardGrid`, `MeetingListTable`.
복붙하지 않는다 — 우선순위 규칙이 3벌로 갈라진다.

배치:
- `MeetingCardGrid.tsx`: 배지 줄(`:128-146`, MeetingIdBadge/타입/폴더/태그 나란한 wrap 영역)에 추가.
- `MeetingListTable.tsx`: `StatusBadge`/`MeetingTypeBadge`가 있는 셀(`:193-194`)에 추가.

### 5. 프론트 — 필터 체인 (7홉 전부 — 하나라도 빠지면 조용히 no-op)

1. `stores/meetingStore.ts` — `dflowFilter` 필드 + 세터 (`statusFilter`/`dateFrom` 옆)
2. `pages/MeetingsPage.tsx:139` — **디바운스 fetch effect의 deps에 추가**. 빠뜨리면 필터를 바꿔도
   fetch가 안 된다.
3. `MeetingsPage.tsx:251-254` — 데스크톱 필터 행에 select 추가
4. `MeetingsPage.tsx:346-399` — 모바일 BottomSheet에 동일 컨트롤 + `:399` 초기화 핸들러에서 클리어
5. `api/meetings/types.ts:144-151` — `GetMeetingsParams`에 `dflow_status?`
6. `api/meetings/lifecycle.ts:26-38` — searchParams 빌더에 전달
7. 컨트롤러 `index` (위 3절)

**URL 동기화 안 함.** 현재 URL에 동기화되는 필터는 `status`뿐이고 날짜 필터도 안 한다 — 일관 유지.

**D'Flow 비활성 시 필터 숨김**: `MeetingsPage`에서 `getDflowSettings()`를 마운트 시 1회 호출해
`enabled=false`면 필터 컨트롤을 렌더하지 않는다 (`ExportButton.tsx:71` 패턴 그대로). 배지는 게이팅
불필요 — 전송 기록이 있을 때만 렌더되므로. 이 호출을 설정 스토어 리팩토링으로 키우지 않는다.

## 테스트

백엔드 (RSpec):
- `meetings_spec.rb`: 목록 응답에 `dflow_synced_at`/`dflow_needs_resync` 존재, `public_uid`/`dflow_url`
  부재
- `meetings_spec.rb`: `dflow_status` 3값 각각의 결과 집합
- `meetings_spec.rb`: 필터가 걸려도 `status_counts`/`total`이 반환 행과 일치
- 위 3절 패리티 매트릭스 (필터 SQL == Ruby 술어)
- 쿼리 수 회귀: 목록 N건에서 summaries 쿼리 1회 (preload 검증)
- `meeting_spec.rb`: `active_summary`가 loaded/unloaded에서 동일 레코드 반환

프론트 (vitest):
- `DflowSyncBadge`: 3상태(미전송=null 렌더, 전송됨, 재전송필요) + 우선순위
- `MeetingCardGrid` / `MeetingListTable`: 배지 렌더/미렌더
- `MeetingsPage`: 필터 변경 → `getMeetings`에 `dflow_status` 전달, 초기화 시 클리어,
  D'Flow 비활성이면 필터 미표시

## 하지 않는 것 (YAGNI)

- 카드 배지에서 D'Flow 링크로 이동 (상세에서 가능)
- 목록에서 일괄 전송/재전송 액션
- `dflow_status` URL 동기화
- 전용 설정 스토어 도입
