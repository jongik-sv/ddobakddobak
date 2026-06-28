# 회의·폴더 단위 Export/Import 설계

날짜: 2026-06-28
브랜치: `feat/meeting-export-import`
상태: 승인됨 (구현 대기)
선행: [2026-06-17 프로젝트 Export/Import](2026-06-17-project-export-import-design.md) — 본 기능은 그 미러·축소판.

## 목적

프로젝트/폴더/회의 **3단 granularity** export/import 완성. 프로젝트 통째 이관(2026-06-17)에 더해:
- **회의 1건**을 `.ddobak-meeting.tgz` 로 → 다른 기기 **현재 프로젝트·현재 폴더**에 새 회의로 복원
- **폴더(디렉토리) 1개**를 `.ddobak-folder.tgz` 로(서브트리+소속 회의 통째) → **현재 프로젝트·현재 폴더 하위**에 폴더 계층 재생성+회의 복원

프로젝트 export/import 와의 핵심 차이:
- 항상 **새 프로젝트 생성** → **현재 프로젝트에** 회의/폴더 추가
- 프로젝트 컨테이너·멤버십 직렬화 안 함 (대상은 import 요청 파라미터)

## 확정된 결정 (브레인스토밍)

| 항목 | 회의 단위 | 폴더 단위 |
|------|----------|----------|
| 가져오기 대상 | 현재 프로젝트 + 현재 보던 폴더(nil→루트) | 현재 프로젝트 + 현재 폴더 하위에 서브트리 부착(nil→루트) |
| 권한 (export) | `meeting.editable_by?(user)` | `folder.editable_by?(user)` |
| 권한 (import) | 대상 프로젝트 create 권한+멤버십 | 동일 |
| AI 챗 | 포함, 실행자 소유로 합침 | 동일 (소속 전 회의) |
| 이름/제목 | 원본 그대로 | 원본 폴더명 그대로(폴더는 name unique 아님) |
| 콘텐츠 소유자 | import 실행자 | import 실행자 |
| 오디오 | export 토글 `include_audio`(기본 on) | 동일 |
| 충돌 처리 | 항상 새 회의 | 항상 새 폴더(+새 회의), 머지 없음 |
| `previous_meeting_id` | 항상 nil | **서브트리 내 리맵**, 범위밖 nil |

## 데이터 모델

### 회의 1건 (직렬화 대상)

```
Meeting (share_code=nil, previous_meeting_id=nil, locked=false 로 복원)
├── transcripts            (FTS: transcripts_fts — 콜백 자동 재색인)
├── summaries              (FTS: summaries_fts)
├── action_items / decisions
├── blocks                 (parent_block_id 자기참조 → 2-pass 리맵)
├── meeting_attachments    (파일: storage/attachments/ + .extracted/ 디렉토리)
├── meeting_contacts       (source_attachment_id → 새 attachment id 리맵)
├── meeting_bookmarks      (user_id → 실행자)
├── meeting_participants   (user_id → 실행자, active 1개 캡)
├── chat_messages          (user_id → 실행자)
├── taggings → tags        (tag.name 전역 unique → find_or_create_by)
└── glossary_entries       (polymorphic owner=Meeting, created_by_id=nil)
```

### 폴더 1개

```
Folder (자기참조 parent_id 서브트리 — 선택 폴더+모든 하위 폴더)
├── glossary_entries       (folder owner)
├── taggings → tags
└── meetings               (각 회의는 위 "회의 1건" 구조 통째)
```

**참조만 하고 직렬화 안 함**: project, (회의 단위의) folder, (폴더 단위의) 상위 parent — import 요청 파라미터로 지정.
**태그**: `tag_ids` 만으로는 기기 간 무의미 → manifest 최상위 `tags:[{name,color,…}]` 전체 레코드 동봉. import 는 `find_or_create_by(name:)` dedup.

파일 (절대 경로 DB 저장 → import 시 재작성 필수):
- 오디오: `meetings.audio_file_path`
- 첨부: `meeting_attachments.file_path` + `<file_path>.extracted/`

`transcript_embeddings`(BLOB)는 직렬화 안 함 — import 후 `EmbedBackfillJob` 재생성.

## 산출 포맷 — `.tgz` (stdlib only)

