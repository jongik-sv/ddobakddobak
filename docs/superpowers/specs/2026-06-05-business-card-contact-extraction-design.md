# 명함 업로드 → 자동 인식 → 회의 참석자 정보 반영 설계

- 날짜: 2026-06-05
- 상태: 설계 승인 (사용자 합의 완료 — A 채택: 신규 구조화 테이블 + 비동기 추출)
- 관련 모델: `Meeting`, `MeetingAttachment`, `MeetingParticipant`(미사용 — 사유 §0)
- 관련 서비스: `LlmService`(재사용 안 함 — 사유 §3.1)

## 0. 목표 / 배경

파일 업로드 다이얼로그에 **명함 업로드** 기능을 추가한다. 명함 이미지를 올리면 자동으로
인식(Vision OCR)하여 **회의에 참석자 정보로 반영**한다.

사용자 확정 결정:

1. **저장 = 구조화 테이블 + 텍스트 동기화** (둘 다). 신규 `meeting_contacts` 테이블이 원본,
   `meeting.attendees`(자유텍스트)는 이름을 자동 동기화.
2. **얻을 수 있는 정보 모두 기록** — 명함의 모든 항목을 보존. 고정 칼럼으로 못 잡는 값은
   `extra`(json) + 원문 `raw_text`로 전량 보존.
3. **자동 등록** (확인/수정 단계 없음). 단, 오인식 교정용 수정/삭제는 사후 허용.
4. **계정 등록 아님** — `MeetingParticipant`(앱 계정 host/viewer 라이브세션 모델)를 쓰지 않는다.
   명함 인물은 외부 연락처일 뿐 앱 사용자가 아니므로, 회의에 "정보만" 반영한다.
5. **실행 = 비동기 Job** (업로드 응답 안 막음, 다중 명함 병렬, 기존 async 패턴과 일치).
6. **OCR 단발 원칙** — Vision OCR은 업로드 시 **1회만** 수행하고 결과(`raw_text` + 구조화
   필드)를 테이블에 영속한다. 이후 표시·수정·요약은 저장값을 사용하며 **재OCR하지 않는다**.
   (테이블이 곧 OCR 결과 캐시. B안=텍스트 덤프는 구조를 잃어 재OCR을 강요할 위험 → A 채택 근거.)

### 왜 `MeetingParticipant`가 아닌가

`MeetingParticipant`는 `belongs_to :user`(NOT NULL), `user_id` 유니크, role=host/viewer,
`joined_at`/`left_at`, ActionCable join/left 브로드캐스트 — **실제 앱 계정의 라이브 세션 참여**
추적용이다. 명함 인물은 계정이 없으므로 부적합. 일상어 "회의 참여자"는 `meetings.attendees`
자유텍스트(요약 프롬프트에 "참석자:"로 투입됨)에 더 가깝다.

## 1. 아키텍처 / 데이터 흐름

```
파일 업로드 다이얼로그 (명함 모드)
  → POST /meetings/:id/attachments  (category=business_card, 이미지)
  → [기존 첨부 저장 경로] 이미지 디스크 저장 + MeetingAttachment 생성 (이미지 보존)
  → category=business_card 이면 CardExtractionJob.perform_later(attachment.id) 큐
        → CardExtractionService(attachment)
              이미지 bytes → base64 → Vision LLM(서버 전용, vision 가능 모델) → JSON
        → MeetingContact 행 생성 (전체 필드 + extra + raw_text + source_attachment_id)
        → meeting.attendees 텍스트에 이름 append (비파괴, 중복 skip)
        → ActionCable broadcast(meeting.transcription_stream,
                                {type: "contacts_updated"})
  → 회의 상세: contacts_updated 수신 → contacts 패널 refetch
```

Vision 경로는 **per-user 요약 LLM과 분리**한다(§3.1). 서버가 vision 불가 provider로
구성된 경우 job은 실패를 broadcast하고, 이미지 첨부는 그대로 남긴다(사용자 수동 입력 가능).

## 2. 데이터 모델 — `meeting_contacts` (신규)

마이그레이션은 가동 중 dev 서버 500(PendingMigrationError) 함정 회피를 위해 적용 시점 유의
(기존 메모 `feedback_rails_pending_migration_trap`).

