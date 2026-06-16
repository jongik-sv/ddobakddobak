# 회의 잠금 + 중요 플래그 설계

날짜: 2026-06-16
대상 repo: `/Users/jji/project/ddobakddobak` (Rails 백엔드 + Tauri/React 프론트)

## 목표

두 독립 기능을 추가한다.

1. **회의 잠금 (완전 읽기전용)** — 잠긴 회의는 STT 재시작·화자분리·요약·회의록/전사 편집·삭제 등 모든 변경(mutate)이 막힌다. 확정된 회의를 실수 재처리/편집으로 망가뜨리는 사고를 방지한다.
2. **중요 플래그 (boolean)** — 폴더와 회의 각각 `important` 플래그를 가진다. 회의 목록(최근 회의)에는 `important=true`인 회의만 뜬다. "전체 보기" 토글로 전부 노출. 회의 생성 시 소속 폴더의 플래그를 기본값으로 상속.

두 기능 모두 기존 기능 동작은 변경하지 않는다(잠금 안 한 회의 / `show_all` 토글 켠 목록은 현행과 동일).

---

## 기능 1 — 회의 잠금

### 데이터 모델

- `meetings.locked_at:datetime` (nullable). `null`=잠금해제, 값=잠긴 시각.
- 모델 헬퍼: `def locked? = locked_at.present?`
- (누가 잠갔는지까지 필요하면 후속 — 1차는 시각만. YAGNI)

### 가드 아키텍처 (누수 방지가 핵심)

회의를 변경하는 엔드포인트는 17개 컨트롤러에 흩어진 **43개**다. 하나라도 빠지면 잠금 누수. 중앙화 + 전수 테스트로 보장한다.

**`MeetingWriteGuard` concern** (신규, `app/controllers/concerns/meeting_write_guard.rb`):

```ruby
module MeetingWriteGuard
  extend ActiveSupport::Concern

  private

  # 잠긴 회의의 변경을 거부. @meeting 이 있으면 그걸, 없으면 컨트롤러가
  # 정의한 locked_meeting (자식 리소스 → 소유 회의 역참조)을 본다.
  def reject_if_locked!
    meeting = respond_to?(:locked_meeting, true) ? locked_meeting : @meeting
    return if meeting.nil? || !meeting.locked?
    render json: { error: "잠긴 회의입니다. 잠금을 해제한 뒤 다시 시도하세요." }, status: :forbidden
  end
end
```

- `app/controllers/concerns/` 는 이미 존재하는 autoload 루트 → 새 루트 추가 아님(서버 재시작 불필요 함정 회피).
- **meeting_id 스코프 컨트롤러** (대다수): `@meeting`을 그대로 사용. mutating 액션에 `before_action :reject_if_locked!` 추가.
- **자식-id 스코프 컨트롤러** (`action_items#update/destroy`, `decisions#update/destroy`, `speakers#update/destroy_all`, `glossary_entries#update/destroy`): 자식 레코드 → 소유 회의를 `locked_meeting` private 메서드로 노출. 예: `def locked_meeting = @action_item.meeting`.
- **default-deny 원칙**: mutating 액션에만 `only:`로 가드를 거는 게 아니라, 안전을 위해 각 컨트롤러에서 "읽기 액션 allowlist를 `except:`로 빼고 전부 가드" 방식을 우선한다(새 mutating 액션이 추가돼도 자동 보호). 단 컨트롤러 구조상 어려우면 명시적 `only:` 목록 + 전수 테스트로 보장.

### 잠금 시 허용(allowlist)

- 읽기(GET) 전부.
- `chat_messages#create` — 챗 질문은 회의 *내용*을 바꾸지 않음(개인 Q&A 기록만 추가). 잠금 중에도 허용.
- 잠금/해제 엔드포인트 자체 (아래) — 가드 예외(아니면 영원히 못 풂).

### 잠금/해제 엔드포인트

`config/routes.rb` meetings member 라우트에 추가:

- `POST   /api/v1/meetings/:id/lock`   → `meetings#lock`
- `DELETE /api/v1/meetings/:id/lock`   → `meetings#unlock`

- 권한: `authorize_meeting_control!` 사용하되, **잠금/해제는 소유자/admin만**(`editable_by?`). 현 `authorize_meeting_control!`는 host participant도 통과시키므로, lock/unlock 액션은 `@meeting.editable_by?(current_user)` 직접 체크로 더 좁힌다.
- `lock`: `update_column(:locked_at, Time.current)` (idempotent — 이미 잠겨도 200). `unlock`: `update_column(:locked_at, nil)`.
- 이 두 액션은 `reject_if_locked!` 가드에서 제외.

### 직렬화

- `MeetingSerializable` 에 `locked_at`, `locked`(boolean) 필드 추가 → 프론트가 상태 표시/버튼 disable 판단.

### 프론트엔드

- `api/meetings.ts`: `lockMeeting(id)`, `unlockMeeting(id)`.
- 회의 타입에 `locked: boolean`, `locked_at` 추가.
- 회의 상세/헤더: 잠금 토글 버튼 + 자물쇠 배지. `locked`면 재처리/편집/삭제/전사편집/화자명변경 등 mutate UI를 disabled + 툴팁("잠긴 회의").
- 회의 목록行: 잠긴 회의에 자물쇠 아이콘.

