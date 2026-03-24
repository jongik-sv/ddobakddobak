# TSK-00-04: DB 스키마 마이그레이션 생성 - 설계 문서

## 개요

PRD 데이터 모델을 기반으로 Rails 마이그레이션 파일을 생성한다. 8개 테이블과 필요한 인덱스를 포함한다.

## 테이블 설계

### 1. users
Devise 기반 인증 사용자 테이블. jti 컬럼은 JWT 무효화용.

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | integer | PK, autoincrement |
| email | string | NOT NULL, UNIQUE |
| encrypted_password | string | NOT NULL |
| name | string | NOT NULL |
| jti | string | NOT NULL |
| created_at | datetime | NOT NULL |
| updated_at | datetime | NOT NULL |

### 2. teams
팀 정보. created_by_id는 teams 생성자(users FK).

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | integer | PK |
| name | string | NOT NULL |
| created_by_id | integer | NOT NULL, FK users |
| created_at | datetime | NOT NULL |
| updated_at | datetime | NOT NULL |

### 3. team_memberships
팀-사용자 다대다 관계. role: admin|member.

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | integer | PK |
| user_id | integer | NOT NULL, FK users |
| team_id | integer | NOT NULL, FK teams |
| role | string | NOT NULL, default: 'member' |
| created_at | datetime | NOT NULL |
| updated_at | datetime | NOT NULL |
| UNIQUE | (user_id, team_id) | |

### 4. meetings
회의 정보. status: pending|recording|completed.

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | integer | PK |
| title | string | NOT NULL |
| team_id | integer | NOT NULL, FK teams |
| created_by_id | integer | NOT NULL, FK users |
| status | string | NOT NULL, default: 'pending' |
| started_at | datetime | nullable |
| ended_at | datetime | nullable |
| audio_file_path | string | nullable |
| created_at | datetime | NOT NULL |
| updated_at | datetime | NOT NULL |

### 5. transcripts
음성→텍스트 변환 결과. meeting에 종속.

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | integer | PK |
| meeting_id | integer | NOT NULL, FK meetings (CASCADE) |
| speaker_label | string | NOT NULL |
| content | text | NOT NULL |
| started_at_ms | integer | NOT NULL |
| ended_at_ms | integer | NOT NULL |
| sequence_number | integer | NOT NULL |
| created_at | datetime | NOT NULL |

인덱스: `(meeting_id, sequence_number)`

### 6. summaries
AI 요약 결과. summary_type: realtime|final.

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | integer | PK |
| meeting_id | integer | NOT NULL, FK meetings (CASCADE) |
| key_points | text | nullable (JSON array) |
| decisions | text | nullable (JSON array) |
| discussion_details | text | nullable (JSON array) |
| summary_type | string | NOT NULL, default: 'final' |
| generated_at | datetime | NOT NULL |
| created_at | datetime | NOT NULL |
| updated_at | datetime | NOT NULL |

인덱스: `(meeting_id)`

### 7. action_items
회의에서 도출된 할 일. status: todo|done.

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | integer | PK |
| meeting_id | integer | NOT NULL, FK meetings (CASCADE) |
| assignee_id | integer | nullable, FK users |
| content | text | NOT NULL |
| due_date | date | nullable |
| status | string | NOT NULL, default: 'todo' |
| ai_generated | boolean | NOT NULL, default: false |
| created_at | datetime | NOT NULL |
| updated_at | datetime | NOT NULL |

인덱스: `(meeting_id)`, `(assignee_id)`

### 8. blocks
블록 에디터 데이터. position은 fractional indexing용 REAL 타입.

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | integer | PK |
| meeting_id | integer | NOT NULL, FK meetings (CASCADE) |
| block_type | string | NOT NULL, default: 'text' |
| content | text | nullable |
| position | float | NOT NULL (fractional indexing) |
| parent_block_id | integer | nullable, FK blocks |
| created_at | datetime | NOT NULL |
| updated_at | datetime | NOT NULL |

인덱스: `(meeting_id, position)`

## 마이그레이션 전략

- 각 테이블을 별도 마이그레이션 파일로 생성
- Devise install 먼저 실행 후 users 테이블에 jti 추가
- `rails db:migrate` 한 번에 실행 가능하도록 순서 설계

## 테스트 계획

- `rails db:migrate` 성공 확인
- `rails db:schema:dump`로 스키마 검증
- RSpec 모델 spec으로 테이블/인덱스/제약조건 검증
