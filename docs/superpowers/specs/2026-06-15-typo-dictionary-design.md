# 폴더별 오타사전 (Glossary) — 설계

- 날짜: 2026-06-15
- 브랜치: `feat/typo-dictionary`
- 우선순위: 2순위 (idea.md "오타사전(오타 수정의 재활용)" §158-162)
- 메커니즘 결정: **결정론적 gsub 재적용** (STT 프롬프트 바이어싱 불채택)

## 1. 목표

오타 교정 매핑 `{from → to}` 를 **영속 저장**하고, 폴더 계층(상위폴더들 → 현재폴더 → 회의)
단위로 적용한다. 파일 재STT 후 자동으로 gsub 재적용되어 **"재STT해도 같은 오타가 다시
나오지 않는다"** 를 보장한다. 사용자가 한 번 고친 오타가 사전에 쌓여 재활용된다.

비목표(YAGNI):
- STT initial_prompt 바이어싱(소프트·~224토큰·환각·qwen3 미배선) — 불채택.
- 회의 → 폴더 엔트리 자동 승격(promote) — 수동(폴더 행에 직접 추가)으로만.
- 실시간/regenerate_notes/re_diarize 자동 재적용 — 범위 밖(아래 §5 참조).

## 2. 데이터 모델 — `glossary_entries` (신규 테이블)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `owner_type` / `owner_id` | string / bigint | polymorphic (`Folder` \| `Meeting`). scope enum 안티패턴 회피 |
| `from_text` | string, null:false | 원본(오타). 최대 200자 |
| `to_text` | string, null:false | 교정 결과. regex 모드 시 `\1` 백레퍼런스 허용 |
| `match_type` | string, null:false, default `"literal"` | `"literal"` \| `"regex"` |
| `enabled` | boolean, null:false, default true | 삭제 없이 비활성화 |
| `created_by_id` | bigint | FK users (감사용) |
| `created_at` / `updated_at` | datetime | |

인덱스:
- `index [:owner_type, :owner_id]`
- `unique index [:owner_type, :owner_id, :from_text, :match_type]`
  (같은 owner 안에서 동일 from+모드 중복 금지)

모델 `GlossaryEntry`:
- `belongs_to :owner, polymorphic: true`
- `belongs_to :creator, class_name: "User", foreign_key: :created_by_id, optional: true`
- validations:
  - `from_text`, `to_text` presence
  - `from_text` length ≤ 200
  - `from_text != to_text` (literal 모드일 때만 의미; regex는 패턴≠결과 자명하므로 검사 생략)
  - `from_text` uniqueness scoped to `[owner_type, owner_id, match_type]`
  - **match_type == "regex" 일 때 컴파일 검증**: `Regexp.new(from_text)` 시도, `RegexpError`면 invalid
- `Folder has_many :glossary_entries, as: :owner, dependent: :destroy`
- `Meeting has_many :glossary_entries, as: :owner, dependent: :destroy`

## 3. Resolver — `GlossaryResolver` (PORO 서비스)

`GlossaryResolver.for(meeting)` → 적용 가능한 교정 목록을 결정론적 순서로 반환.

레벨 수집(구체성 높은 순):
1. `meeting` 자신의 엔트리
2. `meeting.folder` 가 nil이 아니면: `[folder, *folder의 조상들(가까운→먼)]`
   - `Folder#ancestors` 는 `[{id,name}]` 를 **먼→가까운** 순으로 반환하므로,
     resolver 는 별도로 부모 체인을 **레코드로** 로드하고 **가까운→먼** 순으로 정렬한다
     (신규 `Folder#ancestor_records` 헬퍼, 사이클 가드 포함).

병합 규칙:
- enabled 엔트리만.
- **dedup 키 = `[from_text, match_type]`**. 같은 키가 여러 레벨에 있으면
  **구체성이 높은 레벨이 override**(회의 > 현재폴더 > 가까운 조상 > 먼 조상).
- 적용 순서(deterministic):
  1. `literal` 엔트리 먼저 — `from_text` **길이 내림차순**
     (부분 겹침 안전: "이사회"를 "이사"보다 먼저 치환).
  2. `regex` 엔트리 다음 — owner 구체성 → `id`(생성순).
- 가드: `from_text == to_text` (literal) 스킵, nil folder 스킵, disabled 스킵.

반환 형태: `[{ from:, to:, match_type: }, ...]` (적용 순서대로).

## 4. 적용 — `GlossaryApplication` (서비스 + 공통 gsub 헬퍼)

