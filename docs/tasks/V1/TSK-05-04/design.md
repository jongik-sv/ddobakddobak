# TSK-05-04: Action Item CRUD API 및 UI - 설계

## 구현 방향

회의(Meeting)에 속한 Action Item을 조회·생성·수정·삭제하는 REST API를 구현하고, 이를 사용하는 프론트엔드 컴포넌트를 작성한다.

- 백엔드: `MeetingActionItemsController`(index, create)와 `ActionItemsController`(update, destroy) 두 컨트롤러로 분리하여 Rails 중첩 라우트 관례를 따른다.
- 권한: 해당 meeting이 속한 team의 멤버만 접근 가능하도록 `TeamAuthorizable` concern을 활용한다.
- 프론트엔드: `ActionItemList.tsx`에서 목록 표시 + 체크박스 토글을 담당하고, `ActionItemForm.tsx`에서 수동 추가/수정 폼을 담당한다.
- 직렬화: ActiveRecord 쿼리 결과를 plain Hash로 렌더링한다(기존 teams_controller.rb 패턴 동일).
- 테스트: RSpec request spec(백엔드) + Vitest(프론트엔드).

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| `backend/config/routes.rb` | meetings 하위에 action_items 라우트 추가 | 수정 |
| `backend/app/controllers/api/v1/meeting_action_items_controller.rb` | GET(index), POST(create) | 신규 |
| `backend/app/controllers/api/v1/action_items_controller.rb` | PATCH(update), DELETE(destroy) | 신규 |
| `backend/spec/requests/api/v1/meeting_action_items_spec.rb` | index/create request spec | 신규 |
| `backend/spec/requests/api/v1/action_items_spec.rb` | update/destroy request spec | 신규 |
| `frontend/src/api/actionItems.ts` | Action Item API 함수 및 타입 정의 | 신규 |
| `frontend/src/components/action-item/ActionItemList.tsx` | 목록 표시, 체크박스 토글, 삭제 | 신규 |
| `frontend/src/components/action-item/ActionItemForm.tsx` | 수동 추가/수정 폼 (담당자, 마감일) | 신규 |
| `frontend/src/components/action-item/ActionItemList.test.tsx` | ActionItemList 단위 테스트 | 신규 |
| `frontend/src/components/action-item/ActionItemForm.test.tsx` | ActionItemForm 단위 테스트 | 신규 |

---

## 주요 구조

### 1. 라우트 변경 (`backend/config/routes.rb`)

```ruby
namespace :api do
  namespace :v1 do
    # ... 기존 라우트 ...

    resources :meetings, only: [] do
      resources :action_items,
        only: %i[index create],
        controller: "meeting_action_items"
    end

    resources :action_items, only: %i[update destroy]
  end
end
```

### 2. MeetingActionItemsController

```ruby
module Api
  module V1
    class MeetingActionItemsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_meeting

      # GET /api/v1/meetings/:meeting_id/action_items
      def index
        items = @meeting.action_items.includes(:assignee).order(:created_at)
        render json: items.map { |item| serialize_item(item) }
      end

      # POST /api/v1/meetings/:meeting_id/action_items
      def create
        item = @meeting.action_items.build(action_item_params)
        item.ai_generated = false
        if item.save
          render json: serialize_item(item), status: :created
        else
          render json: { errors: item.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def set_meeting
        team_ids = current_user.team_memberships.pluck(:team_id)
        @meeting = Meeting.where(team_id: team_ids).find(params[:meeting_id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Forbidden" }, status: :forbidden
      end

      def action_item_params
        params.require(:action_item).permit(:content, :assignee_id, :due_date, :status)
      end

      def serialize_item(item)
        {
          id: item.id,
          content: item.content,
          status: item.status,
          due_date: item.due_date,
          ai_generated: item.ai_generated,
          assignee: item.assignee ? { id: item.assignee.id, name: item.assignee.name } : nil,
          created_at: item.created_at
        }
      end
    end
  end
end
```

### 3. ActionItemsController

```ruby
module Api
  module V1
    class ActionItemsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_action_item

      # PATCH /api/v1/action_items/:id
      def update
        if @action_item.update(action_item_params)
          render json: serialize_item(@action_item.reload)
        else
          render json: { errors: @action_item.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/action_items/:id
      def destroy
        @action_item.destroy
        head :no_content
      end

      private

      def set_action_item
        team_ids = current_user.team_memberships.pluck(:team_id)
        meeting_ids = Meeting.where(team_id: team_ids).pluck(:id)
        @action_item = ActionItem.where(meeting_id: meeting_ids).find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Forbidden" }, status: :forbidden
      end

      def action_item_params
        params.require(:action_item).permit(:assignee_id, :due_date, :status, :content)
      end

      def serialize_item(item)
        {
          id: item.id,
          content: item.content,
          status: item.status,
          due_date: item.due_date,
          ai_generated: item.ai_generated,
          assignee: item.assignee ? { id: item.assignee.id, name: item.assignee.name } : nil,
          created_at: item.created_at
        }
      end
    end
  end
end
```

### 4. 프론트엔드 타입 및 API (`frontend/src/api/actionItems.ts`)