### TDD 안전망

`spec/requests/meeting_lock_spec.rb`: 잠긴 회의를 만들고 **43개 mutate 엔드포인트 전부**를 호출 → 각각 `403` + 잠금 에러 메시지를 단언한다(table-driven). 챗·잠금/해제·읽기는 잠금 중에도 통과함을 별도 단언. 하나라도 빠지면 빨강 → 누수 자동 검출.

---

## 기능 2 — 중요 플래그

### 데이터 모델

- `meetings.important:boolean NOT NULL default false`
- `folders.important:boolean NOT NULL default false`

### 상속 (생성 시 시드)

- 회의 생성 경로(`meetings#create`, `meetings#upload_audio`, 그 외 회의를 만드는 모든 지점)에서 `important`를 명시하지 않으면 **소속 폴더의 `important`로 시드**한다.
- 폴더 없는 회의 → 전역 default(`false`).
- 모델 콜백으로 강제(쓰기 지점 누락 방지): `before_validation :inherit_importance_from_folder, on: :create`, 단 사용자가 명시적으로 값을 줬으면 보존. 구현: `self.important = folder&.important || false if important.nil?` — 단 컬럼이 NOT NULL default false라 `important`가 nil이 아닐 수 있으므로, "사용자 미지정"을 구분하기 위해 create 시 폴더값을 우선 적용하되 파라미터로 온 값이 있으면 그 값 사용. (상세는 plan에서 확정)
- 폴더 플래그를 나중에 바꿔도 **기존 회의는 안 바뀐다**(스냅샷). 회의 이동 시에도 재상속 안 함. (YAGNI — 필요 시 후속 "폴더 전체 적용" 버튼)

### 가시성 쿼리

- `meetings_controller#index`: `params[:show_all]`가 없으면 `where(important: true)` 추가. 있으면 필터 해제(현행 동일).
- 폴더 플래그는 쿼리에 들어가지 않음 — 회의 자신의 플래그만 본다(상속은 생성 시 1회).

### 마이그레이션 백필

- 컬럼 추가 시 **기존 회의·폴더는 `important: true`로 백필**(현 "전부 보임" 동작 보존 — 마이그레이션 직후 최근목록이 텅 비는 사고 방지). 신규 record의 컬럼 default만 `false`(앞으로 큐레이션).

### 직렬화

- `MeetingSerializable`에 `important` 추가.
- 폴더 직렬화(folders#index / tree)에 `important` 추가.

### 변경 엔드포인트

- 회의 `important` 토글: 기존 `meetings#update`의 permit 파라미터에 `:important` 추가(별도 엔드포인트 불필요). 단 **잠긴 회의면 update가 막히므로**, 중요 토글만은 잠금과 무관히 허용할지 결정 필요 → 1차는 update 경유(잠기면 같이 막힘, 일관성). 
- 폴더 `important` 토글: `folders#update`(또는 폴더 컨트롤러의 수정 액션) permit에 `:important` 추가.

### 프론트엔드

- `api/meetings.ts` `getMeetings`에 `show_all` 파라미터 추가. `meetingStore`에 `showAll` 상태 + 토글 액션, `fetchMeetings`가 전달.
- 회의 타입에 `important: boolean`. 회의行/상세에 중요 토글(별 아이콘 등).
- 폴더 타입/트리에 `important`. 폴더 컨텍스트 메뉴/설정에 중요 토글.
- 목록 헤더에 "전체 보기" 토글(기본 off = 중요회의만). off일 때 important=false 회의는 숨김.

---

## 운영/마이그레이션 주의

- **dev 서버가 포트 13323에서 가동 중**. `db/migrate`에 파일을 추가만 해도 PendingMigration으로 전 요청 500(메모리 함정). → 마이그레이션 파일 생성 직후 즉시 `rails db:migrate` 실행, 또는 서버 잠시 정지 후 진행. 검증 전까지 미적용 파일을 `db/migrate`에 방치하지 말 것.
- 새 concern은 기존 autoload 루트(`app/controllers/concerns/`) 안 → 서버 재시작 불필요.

## 테스트 계획

- **모델 spec**: `locked?`, 중요 상속(`inherit_importance_from_folder`), 폴더없음 default.
- **request spec (잠금 누수)**: 43개 mutate 엔드포인트 전수 403. allowlist(챗·lock/unlock·읽기) 통과.
- **request spec (중요 필터)**: index가 기본 important=true만, `show_all`이면 전부. 생성 시 폴더 상속.
- **request spec (lock/unlock)**: 소유자/admin만 가능, 타인 403, idempotent.
- **프론트**: 잠금 시 버튼 disabled, 중요 토글, 전체보기 토글. 최소 vite build 통과 + 기존 vitest green.

## 범위 밖 (YAGNI)

- 잠금 사유/잠근 사용자 기록, 시간제한 잠금.
- 폴더 플래그 변경 시 기존 회의 일괄 재적용("폴더 전체 적용" 버튼) — 후속.
- 중요도 상/중/하 다단계(초안에서 boolean으로 단순화 확정).
- 잠금 상태에서 중요 토글만 별도 허용(1차는 update와 함께 잠김).
