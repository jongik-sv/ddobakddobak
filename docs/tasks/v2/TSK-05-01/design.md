# TSK-05-01: 회의 공유 모델 및 API - 설계

## 구현 방향
- MeetingParticipant 모델을 신규 생성하여 회의 참여자(host/viewer)를 관리한다.
- Meeting 모델에 share_code 필드를 추가하여 6자리 영숫자 공유 코드를 지원한다.
- 공유/참여/위임 API를 MeetingSharesController로 분리 구현한다.
- 참여자 수 최대 20명 제한, 호스트 나가기 시 자동 위임 로직을 서비스 객체로 분리한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `backend/db/migrate/XXXXXX_create_meeting_participants.rb` | MeetingParticipant 테이블 생성 마이그레이션 | 신규 |
| `backend/db/migrate/XXXXXX_add_share_code_to_meetings.rb` | meetings 테이블에 share_code 컬럼 추가 | 신규 |
| `backend/app/models/meeting_participant.rb` | MeetingParticipant 모델 (meeting_id, user_id, role, joined_at, left_at) | 신규 |
| `backend/app/models/meeting.rb` | has_many :meeting_participants 연관 추가, share_code 관련 메서드 | 수정 |
| `backend/app/models/user.rb` | has_many :meeting_participants 연관 추가 | 수정 |
| `backend/app/controllers/api/v1/meeting_shares_controller.rb` | 공유 코드 생성/중지, 참여, 참여자 목록, 호스트 위임 API | 신규 |
| `backend/app/services/meeting_share_service.rb` | 공유 코드 생성/삭제, 참여, 호스트 위임, 자동 위임 비즈니스 로직 | 신규 |
| `backend/config/routes.rb` | meetings 리소스에 share/join/participants/transfer_host 라우트 추가 | 수정 |
| `backend/spec/models/meeting_participant_spec.rb` | MeetingParticipant 모델 테스트 | 신규 |
| `backend/spec/requests/api/v1/meeting_shares_spec.rb` | 공유 API 요청 테스트 | 신규 |
| `backend/spec/services/meeting_share_service_spec.rb` | 서비스 로직 테스트 | 신규 |

## 주요 구조

### MeetingParticipant 모델
- `belongs_to :meeting`, `belongs_to :user`
- `validates :role, inclusion: { in: %w[host viewer] }`
- `validates :user_id, uniqueness: { scope: :meeting_id, conditions: -> { where(left_at: nil) } }` (활성 참여자 중복 방지)
- `scope :active` — `where(left_at: nil)` (현재 참여 중인 사용자)
- `scope :host` — `where(role: "host")`

### Meeting 모델 확장
- `has_many :meeting_participants, dependent: :destroy`
- `has_many :active_participants, -> { where(left_at: nil) }, class_name: "MeetingParticipant"`
- `validates :share_code, uniqueness: true, allow_nil: true`
- `#sharing?` — `share_code.present?`
- `#host_participant` — `active_participants.find_by(role: "host")`

### MeetingShareService
- `#generate_share_code(meeting, user)` — 이미 공유 중이면 기존 코드 반환, 아니면 `SecureRandom.alphanumeric(6).upcase`로 생성 + 호출자를 host participant로 등록
- `#revoke_share_code(meeting, user)` — share_code를 nil로 설정, 모든 활성 참여자의 left_at 설정
- `#join_meeting(share_code, user)` — 코드로 회의 찾기, 이미 참여 중이면 기존 정보 반환, 아니면 viewer로 참여 (20명 제한 체크)
- `#transfer_host(meeting, current_user, target_user_id)` — 현재 host를 viewer로, 대상을 host로 변경
- `#leave_meeting(meeting, user)` — left_at 설정, 호스트가 나가면 자동 위임 (joined_at 가장 빠른 viewer에게)

### MeetingSharesController
- `before_action :authenticate_user!`
- `POST /api/v1/meetings/:id/share` → `#create_share` — 공유 코드 생성 (회의 소유자만)
- `DELETE /api/v1/meetings/:id/share` → `#destroy_share` — 공유 중지 (호스트만)
- `POST /api/v1/meetings/join` → `#join` — 공유 코드로 참여
- `GET /api/v1/meetings/:id/participants` → `#participants` — 참여자 목록 (참여자만 조회 가능)
- `POST /api/v1/meetings/:id/transfer_host` → `#transfer_host` — 호스트 위임 (현재 호스트만)

## 데이터 흐름

### 공유 코드 생성
호스트 요청 → MeetingSharesController#create_share → MeetingShareService#generate_share_code → share_code 생성 + MeetingParticipant(host) 생성 → { share_code, participants } 응답

### 공유 코드로 참여
참여자 요청(share_code) → MeetingSharesController#join → MeetingShareService#join_meeting → share_code로 Meeting 조회 → 20명 제한 체크 → MeetingParticipant(viewer) 생성 → { meeting, participant } 응답

### 호스트 위임
호스트 요청(target_user_id) → MeetingSharesController#transfer_host → MeetingShareService#transfer_host → 현재 host→viewer, 대상→host 트랜잭션 → { participants } 응답

### 호스트 자동 위임 (나가기 시)
호스트 나가기 → MeetingShareService#leave_meeting → left_at 설정 → 활성 viewer 존재 확인 → joined_at 가장 빠른 viewer를 host로 승격 → ActionCable 브로드캐스트 (host_changed 이벤트)

## 데이터 모델 상세

### meeting_participants 테이블
```ruby
create_table :meeting_participants do |t|
  t.references :meeting, null: false, foreign_key: true
  t.references :user, null: false, foreign_key: true
  t.string :role, null: false, default: "viewer"  # "host" / "viewer"
  t.datetime :joined_at, null: false
  t.datetime :left_at                              # null = 현재 참여 중
  t.timestamps
end

add_index :meeting_participants, [:meeting_id, :user_id, :left_at],
          name: "idx_participants_meeting_user_active"
add_index :meeting_participants, [:meeting_id, :role],
          name: "idx_participants_meeting_role"
```

### meetings 테이블 변경
```ruby
add_column :meetings, :share_code, :string
add_index :meetings, :share_code, unique: true
```

## API 상세

### POST /api/v1/meetings/:id/share
- 권한: 회의 생성자 (created_by_id == current_user.id)
- 요청: 없음
- 응답: `{ share_code: "A1B2C3", participants: [...] }`
- 이미 공유 중이면 기존 코드 반환 (멱등)

### DELETE /api/v1/meetings/:id/share
- 권한: 현재 호스트
- 요청: 없음
- 응답: `204 No Content`
- share_code를 nil로, 모든 활성 참여자에 left_at 설정

### POST /api/v1/meetings/join
- 권한: 인증된 사용자
- 요청: `{ share_code: "A1B2C3" }`
- 응답: `{ meeting: {...}, participant: {...} }`
- 이미 참여 중이면 기존 참여 정보 반환 (멱등)
- 에러: 유효하지 않은 코드 (404), 참여자 수 초과 (422)

### GET /api/v1/meetings/:id/participants
- 권한: 회의 참여자 또는 회의 생성자
- 응답: `{ participants: [{ id, user_id, user_name, role, joined_at }] }`

### POST /api/v1/meetings/:id/transfer_host
- 권한: 현재 호스트
- 요청: `{ target_user_id: 5 }`
- 응답: `{ participants: [...] }`
- 에러: 대상이 활성 참여자가 아닌 경우 (422)

## 선행 조건
- TSK-01-01 (사용자 인증 — JWT, User 모델) [xx] — 완료됨
