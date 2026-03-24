---
name: dev-design
description: "WBS Task 설계 단계. docs/wbs.md에서 Task를 읽고 구현 설계 후 design.md 생성. 사용법: /dev-design TSK-00-01"
---

# /dev-design - Task 설계

인자: `$ARGUMENTS` (TSK-ID, 예: TSK-00-01)

## 실행 절차

### 1. Task 정보 추출
- `docs/wbs.md`에서 `### $ARGUMENTS:` 헤딩을 찾아 Task 블록 전체를 읽는다
- 추출 항목: category, domain, status, requirements, acceptance, tech-spec, api-spec, data-model, ui-spec
- status가 `[ ]`이 아니면 이미 진행 중인 Task이므로 사용자에게 확인 후 진행

### 2. 설계 (서브에이전트 위임)
Agent 도구로 서브에이전트를 실행한다:

**프롬프트 구성**:
```
다음 Task를 설계하라. 코드를 작성하지 말고 설계만 한다.

[Task 블록 전체 붙여넣기]

참고 문서: docs/PRD.md, docs/TRD.md

산출물:
1. 생성/수정할 파일 목록과 각 파일의 역할
2. 주요 함수/클래스/컴포넌트 이름과 책임
3. 데이터 흐름 요약 (입력 → 처리 → 출력)
4. 의존성 및 선행 조건

domain별 가이드:
- backend: Rails API 컨트롤러, 모델, 서비스 구조
- frontend: React 컴포넌트, 페이지, 스토어 구조
- sidecar: FastAPI 엔드포인트, 서비스 구조
- infrastructure: 설정 파일, 환경 구성

결과를 docs/tasks/{TSK-ID}/design.md 파일로 작성하라.
양식은 .claude/skills/dev-design/template.md를 따른다.
```

### 3. WBS 상태 업데이트
- `docs/wbs.md`에서 해당 Task의 `- status: [ ]`를 `- status: [dd]`로 변경 (Edit 도구 사용)

### 4. 완료 보고
- 생성된 design.md 경로와 설계 요약을 사용자에게 출력
