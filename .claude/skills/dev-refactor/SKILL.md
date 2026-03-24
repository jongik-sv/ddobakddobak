---
name: dev-refactor
description: "WBS Task 리팩토링 단계. 코드 품질 개선 후 테스트 확인. 사용법: /dev-refactor TSK-00-01"
---

# /dev-refactor - 코드 리팩토링

인자: `$ARGUMENTS` (TSK-ID, 예: TSK-00-01)

## 실행 절차

### 1. Task 정보 수집
- `docs/wbs.md`에서 `### $ARGUMENTS:` 헤딩을 찾아 domain 확인
- `docs/tasks/{TSK-ID}/design.md`에서 관련 파일 목록 파악

### 2. 리팩토링 (서브에이전트 위임)
Agent 도구로 서브에이전트를 실행한다 (mode: "auto"):

**프롬프트 구성**:
```
다음 Task에서 생성/수정된 코드를 리팩토링하라.

Task: {TSK-ID}
Domain: {domain}
관련 파일: [design.md에서 파악한 파일 목록]

## 리뷰 관점
1. 코드 중복 제거
2. 함수/메서드가 너무 길면 분리
3. 네이밍 개선
4. 불필요한 코드 제거

## 규칙
- 동작을 변경하지 않는다 (리팩토링만)
- 수정 후 반드시 테스트 실행하여 통과 확인
  - backend: `bundle exec rspec`
  - frontend: `npm run test`
  - sidecar: `uv run pytest`
- 테스트 실패 시 수정을 되돌린다

## 결과 작성
docs/tasks/{TSK-ID}/refactor.md 파일에 작성한다.
양식은 .claude/skills/dev-refactor/template.md를 따른다.
```

### 3. WBS 상태 업데이트
- `docs/wbs.md`에서 해당 Task의 `- status: [im]`를 `- status: [xx]`로 변경

### 4. 완료 보고
- 리팩토링 내역 요약과 Task 완료를 사용자에게 출력