기존 `apply_term_corrections`(meetings_controller.rb:538) gsub 로직을 공통 헬퍼로 추출해
재사용한다. literal/regex 분기:

```ruby
def apply_one(text, entry)
  if entry[:match_type] == "regex"
    re = Regexp.new(entry[:from], timeout: 0.5)   # ReDoS 가드(Ruby 4.0 per-pattern timeout)
    text.gsub(re, entry[:to])
  else
    text.gsub(entry[:from], entry[:to])           # String 인자 = 리터럴 매치
  end
rescue Regexp::TimeoutError
  Rails.logger.warn("[glossary] regex timeout, skipped: #{entry[:from].inspect}")
  text                                            # 해당 엔트리만 스킵, 잡은 계속
end
```

적용 지점 3곳:

1. **자동(파일 STT 훅)** — `file_transcription_job.rb` L44/45
   (`store_transcripts` + `apply_speaker_names` 직후, L46 화자분리/요약 분기 **전**):
   resolver 교정을 **transcripts 에만** gsub. 이후 요약·action_items·decisions·blocks 는
   교정된 transcripts 에서 생성되므로 자동 반영. `regenerate_stt`(같은 잡 perform_later)도 공유.

2. **수동 "사전 재적용"** — 기존 완료 회의용. `POST /meetings/:id/reapply_glossary`:
   **전 표면**(summaries 4컬럼 notes_markdown/key_points/decisions/discussion_details
   + action_items + decisions + blocks + transcripts) 에 적용.
   `/feedback` 의 `correct_records!` 머신을 재사용하되 소스만 resolver 로.
   사용자 메모는 기존 정책대로 제외.

3. **/feedback 영속화 루프(D2=A)** — `/feedback` 적용 성공 후,
   요청 `{from,to}` 쌍을 **회의(meeting) 사전에 자동 upsert**(match_type="literal").
   "오타 수정의 재활용" 루프를 닫는다. 사용자는 사전 패널에서 **편집/삭제** 가능(§7).

## 5. 적용 범위 (확정)

| 경로 | 자동 재적용 | 비고 |
|---|---|---|
| 파일 STT (`FileTranscriptionJob`) | ✅ | §4-1 훅 |
| `regenerate_stt` | ✅ | 같은 잡 공유 |
| 수동 "사전 재적용" 버튼 | ✅ (전 표면) | §4-2 |
| 실시간 STT (`TranscriptionJob`) | ❌ | 별도 잡, 자동 미배선. 수동 버튼으로 커버 |
| `regenerate_notes` / `re_diarize` | ❌ | 별도 잡. 수동 버튼으로 커버 |

## 6. 보안 선결 — FoldersController IDOR (확정 버그)

현재 `backend/app/controllers/api/v1/folders_controller.rb` 의 `#update`/`#destroy`/`#create`
에 소유권/인가 가드가 전무하다(`authenticate_user!` 만, `set_folder` 는 unscoped
`Folder.find`). SERVER_MODE 다중사용자에서 **누구나 남의 폴더를 rename/이동/삭제/shared
토글** 가능(IDOR). 폴더에 사전을 얹으면 권한상승(타인이 상위 폴더 사전 편집 → 하위 전
회의 텍스트 오염)으로 악화되므로 **사전 기능과 독립적으로 먼저 수정**한다.

folders 테이블에 `user_id`/owner 컬럼이 없으므로 소유권을 다음과 같이 정의:

```ruby
# Folder 모델
def editable_by?(user)
  user.admin? || meetings.exists?(created_by_id: user.id)   # admin 또는 직속 회의 creator
end
```

- `FoldersController`: `#update`/`#destroy` 에 인가 가드(미충족 403). `#create` 는 parent
  지정 시 `parent.editable_by?(current_user)` 또는 admin 검사.
- **회귀 테스트 필수**: 비소유자 403 / admin·직속 creator 200.

사전 편집 권한(§7 UI 게이트):
- **회의(meeting) 엔트리**: `authorize_meeting_control!`(meeting_lookup.rb:27-33 =
  admin/owner/host. `/feedback` 과 동일 티어) 재사용.
- **폴더(folder) 엔트리**: `Folder#editable_by?`(admin / 직속 회의 creator).

## 7. API

