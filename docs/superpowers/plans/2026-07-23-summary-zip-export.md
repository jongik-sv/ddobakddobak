# 요약 zip 내보내기 (폴더/프로젝트 단위) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폴더/프로젝트 소속 회의들의 AI 요약 md를 실제 폴더 트리를 재현한 zip으로 다운로드하는 기능.

**Architecture:** 백엔드 `SummaryZipExporter` 서비스가 rubyzip으로 zip 스트림 생성(기존 `MarkdownExporter` 재사용, 요약만). 기존 transfers 컨트롤러 2곳에 `export_summaries` 액션 추가. 프런트는 기존 `downloadBlob` 패턴의 API 함수 2개 + 메뉴 항목 2곳(다이얼로그 없음, 즉시 다운로드).

**Tech Stack:** Rails 8.1 + rubyzip 3.4 / React + ky + vitest

**Spec:** `docs/superpowers/specs/2026-07-23-summary-zip-export-design.md` (idea.md 39)

## Global Constraints

- zip 내부 경로에 `parameterize` **절대 금지** (한글→빈 문자열). sanitize 규칙: `[/\\:*?"<>|]` 제거 → 100자 제한. **한글·공백 보존** (공백→`_` 치환 금지 — "폴더 모양 그대로" 목적. 프런트 `sanitizeFilename`의 공백 규칙은 단일 파일명용이라 따르지 않음).
- `Zip.unicode_names = true` 전역 initializer 필수 — rubyzip은 EFS 비트(bit 11)를 자동 설정하지 않음. 미설정 시 Windows 탐색기에서 한글 모지바케.
- skip 판정 = `meeting.active_summary.nil?` (MarkdownExporter summary 소스와 동일 키).
- 휴지통 제외: `kept` 스코프 (`deleted_at: nil`) — folders·meetings 모두. default_scope 없으므로 명시 필수.
- 프로젝트 스코프는 `project.meetings` 순회 (`folder_id: nil` 루트 회의 포함) — `Meeting.where(folder_id:)` 복사 금지.
- 권한: 폴더 = `set_folder` 멤버십 스코프(비멤버 404). 프로젝트 = `@project.member?(current_user)` (admin 전용 아님 — 멤버 누구나).
- 타입체크는 `npx tsc -p tsconfig.app.json` (bare tsc는 거짓 green).
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 모든 백엔드 명령은 `cd backend`, 프런트는 `cd frontend` 후 실행.

---

### Task 1: rubyzip gem + unicode_names initializer

**Files:**
- Modify: `backend/Gemfile` (LLM 클라이언트 gem 선언부 근처, ~47행)
- Create: `backend/config/initializers/rubyzip.rb`
- Test: `backend/spec/initializers/rubyzip_spec.rb`

**Interfaces:**
- Produces: `Zip::` 네임스페이스 사용 가능, 전역 `Zip.unicode_names == true`. Task 2가 `Zip::OutputStream` 사용.

- [ ] **Step 1: Gemfile에 rubyzip 추가**

`backend/Gemfile`의 LLM 클라이언트 gem 선언 아래에:

```ruby
# ZIP export (요약 zip 내보내기 — Windows 호환 zip. stdlib에 zip writer 없음)
gem "rubyzip", "~> 3.4"
```

- [ ] **Step 2: bundle install**

Run: `cd backend && bundle install`
Expected: `Bundle complete!` + Gemfile.lock에 rubyzip 3.4.x

- [ ] **Step 3: initializer 작성**

`backend/config/initializers/rubyzip.rb`:

```ruby
# 한글(비ASCII) 엔트리명을 Windows 탐색기가 UTF-8로 디코딩하려면 EFS 플래그
# (general purpose bit 11)가 필요하다. rubyzip은 이름 인코딩을 자동 감지하지 않고
# 이 전역 설정이 true일 때만 EFS를 세운다 — 미설정 시 한국어 Windows(CP949)에서
# 한글 파일명이 깨진다.
Zip.unicode_names = true
```

- [ ] **Step 4: 실패하는 테스트 작성**

`backend/spec/initializers/rubyzip_spec.rb`:

```ruby
require "rails_helper"

# rubyzip 전역 설정 + EFS 플래그 실효 검증.
# Windows 탐색기는 central directory의 general purpose flag(bit 11=EFS)로
# 엔트리명 인코딩을 판정한다 — 이 비트가 없으면 한글이 CP949로 깨진다.
RSpec.describe "rubyzip initializer" do
  EFS_BIT = 0x0800

  it "unicode_names 가 전역 활성화되어 있다" do
    expect(Zip.unicode_names).to be(true)
  end

  it "한글 엔트리명 zip의 local·central 헤더 양쪽에 EFS 비트를 세운다" do
    buffer = Zip::OutputStream.write_buffer do |zos|
      zos.put_next_entry("한글폴더/회의록.md")
      zos.write("# 내용")
    end
    bytes = buffer.string.b

    # local file header: 시그니처 PK\x03\x04, flag 오프셋 6-7 (LE uint16)
    expect(bytes[0, 4]).to eq("PK\x03\x04".b)
    local_flags = bytes[6, 2].unpack1("v")
    expect(local_flags & EFS_BIT).to eq(EFS_BIT)

    # central directory header: 시그니처 PK\x01\x02, flag 오프셋 8-9
    cd = bytes.index("PK\x01\x02".b)
    expect(cd).not_to be_nil
    central_flags = bytes[cd + 8, 2].unpack1("v")
    expect(central_flags & EFS_BIT).to eq(EFS_BIT)

    # 엔트리명이 raw UTF-8 바이트로 기록됐는지
    name_len = bytes[26, 2].unpack1("v")
    expect(bytes[30, name_len].force_encoding("UTF-8")).to eq("한글폴더/회의록.md")
  end
end
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `cd backend && bundle exec rspec spec/initializers/rubyzip_spec.rb`
Expected: 2 examples, 0 failures

(주의: 이 태스크는 gem+initializer가 먼저 필요해 test-first가 성립하지 않음 — initializer 없이 돌려 EFS 비트 미설정으로 실패하는 것을 먼저 보고 싶으면 Step 3을 잠시 주석 처리 후 실행해 1 failure 확인해도 좋다. 필수는 아님.)

- [ ] **Step 6: Commit**

```bash
git add backend/Gemfile backend/Gemfile.lock backend/config/initializers/rubyzip.rb backend/spec/initializers/rubyzip_spec.rb
git commit -m "feat(export): rubyzip 도입 + EFS(unicode_names) 전역 설정

