# TSK-04-02 리팩토링 노트

## 변경 사항

### 1. app/models/block.rb

- 변경 전: `unless` 조건 + 중첩 표현식으로 에러 추가
- 변경 후: early return 패턴으로 긍정 조건 사용 (`return if ... include?`)
- 이유: `unless` + 부정 중첩은 가독성을 해침. guard clause 패턴으로 의도 명확화

### 2. app/controllers/api/v1/blocks_controller.rb

#### 2-1. create 액션 - 불필요한 변수 제거
- 변경 전: `prev_block = nil`, `next_block = nil` 초기화 후 즉시 전달
- 변경 후: `FractionalIndexing.position_for(nil, nil, @meeting)` 직접 호출
- 이유: 단순히 nil을 담는 변수는 의미 없는 간접층 추가

#### 2-2. update_params 중복 제거
- 변경 전: `block_params`와 `update_params`가 동일한 내용으로 두 번 정의
- 변경 후: `alias update_params block_params`
- 이유: 동일한 로직 중복 제거

#### 2-3. reorder 액션 분리
- 변경 전: reorder 메서드가 인접 블록 탐색, 리밸런싱 조건 분기, 응답 구성 로직을 한 메서드에서 처리 (25줄)
- 변경 후: 세 개의 private 메서드로 분리
  - `find_adjacent_block(block_id)`: 인접 블록 탐색 (nil-safe)
  - `rebalance_if_needed!(prev_block, next_block)`: 리밸런싱 조건 확인 및 실행, boolean 반환
  - `reorder_response(rebalanced)`: 응답 해시 구성
- 이유: 각 책임을 분리하여 reorder 액션의 의도를 흐름으로 읽을 수 있게 함. `prev_block.reload if prev_block` 중복 패턴 제거

## 테스트 결과
- 리팩토링 후 테스트: 35개 통과
