---
name: wbs
description: "PRD/TRD를 기반으로 WBS를 생성합니다. 프로젝트 규모에 따라 4단계/3단계 구조 선택. (Markdown 형식)"
category: planning
---

# /wbs - PRD/TRD 기반 WBS 생성 (Markdown)

> **PRD/TRD → WBS 자동 변환**: docs/ 폴더의 PRD.md, TRD.md를 분석하여 계층적 WBS를 `docs/wbs.md` 파일로 생성합니다.

## 트리거
- PRD 문서를 이슈 계층 구조로 분할이 필요한 경우
- 체계적인 WBS(Work Breakdown Structure) 생성이 필요한 경우
- Task category별 워크플로우 적용이 필요한 경우

## 사용법
```bash
/wbs
/wbs --scale [large|medium|small]
/wbs --start-date 2026-03-25
```

## 입력 파일 (자동 감지)
- **PRD**: `docs/PRD.md`
- **TRD**: `docs/TRD.md`

## 핵심 특징
- **프로젝트 규모 자동 산정**: 대규모/중간규모 자동 판별
- **규모별 계층 구조**: 4단계(대규모) / 3단계(중간/소규모)
- **Task category별 워크플로우**: development, defect, infrastructure 구분
- **워크플로우 상태 표시**: `[ ]`, `[dd]`, `[ap]`, `[im]`, `[xx]`
- **MECE 원칙**: 상호 배타적 + 전체 포괄 분할
- **일정 자동 계산**: category별 기간 추정 + 의존성 기반 일정 산출
- **PRD/TRD 컨텍스트 주입**: 요구사항, 인수조건, 기술스펙을 Task에 직접 포함
- **자기 완결적 Task**: Task만 보고 개발 착수 가능한 상세 정보 제공

---

## 계층 구조

```
Project (프로젝트) - 6~24개월
├── Work Package #1 (주요 기능 묶음) - 1~3개월
│   ├── Activity #1.1 (세부 활동) - 1~4주          ← 4단계만
│   │   ├── Task #1.1.1 (실제 작업) - 1일~1주
│   │   └── Task #1.1.2
│   └── Activity #1.2
│       └── Task #1.2.1
├── Work Package #2
│   └── Task #2.1 (Activity 생략 가능)             ← 3단계
└── Work Package #3
    └── Task #3.1
```

### 계층 타입

| 레벨 | 명칭 | 설명 | 기간 |
|------|------|------|------|
| Level 1 | **Project** | 전체 프로젝트 | 6~24개월 |
| Level 2 | **Work Package** | 주요 기능 단위의 작업 묶음 | 1~3개월 |
| Level 3 | **Activity** | 세부 활동 단위 (4단계에서만 사용) | 1~4주 |
| Level 4 | **Task** | 실제 수행 작업 단위 | 1일~1주 |

### Task category

| category | 설명 | 워크플로우 |
|----------|------|------------|
| `development` | 신규 기능 개발 | `[ ]` → `[dd]` → `[im]` → `[xx]` |
| `defect` | 결함 수정 | `[ ]` → `[dd]` → `[im]` → `[xx]` |
| `infrastructure` | 인프라/기술 작업 | `[ ]` → `[dd]` → `[im]` → `[xx]` |

### Task domain (기술 영역)

| domain | 설명 | 대표 작업 |
|--------|------|----------|
| `frontend` | 클라이언트 UI/UX | React 컴포넌트, 페이지, 스타일링, 상태관리 |
| `backend` | 서버 비즈니스 로직 | API 엔드포인트, 서비스, 미들웨어 |
| `database` | 데이터 계층 | 스키마, 마이그레이션, 쿼리 최적화 |
| `infra` | 인프라/DevOps | 배포, CI/CD, 모니터링, 환경설정 |
| `sidecar` | Python Sidecar | STT, 화자 분리, LLM 연동 |
| `fullstack` | 전체 스택 | E2E 기능, 통합 작업 |
| `docs` | 문서화 | API 문서, 사용자 가이드, README |
| `test` | 테스트 전용 | 단위/통합/E2E 테스트 작성 |

---

## 프로젝트 규모 산정

### 규모 판별 기준

| 기준 | 대규모 (4단계) | 중간/소규모 (3단계) |
|------|---------------|-------------------|
| **예상 기간** | 12개월+ | 12개월 미만 |
| **팀 규모** | 10명+ | 10명 미만 |
| **기능 영역 수** | 5개+ | 5개 미만 |
| **예상 Task 수** | 50개+ | 50개 미만 |