Windows 탐색기 한글 엔트리명 호환에 EFS 비트가 필수인데 rubyzip은
자동 설정하지 않아 initializer로 고정. 바이너리 헤더 검증 스펙 포함.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: SummaryZipExporter 서비스

**Files:**
- Create: `backend/app/services/summary_zip_exporter.rb`
- Test: `backend/spec/services/summary_zip_exporter_spec.rb`

**Interfaces:**
- Consumes: Task 1의 `Zip::OutputStream` (unicode_names 활성 상태). 기존 `MarkdownExporter.new(meeting, include_summary:, include_memo:, include_transcript:).call`, `Meeting#active_summary`, `Folder#ancestor_records`, `kept` 스코프.
- Produces: Task 3이 사용:
  - `SummaryZipExporter.new(folder: Folder)` 또는 `SummaryZipExporter.new(project: Project)` (정확히 하나만, 아니면 `ArgumentError`)
  - `#empty?` → Boolean (요약 있는 회의 0건)
  - `#write_to(io)` → io에 zip 바이트 기록
  - `#filename` → `"<slug>-summaries-YYYYMMDD.zip"` (slug는 `parameterize`, blank 시 `"folder"`/`"project"`)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/spec/services/summary_zip_exporter_spec.rb`:

```ruby
require "rails_helper"
require "stringio"

RSpec.describe SummaryZipExporter do
  # zip 스트림을 되읽어 { 엔트리경로 => 내용 } 맵으로 반환
  def read_zip(io)
    io.rewind
    entries = {}
    Zip::File.open_buffer(io.read) do |zip|
      zip.each do |entry|
        # rubyzip 3.4 는 entry.name 을 ASCII-8BIT 로 반환 — UTF-8 강제
        entries[entry.name.dup.force_encoding("UTF-8")] = entry.get_input_stream.read.force_encoding("UTF-8")
      end
    end
    entries
  end

  def export_entries(exporter)
    io = StringIO.new
    exporter.write_to(io)
    read_zip(io)
  end

  # completed 회의 + final summary 를 붙여 active_summary 를 보장하는 헬퍼
  def add_summary!(meeting, body)
    meeting.update_column(:status, "completed")
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: body)
  end

  let!(:owner)   { create(:user) }
  let!(:project) { create(:project, creator: owner, name: "기획팀") }
  let!(:root)    { create(:folder, project: project, name: "주간 회의") }
  let!(:child)   { create(:folder, project: project, name: "7월", parent_id: root.id) }

  describe "생성자" do
    it "folder·project 를 동시에 주거나 둘 다 없으면 ArgumentError" do
      expect { described_class.new }.to raise_error(ArgumentError)
      expect { described_class.new(folder: root, project: project) }.to raise_error(ArgumentError)
    end
  end

  describe "폴더 스코프" do
    it "서브트리 폴더 구조를 zip 내부 경로로 재현한다 (한글 보존)" do
      m1 = create(:meeting, project: project, creator: owner, folder: root,  title: "킥오프")
      m2 = create(:meeting, project: project, creator: owner, folder: child, title: "중간점검")
      add_summary!(m1, "## 회의록\n킥오프 내용")
      add_summary!(m2, "## 회의록\n점검 내용")

      entries = export_entries(described_class.new(folder: root))
      date1 = (m1.started_at || m1.created_at).to_date.iso8601
      date2 = (m2.started_at || m2.created_at).to_date.iso8601

      expect(entries.keys).to contain_exactly(
        "킥오프_#{date1}.md",
        "7월/중간점검_#{date2}.md"
      )
      expect(entries["킥오프_#{date1}.md"]).to include("킥오프 내용")
    end

    it "active_summary 없는 회의는 파일을 만들지 않는다" do
      create(:meeting, project: project, creator: owner, folder: root, title: "요약없음")
      with = create(:meeting, project: project, creator: owner, folder: root, title: "요약있음")
      add_summary!(with, "내용")

      entries = export_entries(described_class.new(folder: root))
      expect(entries.keys.join).not_to include("요약없음")
      expect(entries.size).to eq(1)
    end

    it "같은 디렉토리 내 동명 회의는 -2 suffix 를 붙인다" do
      m1 = create(:meeting, project: project, creator: owner, folder: root, title: "정기회의")
      m2 = create(:meeting, project: project, creator: owner, folder: root, title: "정기회의")
      add_summary!(m1, "1차")
      add_summary!(m2, "2차")
      # 같은 날짜로 고정해 파일명 충돌 유도
      m2.update_column(:created_at, m1.created_at)
      m2.update_column(:started_at, m1.started_at)

      entries = export_entries(described_class.new(folder: root))
      date = (m1.started_at || m1.created_at).to_date.iso8601
      expect(entries.keys).to contain_exactly(
        "정기회의_#{date}.md",
        "정기회의_#{date}-2.md"
      )
    end

    it "파일시스템 금지 문자만 제거하고 공백·한글은 보존한다" do
      m = create(:meeting, project: project, creator: owner, folder: root, title: 'Q3: 매출/전략 "검토"')
      add_summary!(m, "내용")

      entries = export_entries(described_class.new(folder: root))
      date = (m.started_at || m.created_at).to_date.iso8601
      expect(entries.keys).to contain_exactly("Q3 매출전략 검토_#{date}.md")
    end

    it "휴지통 회의·휴지통 폴더 하위는 제외한다" do
      kept_m    = create(:meeting, project: project, creator: owner, folder: root, title: "정상")
      trashed_m = create(:meeting, project: project, creator: owner, folder: root, title: "버림", deleted_at: Time.current)
      trashed_f = create(:folder, project: project, name: "버린폴더", parent_id: root.id, deleted_at: Time.current)
      in_trashed = create(:meeting, project: project, creator: owner, folder: trashed_f, title: "버린폴더속")
      add_summary!(kept_m, "a")
      add_summary!(trashed_m, "b")
      add_summary!(in_trashed, "c")

      entries = export_entries(described_class.new(folder: root))
      expect(entries.size).to eq(1)
      expect(entries.keys.first).to start_with("정상_")
    end

    it "폴더 사이클이 있어도 무한루프 없이 종료한다" do
      # root→child(기존)에 root.parent_id=child 를 더해 진짜 순환을 만든다 —
      # walk 가 child.children 에서 root 를 다시 만나 seen 가드가 실제 발동된다.
      # (child 자기참조로는 walk 경로가 사이클을 지나지 않아 가드 검증이 안 됨.)
      root.update_column(:parent_id, child.id)
      m = create(:meeting, project: project, creator: owner, folder: root, title: "회의")
      add_summary!(m, "a")
      expect { export_entries(described_class.new(folder: root)) }.not_to raise_error
    end
  end

  describe "프로젝트 스코프" do
    it "folder_id nil 루트 회의를 zip 루트에, 폴더 회의를 폴더 경로에 넣는다" do
      root_m   = create(:meeting, project: project, creator: owner, folder: nil,   title: "루트회의")
      nested_m = create(:meeting, project: project, creator: owner, folder: child, title: "중첩회의")
      add_summary!(root_m, "루트")
      add_summary!(nested_m, "중첩")

      entries = export_entries(described_class.new(project: project))
      d1 = (root_m.started_at || root_m.created_at).to_date.iso8601
      d2 = (nested_m.started_at || nested_m.created_at).to_date.iso8601
      expect(entries.keys).to contain_exactly(
        "루트회의_#{d1}.md",
        "주간 회의/7월/중첩회의_#{d2}.md"
      )
    end
  end

  describe "#empty?" do
    it "요약 있는 회의가 하나도 없으면 true" do
      create(:meeting, project: project, creator: owner, folder: root, title: "요약없음")
      expect(described_class.new(folder: root).empty?).to be(true)
      expect(described_class.new(project: project).empty?).to be(true)
    end
  end

  describe "#filename" do
    it "한글 이름은 parameterize 로 비면 폴백 slug 를 쓴다" do
      today = Date.current.strftime("%Y%m%d")
      expect(described_class.new(folder: root).filename).to eq("folder-summaries-#{today}.zip")
      expect(described_class.new(project: project).filename).to eq("project-summaries-#{today}.zip")
    end

    it "ASCII 이름은 slug 를 쓴다" do
      f = create(:folder, project: project, name: "Weekly Sync")
      today = Date.current.strftime("%Y%m%d")
      expect(described_class.new(folder: f).filename).to eq("weekly-sync-summaries-#{today}.zip")
    end
  end
