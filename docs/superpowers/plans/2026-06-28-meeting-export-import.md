# 회의·폴더 단위 Export/Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의 1건·폴더 서브트리를 `.ddobak-meeting.tgz`/`.ddobak-folder.tgz` 로 내보내고 현재 프로젝트·폴더에 복원하는 기능(프로젝트/폴더/회의 3단 완성) + 회의 카드 "완료" 배지 줄바꿈 버그 수정.

**Architecture:** 신규 `Transfer::Archive`(tar.gz IO·보안 primitive, **신규 작성**)·`Transfer::MeetingSerializer`/`Transfer::MeetingRestorer`(회의 1건 직렬화/복원, 변이점 호출자 주입)를 회의·폴더 서비스가 공유. 동작 중인 `project_exporter`/`project_importer`(489줄, 데이터-임계)는 **이 브랜치에서 무수정**.

**Tech Stack:** Rails 7 (SQLite, RSpec), React + TypeScript (Vitest), stdlib `Gem::Package::TarWriter`/`Zlib`.

## Global Constraints

- 새 gem 의존성 금지 — tar.gz 는 stdlib(`Gem::Package::TarWriter`+`Zlib::GzipWriter`) 만.
- **`project_exporter.rb`·`project_importer.rb`·`project_transfers_controller.rb` 는 수정 금지**(git diff 0). project spec 은 그대로 그린 유지(회귀 게이트).
- `Transfer::Archive` 는 project 코드 이전이 아니라 **신규 작성**(project 의 검증된 로직을 미러하되 파일은 새로).
- manifest `format_version: 1`, `scope: "meeting"` 또는 `"folder"`(문자열 정확히).
- 산출 파일명: 회의 `<slug>-meeting-YYYYMMDD.ddobak-meeting.tgz` / 폴더 `<slug>-folder-YYYYMMDD.ddobak-folder.tgz`.
- 업로드 상한 3GB, gzip magic(`\x1f\x8b`) 검증, scope 검증 필수.
- export 게이트 = `editable_by?(current_user)`. import 게이트 = 대상 프로젝트 create 권한(`require_create_project!`)+멤버십.
- 가져온 회의: 제목/폴더명 원본 그대로, `share_code=nil`, `locked=false`, 모든 소유권 = import 실행자. 회의 `previous_meeting_id`: 회의 단위=nil / 폴더 단위=서브트리 내 리맵(범위밖 nil).
- 백엔드 루트 `backend/`, 프론트 루트 `frontend/`. 명령: `cd backend && bundle exec rspec ...`, `cd frontend && npx vitest run ...` / `npx tsc -p tsconfig.app.json --noEmit`.
- 커밋은 작업별. 푸시·main 머지는 사용자 승인 후 마지막.

---

## File Structure

**Backend 신규:**
- `backend/app/services/transfer/archive.rb` — tar.gz IO·보안 primitive (module)
- `backend/app/services/transfer/meeting_serializer.rb` — 회의 1건 → hash + 파일목록
- `backend/app/services/transfer/meeting_restorer.rb` — 회의 1건 hash → 새 Meeting (변이점 주입)
- `backend/app/services/meeting_exporter.rb` / `meeting_importer.rb`
- `backend/app/services/folder_exporter.rb` / `folder_importer.rb`
- `backend/app/controllers/api/v1/meeting_transfers_controller.rb`
- `backend/app/controllers/api/v1/folder_transfers_controller.rb`
- specs 대응 (`spec/services/transfer/*_spec.rb`, `spec/services/{meeting,folder}_{exporter,importer}_spec.rb`, `spec/requests/api/v1/{meeting,folder}_transfers_spec.rb`)

**Backend 수정:**
- `backend/config/routes.rb` — 회의·폴더 export/import 라우트

**Frontend 신규:**
- `frontend/src/api/transfers.ts` — meeting+folder export/import 클라이언트
- `frontend/src/api/transfers.test.ts`
- `frontend/src/components/meeting/ExportMeetingDialog.tsx`
- `frontend/src/components/transfer/ImportTransferButton.tsx` — 확장자로 회의/폴더 분기
- `frontend/src/components/folder/ExportFolderItem.tsx`(또는 기존 폴더 메뉴에 항목)