`Gem::Package::TarWriter` + `Zlib::GzipWriter`.
- 회의: `<meeting-slug>-meeting-YYYYMMDD.ddobak-meeting.tgz`, `scope:"meeting"`
- 폴더: `<folder-slug>-folder-YYYYMMDD.ddobak-folder.tgz`, `scope:"folder"`

```
manifest.json
  {
    "format_version": 1,
    "scope": "meeting" | "folder",     // ← 스코프 판별
    "exported_at":, "app_version":, "include_audio":,
    "tags": [ {id,name,color,project_id,...} ],
    // scope=="meeting":
    "meeting": { ...cols, transcripts, summaries, action_items, decisions,
                 blocks, attachments, contacts, bookmarks, participants,
                 chat_messages, tag_ids, glossary_entries },
    // scope=="folder":
    "folders":  [ {id, parent_id, ...cols, glossary_entries, tag_ids} ],
    "meetings": [ { ...회의 1건 구조 (folder_id 보존) } ]
  }
audio/<원본meeting_id>.<ext>            # include_audio 시
attachments/<원본첨부 basename>          # 존재 시
attachments/<basename>.extracted/...    # .extracted 디렉토리 존재 시 (충실 번들)
```

> **`.extracted` 번들**: 프로젝트 exporter 는 추출 텍스트 디렉토리를 빠뜨린다(첨부 원본만). 회의/폴더 export 는 단위가 작아 `.extracted/` 까지 번들해 충실 복원한다.

## 포맷 스코프 검증 (필수)

- 회의 import: `manifest.scope != "meeting"` → 거부 (422)
- 폴더 import: `manifest.scope != "folder"` → 거부 (422)
- 한쪽이 다른 포맷을 절반 import 후 깨지는 것 방지 → scope 검증 + 전용 테스트

## 아키텍처 — 공유 정책 (advisor 정정 반영)

**핵심 원칙: 동작 중인 데이터-임계 `project_exporter`/`project_importer`(489줄)는 이 브랜치에서 손대지 않는다.** (이 레포 데이터손실 전적 — 마이그 wipe·6/16 전사 전멸·FK cascade. import/restore 는 데이터 이동 표면이라 비대칭 위험.) 티어들은 **설계상 분기**한다(회의=`source_attachment_id` 리맵 vs 프로젝트=nil, `previous_meeting_id` 처리 상이) → 단일 공유 restore 는 불가능하고 불필요.

| 단위 | 책임 | 비고 |
|------|------|------|
| `Transfer::Archive` (신규) | tar.gz IO·보안 primitive (`guard_entry_name!`·`account_bytes!`·`gzip_magic?`·tempfile staging·`sanitize`·`add_file_streamed`) | **신규 작성**(project 코드 이전 아님). 회의·폴더 서비스만 사용. project 서비스 무수정 |
| `Transfer::MeetingSerializer` (신규) | 회의 1건 → hash + 파일 목록(audio·attachments·.extracted) | 회의·폴더 exporter 공유 |
| `Transfer::MeetingRestorer` (신규) | 회의 1건 hash → 새 Meeting 복원·자식·파일복사. **변이점을 호출자 주입** | 회의·폴더 importer 공유 |
| `MeetingExporter`/`MeetingImporter` (신규) | scope:"meeting" manifest·tgz·단일 회의 | |
| `FolderExporter`/`FolderImporter` (신규) | scope:"folder" manifest·tgz·폴더 2-pass + 회의들 | |
| `Api::V1::MeetingTransfersController`·`FolderTransfersController` (신규) | HTTP 경계·게이트·스트리밍 | |
| `project_exporter.rb`·`project_importer.rb` | **변경 없음** | project↔shared dedup 은 deferred(별도 isolated 리팩터로 기록) |

**`Transfer::MeetingRestorer` 주입 인터페이스** (티어별 변이점):
- `folder_id_for(meeting_hash)` — 회의: 주입 폴더 고정 / 폴더: folder_map[원본 folder_id]
- `previous_meeting_id_for(meeting_hash, meeting_map)` — 회의: 항상 nil / 폴더: 서브트리 meeting_map 리맵(범위밖 nil)
- `tag_for(tag_hash)` — `Tag.find_or_create_by(name:)`{ 신규면 project_id=대상 }
- `user` (소유자), `project` (대상), 아카이브 파일 접근자(staged tgz 에서 audio/attachment/.extracted 복사)

