# TSK-05-02 리팩토링

## 개선 사항

- `SummarizationJob#transcripts_payload` 앞의 불필요한 빈 줄 제거 (편집 과정에서 생긴 공백)

## 변경하지 않은 이유

### transcripts_payload 중복 (SummarizationJob vs MeetingFinalizerService)
`transcripts_payload` 메서드가 두 클래스에 동일하게 존재하나, 두 클래스가 각각 `ApplicationJob`과 일반 Service 클래스로 타입이 달라 Concern으로 공유하려면 새 모듈 파일 생성이 필요하다. 과도한 리팩토링 금지 원칙에 따라 현행 유지.

### broadcast 메서드 중복
`broadcast_summary_update` (Job)와 `broadcast_final_summary` (Service)가 동일한 payload를 전송하지만, 각 클래스의 역할이 명확히 구분되어 있어 동일한 이유로 현행 유지.

### 에러 처리 구조
- `SummarizationJob`: `rescue`가 `summarize_meeting` 내부에 위치 → meeting 단위 에러 격리가 의도적이므로 적절.
- `MeetingFinalizerService`: `rescue`가 `call` 최상위에 위치 → 전체 흐름을 하나의 트랜잭션처럼 처리하는 의도이므로 적절.

### Meeting.recording named scope
`Meeting` 모델에 `enum :status` 선언으로 `Meeting.recording` 스코프가 자동 생성되어 있음. 별도 추가 불필요.

### 메서드 길이 및 변수명
모든 메서드가 적절한 길이이며, 변수명도 명확하여 변경 불필요.

## 테스트 결과
29 examples, 0 failures
