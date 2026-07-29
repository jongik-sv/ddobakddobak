# 요약 zip 내보내기 (폴더/프로젝트 단위) 설계

날짜: 2026-07-23
상태: 승인됨 (구현 전)
출처: idea.md 39 — "회의록 md 파일만 내보내기. import 용도가 아니라 LLM 입력 분석용. 폴더 모양 그대로."

## 목적

폴더 또는 프로젝트 단위로, 소속 회의들의 **AI 요약 md 파일만** 실제 폴더 구조를 재현한 zip으로 내려받는다.
사용자가 zip을 풀면 Finder/탐색기에서 폴더 트리 그대로 회의록을 열람할 수 있다.

기존 기능과의 관계 (기존 기능은 변경하지 않는다):

| 기존 기능 | 포맷 | 용도 |
|---|---|---|
| 회의 md 내보내기 (`ExportButton`) | 단일 .md | 회의 1건 |
| 회의/폴더/프로젝트 내보내기 (`Export*Dialog`) | .tgz 아카이브 | 재수입(백업/이관) 전용 |
| **신규: 요약 zip 내보내기** | **.zip (md 트리)** | **사람이 열어보는 용도** |

## 결정 사항

- 산출 형태: **zip 다운로드** (웹·Tauri 동일 동작. tar.gz는 Windows 탐색기에서 안 열려 탈락)
- md 내용: **요약만 고정** (옵션 없음 — `include_summary: true`, memo/transcript false)
- 트리: **하위폴더 재귀 포함**, 폴더 구조 그대로 재현
- 권한: **프로젝트 멤버 누구나** (기존 프로젝트 tgz export의 admin 전용과 다름 — 의도된 완화)
- zip 생성 위치: **백엔드** (`rubyzip` gem 추가. Ruby stdlib에 zip writer 없음)

## 백엔드

### gem

`Gemfile`에 `rubyzip` 추가.

### 서비스: `backend/app/services/summary_zip_exporter.rb`

```ruby
SummaryZipExporter.new(folder: f)   # 또는
SummaryZipExporter.new(project: p)
exporter.write_to(io)   # zip 스트림
exporter.filename       # "<slug>-summaries-YYYYMMDD.zip"
```

- **폴더 스코프**: `FolderExporter#collect_subtree` 패턴(사이클 가드 Set) 재사용. 서브트리 폴더들의 회의 수집. 각 회의의 zip 내부 경로 = 선택 폴더 기준 상대 폴더 경로.
- **프로젝트 스코프**: `project.meetings` 직접 순회. ⚠️ `FolderExporter#meetings`의 `Meeting.where(folder_id: folders.map(&:id))`를 복사하면 **`folder_id: nil` 루트 회의가 누락**된다 — 반드시 `project.meetings` 기준으로 순회하고, 회의별 폴더 경로를 계산한다 (`folder_id` nil → zip 루트).
- 폴더 경로 계산: `[folder] + folder.ancestor_records` 체인 패턴 (meeting.rb:403 선례. 자기 자신 제외 주의).
- 회의별 md = `MarkdownExporter.new(m, include_summary: true, include_memo: false, include_transcript: false).call`
- **skip 조건**: `meeting.active_summary.nil?` → 파일 미생성. (MarkdownExporter가 summary 섹션에 읽는 소스와 동일 키 — 다른 필드로 판정하면 내용 있는 회의를 skip하거나 빈 파일을 만든다.)
- 빈 폴더(요약 있는 회의가 없는 폴더): 디렉토리 엔트리 생성 안 함 (파일 경로로만 엔트리 추가 — 자연스럽게 제외됨).
- **전체가 skip이라 zip이 비는 경우**: 서비스가 빈 여부를 노출하고 컨트롤러가 422 + `{ error: "내보낼 요약이 없습니다" }` 응답.

### zip 내부 경로 규칙 (⚠️ 핵심 함정)

- **`parameterize` 절대 금지** — 한글 입력 시 빈 문자열 반환 → 모든 폴더/파일이 충돌한다. (`FolderExporter#filename`의 `parameterize`는 바깥 다운로드 파일명 전용이라 `"folder"` 폴백으로 버티는 것.)
- 내부 경로 sanitize: 파일시스템 금지 문자(`/\:*?"<>|`)만 제거, 100자 제한. **한글·공백 보존** — "폴더 모양 그대로"와 LLM 입력 용도 모두 최소 변형을 요구한다. (프런트 `sanitizeFilename`의 공백→`_` 규칙은 단일 다운로드 파일명용이라 트리 경로에는 적용하지 않음.)
- 파일명: `<sanitize된 제목>_<회의날짜 YYYY-MM-DD>.md` (제목 blank → `meeting`). 회의날짜 없으면 생성일.
- 같은 디렉토리 내 충돌: `-2`, `-3` … suffix.
- **UTF-8 플래그(EFS, general-purpose bit 11)** 명시 설정 — Windows 탐색기 한글 모지바케 방지. rubyzip 버전별 기본값이 달라 명시가 필수. (rubyzip이 UTF-8 이름에 EFS를 자동 설정하는 버전이라도, 테스트로 실제 바이트를 검증한다 — 아래 검증 4.)
- 바깥 zip 다운로드 파일명: `<slug>-summaries-<YYYYMMDD>.zip` (`parameterize`, blank 폴백 `folder`/`project`).

