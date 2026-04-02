# TSK-05-01: LLM 요약 클라이언트 구현 - 리팩토링

## 변경사항

### 1. `_call_llm()` 헬퍼 메서드 추출

`summarize()`와 `extract_action_items()` 모두 동일한 LLM 호출 + JSON 파싱 패턴을 반복하고 있었다.
공통 패턴을 `_call_llm(system, user_content, max_tokens)` 메서드로 추출하여 중복 제거.

**Before:** 두 메서드 각각에 try/except + `messages.create` + `_extract_json` + `json.loads` 코드 중복

**After:** `_call_llm()` 한 곳에서 처리, 실패 시 `None` 반환으로 명확한 실패 처리

### 2. `type` 파라미터 → `summary_type` 으로 개명

`type`은 Python 내장 함수명으로, 파라미터 이름으로 사용 시 내장 함수를 섀도잉한다.
`summary_type`으로 변경하여 잠재적 버그 방지.

## 테스트 결과

리팩토링 후 89개 전체 테스트 통과 확인.