| 메서드 · 경로 | 동작 | 인가 |
|---|---|---|
| `GET /meetings/:id/glossary` | 3단 뷰(ancestors/folder/meeting 엔트리 + resolved 미리보기) | `authorize_meeting_read!` |
| `POST /meetings/:id/glossary_entries` | 회의 엔트리 생성 | `authorize_meeting_control!` |
| `POST /folders/:id/glossary_entries` | 폴더 엔트리 생성 | `Folder#editable_by?` |
| `PATCH /glossary_entries/:id` | 엔트리 수정(from/to/match_type/enabled) | owner 타입별 게이트 |
| `DELETE /glossary_entries/:id` | 엔트리 삭제 | owner 타입별 게이트 |
| `POST /meetings/:id/reapply_glossary` | 전 표면 수동 재적용 | `authorize_meeting_control!` |

`GET .../glossary` 응답 예:
```json
{
  "ancestors": [{ "folder": {"id":1,"name":"본부"}, "entries": [...] }, ...],
  "folder":    { "folder": {"id":7,"name":"기획팀"}, "entries": [...] },
  "meeting":   { "entries": [...] },
  "resolved":  [{ "from":"회진", "to":"회의", "match_type":"literal" }, ...]
}
```

## 8. 프론트엔드

- **`GlossaryPanel`** — `MeetingPage.tsx` 의 `TermCorrectionDetails`(L451-459) 옆에
  collapsible 로 배치(상태 `completed` 게이트). **3단 테이블**:
  상위폴더들 → 현재폴더 → 현재회의. 행 = `from → to` + `match_type` 셀렉터(리터럴/정규식)
  + `enabled` 토글 + 편집/삭제. 레벨별 "추가"(편집 권한 게이트). 폴더 행에는
  **"이 변경은 N개 회의에 영향" 경고**. 하단 **"사전 재적용"** 버튼.
- `TermCorrectionDetails` 에 자동 영속(D2=A) 안내(자동 저장됨 표시). 별도 체크박스 불필요.
- 폴더 kebab 메뉴(`FolderTree.tsx`)에 **"오타 사전"** 항목 → `GlossaryDialog`
  (사이드바에서 폴더 사전 직접 관리). *부차적 — 시간 여유 시.*
- API: `frontend/src/api/glossary.ts`(신규). 상태: `useGlossary(meetingId)` 훅.

## 9. 테스트 (TDD)

- **모델**: `GlossaryEntry` validations(presence/length/uniqueness/regex 컴파일), polymorphic owner.
- **Resolver**: cascade 구체성 override, literal 길이 내림차순, regex 후순위, nil folder,
  disabled 스킵, from==to 스킵.
- **적용 헬퍼**: literal gsub, regex gsub + 백레퍼런스, **ReDoS timeout 스킵**(악성 패턴이
  잡을 죽이지 않음).
- **보안 회귀**: FoldersController IDOR — 비소유자 update/destroy 403, admin/직속 creator 200.
- **Glossary 컨트롤러**: CRUD 인가(회의 control 티어 / 폴더 editable 티어).
- **잡 훅 통합**: 재STT → 요약 생성 전 transcripts 교정 확인.
- **수동 재적용**: 전 표면 교정 확인.
- **/feedback 영속화**: 적용 후 회의 사전에 엔트리 생성 확인.
- **프론트**: GlossaryPanel 렌더·권한 게이트·재적용 호출.

## 10. 미세결정 (확정)

- **D1 매칭방식**: `literal`(기본) + `regex`(opt-in, per-entry `match_type`).
  ReDoS 4중 가드 — ①저장 시 컴파일 검증 ②from_text ≤ 200자 ③`Regexp.timeout: 0.5s`
  ④적용 중 timeout → 해당 엔트리만 스킵 + 경고 로그.
- **D2 /feedback 영속화**: A — 적용 시 회의 사전에 **자동 저장(ON)**. 편집/삭제 가능.
- **D3 적용 범위**: 파일 STT + `regenerate_stt` **만** 자동. 실시간·notes·re_diarize 제외.

## 11. 구현 순서(개요)

1. 보안 선결: `Folder#editable_by?` + FoldersController 인가 가드 + 회귀 테스트.
2. 마이그레이션 + `GlossaryEntry` 모델 + 연관.
3. `GlossaryResolver` + `Folder#ancestor_records`.
4. `GlossaryApplication` 공통 헬퍼(literal/regex) + ReDoS 가드.
5. 잡 훅(파일 STT) 자동 재적용.
6. API(컨트롤러·라우트) + 인가.
7. `/feedback` 영속화 루프.
8. 프론트 `GlossaryPanel` + API + 훅.
9. (부차) 폴더 kebab `GlossaryDialog`.