end
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/summary_zip_exporter_spec.rb`
Expected: FAIL — `uninitialized constant SummaryZipExporter`

- [ ] **Step 3: 서비스 구현**

`backend/app/services/summary_zip_exporter.rb`:

```ruby
# 폴더 서브트리 또는 프로젝트 전체의 회의 AI 요약을, 실제 폴더 구조를 재현한
# zip(.md 트리)으로 내보낸다. 기존 tgz export(재수입용)와 달리 사람이 풀어서
# 읽는 용도 — Windows 탐색기 호환을 위해 zip + EFS(initializers/rubyzip.rb).
#
# 사용법:
#   exporter = SummaryZipExporter.new(folder: f)   # 또는 project: p (정확히 하나)
#   exporter.empty?        # 요약 있는 회의 0건이면 true (컨트롤러가 422 분기)
#   exporter.write_to(io)  # zip 스트림 기록
#   exporter.filename      # "<slug>-summaries-YYYYMMDD.zip"
class SummaryZipExporter
  # 파일시스템 금지 문자만 제거 + 100자 제한. 한글·공백 보존 —
  # "폴더 모양 그대로"(idea 39)와 LLM 입력 용도 모두 최소 변형을 요구한다.
  # ⚠️ parameterize 금지 — 한글 입력 시 빈 문자열이 되어 경로가 전부 충돌한다.
  # (frontend sanitizeFilename 의 공백→_ 는 단일 다운로드 파일명용이라 안 따름)
  ILLEGAL_CHARS = %r{[/\\:*?"<>|]}

  def initialize(folder: nil, project: nil)
    raise ArgumentError, "folder 또는 project 중 정확히 하나" unless folder.nil? ^ project.nil?
    @folder  = folder
    @project = project
  end

  # 요약 있는 회의가 하나도 없으면 true.
  def empty?
    entries.empty?
  end

  # zip 스트림을 io 에 작성한다.
  def write_to(io)
    Zip::OutputStream.write_buffer(io) do |zos|
      entries.each do |entry|
        zos.put_next_entry(entry[:path])
        zos.write(entry[:content])
      end
    end
  end

  # 다운로드 파일명. 바깥 파일명만 parameterize(브라우저가 UTF-8 파일명을
  # 처리해 주지만 기존 exporter 관례 유지) — blank 폴백 folder/project.
  def filename
    slug = (@folder ? @folder.name : @project.name).to_s.parameterize
    slug = (@folder ? "folder" : "project") if slug.blank?
    "#{slug}-summaries-#{Date.current.strftime('%Y%m%d')}.zip"
  end

  private

  # [{ path:, content: }] — 요약 없는 회의는 제외, 경로 충돌은 -2, -3 suffix.
  def entries
    @entries ||= build_entries
  end

  def build_entries
    used = Hash.new(0)
    meeting_dir_pairs.filter_map do |meeting, dir_parts|
      next unless meeting.active_summary

      content = MarkdownExporter.new(
        meeting,
        include_summary:    true,
        include_memo:       false,
        include_transcript: false
      ).call

      dir  = dir_parts.map { |name| sanitize(name) }.join("/")
      base = "#{sanitize(meeting.title.presence || 'meeting')}_#{file_date(meeting)}"

      used_key = [dir, base]
      used[used_key] += 1
      suffix = used[used_key] > 1 ? "-#{used[used_key]}" : ""

      path = [dir, "#{base}#{suffix}.md"].reject(&:blank?).join("/")
      { path: path, content: content }
    end
  end

  # [[meeting, dir_parts]] — dir_parts 는 스코프 루트 기준 상대 폴더명 배열.
  def meeting_dir_pairs
    @folder ? folder_scope_pairs : project_scope_pairs
  end

  # 선택 폴더가 zip 루트. DFS + seen 가드(FolderExporter 와 동일하게 FK 가
  # 사이클을 막지 못하는 전제). 휴지통 폴더·회의는 kept 로 제외.
  def folder_scope_pairs
    pairs = []
    seen  = Set.new
    walk = lambda do |folder, parts|
      next if seen.include?(folder.id)
      seen << folder.id
      folder.meetings.kept.each { |m| pairs << [m, parts] }
      folder.children.kept.each { |c| walk.call(c, parts + [c.name]) }
    end
    walk.call(@folder, [])
    pairs
  end

  # ⚠️ project.meetings 직접 순회 — 폴더 재귀로 모으면 folder_id nil 루트
  # 회의가 누락된다. 경로는 회의별 조상 체인으로 계산(루트→리프 순).
  def project_scope_pairs
    @project.meetings.kept.includes(:folder).map do |meeting|
      parts =
        if meeting.folder
          ([meeting.folder] + meeting.folder.ancestor_records).reverse.map(&:name)
        else
          []
        end
      [meeting, parts]
    end
  end

  def sanitize(name)
    name.to_s.gsub(ILLEGAL_CHARS, "").slice(0, 100)
  end

  # 회의 날짜: 실제 시작 시각 우선, 없으면 생성일.
  def file_date(meeting)
    (meeting.started_at || meeting.created_at).to_date.iso8601
  end
end
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/summary_zip_exporter_spec.rb`
Expected: 전부 PASS (10 examples, 0 failures)

주의사항 (실패 시 점검):
- `Zip::File.open_buffer` 시그니처가 3.4에서 다르면 `Zip::InputStream.open(StringIO.new(...))` + `get_next_entry` 루프로 대체.
- sanitize 는 공백을 보존한다 (`주간 회의` 폴더는 zip 경로에도 `주간 회의`) — 공백→`_` 치환을 추가하지 말 것. Global Constraints 참조.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/summary_zip_exporter.rb backend/spec/services/summary_zip_exporter_spec.rb
git commit -m "feat(export): SummaryZipExporter — 요약 md 폴더트리 zip 서비스

폴더 서브트리/프로젝트 전체의 active_summary 회의를 MarkdownExporter
(요약만)로 조립해 폴더 구조 그대로 zip에 담는다. 루트 회의 포함,
kept 필터, 사이클 가드, 동명 -2 suffix, 한글 보존 sanitize.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 백엔드 엔드포인트 2개 + 라우트

**Files:**
- Modify: `backend/app/controllers/api/v1/folder_transfers_controller.rb`
- Modify: `backend/app/controllers/api/v1/project_transfers_controller.rb`
- Modify: `backend/config/routes.rb` (folders member 블록 ~124행, projects member 블록 ~180행)
- Test: `backend/spec/requests/api/v1/summary_zip_export_spec.rb`

**Interfaces:**
- Consumes: Task 2의 `SummaryZipExporter.new(folder:|project:)`, `#empty?`, `#write_to(io)`, `#filename`.
- Produces: `POST /api/v1/folders/:id/export_summaries`, `POST /api/v1/projects/:id/export_summaries` — 200 `application/zip` attachment / 404(폴더 비멤버) / 403(프로젝트 비멤버) / 422 `{ "error": "내보낼 요약이 없습니다" }`. body 파라미터 없음. Task 4가 이 경로·상태코드에 의존.

- [ ] **Step 1: 실패하는 request 테스트 작성**

`backend/spec/requests/api/v1/summary_zip_export_spec.rb`:

```ruby
require "rails_helper"
require "stringio"

# 요약 zip 내보내기 HTTP 경계.
# - POST /api/v1/folders/:id/export_summaries   → 멤버십 스코프(set_folder, 비멤버 404)
# - POST /api/v1/projects/:id/export_summaries  → member? 게이트(비멤버 403, admin 전용 아님)
RSpec.describe "Summary zip export", type: :request do
  before(:all) { Transcript.ensure_fts_tables! }

  let!(:member)   { create(:user) }
  let!(:outsider) { create(:user) }
  let!(:project)  { create(:project, creator: member, name: "기획팀") }
  let!(:folder)   { create(:folder, project: project, name: "주간 회의") }

  # meeting factory after_create 가 creator(member)를 프로젝트 멤버로 자동 등록
  let!(:meeting) do
    create(:meeting, project: project, creator: member, folder: folder,
                     title: "킥오프", status: "completed")
  end
  let!(:summary) do
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "## 회의록\n내용")
  end

  def zip_entry_names(body)
    names = []
    Zip::File.open_buffer(body) do |zip|
      zip.each { |e| names << e.name.dup.force_encoding("UTF-8") }
    end
    names
  end

  describe "POST /api/v1/folders/:id/export_summaries" do
    it "멤버는 200 + application/zip + .zip 파일명" do
      login_as(member)
      post "/api/v1/folders/#{folder.id}/export_summaries"

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("application/zip")
      expect(response.headers["Content-Disposition"]).to include("attachment")
      expect(response.headers["Content-Disposition"]).to include(".zip")
      expect(zip_entry_names(response.body).join).to include("킥오프")
    end

    it "비멤버는 404 (set_folder 멤버십 스코프)" do
      login_as(outsider)
      post "/api/v1/folders/#{folder.id}/export_summaries"
      expect(response).to have_http_status(:not_found)
    end

    it "요약 있는 회의가 없으면 422" do
      summary.destroy!
      login_as(member)
      post "/api/v1/folders/#{folder.id}/export_summaries"
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to eq("내보낼 요약이 없습니다")
    end
  end

  describe "POST /api/v1/projects/:id/export_summaries" do
    it "일반 멤버(비admin)는 200 — admin 전용이 아니다" do
      login_as(member)
      post "/api/v1/projects/#{project.id}/export_summaries"

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("application/zip")
      expect(zip_entry_names(response.body).join).to include("킥오프")
    end

    it "비멤버는 403 (admin 이어도 멤버가 아니면 403)" do
      admin_outsider = create(:user, :admin)
      login_as(admin_outsider)
      post "/api/v1/projects/#{project.id}/export_summaries"
      expect(response).to have_http_status(:forbidden)
    end

    it "요약 있는 회의가 없으면 422" do
      summary.destroy!
      login_as(member)
      post "/api/v1/projects/#{project.id}/export_summaries"
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
end
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/summary_zip_export_spec.rb`
Expected: FAIL — 404 (라우트 없음)

- [ ] **Step 3: 라우트 추가**

`backend/config/routes.rb` — folders member 블록(기존 `post :export, to: "folder_transfers#export"` 아래):

```ruby
      post :export_summaries, to: "folder_transfers#export_summaries"
```

projects member 블록(기존 `post :export, to: "project_transfers#export"` 아래):

```ruby
        post :export_summaries, to: "project_transfers#export_summaries"
```

- [ ] **Step 4: FolderTransfersController 액션 추가**

`backend/app/controllers/api/v1/folder_transfers_controller.rb`:

`before_action :set_folder, only: %i[export]` → `before_action :set_folder, only: %i[export export_summaries]` 로 변경.

`export` 액션 아래에 추가:

```ruby
      # POST /api/v1/folders/:id/export_summaries
      # 서브트리 회의들의 AI 요약 md 를 폴더 구조 그대로 zip 으로 다운로드.
      # 권한: set_folder 의 멤버십 스코프(비멤버 404)만 — 읽기 행위라
      # export(tgz)와 달리 editable_by? 를 요구하지 않는다(멤버 누구나).
      def export_summaries
        exporter = SummaryZipExporter.new(folder: @folder)
        return render json: { error: "내보낼 요약이 없습니다" }, status: :unprocessable_entity if exporter.empty?

        send_zip(exporter)
      end
```

private 섹션에 추가 (기존 tgz export 의 Tempfile+send_file 패턴 — Tempfile finalizer 가 응답 전송 후 정리하므로 ensure unlink 금지):

```ruby
      def send_zip(exporter)
        tempfile = Tempfile.new([ "summaries-export", ".zip" ])
        tempfile.binmode
        exporter.write_to(tempfile)
        tempfile.flush

        send_file tempfile.path,
          type:        "application/zip",
          disposition: "attachment",
          filename:    exporter.filename
      end
```

- [ ] **Step 5: ProjectTransfersController 액션 추가**

`backend/app/controllers/api/v1/project_transfers_controller.rb`:

before_action 조정 — `require_system_admin!` 은 기존 액션에만 (⚠️ 전역이면 신규 액션이 admin 게이트에 걸림):

```ruby
      before_action :authenticate_user!
      before_action :require_system_admin!, except: %i[export_summaries]
      before_action :set_project, only: %i[export export_summaries]
      before_action :reject_others_personal_project!, only: %i[export]
```

`export` 액션 아래에 추가:

```ruby
      # POST /api/v1/projects/:id/export_summaries
      # 프로젝트 전체 회의(루트 회의 포함)의 AI 요약 md 를 폴더 구조 zip 으로.
      # 권한: 프로젝트 멤버 누구나 — export(tgz)의 system admin 전용과 다른
      # 의도된 완화(요약 열람 권한이 있으면 내보내기도 가능).
      # admin 이어도 멤버가 아니면 403 (남의 개인 프로젝트 요약 열람 차단 포함).
      def export_summaries
        return render json: { error: "Forbidden" }, status: :forbidden unless @project.member?(current_user)

        exporter = SummaryZipExporter.new(project: @project)
        return render json: { error: "내보낼 요약이 없습니다" }, status: :unprocessable_entity if exporter.empty?

        send_zip(exporter)
      end
```

private 섹션에 Task 3 Step 4와 동일한 `send_zip` 를 추가 (이 코드베이스는 boolean_param 도 컨트롤러별 복붙이 관례 — 공유 concern 리팩토링은 이 작업 범위 밖):

```ruby
      def send_zip(exporter)
        tempfile = Tempfile.new([ "summaries-export", ".zip" ])
        tempfile.binmode
        exporter.write_to(tempfile)
        tempfile.flush

        send_file tempfile.path,
          type:        "application/zip",
          disposition: "attachment",
          filename:    exporter.filename
      end
```

- [ ] **Step 6: 테스트 실행 — 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/summary_zip_export_spec.rb`
Expected: 6 examples, 0 failures

- [ ] **Step 7: 기존 transfers 스펙 회귀 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/folder_transfers_spec.rb spec/requests/api/v1/project_transfers_spec.rb`
Expected: 전부 PASS (before_action 조정이 기존 admin 게이트를 깨지 않았는지)

- [ ] **Step 8: Commit**

```bash
git add backend/config/routes.rb backend/app/controllers/api/v1/folder_transfers_controller.rb backend/app/controllers/api/v1/project_transfers_controller.rb backend/spec/requests/api/v1/summary_zip_export_spec.rb
git commit -m "feat(export): 요약 zip 내보내기 엔드포인트 (폴더/프로젝트)

POST folders/:id/export_summaries — 멤버십 스코프(404)
POST projects/:id/export_summaries — member? 게이트(403, admin 전용 완화)
빈 결과 422. Tempfile+send_file 스트리밍(기존 tgz 패턴).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 프런트 API 함수 2개

**Files:**
- Modify: `frontend/src/api/transfers.ts`
- Test: `frontend/src/api/transfers.test.ts` (기존 파일에 테스트 추가)

**Interfaces:**
- Consumes: Task 3의 엔드포인트. 기존 `apiClient`(ky), `downloadBlob`, `filenameFromDisposition`.
- Produces: Task 5·6이 사용:
  - `exportFolderSummaries(folderId: number): Promise<void>` — throw on HTTP error (ky HTTPError)
  - `exportProjectSummaries(projectId: number): Promise<void>` — 동일
  - `SUMMARY_EXPORT_EMPTY_STATUS = 422` (호출부가 422 분기용으로 import)

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/api/transfers.test.ts` 에 기존 mock 셋업(post/downloadBlob vi.mock)을 재사용해 describe 블록 추가. import 라인에 신규 함수 추가:

```ts
import {
  exportMeeting,
  importMeeting,
  exportFolder,
  importFolder,
  exportFolderSummaries,
  exportProjectSummaries,
} from './transfers'
```

파일 하단에 추가:

```ts
describe('exportFolderSummaries', () => {
  it('POST folders/:id/export_summaries 후 zip blob 을 다운로드한다', async () => {
    const blob = new Blob(['zipbytes'])
    post.mockReturnValue({
      blob: () => Promise.resolve(blob),
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-disposition'
            ? 'attachment; filename="weekly-summaries-20260723.zip"'
            : null,
      },
    })

    await exportFolderSummaries(12)

    expect(post).toHaveBeenCalledWith('folders/12/export_summaries', { timeout: false })
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'weekly-summaries-20260723.zip')
  })

  it('Content-Disposition 없으면 폴백 파일명을 쓴다', async () => {
    const blob = new Blob(['zipbytes'])
    post.mockReturnValue({
      blob: () => Promise.resolve(blob),
      headers: { get: () => null },
    })

    await exportFolderSummaries(12)

    expect(downloadBlob).toHaveBeenCalledWith(blob, 'folder-12-summaries.zip')
  })
})

describe('exportProjectSummaries', () => {
  it('POST projects/:id/export_summaries 후 zip blob 을 다운로드한다', async () => {
    const blob = new Blob(['zipbytes'])
    post.mockReturnValue({
      blob: () => Promise.resolve(blob),
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-disposition'
            ? 'attachment; filename="plan-summaries-20260723.zip"'
            : null,
      },
    })

    await exportProjectSummaries(3)

    expect(post).toHaveBeenCalledWith('projects/3/export_summaries', { timeout: false })
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'plan-summaries-20260723.zip')
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd frontend && npx vitest run src/api/transfers.test.ts`
Expected: FAIL — `exportFolderSummaries` export 없음

- [ ] **Step 3: 구현**

`frontend/src/api/transfers.ts` 하단에 추가:

```ts
/** 요약 zip 이 비었을 때(요약 있는 회의 0건) 백엔드가 주는 상태코드. 호출부 에러 분기용. */
export const SUMMARY_EXPORT_EMPTY_STATUS = 422

/**
 * 폴더 서브트리 회의들의 AI 요약 md 를 폴더 구조 zip 으로 다운로드.
 * 실패 시 ky HTTPError throw — 422 = 내보낼 요약 없음(호출부에서 분기).
 */
export async function exportFolderSummaries(folderId: number): Promise<void> {
  const response = await apiClient.post(`folders/${folderId}/export_summaries`, {
    timeout: false,
  })
  const disposition = response.headers.get('content-disposition')
  const filename = filenameFromDisposition(disposition) ?? `folder-${folderId}-summaries.zip`
  const blob = await response.blob()
  await downloadBlob(blob, filename)
}

/**
 * 프로젝트 전체 회의(루트 회의 포함)의 AI 요약 md 를 폴더 구조 zip 으로 다운로드.
 * 실패 시 ky HTTPError throw — 422 = 내보낼 요약 없음.
 */
export async function exportProjectSummaries(projectId: number): Promise<void> {
  const response = await apiClient.post(`projects/${projectId}/export_summaries`, {
    timeout: false,
  })
  const disposition = response.headers.get('content-disposition')
  const filename = filenameFromDisposition(disposition) ?? `project-${projectId}-summaries.zip`
  const blob = await response.blob()
  await downloadBlob(blob, filename)
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd frontend && npx vitest run src/api/transfers.test.ts`
Expected: 전부 PASS (기존 테스트 포함)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/transfers.ts frontend/src/api/transfers.test.ts
git commit -m "feat(export): 요약 zip 내보내기 API 함수 2종

exportFolderSummaries / exportProjectSummaries — 기존 tgz export 패턴
(blob + Content-Disposition 파일명 + downloadBlob) 재사용.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: FolderTree 메뉴 항목

**Files:**
- Modify: `frontend/src/components/folder/FolderTree.tsx` (메뉴 항목 ~269행 "내보내기(.tgz)" 아래)
- Test: `frontend/src/components/folder/FolderTree.summaryExport.test.tsx` (신규 — 기존 FolderTree 테스트 파일이 있으면 거기에 추가해도 됨, 먼저 `ls frontend/src/components/folder/*.test.tsx` 로 확인)

**Interfaces:**
- Consumes: Task 4의 `exportFolderSummaries`, `SUMMARY_EXPORT_EMPTY_STATUS`.
- Produces: 폴더 컨텍스트 메뉴 "요약 내보내기(zip)" 항목. UX: 클릭 → 메뉴 유지한 채 "내보내는 중…" → 성공 시 메뉴 닫기 / 실패 시 메뉴 안에 빨간 에러 한 줄 (422: "내보낼 요약이 없습니다", 기타: "내보내기에 실패했습니다").

- [ ] **Step 1: 기존 테스트 파일 확인**

Run: `ls frontend/src/components/folder/*.test.tsx 2>/dev/null || echo "none"`
결과에 따라 테스트를 기존 파일에 추가하거나 신규 생성.

- [ ] **Step 2: 실패하는 테스트 작성**

`frontend/src/components/folder/FolderTree.summaryExport.test.tsx` (신규 기준 — FolderTree 의 실제 props 는 구현 시 파일 상단 interface 를 읽고 최소 셋으로 맞출 것):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const exportFolderSummaries = vi.fn()
vi.mock('../../api/transfers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../api/transfers')>()
  return {
    ...mod,
    exportFolderSummaries: (...a: unknown[]) => exportFolderSummaries(...a),
  }
})

