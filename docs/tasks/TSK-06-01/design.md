# TSK-06-01: 회의 CRUD API - 설계

## 구현 방향

`MeetingsController`를 신규 생성하여 회의 목록/생성/상세/수정/삭제 및 녹음 시작·종료 7개 엔드포인트를 구현한다. 기존 `TeamAuthorizable` concern과 `MeetingFinalizerService`를 그대로 활용하고, 상세 응답(transcripts, summary, action_items 포함)은 컨트롤러 내 `meeting_json` 헬퍼로 직렬화한다. 오디오 스트리밍은 `send_file`로 처리하며, 라우트에 기존 nested resources와 충돌하지 않도록 `member` 블록을 추가한다.

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `backend/app/controllers/api/v1/meetings_controller.rb` | 회의 CRUD + start/stop/audio 엔드포인트 | 신규 |
| `backend/config/routes.rb` | meetings 라우트 추가 (index, create, show, update, destroy, start, stop, audio) | 수정 |
| `backend/app/models/meeting.rb` | scope 추가 (search, for_team) | 수정 |
| `backend/spec/requests/api/v1/meetings_spec.rb` | 전 엔드포인트 request spec | 신규 |

---

## 주요 구조

**`Api::V1::MeetingsController`**
- `index` — 팀 소속 회의 목록 반환. `page`, `per` 파라미터로 페이징, `q` 파라미터로 title LIKE 검색
- `create` — `{ title, team_id }` 수신, 팀 멤버십 확인 후 `Meeting` 생성. `created_by_id = current_user.id`
- `show` — 회의 상세. transcripts(sequence_number 순), summary(final 우선), action_items(created_at 순) 포함
- `update` — `{ title }` 수신, 생성자 또는 팀 admin만 수정 가능 (`require_resource_owner_or_admin!`)
- `destroy` — 생성자 또는 팀 admin만 삭제 가능. 연관 레코드 cascade 삭제는 모델 `dependent: :destroy`로 처리
- `start` — `pending` 상태 확인 후 `status = "recording"`, `started_at = Time.current` 저장
- `stop` — `recording` 상태 확인 후 `status = "completed"`, `ended_at = Time.current` 저장, `MeetingFinalizerService#call` 실행
- `audio` — `audio_file_path` 존재 확인 후 `send_file`로 스트리밍 (Content-Type: audio/webm)

**`set_meeting` (private)**
- `current_user` 소속 팀의 회의만 조회하여 소유권 검증. `Meeting.joins(:team).where(teams: { id: team_ids }).find(params[:id])`

**`Meeting` 모델 scope**
- `scope :for_team, ->(team_ids) { where(team_id: team_ids) }`
- `scope :search, ->(q) { where("title LIKE ?", "%#{q}%") if q.present? }`

**`meeting_json` (private 헬퍼)**
- index용 간략 응답과 show용 전체 응답을 `full: true` 옵션으로 분기

---

## 데이터 흐름

**목록/검색:** `GET /api/v1/meetings?page=1&per=20&q=키워드` → 팀 소속 필터 + LIKE 검색 → `{ meetings: [...], meta: { total, page, per } }`

**생성:** `POST /api/v1/meetings { title, team_id }` → 팀 멤버십 확인 → `Meeting.create!(title, team_id, created_by_id)` → 201 응답

**상세:** `GET /api/v1/meetings/:id` → 팀 소속 확인 → transcripts + summary + action_items includes → 200 응답

**수정/삭제:** `PATCH|DELETE /api/v1/meetings/:id` → 팀 소속 + 소유자/admin 확인 → 업데이트 또는 삭제

**녹음 시작:** `POST /api/v1/meetings/:id/start` → `pending` 상태 검증 → `recording` 전환 → 200 응답

**녹음 종료:** `POST /api/v1/meetings/:id/stop` → `recording` 상태 검증 → `completed` 전환 → `MeetingFinalizerService#call` → 200 응답

**오디오 스트리밍:** `GET /api/v1/meetings/:id/audio` → `audio_file_path` 존재 확인 → `send_file` (Range 요청 지원)

---

## 선행 조건

- TSK-00-04: DB 스키마 및 Rails 기본 환경 (`meetings`, `transcripts`, `summaries`, `action_items` 테이블 존재)
- TSK-01-03: JWT 인증 (`authenticate_user!`, `current_user`) 및 `TeamAuthorizable` concern 구현 완료
- `MeetingFinalizerService` (TSK-05-02에서 구현 완료)
- `audio_file_path` 컬럼이 meetings 테이블에 존재 (마이그레이션 확인 완료)
