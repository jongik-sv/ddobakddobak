# 프로젝트 Export/Import 설계

날짜: 2026-06-17
브랜치: `feat/project-export-import`
상태: 승인됨 (구현 대기)

## 목적

특정 프로젝트 1개를 통째로 다른 기기(같은 또박또박 앱)로 이관한다. 회의록·음성·트랜스크립트·요약·AI 챗 등 프로젝트에 속한 모든 데이터를 단일 `.zip`으로 내보내고, 대상 기기에서 가져와 **새 프로젝트**로 복원한다.

SQLite 파일 통복사는 전체 DB를 옮기므로 부적합 → 프로젝트 단위 선택 이관을 위한 export/import 기능을 구현한다.

## 확정된 결정 (브레인스토밍)

| 항목 | 결정 |
|------|------|
| 실행 방식 | 앱 내 UI 버튼 (API 엔드포인트 + ProjectsPage) |
| 권한 | **시스템 admin 전용** (`User#admin?` == `role == "admin"`), export·import 둘 다 |
| 콘텐츠 소유자 | 가져온 모든 회의·챗·첨부 = **import 실행자** 소유 (유저 리매핑 없음) |
| AI 챗 범위 | **전원 챗 전부** 포함 (실행자 소유로 합침) |
| 새 프로젝트 멤버 | **import 실행자만** (admin 멤버). 원본 멤버십 드롭 |
| 충돌 처리 | **항상 새 Project 생성** (멱등성 없음, 머지 없음) |
| 오디오 | export 시 **토글** (`include_audio`). 끄면 메타데이터만 |
| 새 프로젝트 이름 | `원본이름 (가져옴 YYYY-MM-DD)` 자동 접미사 |

## 데이터 모델

```
Project
├── folders            (자기참조 parent_id 계층)
├── project_memberships  ← import 시 실행자만 새로 생성
├── project_invites     ← 이관 안 함
└── meetings
    ├── transcripts        (FTS: transcripts_fts)
    ├── summaries          (FTS: summaries_fts)
    ├── action_items
    ├── decisions
    ├── blocks
    ├── meeting_attachments  (파일: storage/attachments/, uploaded_by_id)
    ├── meeting_contacts
    ├── meeting_bookmarks    (user_id)
    ├── meeting_participants
    ├── chat_messages        (user_id — per-user private)
    ├── taggings → tags      (tag.name 전역 unique, project_id optional)
    └── glossary_entries     (polymorphic owner)
```

파일 저장 (절대 경로로 DB에 저장됨 → import 시 재작성 필수):
- 오디오: `meetings.audio_file_path` = `<root>/backend/storage/audio/<meeting_id>.mp3`
- 첨부: `meeting_attachments.file_path` = `<root>/backend/storage/attachments/<meetingid>_<hash>_<name>`

## 산출 포맷 — `.tar.gz` (stdlib only)

**rubyzip 미설치 → 새 gem 의존성 회피.** `Gem::Package::TarWriter` + `Zlib::GzipWriter`(쓰기), `Gem::Package::TarReader` + `Zlib::GzipReader`(읽기)로 stdlib만 사용. 대용량 오디오는 디스크에서 청크 스트리밍. 앱 전용 포맷이라 사용자가 직접 열 일 없음. 파일명 `<slug>-export-YYYYMMDD.ddobak.tgz`.

```
manifest.json
  {
    "format_version": 1,
    "exported_at": "2026-06-17T...",
    "app_version": "...",
    "include_audio": true,
    "project": { name, icon_*, ... },
    "folders": [ {id, parent_id, ...}, ... ],
    "tags":    [ {id, name, color, ...}, ... ],
    "meetings": [
      { ...meeting cols (원본 id 보존),
        transcripts: [...], summaries: [...], action_items: [...],
        decisions: [...], blocks: [...], attachments: [...],
        contacts: [...], bookmarks: [...], participants: [...],
        chat_messages: [...], tag_ids: [...], glossary_entries: [...] }
    ]
  }
audio/<원본meeting_id>.mp3          # include_audio=true 일 때만
attachments/<원본첨부파일basename>    # 항상 (첨부는 작음)
```

원본 PK를 그대로 직렬화 → import 시 old_id→new 맵으로 FK 리매핑.

## Export 흐름

`POST /api/v1/projects/:id/export` body `{ include_audio: bool }`
→ `ProjectExporter.new(project, include_audio:).write_to(io)` (tar.gz) 스트리밍 다운로드 `<slug>-export-YYYYMMDD.ddobak.tgz`

1. 게이트: `current_user.admin?` 아니면 403
2. eager-load project + 전 자식 직렬화 (원본 PK 유지)
3. zip 빌드: manifest.json + (include_audio면) audio/ + attachments/
4. `Content-Disposition: attachment` 스트리밍