// FolderTree 가 여는 하위 다이얼로그들은 stub (ExportButton.test.tsx 관례)
vi.mock('./ExportFolderDialog', () => ({ default: () => null }))

import FolderTree from './FolderTree'

// 최소 folder 객체 — 실제 Folder 타입 필수 필드는 구현 시 확인해 보강
const folder = { id: 12, name: '주간 회의' }

function openMenu() {
  // 폴더 행의 메뉴(⋯) 트리거를 연다 — 실제 aria-label/role 은 구현 시 확인
  return userEvent.click(screen.getByRole('button', { name: /메뉴|more/i }))
}

beforeEach(() => {
  exportFolderSummaries.mockReset()
})

describe('FolderTree 요약 내보내기', () => {
  it('메뉴 항목 클릭 시 exportFolderSummaries 를 호출한다', async () => {
    exportFolderSummaries.mockResolvedValue(undefined)
    render(<FolderTree folder={folder as never} />)

    await openMenu()
    await userEvent.click(screen.getByText('요약 내보내기(zip)'))

    await waitFor(() => expect(exportFolderSummaries).toHaveBeenCalledWith(12))
  })

  it('422 실패 시 "내보낼 요약이 없습니다" 를 표시한다', async () => {
    exportFolderSummaries.mockRejectedValue({ response: { status: 422 } })
    render(<FolderTree folder={folder as never} />)

    await openMenu()
    await userEvent.click(screen.getByText('요약 내보내기(zip)'))

    expect(await screen.findByText('내보낼 요약이 없습니다')).toBeInTheDocument()
  })

  it('기타 실패 시 "내보내기에 실패했습니다" 를 표시한다', async () => {
    exportFolderSummaries.mockRejectedValue(new Error('network'))
    render(<FolderTree folder={folder as never} />)

    await openMenu()
    await userEvent.click(screen.getByText('요약 내보내기(zip)'))

    expect(await screen.findByText('내보내기에 실패했습니다')).toBeInTheDocument()
  })
})
```

⚠️ FolderTree 의 실제 props/렌더 요구(스토어, 라우터 등)로 render 가 깨지면: 파일 상단을 읽고 필요한 provider/mock 를 추가하되, 테스트 의도(호출·422 메시지·기타 메시지 3케이스)는 유지.

- [ ] **Step 3: 테스트 실행 — 실패 확인**

Run: `cd frontend && npx vitest run src/components/folder/FolderTree.summaryExport.test.tsx`
Expected: FAIL — "요약 내보내기(zip)" 항목 없음

- [ ] **Step 4: 구현**

`frontend/src/components/folder/FolderTree.tsx`:

상단 import 에 추가:

```ts
import { exportFolderSummaries, SUMMARY_EXPORT_EMPTY_STATUS } from '../../api/transfers'
import { FileDown } from 'lucide-react'
```

(lucide import 는 기존 아이콘 import 라인에 `FileDown` 추가하는 방식으로.)

상태 추가 (`showExportDialog` 상태 근처):

```ts
const [summaryExporting, setSummaryExporting] = useState(false)
const [summaryExportError, setSummaryExportError] = useState('')
```

핸들러 (컴포넌트 본문):

```ts
// 요약 zip 내보내기 — 다이얼로그 없이 즉시. 메뉴를 열어둔 채 진행 표시,
// 성공 시 닫고 실패 시 메뉴 안에 에러 한 줄(422=요약 없음).
const handleSummaryExport = async (e: React.MouseEvent) => {
  e.stopPropagation()
  setSummaryExporting(true)
  setSummaryExportError('')
  try {
    await exportFolderSummaries(folder.id)
    setShowMenu(false)
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    setSummaryExportError(
      status === SUMMARY_EXPORT_EMPTY_STATUS ? '내보낼 요약이 없습니다' : '내보내기에 실패했습니다',
    )
  } finally {
    setSummaryExporting(false)
  }
}
```

메뉴 항목 — 기존 "내보내기(.tgz)" 버튼 바로 아래에:

```tsx
<button
  onClick={handleSummaryExport}
  disabled={summaryExporting}
  className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm hover:bg-muted transition-colors disabled:opacity-50"
