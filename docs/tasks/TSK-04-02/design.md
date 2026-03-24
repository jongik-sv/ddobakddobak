# TSK-04-02: 블록 CRUD API - 설계 문서

## 1. API 엔드포인트 설계

### 라우트 구조

```ruby
namespace :api do
  namespace :v1 do
    resources :meetings, only: [] do
      resources :blocks, only: %i[index create update destroy] do
        member do
          patch :reorder
        end
      end
    end
  end
end
```

### 엔드포인트 목록

| Method | Path | 설명 |
|--------|------|------|
| GET    | `/api/v1/meetings/:meeting_id/blocks` | 블록 목록 조회 (position 순) |
| POST   | `/api/v1/meetings/:meeting_id/blocks` | 블록 생성 |
| PATCH  | `/api/v1/meetings/:meeting_id/blocks/:id` | 블록 수정 |
| DELETE | `/api/v1/meetings/:meeting_id/blocks/:id` | 블록 삭제 |
| PATCH  | `/api/v1/meetings/:meeting_id/blocks/:id/reorder` | 블록 순서 변경 |

### GET /api/v1/meetings/:meeting_id/blocks

- 인증: JWT 필수
- 응답: 200 OK, blocks 배열 (position ASC)
- 에러: 404 (meeting 없음), 403 (권한 없음)

### POST /api/v1/meetings/:meeting_id/blocks

Request body:
```json
{
  "block": {
    "block_type": "text",
    "content": "내용",
    "parent_block_id": null,
    "position": 1000.0
  }
}
```

- position을 명시하지 않으면 서버에서 마지막 블록 기준으로 자동 계산
- 응답: 201 Created, 생성된 block 객체
- 에러: 422 (유효성 오류), 404, 403

### PATCH /api/v1/meetings/:meeting_id/blocks/:id

Request body:
```json
{
  "block": {
    "block_type": "heading1",
    "content": "수정된 내용"
  }
}
```

- position, parent_block_id도 수정 가능
- 응답: 200 OK, 수정된 block 객체
- 에러: 422, 404, 403

### DELETE /api/v1/meetings/:meeting_id/blocks/:id

- 응답: 204 No Content
- 에러: 404, 403

### PATCH /api/v1/meetings/:meeting_id/blocks/:id/reorder

Request body:
```json
{
  "prev_block_id": 5,
  "next_block_id": 8
}
```

- `prev_block_id`: 이동할 위치의 바로 앞 블록 ID (없으면 null)
- `next_block_id`: 이동할 위치의 바로 뒤 블록 ID (없으면 null)
- 서버에서 새 position 계산 후 해당 블록 업데이트
- 응답: 200 OK, 업데이트된 block 객체 (rebalance 발생 시 전체 블록 목록)
- 에러: 422, 404, 403

---

## 2. Fractional Indexing 설계

### 기본 원칙

- position 타입: Float (DB: REAL)
- 초기값: 첫 번째 블록 = `1000.0`
- 간격: 기본적으로 1000.0 단위로 생성 (1000.0, 2000.0, 3000.0, ...)

### 삽입 위치 계산

```ruby
module FractionalIndexing
  DEFAULT_START = 1000.0
  DEFAULT_GAP   = 1000.0
  REBALANCE_THRESHOLD = 0.001

  # 맨 앞에 삽입: prev 없음
  # position = next_position / 2
  def self.before(next_pos)
    next_pos / 2.0
  end

  # 맨 뒤에 삽입: next 없음
  # position = last_position + DEFAULT_GAP
  def self.after(prev_pos)
    prev_pos + DEFAULT_GAP
  end

  # 두 블록 사이 삽입
  # position = (prev + next) / 2
  def self.between(prev_pos, next_pos)
    (prev_pos + next_pos) / 2.0
  end

  # gap이 너무 작은지 확인
  def self.needs_rebalance?(prev_pos, next_pos)
    (next_pos - prev_pos).abs < REBALANCE_THRESHOLD
  end
end
```

### Rebalance

gap < 0.001 이면 해당 meeting의 전체 블록을 position 순으로 재정렬:

```ruby
def rebalance_positions(meeting)
  blocks = meeting.blocks.order(:position)
  blocks.each_with_index do |block, index|
    block.update_column(:position, (index + 1) * FractionalIndexing::DEFAULT_GAP)
  end
end
```

### 위치 계산 시나리오

| 시나리오 | prev_pos | next_pos | 새 position |
|---------|----------|----------|-------------|
| 첫 블록 생성 | - | - | 1000.0 |
| 맨 뒤 추가 | 3000.0 | - | 4000.0 |
| 맨 앞 삽입 | - | 1000.0 | 500.0 |
| 중간 삽입 | 1000.0 | 2000.0 | 1500.0 |
| 촘촘한 중간 | 1000.0 | 1000.001 | rebalance |