## Import 흐름

`POST /api/v1/projects/import` multipart `file=<zip>`
→ `ProjectImporter.new(zip_io, current_user).run!` → `{ project_id }`

1. 게이트: `current_user.admin?` 아니면 403
2. tar.gz 임시 디렉토리 추출 — **path-traversal 가드**(엔트리명 `..`·절대경로 거부), 업로드 크기 제한
3. manifest 파싱, `format_version` 확인
4. **단일 DB 트랜잭션**:
   - `Project` 생성 (name = `원본 (가져옴 YYYY-MM-DD)`, creator = 실행자)
   - `ProjectMembership` (실행자, role admin)
   - **folders**: 2-pass — 먼저 전부 생성(parent 없이), 그다음 parent_id 리맵 연결 (계층 보존)
   - **tags**: `Tag.find_or_create_by(name:)` 로 dedupe, old_tag_id→tag 맵
   - **meetings**: 각각 생성
     - project_id = 새, folder_id = 리맵, created_by_id = 실행자
     - `share_code = nil` (unique 충돌 회피)
     - `previous_meeting_id` = 리맵 (export 범위 밖이면 nil)
     - `audio_file_path` = 파일 복사 후 새 경로, 없으면 nil
     - old_meeting_id→new_meeting 맵
   - 자식 레코드 생성 (meeting_id = 새):
     - transcripts, summaries, action_items, decisions, blocks, contacts, participants — 그대로
     - bookmarks, chat_messages → `user_id` = 실행자
     - meeting_attachments → `uploaded_by_id` = 실행자, file_path = 복사 후 새 경로
     - taggings → taggable = 새 meeting, tag = 리맵
     - glossary_entries → owner = 새 meeting (polymorphic)
   - 파일 복사: zip→`storage/audio/<새id>.mp3`, zip→`storage/attachments/<새meetingid>_<hash>_<name>`
   - 트랜잭션 롤백 시 복사한 파일 정리 (cleanup 리스트)
5. FTS(`transcripts_fts`·`summaries_fts`)는 `FtsIndexable` after_save 콜백으로 자동 재색인 — insert 경로 확인
6. `{ project_id }` 반환 → 프론트가 해당 프로젝트로 이동

## UI (ProjectsPage — 시스템 admin 에게만 노출)

- 프로젝트 카드/행: **내보내기** 버튼 → 모달(음성 포함 체크박스) → `POST .../export` → blob 다운로드
- 상단: **가져오기** 버튼 → 파일 선택(.zip) → `POST .../import` → 진행 표시 → 성공 시 새 프로젝트로 이동·목록 갱신
- API 클라이언트(`frontend/src/lib/api*` 또는 기존 projects api)에 export/import 함수 추가

## 컴포넌트 분리

| 단위 | 책임 |
|------|------|
| `app/services/project_exporter.rb` | project→manifest+zip 직렬화. 입력=Project,include_audio. 출력=zip 바이트/스트림 |
| `app/services/project_importer.rb` | zip→새 Project 복원·리맵·파일복사. 입력=zip IO,user. 출력=새 project_id. 트랜잭션·롤백 |
| `Api::V1::ProjectTransfersController` (또는 projects_controller 에 export/import 액션) | HTTP 경계·admin 게이트·스트리밍·multipart |
| 프론트 export/import 버튼 + api | UI·다운로드/업로드 |

기존 `app/services/meeting_export_serializer.rb`, `markdown_exporter.rb` 패턴 참고.

## 보안

- export·import 둘 다 `current_user.admin?` 게이트 (시스템 admin)
- import zip-slip 방지: 추출 엔트리명 정규화·`..`/절대경로 거부
- 업로드 크기 상한 (예: 3GB) + content-type 확인
- import는 원자적 트랜잭션 — 부분 실패 시 전부 롤백 + 복사 파일 정리

## TDD 검증

- **라운드트립**: 시드 프로젝트 export→import → folders·meetings·transcripts·summaries·chat·tags·glossary 레코드 수 일치, 트랜스크립트 내용 일치, 폴더 계층 보존
- 소유권: 새 회의 `created_by`·챗 `user`·첨부 `uploaded_by` = import 실행자
- `share_code` nil, `previous_meeting_id` 범위밖이면 nil
- tag dedupe (기존 동명 tag 재사용)
- include_audio=false → 오디오 파일 없음·audio_file_path nil, 메타는 보존
- 오디오 파일 복사 검증 (include_audio=true)
- zip-slip 페이로드 거부
- 비-admin 403
- FTS 검색이 import된 트랜스크립트를 찾음

## 비범위 (YAGNI)

- 멱등 재import·머지 (항상 새 프로젝트)
- 유저/멤버 이관 (전부 실행자)
- project_invites 이관
- 진행률 스트리밍(초기엔 단순 동기 업로드)
```
