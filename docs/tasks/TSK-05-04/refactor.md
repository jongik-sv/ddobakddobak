# TSK-05-04: 리팩토링 리포트

## 개선 사항

### 백엔드

- **`serialize_item` 중복 제거**: `MeetingActionItemsController`와 `ActionItemsController` 양쪽에 동일한 `serialize_item` 메서드가 존재했음. `ActionItemSerializable` concern으로 추출하여 두 controller가 `include`하도록 변경. 단일 진실 공급원(SSOT) 확보.
  - 신규 파일: `backend/app/controllers/concerns/action_item_serializable.rb`
  - 변경 파일: `api/v1/meeting_action_items_controller.rb`, `api/v1/action_items_controller.rb`

### 프론트엔드

- **불필요한 guard 조건 제거 (`ActionItemForm.tsx`)**: `isEditMode && initialValues.id !== undefined` 에서 `isEditMode`가 이미 `!!initialValues?.id`로 정의되어 `initialValues.id`의 존재를 보장하므로, 중복 검사 `initialValues.id !== undefined`를 제거하고 non-null assertion(`!`)으로 단순화.

- **중복 접근성 속성 제거 (`ActionItemForm.tsx`)**: 날짜 input이 `sr-only` 텍스트를 가진 `<label>`로 이미 감싸져 있으면서 동시에 `aria-label="마감일"`과 불필요한 `id="due-date"` 속성도 갖고 있었음. `<label>`의 `sr-only` span으로 접근성이 충분히 보장되므로 `aria-label`과 `id` 속성 제거.

## 테스트 결과

- 백엔드: 18/18
- 프론트엔드: 25/25