## Import 흐름 (공통)

1. 게이트 (export=editable_by? / import=대상 프로젝트 create+멤버십, folder_id 주면 같은 project 소속 검증)
2. tgz 추출 — path-traversal 가드·≤3GB·gzip magic
3. manifest 파싱 → `format_version`·`scope` 검증
4. 단일 DB 트랜잭션:
   - (폴더) folders 2-pass 생성(parent 리맵), 대상 = 현재 프로젝트·parent=현재 폴더(nil→루트)
   - 각 회의 → `Transfer::MeetingRestorer` (티어 주입). share_code nil, locked false, 소유=실행자
   - 파일 복사: audio→`storage/audio/<새id>`, attachment→`storage/attachments/<새meetingid>_…`, `.extracted/` 복사. cleanup 리스트
5. post-commit: 회의별 transcripts 있으면 `EmbedBackfillJob.perform_later`
6. 회의 단위 `{meeting_id}` / 폴더 단위 `{folder_id, meeting_ids}` 반환

## 라우트

- `POST /api/v1/meetings/:id/export` body `{include_audio}`
- `POST /api/v1/projects/:project_id/meetings/import` multipart `file`, body `{folder_id?}`
- `POST /api/v1/folders/:id/export` body `{include_audio}`
- `POST /api/v1/projects/:project_id/folders/import` multipart `file`, body `{parent_folder_id?}`

## UI

- **회의 내보내기**: `MeetingActions` 에 항목 추가(기존 markdown `ExportButton` 과 별개). 음성 토글 다이얼로그
- **폴더 내보내기**: 폴더 컨텍스트 메뉴/액션에 "폴더 내보내기"
- **가져오기**: 프로젝트/폴더 회의 목록 화면에 "가져오기" 버튼 — 파일 확장자(`.ddobak-meeting.tgz`/`.ddobak-folder.tgz`)로 회의/폴더 분기, 현재 project_id(+folder_id/parent_folder_id) 전달
- API 클라이언트 `frontend/src/api/meetingTransfers.ts` + `folderTransfers.ts` (또는 통합 `transfers.ts`), `timeout:false`

## 별건 버그 수정 (같은 브랜치)

회의 카드 상태 배지 "완료" 가 제목이 길면 세로(완/료)로 줄바꿈.
- 위치: `frontend/src/components/meeting/MeetingListUI.tsx` `StatusBadge` (line ~14–50)
- 수정: 배지 span 에 `whitespace-nowrap shrink-0`, 제목/콘텐츠 컨테이너에 `min-w-0`

## 보안

- export 게이트 `editable_by?`, import 게이트 멤버십+create
- zip-slip·zip-bomb(3GB)·gzip magic·**scope 검증**
- import 원자적 트랜잭션 — 부분 실패 전부 롤백 + 복사 파일 정리

## TDD 검증

공통:
- 비-editor export 403, 비-member import 403, zip-slip 거부, wrong-scope 422
- `include_audio=false` → 오디오 없음·메타 보존
- 소유권 = 실행자, `share_code` nil
- `.extracted/` 복사, FTS 검색이 import 트랜스크립트 매칭
- **`Transfer::Archive` 추출이 project 서비스를 건드리지 않음** 확인 (project 서비스 git diff 없음, project spec 그대로 그린)

회의:
- 라운드트립을 **이미 동명 태그를 가진 기존 프로젝트로** import → 태그 dedup(기존 재사용·신규는 대상 project_id), 대상 project/folder, `previous_meeting_id` nil

폴더:
- 서브트리 폴더 계층 보존(parent 리맵), 소속 회의 전부 복원
- **`previous_meeting_id` 서브트리 내 리맵**(범위밖 nil) 단언
- 부착 위치 = 현재 폴더 하위

## 비범위 (YAGNI)

- 멱등 재import·머지 (항상 새 회의/폴더)
- 유저/멤버 이관 (전부 실행자)
- 프로젝트 컨테이너 이관
- `project_*` 서비스를 shared 모듈로 폴드(deferred, 별도 리팩터)
- 진행률 스트리밍

## 완료 후 작업

- `idea.md` 22번 → "향후 추가 계획 — 완료" 챕터(21번 뒤) 이동
- `idea.md` 를 최종 커밋에 함께 묶음
