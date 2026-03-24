---
name: dev
description: "WBS Task 전체 개발 사이클 실행 (설계→TDD구현→테스트→리팩토링). 사용법: /dev TSK-00-01 또는 /dev TSK-00-01 --only design"
---

# /dev - Task 개발 전체 사이클

인자: `$ARGUMENTS` (TSK-ID + 옵션, 예: `TSK-00-01`, `TSK-00-01 --only design`)

## 인자 파싱
- 첫 번째 인자: TSK-ID (필수, 예: TSK-00-01)
- `--only <phase>`: 특정 단계만 실행 (design|build|test|refactor)
- 옵션 없으면 4단계 전체 순차 실행

## 실행 절차

### 0. Task 확인
- `docs/wbs.md`에서 `### {TSK-ID}:` 헤딩을 찾아 Task 블록 전체를 읽는다
- Task를 찾을 수 없으면 에러 출력 후 종료
- Task 정보(category, domain, status, 요구사항 등)를 추출한다

### 1. Phase: Design (설계)
서브에이전트 실행:
- **description**: "{TSK-ID} 설계"
- **prompt**: dev-design 스킬의 절차를 따른다. Task 블록 전체를 포함하여 전달.
  1. PRD.md, TRD.md를 참조하여 구현 구조 설계
  2. `docs/tasks/{TSK-ID}/design.md` 생성 (생성/수정할 파일 목록, 주요 구조, 데이터 흐름)
  3. `docs/wbs.md`에서 status를 `[dd]`로 업데이트
- **mode**: "auto"

### 2. Phase: Build (TDD 구현)
서브에이전트 실행:
- **description**: "{TSK-ID} TDD 구현"
- **prompt**: dev-build 스킬의 절차를 따른다. Task 블록 + design.md 내용 포함.
  1. acceptance criteria 기반 테스트 먼저 작성
  2. 테스트 통과하는 코드 구현
  3. domain별 테스트 프레임워크로 확인 (backend: RSpec, frontend: Vitest, sidecar: pytest)
  4. `docs/wbs.md`에서 status를 `[im]`으로 업데이트
- **mode**: "auto"

### 3. Phase: Test (테스트)
서브에이전트 실행:
- **description**: "{TSK-ID} 테스트"
- **prompt**: dev-test 스킬의 절차를 따른다.
  1. 전체 테스트 실행
  2. 실패 시 수정 → 재실행 (최대 3회)
  3. `docs/tasks/{TSK-ID}/test-report.md` 생성
- **mode**: "auto"

### 4. Phase: Refactor (리팩토링)
서브에이전트 실행:
- **description**: "{TSK-ID} 리팩토링"
- **prompt**: dev-refactor 스킬의 절차를 따른다.
  1. 코드 품질 리뷰 및 개선
  2. 테스트 재실행으로 리그레션 확인
  3. `docs/tasks/{TSK-ID}/refactor.md` 생성
  4. `docs/wbs.md`에서 status를 `[xx]`로 업데이트
- **mode**: "auto"

## --only 옵션 처리
- `--only design`: Phase 1만 실행
- `--only build`: Phase 2만 실행
- `--only test`: Phase 3만 실행
- `--only refactor`: Phase 4만 실행

## 완료 보고
각 Phase 완료 시 한 줄 요약을 출력하고, 전체 완료 시 최종 상태를 보고한다.