### 엔드포인트

기존 transfers 컨트롤러에 액션 추가:

```
POST /api/v1/folders/:id/export_summaries    → FolderTransfersController#export_summaries
POST /api/v1/projects/:id/export_summaries   → ProjectTransfersController#export_summaries
```

- 권한: 폴더 = `set_folder`의 멤버십 스코프만 (비멤버 404). `editable_by?`는 요구하지 않음 — 읽기 행위인 요약 내보내기에 "멤버 누구나" 결정을 그대로 적용 (tgz export의 editable_by? 게이트와 의도적으로 다름). 프로젝트 = `project.member?(current_user)` (admin 전용 아님. admin이어도 비멤버면 403).
- 응답: Tempfile에 쓰고 `send_file`, `Content-Type: application/zip`, `Content-Disposition: attachment` + filename.
- body 파라미터 없음.

## 프런트엔드

### API: `frontend/src/api/transfers.ts`

```ts
exportFolderSummaries(folderId: number): Promise<void>
exportProjectSummaries(projectId: number): Promise<void>
```

기존 `exportFolder` 패턴 재사용: `apiClient.post(..., { timeout: false })` → blob → `filenameFromDisposition`(projectTransfers.ts 것 공용화 또는 동일 구현) → `downloadBlob`. 422 응답이면 에러 메시지 표출.

### 진입점 (기존 항목과 별개, 다이얼로그 없음 — 클릭 즉시 다운로드)

1. `FolderTree.tsx` 폴더 컨텍스트 메뉴: 기존 "내보내기" 항목 아래 **"요약 내보내기(zip)"**
2. `ProjectsPage.tsx` 프로젝트 메뉴: **"요약 내보내기(zip)"** — 멤버 누구나 노출 (기존 tgz export는 admin 전용 노출 유지)

- 진행 중: 해당 메뉴 항목 disabled + 스피너 (별도 모달 없음).
- 실패(422 포함): 에러 토스트 — 기존 에러 표출 패턴 따름.

## 테스트

### rspec

- `SummaryZipExporter` 단위:
  - 폴더 서브트리 → zip 엔트리 경로가 폴더 트리 재현 (한글 폴더명 보존)
  - 프로젝트 스코프: `folder_id: nil` 회의가 zip 루트에 존재
  - `active_summary` 없는 회의 → 엔트리 없음
  - 동명 회의 2건 같은 폴더 → `-2` suffix
  - 전체 skip → 빈 판정 노출
  - 폴더 사이클 → 무한루프 없음
- request:
  - 폴더/프로젝트 각: 멤버 200 + `application/zip`, 비멤버 403, 요약 전무 422
  - 프로젝트: **admin이 아닌 일반 멤버**가 200 (권한 완화 확인)

### vitest

- 신규 API 함수 (blob 다운로드 트리거, 422 에러 경로)
- 메뉴 항목 렌더 + 클릭 시 API 호출

### 수동 검증 체크리스트 (게이트 통과와 별개 — 자동 테스트로 안 잡히는 항목)

1. **한글 폴더·회의명으로 export한 zip을 Windows 탐색기에서 열어 한글 정상 확인** (EFS 플래그의 실효 검증 — Mac에서는 재현 안 됨)
2. macOS Finder에서 압축 해제 → 트리 구조·파일 내용 확인
3. Tauri 앱에서 다운로드 동작 (plugin-dialog save 경로)

### 자동 검증 (스펙 요구)

4. zip 바이너리에서 EFS 비트(general-purpose flag bit 11) 설정 여부를 검증하는 rspec 단언 (한글 엔트리명 대상)
5. rspec 전체 green, `tsc -p tsconfig.app.json` 0 에러, vitest 전체 green

## 하지 않는 것

- 기존 md/tgz 내보내기 변경
- 내보낼 내용 옵션(메모/원본텍스트) — 요약만 고정
- Tauri 실폴더 쓰기 (zip으로 통일)
- 프런트 zip 조립(jszip) — 백엔드 단일 소스