### 규모별 구조

**4단계 (대규모)**: `Project → WP → ACT → TSK`
```
## WP-01: Work Package Name
### ACT-01-01: Activity Name
#### TSK-01-01-01: Task Name
```

**3단계 (중간/소규모)**: `Project → WP → TSK`
```
## WP-01: Work Package Name
### TSK-01-01: Task Name
```

---

## 워크플로우 상태 기호

### 칸반 컬럼 매핑

| 칸반 컬럼 | 상태 | 의미 |
|-----------|------|------|
| Todo | `[ ]` | 대기 |
| Design | `[dd]` | 설계 |
| Implement | `[im]` | 구현 |
| Done | `[xx]` | 완료 |

### 상태 기호

| 기호 | 의미 | 설명 |
|------|------|------|
| `[ ]` | Todo | 대기 (모든 category 공통) |
| `[dd]` | Design | 설계 단계 |
| `[im]` | Implement | 구현 단계 |
| `[xx]` | Done | 완료 |

---

## 자동 실행 플로우

### 1단계: PRD/TRD 분석 및 프로젝트 규모 산정

1. `docs/PRD.md` 파일 읽기 및 구조 분석
2. `docs/TRD.md` 파일 읽기 및 기술 스펙 파악
3. 프로젝트 규모 산정 (기능 영역 수, 예상 복잡도)
4. 규모 결정: 4단계 / 3단계
5. 사용자에게 규모 확인 (옵션)

### 2단계: PRD 섹션 → Work Package 매핑

PRD의 MVP 마일스톤 및 기능 영역을 Work Package로 매핑:

| PRD 섹션 | Work Package 매핑 |
|----------|------------------|
| 프로젝트 초기화 | WP-00 |
| MVP 핵심 기능 (P0) | WP-01 ~ WP-0N |
| MVP 중요 기능 (P1) | WP-0N+1 ~ WP-0M |
| Phase 2 기능 (P2~P3) | WP-0M+1 ~ (참고용, 상세 분해 미실시) |

### 3단계: Work Package → Activity 분해 (4단계만)

- 사용자 관점 기능 단위
- 1~4주 규모 검증
- 독립적 테스트 가능 여부
- MECE 원칙 적용

### 4단계: Activity → Task 분해 및 category 분류

| category | 식별 기준 |
|----------|----------|
| **development** | 신규 기능 구현, 설계 필요 |
| **defect** | 결함 수정, 기존 코드 패치 |
| **infrastructure** | 리팩토링, 인프라, 성능개선 |

**Task 크기 검증**:
- 최소: 4시간
- 권장: 1~3일
- 최대: 1주 (초과 시 분할)

### 5단계: PRD/TRD 컨텍스트 주입

각 Task에 PRD/TRD 문서에서 관련 정보를 추출하여 주입합니다.

**PRD → Task 매핑 규칙:**

| PRD 섹션 | Task 속성 | 추출 방법 |
|----------|----------|----------|
| 기능 요구사항 | prd-ref, requirements | 해당 기능 상세 내용 |
| 인수 조건 | acceptance | 완료 판정 기준 목록 |
| 비기능 요구사항 | constraints | 성능, 보안, 규격 제한 |
| 사용자 흐름 | note | 요약 또는 참조 |

**TRD → Task 매핑 규칙:**

| TRD 섹션 | Task 속성 | 추출 방법 |
|----------|----------|----------|
| 기술 스택 | tech-spec | 해당 Task에 사용할 기술 |
| API 설계 | api-spec | 엔드포인트, 스키마, 에러코드 |
| 데이터 모델 | data-model | 관련 엔티티, 필드, 관계 |
| UI 컴포넌트 | ui-spec | 컴포넌트, 레이아웃, 스타일 |
| 성능 요구사항 | constraints | 응답시간, 처리량 제한 |

**상세도 레벨 결정:**

| Task 특성 | 권장 레벨 |
|----------|----------|
| 인프라/설정 작업 | minimal |
| 단순 CRUD | standard |
| 비즈니스 로직 | detailed |
| 핵심 기능/신규 개발 | full |

### 6단계: 일정 계산

**Task 기간 추정 (category별 기본값)**:

| category | 기본 기간 | 범위 |
|----------|----------|------|
| development | 10일 | 5~15일 |
| defect | 3일 | 2~5일 |
| infrastructure | 5일 | 2~10일 |

### 7단계: WBS 문서 생성

**생성 파일**: `docs/wbs.md`

---

## 출력 형식

### wbs.md 파일 형식

```markdown
# WBS - 또박또박 (ddobakddobak)

> version: 1.0
> depth: 3
> updated: {날짜}

---

## WP-00: 프로젝트 초기화
- status: planned
- priority: critical
- schedule: {시작일} ~ {종료일}
- progress: 0%

### TSK-00-01: Rails API + React 프로젝트 초기화
- category: infrastructure
- domain: infra
- status: [ ]
- priority: critical
- assignee: -
- schedule: {시작일} ~ {종료일}
- tags: setup, init
- depends: -
- note: backend/, frontend/, sidecar/ 디렉토리 구조 생성

---

## WP-01: {Work Package명}
- status: planned
- priority: high
- schedule: {시작일} ~ {종료일}
- progress: 0%

### TSK-01-01: {Task명}
- category: development
- domain: backend
- status: [ ]
- priority: high
- assignee: -
- schedule: {시작일} ~ {종료일}
- tags: api, auth
- depends: -

#### PRD 요구사항
- prd-ref: PRD 3.5 사용자/팀 관리
- requirements:
  - 이메일/비밀번호로 로그인
  - JWT 토큰 발급
- acceptance:
  - 유효한 자격증명 → 토큰 발급 성공
  - 잘못된 비밀번호 → 에러 반환
- constraints:
  - 비밀번호 bcrypt 해싱

#### 기술 스펙 (TRD)
- tech-spec:
  - Framework: Ruby on Rails 8+ (API 모드)
  - Auth: Devise + devise-jwt
- api-spec:
  - POST /api/v1/login
  - Request: { email: string, password: string }
  - Response: { token, user }
- data-model:
  - User: id, email, encrypted_password, name, jti
```

### ID 패턴

| 레벨 | 마크다운 | ID 패턴 | 예시 |
|------|----------|---------|------|
| WP (초기화) | `## WP-00:` | `WP-00` (예약) | `## WP-00: 프로젝트 초기화` |
| WP | `## WP-XX:` | `WP-{2자리}` | `## WP-01: 인증 및 팀 관리` |
| ACT (4단계) | `### ACT-XX-XX:` | `ACT-{WP}-{순번}` | `### ACT-01-01: 인증 구현` |
| TSK (4단계) | `#### TSK-XX-XX-XX:` | `TSK-{WP}-{ACT}-{순번}` | `#### TSK-01-01-01: API 구현` |
| TSK (3단계) | `### TSK-XX-XX:` | `TSK-{WP}-{순번}` | `### TSK-01-01: 로그인 API` |

### Task 속성

**기본 속성**: category, domain, status, priority, assignee, schedule, tags, depends, blocked-by, note
**PRD 연동 속성**: prd-ref, requirements, acceptance, constraints, test-criteria
**TRD 연동 속성**: tech-spec, api-spec, data-model, ui-spec
**상세도 레벨**: minimal, standard, detailed, full

---

## 고급 옵션

```bash
# 규모 강제 지정
/wbs --scale large
/wbs --scale medium

# 시작일 지정
/wbs --start-date 2026-03-25

# 규모 산정만 실행 (WBS 생성 없이)
/wbs --estimate-only
```

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--scale [large\|medium]` | 프로젝트 규모 강제 지정 | 자동 산정 |
| `--start-date [YYYY-MM-DD]` | 프로젝트 시작일 지정 | 오늘 날짜 |
| `--estimate-only` | 규모 산정만 실행 | - |

---

## 산출물 위치

| 산출물 | 경로 |
|--------|------|
| WBS 문서 | `docs/wbs.md` |

---

## 성공 기준

- **요구사항 커버리지**: PRD 모든 기능이 Task로 분해됨
- **적정 규모**: 모든 Task가 1일~1주 범위 내
- **추적성**: 각 Task에 PRD 요구사항 참조 (prd-ref) 연결
- **워크플로우 준비**: 모든 Task에 상태 기호 및 category 표시
- **컨텍스트 완전성**: 개발 Task는 requirements, acceptance, tech-spec 필수 포함
- **자기 완결성**: Task만 보고 개발 착수 가능한 수준의 상세도
