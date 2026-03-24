---
name: dev-test
description: "WBS Task 테스트 단계. 단위 + E2E 테스트 실행, 실패 시 수정 반복. 사용법: /dev-test TSK-00-01"
---

# /dev-test - 테스트 실행

인자: `$ARGUMENTS` (TSK-ID, 예: TSK-00-01)

## 실행 절차

### 1. Task 정보 수집
- `docs/wbs.md`에서 `### $ARGUMENTS:` 헤딩을 찾아 domain 확인
- `docs/tasks/{TSK-ID}/design.md`에서 관련 파일 목록 파악

### 2. 테스트 실행 (서브에이전트 위임)
Agent 도구로 서브에이전트를 실행한다 (mode: "auto"):

**프롬프트 구성**:
```
다음 Task의 테스트를 실행하고 모두 통과시켜라.

Task: {TSK-ID}
Domain: {domain}

## 절차
1. domain에 맞는 테스트 실행:
   - backend: `bundle exec rspec`
   - frontend: `npm run test`
   - sidecar: `uv run pytest`
   - fullstack: 위 전부 실행
2. 실패하는 테스트가 있으면 원인 분석 후 코드 수정
3. 다시 테스트 실행
4. 최대 3회 반복. 3회 후에도 실패하면 실패 내역을 보고

## 결과 작성
docs/tasks/{TSK-ID}/test-report.md 파일에 작성한다.
양식은 .claude/skills/dev-test/template.md를 따른다.
```

### 3. 완료 보고
- 테스트 결과 요약을 사용자에게 출력 (WBS 상태 변경 없음)