```typescript
import apiClient from './client'

export interface ActionItemAssignee {
  id: number
  name: string
}

export interface ActionItem {
  id: number
  content: string
  status: 'todo' | 'in_progress' | 'done'
  due_date: string | null
  ai_generated: boolean
  assignee: ActionItemAssignee | null
  created_at: string
}

export interface CreateActionItemParams {
  content: string
  assignee_id?: number | null
  due_date?: string | null
  status?: ActionItem['status']
}

export interface UpdateActionItemParams {
  assignee_id?: number | null
  due_date?: string | null
  status?: ActionItem['status']
  content?: string
}

export async function getActionItems(meetingId: number): Promise<ActionItem[]> {
  return apiClient.get(`meetings/${meetingId}/action_items`).json()
}

export async function createActionItem(
  meetingId: number,
  params: CreateActionItemParams
): Promise<ActionItem> {
  return apiClient
    .post(`meetings/${meetingId}/action_items`, { json: { action_item: params } })
    .json()
}

export async function updateActionItem(
  id: number,
  params: UpdateActionItemParams
): Promise<ActionItem> {
  return apiClient
    .patch(`action_items/${id}`, { json: { action_item: params } })
    .json()
}

export async function deleteActionItem(id: number): Promise<void> {
  await apiClient.delete(`action_items/${id}`)
}
```

### 5. ActionItemList 컴포넌트 구조

```tsx
// frontend/src/components/action-item/ActionItemList.tsx
interface ActionItemListProps {
  meetingId: number
  teamMembers: { id: number; name: string }[]
}

// 상태: items(ActionItem[]), loading, showForm
// 로직:
//   - mount 시 getActionItems(meetingId) 호출
//   - 체크박스 토글: updateActionItem(id, { status: 'done' | 'todo' })
//   - 삭제: deleteActionItem(id) → items에서 제거
//   - "추가" 버튼 클릭 시 ActionItemForm 표시
```

### 6. ActionItemForm 컴포넌트 구조

```tsx
// frontend/src/components/action-item/ActionItemForm.tsx
interface ActionItemFormProps {
  meetingId: number
  teamMembers: { id: number; name: string }[]
  initialValues?: Partial<ActionItem>   // 수정 모드용
  onSubmit: (item: ActionItem) => void
  onCancel: () => void
}

// 필드: content(textarea), assignee_id(select), due_date(date input)
// 수정 모드: initialValues가 있으면 updateActionItem, 없으면 createActionItem
```

---

## 데이터 흐름

```
[ActionItemList mount]
  → getActionItems(meetingId) : GET /api/v1/meetings/:id/action_items
  → items 상태 업데이트 → 목록 렌더링

[체크박스 클릭]
  → updateActionItem(id, { status }) : PATCH /api/v1/action_items/:id
  → 응답 ActionItem으로 items 내 해당 항목 교체

[수동 추가 submit]
  → createActionItem(meetingId, params) : POST /api/v1/meetings/:id/action_items
  → 응답 ActionItem을 items 끝에 추가 → 폼 닫기

[수정 submit]
  → updateActionItem(id, params) : PATCH /api/v1/action_items/:id
  → 응답 ActionItem으로 items 내 해당 항목 교체 → 폼 닫기

[삭제 클릭]
  → deleteActionItem(id) : DELETE /api/v1/action_items/:id
  → items에서 해당 id 필터링 제거
```

### 권한 흐름 (백엔드)

```
요청 → authenticate_user! → set_meeting(or set_action_item)
  → current_user.team_memberships를 통해 접근 가능한 meeting만 조회
  → 없으면 403 Forbidden 반환
```

---

## 테스트 전략

### RSpec (백엔드)

**`spec/requests/api/v1/meeting_action_items_spec.rb`**

| 케이스 | 검증 포인트 |
|---|---|
| GET - 인증된 팀 멤버 | 200, 해당 meeting의 action_items 반환 |
| GET - 다른 팀 meeting | 403 반환 |
| GET - 미인증 | 401 반환 |
| POST - 정상 생성 | 201, ai_generated=false, 반환 JSON 구조 |
| POST - content 누락 | 422 반환 |
| POST - 다른 팀 meeting | 403 반환 |

**`spec/requests/api/v1/action_items_spec.rb`**

| 케이스 | 검증 포인트 |
|---|---|
| PATCH - status 변경 | 200, status 업데이트 반영 |
| PATCH - assignee_id, due_date 변경 | 200, 변경값 반영 |
| PATCH - 다른 팀 item | 403 반환 |
| DELETE - 정상 삭제 | 204, DB에서 제거 |
| DELETE - 다른 팀 item | 403 반환 |

### Vitest (프론트엔드)

**`ActionItemList.test.tsx`**

| 케이스 | 검증 포인트 |
|---|---|
| 로딩 상태 표시 | 초기 렌더링 시 로딩 인디케이터 |
| 목록 렌더링 | mock items의 content 텍스트 표시 |
| 체크박스 토글 | updateActionItem 호출, status 변경 반영 |
| 삭제 버튼 | deleteActionItem 호출, 목록에서 제거 |
| 빈 목록 | "Action Item이 없습니다" 문구 표시 |

**`ActionItemForm.test.tsx`**

| 케이스 | 검증 포인트 |
|---|---|
| 신규 추가 submit | createActionItem 호출, onSubmit 콜백 |
| 수정 모드 initialValues | 폼 필드에 기존 값 표시 |
| 취소 버튼 | onCancel 콜백 호출 |
| content 빈값 submit | 클라이언트 validation 에러 표시 |

### Factory 추가 사항

`spec/factories/action_items.rb`에 `with_assignee` trait 추가:
```ruby
trait :with_assignee do
  association :assignee, factory: :user
end
```