>
  <FileDown className="w-3.5 h-3.5" /> {summaryExporting ? '내보내는 중…' : '요약 내보내기(zip)'}
</button>
{summaryExportError && (
  <p role="alert" className="px-3 py-1 text-xs text-red-600">{summaryExportError}</p>
)}
```

메뉴 높이 상수: 트리거 버튼의 flip 계산에 `MENU_H = 410` 이 있음 — 항목이 하나 늘었으니 `MENU_H` 를 ~455 로 갱신 (44px 항목 + 여백).

에러 상태 초기화: 메뉴 재오픈 시 이전 에러가 남지 않게, 트리거 버튼 onClick 의 `setShowMenu(!showMenu)` 근처에서 `setSummaryExportError('')` 호출.

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `cd frontend && npx vitest run src/components/folder/FolderTree.summaryExport.test.tsx`
Expected: 3 examples PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/folder/FolderTree.tsx frontend/src/components/folder/FolderTree.summaryExport.test.tsx
git commit -m "feat(export): 폴더 메뉴에 요약 내보내기(zip) 항목

다이얼로그 없이 즉시 다운로드. 진행 중 표시 + 메뉴 내 에러 표출
(422=내보낼 요약 없음).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: ProjectsPage 메뉴 항목

**Files:**
- Modify: `frontend/src/pages/ProjectsPage.tsx` (카드 메뉴 ~132행, admin 조건 "내보내기" 항목 근처)
- Test: `frontend/src/pages/ProjectsPage.summaryExport.test.tsx` (신규 — 기존 ProjectsPage 테스트가 있으면 거기 추가, 먼저 `ls frontend/src/pages/ProjectsPage*.test.tsx` 확인)

**Interfaces:**
- Consumes: Task 4의 `exportProjectSummaries`, `SUMMARY_EXPORT_EMPTY_STATUS`. ProjectsPage 기존 로컬 `error` state(103행 `role="alert"` div — 이미 렌더됨).
- Produces: 프로젝트 카드 메뉴 "요약 내보내기(zip)" 항목 — **멤버 누구나 노출**(기존 tgz "내보내기"의 `isSystemAdmin` 조건 밖). 실패 시 페이지 상단 기존 error div 에 메시지.

- [ ] **Step 1: 기존 테스트 파일 확인**

Run: `ls frontend/src/pages/ProjectsPage*.test.tsx 2>/dev/null || echo "none"`

- [ ] **Step 2: 실패하는 테스트 작성**

`frontend/src/pages/ProjectsPage.summaryExport.test.tsx` (신규 기준 — ProjectsPage 의 실제 렌더 요구(스토어·라우터·프로젝트 목록 fetch mock)는 기존 ProjectsPage 테스트 또는 파일 상단을 읽고 맞출 것):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const exportProjectSummaries = vi.fn()
vi.mock('../api/transfers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/transfers')>()
  return {
    ...mod,
    exportProjectSummaries: (...a: unknown[]) => exportProjectSummaries(...a),
  }
})

// 프로젝트 목록·auth 스토어 mock 은 기존 ProjectsPage 테스트 관례를 따를 것.
// 핵심 검증 3가지:
// 1) 비admin 멤버에게도 "요약 내보내기(zip)" 항목이 보인다 (기존 "내보내기"는 admin 전용)
// 2) 클릭 시 exportProjectSummaries(projectId) 호출
// 3) 422 실패 시 페이지 error div 에 "내보낼 요약이 없습니다"

describe('ProjectsPage 요약 내보내기', () => {
  it('비admin 멤버 카드 메뉴에 요약 내보내기(zip) 항목이 보이고 클릭 시 API 호출', async () => {
    exportProjectSummaries.mockResolvedValue(undefined)
    // render ProjectsPage (프로젝트 1건, 현재 유저 role: 'member')
    // ... 기존 테스트 셋업 재사용
    // 메뉴(⋯) 열기 → 항목 확인·클릭
    // expect(screen.queryByText('내보내기')).not.toBeInTheDocument()  // admin 전용 tgz 항목은 없음
    // await userEvent.click(screen.getByText('요약 내보내기(zip)'))
    // await waitFor(() => expect(exportProjectSummaries).toHaveBeenCalledWith(1))
  })

  it('422 실패 시 "내보낼 요약이 없습니다" 표시', async () => {
    exportProjectSummaries.mockRejectedValue({ response: { status: 422 } })
    // ... 클릭 후
    // expect(await screen.findByText('내보낼 요약이 없습니다')).toBeInTheDocument()
  })
})
```