---

## 3. 중첩 블록 (parent_block_id)

### 데이터 구조

- `parent_block_id`: nullable integer, 자식 블록의 부모 블록 ID
- 자식 블록은 부모 블록과 동일한 `meeting_id`를 가짐
- 중첩 깊이 제한: 설계상 무제한이나 실용적으로 최대 5 depth 권장

### 목록 조회 방식

- **Flat 반환**: 중첩 구조 없이 모든 블록을 position ASC로 반환
- `parent_block_id` 필드 포함하여 클라이언트에서 트리 구성
- 이유: 간단한 쿼리, 클라이언트 유연성

```ruby
# Controller
def index
  @blocks = @meeting.blocks.order(:position)
  render json: @blocks.map { |b| block_json(b) }
end
```

### 유효성 검사

```ruby
# Block 모델
validates :parent_block_id, inclusion: {
  in: -> (block) {
    [nil] + block.meeting.block_ids
  },
  message: "must belong to the same meeting"
}, if: -> { parent_block_id.present? }
```

---

## 4. 접근 제어

### 권한 체인

```
Request → Meeting → Team → TeamMembership → User
```

### 구현 방식

```ruby
class Api::V1::BlocksController < ApplicationController
  before_action :authenticate_user!
  before_action :set_meeting
  before_action :authorize_meeting_member!
  before_action :set_block, only: %i[update destroy reorder]

  private

  def set_meeting
    @meeting = Meeting.find(params[:meeting_id])
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Meeting not found" }, status: :not_found
  end

  def authorize_meeting_member!
    unless @meeting.team.team_memberships.exists?(user: current_user)
      render json: { error: "Forbidden" }, status: :forbidden
    end
  end

  def set_block
    @block = @meeting.blocks.find(params[:id])
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Block not found" }, status: :not_found
  end
end
```

---

## 5. Block 모델 설계

### Enum

```ruby
# block_type enum (string column)
BLOCK_TYPES = %w[
  text
  heading1
  heading2
  heading3
  bullet_list
  numbered_list
  checkbox
  quote
  divider
].freeze

enum :block_type, BLOCK_TYPES.index_by(&:itself), prefix: false
```

### Validations

```ruby
class Block < ApplicationRecord
  belongs_to :meeting
  belongs_to :parent_block, class_name: "Block", optional: true

  BLOCK_TYPES = %w[
    text heading1 heading2 heading3
    bullet_list numbered_list checkbox quote divider
  ].freeze

  validates :block_type, inclusion: { in: BLOCK_TYPES }
  validates :position, presence: true, numericality: { greater_than: 0 }
  validates :meeting_id, presence: true
  validate :parent_block_same_meeting

  private

  def parent_block_same_meeting
    return unless parent_block_id.present?
    unless meeting.block_ids.include?(parent_block_id)
      errors.add(:parent_block_id, "must belong to the same meeting")
    end
  end
end
```

### Associations

```ruby
belongs_to :meeting
belongs_to :parent_block, class_name: "Block", optional: true
has_many :child_blocks, class_name: "Block", foreign_key: :parent_block_id, dependent: :destroy
```

---

## 6. 응답 JSON 구조

### 단일 블록

```json
{
  "id": 42,
  "meeting_id": 7,
  "block_type": "text",
  "content": "회의 내용입니다.",
  "position": 1500.0,
  "parent_block_id": null,
  "created_at": "2026-05-05T10:00:00.000Z",
  "updated_at": "2026-05-05T10:05:00.000Z"
}
```

### 목록 (index)

```json
[
  {
    "id": 1,
    "meeting_id": 7,
    "block_type": "heading1",
    "content": "회의 제목",
    "position": 1000.0,
    "parent_block_id": null,
    "created_at": "2026-05-05T10:00:00.000Z",
    "updated_at": "2026-05-05T10:00:00.000Z"
  },
  {
    "id": 2,
    "meeting_id": 7,
    "block_type": "text",
    "content": "하위 내용",
    "position": 1500.0,
    "parent_block_id": 1,
    "created_at": "2026-05-05T10:01:00.000Z",
    "updated_at": "2026-05-05T10:01:00.000Z"
  }
]
```

### Rebalance 발생 시 reorder 응답

```json
{
  "block": { ...updated block... },
  "rebalanced": true,
  "blocks": [ ...all blocks in new order... ]
}
```

---

## 7. 파일 구조

```
app/
  controllers/
    api/
      v1/
        blocks_controller.rb
  models/
    block.rb                    # 기존 파일 수정
  lib/
    fractional_indexing.rb      # 위치 계산 유틸리티

spec/
  requests/
    api/
      v1/
        blocks_spec.rb
  models/
    block_spec.rb
  factories/
    blocks.rb
```