| 칼럼 | 타입 | 비고 |
|---|---|---|
| `id` | pk | |
| `meeting_id` | integer, NOT NULL, idx | FK |
| `name` | string | 이름 |
| `company` | string | 회사/소속 |
| `department` | string | 부서 |
| `title` | string | 직함/직책 |
| `mobile` | string | 휴대폰 |
| `phone` | string | 유선 전화 |
| `fax` | string | 팩스 |
| `email` | string | 이메일 |
| `website` | string | 웹/홈페이지 |
| `address` | text | 주소 |
| `extra` | json | 고정칼럼 외 잡힌 모든 값(SNS, 추가번호, 메신저 등) |
| `raw_text` | text | Vision이 읽은 명함 **원문 전체** (= "정보 모두 기록" 보장) |
| `source_attachment_id` | integer, null, idx | FK→meeting_attachments (원본 이미지) |
| `created_by_id` | integer, NOT NULL | uploader (attachment.uploaded_by_id) |
| `created_at`/`updated_at` | datetime | |

모델:

```ruby
class MeetingContact < ApplicationRecord
  belongs_to :meeting
  belongs_to :source_attachment, class_name: "MeetingAttachment", optional: true
  belongs_to :creator, class_name: "User", foreign_key: "created_by_id"

  # 표시는 자유 — 빈 명함(인식 실패)도 raw_text 보존 위해 name presence 강제하지 않음
  def display_label
    [name.presence, company.presence].compact.join(" / ").presence || "(미인식 명함)"
  end
end
```

`Meeting has_many :meeting_contacts, dependent: :destroy`.

### attendees 동기화 규칙 (비파괴 append)

- contact 생성 시 `meeting.attendees`에 `"이름"` 또는 `"이름 (회사)"`를 **추가만** 한다.
- 기존 사용자 입력 텍스트는 **지우지 않는다**. 이미 같은 이름이 텍스트에 있으면 skip(중복 방지).
- name 공백이면 attendees 동기화 안 함(원문은 raw_text에 보존).
- 줄/쉼표 구분은 기존 attendees 포맷을 따른다(없으면 쉼표 join).

## 3. 백엔드

### 3.1 `CardExtractionService` (신규)

- 입력: `MeetingAttachment`(이미지) — `file_path`, `content_type`.
- 처리: 파일 bytes 읽어 base64 → Vision LLM 호출 → JSON 파싱.
- **Vision 경로 분리**: `LlmService`의 `call_anthropic`/`call_openai`는 **텍스트 전용**이며
  `claude_cli`/`gemini_cli`/`codex_cli` provider는 Open3 stdin이라 이미지를 못 보낸다.
  따라서 명함 OCR은 per-user 요약 LLM 설정을 타지 않고, **서버 전용 vision 설정**으로 직접
  image content block을 구성해 호출한다.
  - provider/model: 기본 = anthropic + vision 가능 모델(서버 기본 `claude-sonnet-4-20250514`는
    vision 지원). 선택적 ENV override(`VISION_LLM_PROVIDER`/`VISION_LLM_MODEL`/키) 허용.
  - provider가 vision 불가(예: CLI)면 명확한 에러 raise → job이 실패 처리.
  - **구현 전 확인**: 프로젝트의 `anthropic` ruby gem이 image content block(`type: "image",
    source: {type: "base64", media_type:, data:}`)을 지원하는지, 대상 모델이 vision인지 검증.
- 프롬프트: 한국어 명함 가정. 고정 키 JSON + `extra` 객체(잔여 전부) + `raw_text`(원문 전체).
  한 이미지에 명함 여러 장일 수 있으니 **배열** 반환을 허용(보통 길이 1).
- 견고성:
  - bad JSON → 1회 재시도 → 그래도 실패면 `raw_text`만이라도 담은 contact 1건 생성
    ("정보 모두 기록" 원칙 — 최소한 원문은 남긴다).
  - vision 호출 자체 실패(provider 불가/타임아웃) → 예외를 job으로 전파.

반환 예: `[{ name:, company:, department:, title:, mobile:, phone:, fax:, email:,
website:, address:, extra: {...}, raw_text: "..." }, ...]`

### 3.2 `CardExtractionJob(attachment_id)` (신규)

1. `MeetingAttachment` 로드. 없거나 category≠business_card면 종료.
2. `CardExtractionService` 호출.
3. 각 contact → `MeetingContact` 생성(`source_attachment_id`, `created_by_id` 채움).
4. attendees 동기화(§2 규칙).
5. `ActionCable.server.broadcast(meeting.transcription_stream, {type: "contacts_updated"})`.
6. 실패 시: 로그 + `broadcast({type: "card_extraction_failed", attachment_id:})`.
   이미지 첨부는 보존(삭제 안 함).