⚠️ 위 주석 처리된 부분은 placeholder 가 아니라 **기존 ProjectsPage 테스트 셋업에 종속되는 부분** — 구현자는 반드시 기존 테스트 파일(없으면 ProjectsPage.tsx 상단 store 사용부)을 읽고 실제 렌더 가능한 셋업으로 채워 3가지 핵심 검증을 완성할 것. 셋업이 과도하게 복잡하면(페이지 전체 render 에 mock 5개 이상 필요) 컴포넌트 테스트를 포기하고 Task 4의 API 테스트 + Task 7 수동 검증으로 대체하되, 그 결정을 커밋 메시지에 남길 것.

- [ ] **Step 3: 테스트 실행 — 실패 확인**

Run: `cd frontend && npx vitest run src/pages/ProjectsPage.summaryExport.test.tsx`
Expected: FAIL

- [ ] **Step 4: 구현**

`frontend/src/pages/ProjectsPage.tsx`:

import 추가:

```ts
import { exportProjectSummaries, SUMMARY_EXPORT_EMPTY_STATUS } from '../api/transfers'
import { FileDown } from 'lucide-react'
```

상태 추가 (`exportTarget` 근처):

```ts
const [summaryExportingId, setSummaryExportingId] = useState<number | null>(null)
```

핸들러:

```ts
// 요약 zip 내보내기 — 멤버 누구나. 실패 시 페이지 상단 error div 재사용.
const handleSummaryExport = async (p: Project) => {
  setMenuId(null)
  setSummaryExportingId(p.id)
  setError('')
  try {
    await exportProjectSummaries(p.id)
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    setError(
      status === SUMMARY_EXPORT_EMPTY_STATUS
        ? '내보낼 요약이 없습니다'
        : '요약 내보내기에 실패했습니다',
    )
  } finally {
    setSummaryExportingId(null)
  }
}
```

(⚠️ ProjectsPage 의 기존 error state 세터 이름을 확인 — `setError` 가 아니라면 실제 이름에 맞출 것. error state 가 문자열이 아니라면 기존 사용 방식을 따를 것.)

카드 메뉴 — 기존 `{isSystemAdmin && (...내보내기...)}` 블록 **바깥**(멤버 누구나 보이게), 그 위나 아래에:

```tsx
<button
  onClick={() => handleSummaryExport(p)}
  disabled={summaryExportingId === p.id}
  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
>
  <FileDown className="h-4 w-4" />
  {summaryExportingId === p.id ? '내보내는 중…' : '요약 내보내기(zip)'}
</button>
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `cd frontend && npx vitest run src/pages/ProjectsPage.summaryExport.test.tsx`
Expected: PASS (또는 Step 2의 대체 결정 시 이 스텝 생략)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ProjectsPage.tsx frontend/src/pages/ProjectsPage.summaryExport.test.tsx
git commit -m "feat(export): 프로젝트 메뉴에 요약 내보내기(zip) 항목

멤버 누구나 노출(기존 tgz 내보내기의 admin 전용과 별개).
실패 시 페이지 error 표출(422=내보낼 요약 없음).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 전체 게이트 + 수동 검증 안내

**Files:**
- 수정 없음 (검증만)

**Interfaces:**
- Consumes: Task 1~6 전체.
- Produces: 게이트 결과 보고 + 수동 검증 체크리스트 전달.

- [ ] **Step 1: 백엔드 전체 rspec**

Run: `cd backend && bundle exec rspec`
Expected: 0 failures (기준선: 전체 green)

- [ ] **Step 2: 프런트 타입체크**

Run: `cd frontend && npx tsc -p tsconfig.app.json`
Expected: 에러 0 (bare tsc 금지 — 루트 files:[] 거짓 green)

- [ ] **Step 3: 프런트 전체 vitest**

Run: `cd frontend && npm test`
Expected: 0 failures

- [ ] **Step 4: 프런트 빌드**

Run: `cd frontend && npm run build`
Expected: 빌드 성공

- [ ] **Step 5: 수동 검증 체크리스트 사용자 전달 (자동으로 못 잡는 항목)**

보고에 포함:
1. **한글 폴더·회의명 zip → Windows 탐색기에서 열어 한글 확인** (EFS 실효 — Mac 재현 불가)
2. macOS Finder 압축 해제 → 트리·내용 확인
3. Tauri 앱에서 다운로드 (plugin-dialog save 경로)
4. 폴더 메뉴·프로젝트 메뉴 항목 노출/동작 (비admin 멤버 계정으로 프로젝트 항목 확인)

---

## Self-Review 결과

- 스펙 커버리지: gem/initializer(T1), 서비스+skip+dedup+루트회의+사이클+kept(T2), 엔드포인트+권한+422(T3), API 함수(T4), 진입점 2곳(T5·6), 게이트+수동검증(T7) — 스펙 전 항목 매핑됨.
- 스펙과 차이 2건 (의도적, 스펙에 반영 완료): ① 폴더 권한을 `editable_by?` 대신 `set_folder` 멤버십 스코프만으로 — "멤버 누구나" 결정이 읽기 행위인 요약 내보내기에 정확히 부합. ② 트리 경로 sanitize 에서 공백 보존(공백→`_` 제외) — "폴더 모양 그대로"+LLM 입력 목적. advisor 검토로 테스트 간 모순(공백 규칙) 해소, 사이클 테스트를 실제 가드 발동 형태로 교정.
- Task 6 Step 2에 주석 placeholder 있음 — 기존 테스트 셋업 종속이라 플랜에서 확정 불가함을 명시하고 구현자 행동 규칙(읽고 채우기 / 복잡도 초과 시 대체+기록)을 지정했으므로 허용.
- 타입 일관성: `SummaryZipExporter` 시그니처(T2 Produces ↔ T3 사용), `SUMMARY_EXPORT_EMPTY_STATUS`(T4 ↔ T5·6) 일치 확인.