**Frontend 수정:**
- `frontend/src/components/meeting/MeetingActions.tsx` — "회의 내보내기"
- 회의 목록 화면 — "가져오기" 버튼 마운트
- 폴더 메뉴 컴포넌트 — "폴더 내보내기"
- `frontend/src/components/meeting/MeetingListUI.tsx` — StatusBadge 줄바꿈 수정

---

## Task 1: `Transfer::Archive` (신규 primitive, project 무수정)

**Files:**
- Create: `backend/app/services/transfer/archive.rb`
- Create: `backend/spec/services/transfer/archive_spec.rb`

**Interfaces:**
- Produces `Transfer::Archive` (module_function 또는 concern):
  - `guard_entry_name!(name)` → raise `Transfer::Archive::UnsafeEntryError` (zip-slip: 선행 `/`, `..` 세그먼트, `A:\` 드라이브 거부; `\`→`/` 정규화 후 검사)
  - `account_bytes!(added, counter_ref)` / `MAX_DECOMPRESSED_BYTES = 3 * 1024**3` → raise `Transfer::Archive::InvalidArchiveError`
  - `gzip_magic?(io)` → bool (read 2 bytes 0x1f,0x8b, rewind)
  - `add_file_streamed(tar, entry_name, path, chunk: 65536)`
  - `sanitize(model_class, attrs)` → `attrs.slice(*model_class.column_names).except("id","created_at","updated_at")`
  - 에러: `Transfer::Archive::UnsafeEntryError < StandardError`, `Transfer::Archive::InvalidArchiveError < StandardError`

- [ ] **Step 1: 참조 정독** — `backend/app/services/project_importer.rb` 의 `guard_entry_name!`·`account_bytes!`·`sanitize`, `project_exporter.rb` 의 `add_file_streamed`·CHUNK_SIZE, `project_transfers_controller.rb` 의 `gzip_magic?` 로직 확인(미러 대상). **project 파일은 읽기만, 수정 금지.**
- [ ] **Step 2: spec 작성(실패)** — `archive_spec.rb`: `guard_entry_name!` 가 `"../x"`,`"/abs"`,`"a/../b"`,`"C:\\x"` raise·`"audio/1.mp3"` 통과; `gzip_magic?` 가 `"\x1f\x8b..."` true·`"PK.."` false·호출 후 pos 0; `account_bytes!` 누적 >3GB raise; `sanitize(Meeting, {"id"=>1,"title"=>"x","bogus"=>9})` → `{"title"=>"x"}`.
- [ ] **Step 3: 실패 확인** — `cd backend && bundle exec rspec spec/services/transfer/archive_spec.rb` → FAIL(`uninitialized constant Transfer::Archive`).
- [ ] **Step 4: 구현** — `transfer/archive.rb` 작성.
- [ ] **Step 5: 통과 확인** — 같은 명령 → PASS.
- [ ] **Step 6: project 무수정 증명** — `git status --short backend/app/services/project_*.rb backend/app/controllers/api/v1/project_transfers_controller.rb` → 출력 없음(변경 0).
- [ ] **Step 7: Commit** — `git add backend/app/services/transfer/archive.rb backend/spec/services/transfer/archive_spec.rb && git commit -m "feat(transfer): Transfer::Archive tar.gz IO + security primitives"`

---

## Task 2: `Transfer::MeetingSerializer` + `MeetingExporter`

**Files:**
- Create: `backend/app/services/transfer/meeting_serializer.rb`
- Create: `backend/app/services/meeting_exporter.rb`
- Create: `backend/spec/services/meeting_exporter_spec.rb`

**Interfaces:**
- Consumes: `Transfer::Archive`.
- Produces:
  - `Transfer::MeetingSerializer.new(meeting)` → `#as_hash` (meeting cols + `transcripts/summaries/action_items/decisions/blocks/attachments/contacts/bookmarks/participants/chat_messages/tag_ids/glossary_entries`, attachment 의 file_path 는 basename 으로 치환), `#files` → `[{tar_entry:, path:}]` (audio[옵션]·attachment 원본·`.extracted/**`), `#tags` → 참조 태그 레코드.
  - `MeetingExporter.new(meeting, include_audio: true)` → `#write_to(io)`(tar.gz: manifest.json scope:"meeting" + 파일), `#filename`.

- [ ] **Step 1: spec 작성(실패)** — `meeting_exporter_spec.rb`: 시드 meeting(transcripts·summary·block(parent)·attachment(+`.extracted/x.txt`)·contact·bookmark·chat·tag·glossary). export→tar 추출: `manifest["scope"]=="meeting"`, `manifest["meeting"]["transcripts"].size` 일치, `manifest["tags"]` 에 태그 name, `include_audio:false`→audio 엔트리 0, `include_audio:true`&오디오 존재→`audio/<id>.<ext>` 존재, `attachments/<basename>.extracted/x.txt` tar 포함.
- [ ] **Step 2: 실패 확인** — `cd backend && bundle exec rspec spec/services/meeting_exporter_spec.rb` → FAIL.
- [ ] **Step 3: 구현** — `meeting_serializer.rb`(직렬화 로직, project_exporter 의 serialize_meeting/serialize_attachment 미러 + `.extracted` 재귀 `Dir.glob(File.join(att.extraction_dir,"**/*"))`), `meeting_exporter.rb`(manifest 조립·`Transfer::Archive.add_file_streamed`).
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: Commit** — `git add backend/app/services/transfer/meeting_serializer.rb backend/app/services/meeting_exporter.rb backend/spec/services/meeting_exporter_spec.rb && git commit -m "feat(transfer): MeetingSerializer + MeetingExporter (scope=meeting)"`

---

## Task 3: `Transfer::MeetingRestorer` + `MeetingImporter`

**Files:**
- Create: `backend/app/services/transfer/meeting_restorer.rb`
- Create: `backend/app/services/meeting_importer.rb`
- Create: `backend/spec/services/meeting_importer_spec.rb`

**Interfaces:**
- Consumes: `Transfer::Archive`, `MeetingExporter`(round-trip), `ProjectExporter`(wrong-scope 테스트).
- Produces:
  - `Transfer::MeetingRestorer.new(meeting_hash, user:, project:, file_lookup:, folder_id:, previous_meeting_id: nil, tag_resolver:)` → `#restore!` → 새 `Meeting`. `file_lookup` = `->(tar_entry){ staged_path or nil }`. `tag_resolver` = `->(tag_hash){ Tag }`. 자식 복원·blocks 2-pass·contacts source_attachment 리맵·소유권 이관·파일 복사·cleanup 경로 yield/수집.
  - `MeetingImporter.new(io, user:, project:, folder: nil)` → `#run!` → `{ meeting_id: }`. scope!="meeting" → raise `Transfer::Archive::InvalidArchiveError`.

- [ ] **Step 1: 라운드트립 spec 작성(실패)** — `meeting_importer_spec.rb`:
  - export→`MeetingImporter.new(io, user:, project: 대상, folder: 대상폴더).run!`.
  - 새 meeting: project_id=대상·folder_id=대상폴더·created_by=실행자·제목 동일·share_code nil·previous_meeting_id nil·locked false.
  - transcripts/summaries/blocks/chat 수·내용 일치, blocks `parent_block_id` 보존.
  - **태그 dedup**: 대상 프로젝트에 동명 태그 선존재→재사용(중복 0); manifest 신규 태그→project_id=대상.
  - 소유권: chat/bookmark/participant user_id·attachment uploaded_by_id·contact created_by_id=실행자. contacts source_attachment_id→새 id.
  - 파일: audio·attachment·`.extracted/` 복사 존재. `include_audio:false`→audio_file_path nil.
  - **wrong-scope**: `ProjectExporter` tgz → `MeetingImporter` → `InvalidArchiveError`.
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — `meeting_restorer.rb`(변이점 주입 복원, project_importer 의 meeting/child 복원 로직 미러하되 신규), `meeting_importer.rb`(tgz 추출·`Transfer::Archive` 가드·manifest+scope 검증·단일 트랜잭션·`MeetingRestorer` 호출 folder_id=주입·previous_meeting_id=nil·tag_resolver=find_or_create_by(name){project_id=대상}·post-commit EmbedBackfillJob·rollback cleanup).
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: Commit** — `git add backend/app/services/transfer/meeting_restorer.rb backend/app/services/meeting_importer.rb backend/spec/services/meeting_importer_spec.rb && git commit -m "feat(transfer): MeetingRestorer + MeetingImporter (.ddobak-meeting.tgz → current project)"`

---

## Task 4: `FolderExporter`

**Files:**
- Create: `backend/app/services/folder_exporter.rb`
- Create: `backend/spec/services/folder_exporter_spec.rb`

**Interfaces:**
- Consumes: `Transfer::Archive`, `Transfer::MeetingSerializer`.
- Produces: `FolderExporter.new(folder, include_audio: true)` → `#write_to(io)`(tar.gz manifest scope:"folder", `folders:[서브트리]`·`meetings:[MeetingSerializer 각]`·`tags:`), `#filename`.

- [ ] **Step 1: spec 작성(실패)** — `folder_exporter_spec.rb`: 폴더 A>자식 B, A에 회의1·B에 회의2(서로 previous_meeting 링크). export→추출: `manifest["scope"]=="folder"`, `folders` 에 A·B(parent_id 보존), `meetings` 2건(각 folder_id 보존), 회의2 manifest 에 previous_meeting_id=회의1 원본 id, audio/attachment 엔트리.
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — `folder_exporter.rb`: 폴더 서브트리 수집(`folder` + 재귀 children), 각 폴더 cols+glossary+tag_ids, 소속 meetings 를 `Transfer::MeetingSerializer` 로, 파일 합산.
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: Commit** — `git add backend/app/services/folder_exporter.rb backend/spec/services/folder_exporter_spec.rb && git commit -m "feat(transfer): FolderExporter (scope=folder, subtree+meetings)"`

---

## Task 5: `FolderImporter`

**Files:**
- Create: `backend/app/services/folder_importer.rb`
- Create: `backend/spec/services/folder_importer_spec.rb`

**Interfaces:**
- Consumes: `Transfer::Archive`, `Transfer::MeetingRestorer`, `FolderExporter`(round-trip).
- Produces: `FolderImporter.new(io, user:, project:, parent_folder: nil)` → `#run!` → `{ folder_id:, meeting_ids: }`. scope!="folder" → raise.

- [ ] **Step 1: 라운드트립 spec 작성(실패)** — `folder_importer_spec.rb`:
  - FolderExporter(폴더 A>B, 회의1@A·회의2@B prev=회의1) export → `FolderImporter.new(io, user:, project: 대상, parent_folder: 대상상위).run!`.
  - 폴더 계층: 새 A.parent_id=대상상위·새 B.parent_id=새 A. 회의1@새A·회의2@새B.
  - **회의2 previous_meeting_id = 새 회의1 id**(서브트리 내 리맵). (범위밖이면 nil 인 케이스도 단언)
  - 소유권·태그 dedup·파일 복사 = 회의 단위와 동일.
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — `folder_importer.rb`: tgz 추출·가드·scope 검증·단일 트랜잭션. folders 2-pass(생성 후 parent_id 리맵, 루트 폴더 parent=주입 parent_folder), folder_map. meetings 2-pass: 먼저 `MeetingRestorer`(folder_id=folder_map[원본]·previous_meeting_id=nil) 로 생성하며 meeting_map 채움, 그 다음 `previous_meeting_id` 서브트리 리맵(meeting_map 에 있으면 새 id, 없으면 nil) update. tag_resolver 공통. post-commit EmbedBackfillJob(회의별). rollback cleanup.
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: Commit** — `git add backend/app/services/folder_importer.rb backend/spec/services/folder_importer_spec.rb && git commit -m "feat(transfer): FolderImporter (.ddobak-folder.tgz → current project subtree)"`

---

## Task 6: 컨트롤러 + 라우트 (회의 + 폴더)

**Files:**
- Create: `backend/app/controllers/api/v1/meeting_transfers_controller.rb`
- Create: `backend/app/controllers/api/v1/folder_transfers_controller.rb`
- Create: `backend/spec/requests/api/v1/meeting_transfers_spec.rb`
- Create: `backend/spec/requests/api/v1/folder_transfers_spec.rb`
- Modify: `backend/config/routes.rb`

**Interfaces:**
- Produces 라우트(설계 §라우트). 응답: 회의 export 200 gzip / import 201 `{meeting_id}`; 폴더 export 200 gzip / import 201 `{folder_id, meeting_ids}`.

- [ ] **Step 1: 라우트 추가** — `routes.rb`: meetings member `post :export → meeting_transfers#export`; `post "projects/:project_id/meetings/import" → meeting_transfers#import`; folders member `post :export → folder_transfers#export`; `post "projects/:project_id/folders/import" → folder_transfers#import`. 기존 라우트 충돌 확인.
- [ ] **Step 2: request spec 작성(실패)** — `meeting_transfers_spec.rb`·`folder_transfers_spec.rb`: export editor 200·gzip magic·filename / 비-editor 403 / non-accessible 404; import 멤버 201·생성검증 / 비-멤버 403 / wrong-scope 422 / non-gzip 422.
- [ ] **Step 3: 실패 확인** — 두 spec FAIL.
- [ ] **Step 4: 컨트롤러 구현** — `project_transfers_controller.rb` 패턴 미러(신규 파일). export: set + `editable_by?` 게이트·`send_file`·Content-Disposition. import: 대상 project 로드+create/멤버십 게이트·folder/parent 소속 검증·3GB·`Transfer::Archive.gzip_magic?`·서비스 호출·rescue `Transfer::Archive::*`/`Zlib::GzipFile::Error`/`RecordInvalid`→422.
- [ ] **Step 5: 통과 확인** — 두 spec PASS.
- [ ] **Step 6: 백엔드 전체 회귀** — `cd backend && bundle exec rspec spec/services spec/requests/api/v1/project_transfers_spec.rb spec/requests/api/v1/meeting_transfers_spec.rb spec/requests/api/v1/folder_transfers_spec.rb` → ALL PASS (project spec 포함 그린).
- [ ] **Step 7: Commit** — `git add backend/app/controllers/api/v1/meeting_transfers_controller.rb backend/app/controllers/api/v1/folder_transfers_controller.rb backend/spec/requests/api/v1/meeting_transfers_spec.rb backend/spec/requests/api/v1/folder_transfers_spec.rb backend/config/routes.rb && git commit -m "feat(transfer): meeting+folder export/import API endpoints + gates"`

---

## Task 7: 프론트엔드 API + UI

**Files:**
- Create: `frontend/src/api/transfers.ts`, `frontend/src/api/transfers.test.ts`
- Create: `frontend/src/components/meeting/ExportMeetingDialog.tsx`, `frontend/src/components/transfer/ImportTransferButton.tsx`
- Modify: `frontend/src/components/meeting/MeetingActions.tsx`, 회의 목록 화면, 폴더 메뉴 컴포넌트

**Interfaces:**
- `exportMeeting(meetingId, {includeAudio}): Promise<void>` / `importMeeting(projectId, file, folderId?): Promise<{meeting_id}>`
- `exportFolder(folderId, {includeAudio}): Promise<void>` / `importFolder(projectId, file, parentFolderId?): Promise<{folder_id, meeting_ids}>`
- `ImportTransferButton`: 파일 확장자(`.ddobak-meeting.tgz`/`.ddobak-folder.tgz`)로 회의/폴더 import 분기.

- [ ] **Step 1: api test 작성(실패)** — `transfers.test.ts`: export 가 올바른 URL·body POST + blob 다운로드(projectTransfers.test.ts mock 패턴), import 가 FormData POST + 응답 반환. (회의·폴더 각 1 케이스)
- [ ] **Step 2: 실패 확인** — `cd frontend && npx vitest run src/api/transfers.test.ts` → FAIL.
- [ ] **Step 3: api 구현** — `transfers.ts`(projectTransfers.ts 패턴, `filenameFromDisposition` 재사용/복제, `timeout:false`).
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: UI 구현** — `ExportMeetingDialog`(음성 체크박스), `ImportTransferButton`(확장자 분기·`onImported` refetch), `MeetingActions` 에 "회의 내보내기", 폴더 메뉴에 "폴더 내보내기", 회의 목록 화면에 `ImportTransferButton`(현재 projectId+folderId 전달). 컴포넌트 위치는 Task 시작 시 grep(`MeetingActions.tsx`·폴더 메뉴·목록 화면) 확정.
- [ ] **Step 6: 타입체크+테스트** — `cd frontend && npx tsc -p tsconfig.app.json --noEmit`(신규 에러 0; 기준선 ~24 무시) + `npx vitest run src/api/transfers.test.ts` PASS.
- [ ] **Step 7: Commit** — `git add frontend/src/api/transfers.* frontend/src/components/meeting/ExportMeetingDialog.tsx frontend/src/components/transfer/ImportTransferButton.tsx frontend/src/components/meeting/MeetingActions.tsx <목록·폴더화면> && git commit -m "feat(transfer): meeting+folder export/import frontend"`

---

## Task 8: 회의 카드 "완료" 배지 줄바꿈 수정

**Files:**
- Modify: `frontend/src/components/meeting/MeetingListUI.tsx`

- [ ] **Step 1: 마크업 확인** — `StatusBadge`(line ~14–50) 전 status span + 감싸는 카드 헤더 row(제목+배지) 정독, 제목 컨테이너 `min-w-0` 유무.
- [ ] **Step 2: 수정** — 전 status `<span>` className 에 `whitespace-nowrap shrink-0` 추가, 배지를 밀어내는 제목/콘텐츠 flex 자식에 `min-w-0`.
- [ ] **Step 3: 검증** — `cd frontend && npx tsc -p tsconfig.app.json --noEmit`(에러 0) + 관련 vitest 있으면 PASS. dev 서버로 긴 제목 카드 배지 가로 유지 육안 확인(가능 시).
- [ ] **Step 4: Commit** — `git add frontend/src/components/meeting/MeetingListUI.tsx && git commit -m "fix(meeting): 회의 카드 완료 배지 세로 줄바꿈 방지"`

---

## Task 9: 통합 검증 + idea.md + 마무리

**Files:** Modify: `idea.md`

- [ ] **Step 1: 백엔드 전체 그린** — `cd backend && bundle exec rspec spec/services spec/requests/api/v1/{meeting,folder,project}_transfers_spec.rb` → ALL PASS.
- [ ] **Step 2: 프론트 타입체크+테스트** — `cd frontend && npx tsc -p tsconfig.app.json --noEmit && npx vitest run src/api/transfers.test.ts` → PASS·신규 에러 0.
- [ ] **Step 3: project 무수정 최종 확인** — `git diff main --stat -- backend/app/services/project_exporter.rb backend/app/services/project_importer.rb backend/app/controllers/api/v1/project_transfers_controller.rb` → 출력 없음.
- [ ] **Step 4: idea.md 22번 이동** — "## 향후 추가 계획 — 미완료" 에서 `22. 회의 단위로 내보내기 가져오기...` 제거 → "## 향후 추가 계획 — 완료 (완)" 의 `21.` 뒤에 `22. 회의·폴더 단위 내보내기/가져오기 (완)` 추가.
- [ ] **Step 5: idea.md 포함 커밋** — `git add idea.md && git commit -m "docs(idea): 22번 회의·폴더 단위 export/import 완료"`. 사용자 승인 후 main 머지.

---

## Self-Review

- **Spec coverage**: Archive 신규·project 무수정(T1, T6·T9 검증), MeetingSerializer/Restorer 공유(T2·T3), 회의 export/import+태그 dedup+wrong-scope(T2·T3), 폴더 export/import+previous_meeting 서브트리 리맵(T4·T5), 권한 게이트(T6), 프론트 3단 UI(T7), 배지(T8), idea.md(T9) — 전 항목 매핑.
- **Placeholder**: 코드 단계는 실존 참조 파일(project_*) 미러 + 차이 열거. mirror 대상은 실파일.
- **Type 일관**: `MeetingExporter.new(m, include_audio:)`·`MeetingImporter.new(io,user:,project:,folder:)`→`{meeting_id}`·`FolderExporter.new(f,include_audio:)`·`FolderImporter.new(io,user:,project:,parent_folder:)`→`{folder_id,meeting_ids}`·`MeetingRestorer.new(hash,user:,project:,file_lookup:,folder_id:,previous_meeting_id:,tag_resolver:)` 전 Task 일관.