### 3.3 엔드포인트

- **첨부 create 훅**: `MeetingAttachmentsController#create_file_attachment`에서 저장 성공 후
  `category == "business_card"`면 `CardExtractionJob.perform_later(attachment.id)` enqueue.
- **contacts 라우트** (신규, meetings 하위 중첩):
  - `GET    /meetings/:id/contacts` — 목록(패널/refetch용)
  - `PATCH  /meetings/:id/contacts/:contact_id` — 오인식 교정
  - `DELETE /meetings/:id/contacts/:contact_id` — 삭제
  - create는 job 경유 암묵 생성(직접 POST 불필요). 필요 시 수동추가 POST는 후속.
- 권한: 첨부와 동일 패턴. 읽기=`MeetingLookup` 접근 가능자, 변경(PATCH/DELETE)=
  `authorize_meeting_control!`.

### 3.4 모델/상수 변경

- `MeetingAttachment::CATEGORIES`에 `"business_card"` 추가(inclusion 검증 통과용).
- 명함 모드 업로드는 이미지 MIME만 허용(이미 `image/png|jpeg|gif|webp` 존재). 비이미지 거부.

## 4. 프런트엔드

### 4.1 `AddFileDialog`

- 카테고리 칩에 **"명함"**(value=`business_card`) 추가.
- 명함 선택 시: accept를 이미지로 제한(`.png,.jpg,.jpeg,.webp`), 안내문 "명함 이미지를
  올리면 자동 인식됩니다".
- 업로드는 기존 `createFileAttachment(meetingId, 'business_card', file)` 재사용.
- 업로드 성공 후 "명함 인식 중…" 안내(인식은 비동기 — 완료는 상세 패널에서 반영).

### 4.2 회의 상세 — 참석자(명함) 패널 (신규)

- contact 카드 목록: 이름·회사·직함 + 연락처(휴대폰/이메일 등). `extra`는 접기.
- `contacts_updated` 브로드캐스트 수신 → `getContacts` refetch. `card_extraction_failed` →
  토스트/배지로 "명함 인식 실패" 표시(원본 이미지 첨부는 그대로 존재).
- 항목 인라인 수정/삭제(오인식 교정).

### 4.3 `api/contacts.ts` (신규)

- 타입 `MeetingContact`(모든 필드 + extra + raw_text).
- `getContacts(meetingId)`, `updateContact(meetingId, id, patch)`, `deleteContact(meetingId, id)`.

## 5. 에러 처리 / PII

- Vision 불가(서버 provider가 CLI/키 없음) 또는 호출 실패 → 첨부 보존, "인식 실패" 표시,
  수동 입력/재시도 여지. `raw_text`는 가능한 한 항상 보존.
- bad JSON → 재시도 1회 → raw_text-only contact.
- 명함 모드에 비이미지 → 422 거부.
- PII: 명함 이미지는 일반 첨부와 동일 저장소(`storage/attachments`)에 보존되며 첨부 삭제로
  제거 가능. contact 행은 회의 삭제 시 cascade.

## 6. 테스트

### 백엔드
- request spec: contacts `index/update/destroy` + 권한(소유/공유/타인) 경계.
- service spec(vision **stub** — 실제 API 미호출): JSON 파싱 → 필드/extra/raw_text 매핑,
  배열(다중 명함), bad JSON → 재시도 → raw_text-only, vision 불가 → 예외.
- job spec: 서비스 stub → contact 생성 + attendees append(중복 skip·비파괴) + broadcast.
- attachment create: category=business_card → job enqueue 검증.

### 프런트
- `AddFileDialog`: 명함 칩 선택 시 이미지 전용·안내문.
- contacts 패널: 렌더 + `contacts_updated` 수신 시 refetch + 수정/삭제.
- `api/contacts.ts` 유닛.

## 7. 범위 밖 (YAGNI / 후속)

- 명함 수동 추가(폼) — 후속.
- 연락처 전역 주소록/재사용 — 후속.
- PDF 스캔 명함 — v1은 이미지만.
- 다국어 명함 고도화 — 프롬프트가 기본 처리, 별도 튜닝은 후속.
