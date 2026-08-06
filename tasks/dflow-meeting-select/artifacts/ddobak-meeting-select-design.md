# 또박또박 설계 — D'Flow 전송 시 회의 선택·등록

- 버전: v1.0 (2026-08-06)
- 대상: /Users/jji/project/ddobakddobak (Rails backend + React frontend)
- 짝 문서: `dflow-meeting-create-spec.md` (D'Flow 측 계약 v2.5) — **D'Flow가 먼저 배포되어야 이 기능이 동작한다.** 미배포 상태에서 `meeting`/`meeting_id`를 보내면 400 가능.

## 0. UX 플로우 (SendToDflowDialog)

기존 다이얼로그(팀·제목·편철 경로)에 **"회의 연결 (선택)"** 섹션 추가:

```
[회의 연결 (선택)]
프로젝트: [드롭다운 — meta.projects]        (미선택 = 연결 안 함, 기본값)
  └ 선택 시 → 회의: [드롭다운 — 해당 프로젝트 회의 목록]
       **가장 위 옵션 = "➕ 신규 회의 등록"** (회의 없는 프로젝트도 이 옵션은 항상 표시)
       이하 기존 회의: 제목 · 날짜 · category 라벨 · (반복 배지: recurrence≠none)
       정렬: |meeting.date − 회의록 날짜| 오름차순 (가까운 회의 먼저)
  └ "➕ 신규 회의 등록" 선택 시 콤보 아래 인라인 3필드 (전부 프리필 — 추가 입력 없이 바로 전송 가능):
       제목   [회의록 제목 프리필, ≤200자]
       날짜   [회의 날짜(KST) 프리필, date input]
       구분   [select 6종, 기본 general]
```

- 재전송(이미 `dflow_meeting_id` 있음): 섹션이 현재 연결 스냅샷("프로젝트명 / 회의 제목") 표시 + [변경] [연결 해제] 액션. 손대지 않으면 **meeting 관련 필드를 아예 보내지 않는다** (3값 규약: 키 부재 = 유지).
- 전송 성공 후: 결과 영역에 연결된 회의 배지 표시.
- 미연결 전송은 항상 허용 (확정 결정 — 연결은 선택).

## 1. 데이터 모델 (마이그레이션 1건)

```ruby
add_column :meetings, :dflow_meeting_id, :string      # D'Flow 회의 uuid (nullable)
add_column :meetings, :dflow_meeting_title, :string   # 표시 스냅샷
add_column :meetings, :dflow_project_name, :string    # 표시 스냅샷
```

- 스냅샷 2필드는 표시 전용 — D'Flow 쪽에서 이름이 바뀌면 낡을 수 있음(수용). 정합의 SSOT는 `dflow_meeting_id`.
- ⚠️ 러닝 dev 서버 있으면 마이그 파일은 적용 직전까지 `db/migrate` 밖에 보관 (PendingMigrationError 함정).

## 2. Backend

### 2.1 `DflowClient` (`backend/app/services/dflow_client.rb`)

- `upload_minute(payload)` — 무변경 (payload passthrough). `meta(project_id)` — 이미 project_id 지원, 무변경.

### 2.2 `DflowUploadService` (`backend/app/services/dflow_upload_service.rb`)

옵션 확장: `meeting_id_action` 3태 + `new_meeting`.

```ruby
# 호출부에서 넘기는 옵션 (컨트롤러 파라미터 그대로)
#   meeting: { mode: "keep" | "link" | "unlink" | "create",
#              meeting_id: uuid,                       # mode=link
#              project_id:, title:, date:, category:,  # mode=create
#              display: { meeting_title:, project_name: } }  # link/create 시 스냅샷
```

payload 구성 (계약 v2.5):

| mode | payload |
|---|---|
| `keep` (기본) | meeting 관련 키 **부재** — D'Flow가 기존 연결 유지 |
| `link` | `meeting_id: <uuid>` |
| `unlink` | `meeting_id: null` (명시적 null 직렬화 주의 — 키를 넣고 값 null) |
| `create` | `meeting: { project_id:, title:, date:, category: }` |

사전 검증 (기존 검증 블록에 추가): `create` 시 제목 presence·≤200자, 날짜 형식, category 6종 enum. `link`와 `create` 동시 지정 방어(컨트롤러 400).

응답 처리: 성공 시 `resp["meeting_id"]` 저장 —

```ruby
meeting.update!(dflow_synced_at: ..., dflow_url: ...,
  dflow_meeting_id: resp["meeting_id"],          # unlink면 null로 클리어됨
  dflow_meeting_title: display[:meeting_title],   # keep이면 기존 유지 (update 제외)
  dflow_project_name: display[:project_name])
```

- `keep` 모드면 dflow_meeting_* 3필드를 update 대상에서 제외 (기존 값 유지).
- `unlink` 성공 시 3필드 모두 nil.

에러 매핑 추가 (`MeetingDflowController` 매핑 테이블):

| D'Flow 응답 | 사용자 메시지 |
|---|---|
| 403 `not_project_member` | "선택한 D'Flow 프로젝트의 멤버가 아닙니다." |
| 400 `validation_failed` (message에 "회의를 찾을 수 없습니다") | "연결하려던 회의가 D'Flow에서 삭제되었습니다. 연결을 해제하거나 다른 회의를 선택하세요." |

### 2.3 `MeetingDflowController` (`backend/app/controllers/api/v1/meeting_dflow_controller.rb`)

- `#upload`: `meeting` 파라미터 수신 → 서비스에 전달. `mode` 값 화이트리스트 검증(그 외 400).
- `#status`: 응답에 `dflow_meeting_id`, `dflow_meeting_title`, `dflow_project_name` 추가 (다이얼로그 재진입 시 현재 연결 표시용).
- `#link`(PUT, 수동 연결 재발급)와 무관 — meeting 연결은 upload 경로에서만 변경.

## 3. Frontend

### 3.1 API 레이어 (`frontend/src/lib/` dflow api 모듈)

- `uploadToDflow(meetingId, { teamOverride?, titleOverride?, meeting? })` — meeting 옵션 타입 추가 (§2.2 구조).
- `getDflowMeta(projectId?)` — project_id 파라미터 추가. 응답 타입에 `meetings?: { id; title; date; category; recurrence }[]`.
- `DflowStatus` 타입에 `dflow_meeting_id/title/project_name` 추가.

### 3.2 `SendToDflowDialog.tsx`

상태 추가:

```ts
meetingMode: 'keep' | 'none' | 'link' | 'create'   // 'none'=신규 전송 기본(키 부재), 'keep'=재전송 기본
selectedProjectId: string | null
projectMeetings: DflowMeetingItem[] | null          // 프로젝트 선택 시 getDflowMeta(projectId) 재호출 결과
selectedMeetingId: string | null
newMeeting: { title: string; date: string; category: MeetingCategory }
```

- 초기값: status에 `dflow_meeting_id` 있으면 `keep`, 없으면 `none`. `none`과 `keep` 둘 다 payload에 meeting 미포함 — 구분은 UI 표시용(현재 연결 배지 유무).
- 프로젝트 선택 → `getDflowMeta(projectId)` 호출(로딩 스피너, 실패 시 섹션 내 에러 + 재시도). 회의 정렬은 클라이언트에서 |date − 회의날짜| 오름차순.
- "+ 새 회의 등록" → `create` 모드, 제목=`buildDflowTitle` 결과 프리필, 날짜=회의 KST 날짜 프리필.
- 전송 버튼 활성 조건 추가: `link`면 selectedMeetingId 필수, `create`면 제목·날짜 유효.
- 전송 성공 → `sendResult`에 `meeting_id`/`meeting_created` 반영, 배지 "회의 연결됨"(+ "새 회의 등록됨" if created), `onChanged` 콜백 기존 유지.
- category 라벨 상수: `{ routine: '정례', general: '일반', kickoff: '킥오프', review: '리뷰', report: '보고', external: '외부' }` — D'Flow enum 6종과 1:1.

## 4. 엣지 케이스

1. **회의 삭제됨**: `keep` 재전송은 키 부재라 D'Flow가 검증 안 함 → 성공하되 D'Flow에서 연결은 이미 set null(FK on delete set null) — 다음 status 조회로는 안 드러남(스냅샷 잔존). 수용: 사용자가 [변경]으로 재선택하면 정리됨. `link`로 삭제된 id 보내면 400 → §2.2 에러 매핑.
2. **meta에 projects 없음/비어있음**: 섹션에 "D'Flow 프로젝트 없음" 안내, 연결 없이 전송 유도.
3. **create 후 클라이언트 응답 유실**: 재전송 시 또 `create` 보내도 D'Flow dedup(project+date+title)이 재사용 — 중복 회의 없음.
4. **하위호환**: meeting 파라미터 없는 기존 클라이언트/테스트 → 종전과 동일 동작 (서비스 기본 mode=keep=키 부재).

## 5. 구현 순서 (또박또박)

1. 마이그레이션 + Meeting 모델 (스냅샷 3컬럼)
2. DflowUploadService meeting 옵션 + payload + 응답 저장 (+ 단위 테스트: 4 mode별 payload, 응답 저장, unlink 클리어)
3. Controller 파라미터·status 확장 + 에러 매핑 (request spec)
4. Frontend API 타입·getDflowMeta(projectId)
5. SendToDflowDialog 섹션 UI + 상태 + 전송 배선
6. 검증: 전수 grep + `tsc -p tsconfig.app.json`(전체 0 기준) + vite build + backend spec
   - ⚠️ QA는 spec stub으로만 — 러닝 dev 서버·실 settings.yaml 건드리지 않음

## 6. 수용 기준

- [ ] 신규 전송: 프로젝트→회의 선택 후 전송 시 D'Flow 회의록이 해당 회의에 연결됨 (D'Flow 상세에서 확인)
- [ ] 신규 회의 등록 경로: 3필드 입력 → 전송 → D'Flow에 회의 생성 + 연결
- [ ] 미연결 전송 = 기존과 완전 동일 (payload diff 없음)
- [ ] 재전송 기본(keep) = meeting 키 부재, 기존 연결 유지
- [ ] 연결 해제 = meeting_id null 전송, 로컬 3필드 클리어
- [ ] 403 not_project_member / 회의 삭제 400 각각 안내 문구 노출
