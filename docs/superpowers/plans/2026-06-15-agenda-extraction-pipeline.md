# 안건 자료 추출 파이프라인 (2차) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비-텍스트 안건 첨부(pdf/docx/pptx/xlsx/이미지)를 업로드 시점에 추출해 md로 저장하고, 1차 압축·주입 경로에 합류시킨다.

**Architecture:** 업로드(비-md agenda) → `AgendaExtractionJob` → `AgendaExtractionService`(claude CLI가 `uv run --with` 로 python-pptx/openpyxl/python-docx/pdfplumber 실행, 이미지는 Vision OCR) → 원본 옆 `<file_path>.extracted/` 에 md 기록 → `AgendaReferenceJob`(1차) 체이닝이 업로드 md + 추출 md 합산 압축<8000 → 주입.

**Tech Stack:** Rails 8, RSpec, claude CLI shell-out(Open3), `uv run --with`.

**스파이크 결과(완료):** CLI 샌드박스에 office libs 미설치·pip 차단이나 `uv run --with <pkg> python ...` 로 설치+실행 성공. pptx 생성→추출 E2E 확인. **배포 환경에 `uv` 설치 필요.**

---

## File Structure

- Create: `backend/app/services/agenda_extraction_service.rb` — 첨부 1개를 CLI로 추출해 폴더에 md 기록
- Create: `backend/app/jobs/agenda_extraction_job.rb` — 서비스 호출 + RefJob 체이닝
- Modify: `backend/app/models/meeting_attachment.rb` — `extraction_dir` + 삭제 cascade
- Modify: `backend/app/jobs/agenda_reference_job.rb` — `collect_agenda_text` 가 `.extracted/*.md` 합산
- Modify: `backend/app/controllers/api/v1/meeting_attachments_controller.rb` — 비텍스트 agenda→ExtractionJob 분기
- Test: 각 대응 spec

상수: 텍스트 타입 `%w[text/markdown text/plain]`(1차 `AgendaReferenceJob::AGENDA_TEXT_TYPES` 재사용).

---

## Task 1: MeetingAttachment 추출 폴더 경로 + 삭제 cascade

**Files:**
- Modify: `backend/app/models/meeting_attachment.rb`
- Test: `backend/spec/models/meeting_attachment_extraction_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

```ruby
# backend/spec/models/meeting_attachment_extraction_spec.rb
require "rails_helper"

RSpec.describe MeetingAttachment, "extraction dir" do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  def file_attachment(path)
    meeting.meeting_attachments.create!(
      kind: "file", category: "agenda", display_name: "d.pptx", original_filename: "d.pptx",
      content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      file_size: 3, file_path: path, uploaded_by_id: user.id, position: 1
    )
  end

  it "derives extraction_dir from file_path" do
    att = file_attachment("/tmp/x/d.pptx")
    expect(att.extraction_dir).to eq("/tmp/x/d.pptx.extracted")
  end

  it "returns nil extraction_dir for links (no file_path)" do
    link = meeting.meeting_attachments.create!(
      kind: "link", category: "agenda", display_name: "l", url: "https://e.io",
      uploaded_by_id: user.id, position: 2
    )
    expect(link.extraction_dir).to be_nil
  end

  it "removes the extraction dir when the attachment is destroyed" do
    dir = Dir.mktmpdir
    file = File.join(dir, "d.pptx"); File.write(file, "x")
    att = file_attachment(file)
    FileUtils.mkdir_p(att.extraction_dir); File.write(File.join(att.extraction_dir, "d.pptx.md"), "md")

    att.destroy

    expect(File.exist?(att.extraction_dir)).to be(false)
    expect(File.exist?(file)).to be(false)
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/meeting_attachment_extraction_spec.rb`
Expected: FAIL — `undefined method 'extraction_dir'`

- [ ] **Step 3: 최소 구현**

`meeting_attachment.rb` 에 추가:
```ruby
  # 비-텍스트 첨부 추출물(.md) 저장 폴더. 원본 파일 옆에 둔다(파일 없으면 nil).
  def extraction_dir
    return nil unless file? && file_path.present?
    "#{file_path}.extracted"
  end
```

`remove_file_from_disk` 교체(폴더도 cascade):
```ruby
  def remove_file_from_disk
    return unless file? && file_path.present?
    FileUtils.rm_f(file_path)
    FileUtils.rm_rf(extraction_dir) if extraction_dir
  end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/meeting_attachment_extraction_spec.rb`
Expected: PASS (3 examples)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/models/meeting_attachment.rb backend/spec/models/meeting_attachment_extraction_spec.rb
git commit -m "feat(agenda): attachment extraction_dir + cascade delete"
```

---

## Task 2: AgendaExtractionService — content_type별 추출 지시

**Files:**
- Create: `backend/app/services/agenda_extraction_service.rb`
- Test: `backend/spec/services/agenda_extraction_service_spec.rb`

설계: `extraction_prompt(dir)` 가 content_type별 지시문을 만든다(테스트 대상). `call` 은 폴더 생성 → `run_cli` → 폴더 내 `*.md` glob 반환. `run_cli` 는 spec에서 stub.

- [ ] **Step 1: 실패 테스트 작성**

```ruby
# backend/spec/services/agenda_extraction_service_spec.rb
require "rails_helper"
require "tmpdir"

RSpec.describe AgendaExtractionService do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  def att(content_type:, filename:, path:)
    meeting.meeting_attachments.create!(
      kind: "file", category: "agenda", display_name: filename, original_filename: filename,
      content_type: content_type, file_size: 3, file_path: path, uploaded_by_id: user.id, position: 1
    )
  end

  describe "#extraction_prompt" do
    it "instructs uv run + python-pptx for pptx and names <base>.pptx.md" do
      a = att(content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              filename: "deck.pptx", path: "/tmp/deck.pptx")
      prompt = described_class.new(a).extraction_prompt("/tmp/deck.pptx.extracted")
      expect(prompt).to include("uv run --with python-pptx")
      expect(prompt).to include("deck.pptx.md")
      expect(prompt).to include("네이티브 차트")     # 차트 데이터표 지시
      expect(prompt).to include("임베디드 이미지")   # 무시 지시
    end

    it "instructs openpyxl and per-sheet naming for xlsx" do
      a = att(content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              filename: "book.xlsx", path: "/tmp/book.xlsx")
      prompt = described_class.new(a).extraction_prompt("/tmp/book.xlsx.extracted")
      expect(prompt).to include("uv run --with openpyxl")
      expect(prompt).to include("book.xlsx.sheet1.md")
    end

    it "instructs Vision Read (not python) for images" do
      a = att(content_type: "image/png", filename: "p.png", path: "/tmp/p.png")
      prompt = described_class.new(a).extraction_prompt("/tmp/p.png.extracted")
      expect(prompt).to include("Read")
      expect(prompt).not_to include("uv run")
      expect(prompt).to include("p.png.md")
    end
  end

  describe "#call" do
    it "creates the dir, runs the CLI, and returns written md paths" do
      Dir.mktmpdir do |dir|
        path = File.join(dir, "deck.pptx"); File.write(path, "x")
        a = att(content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                filename: "deck.pptx", path: path)
        svc = described_class.new(a)
        allow(svc).to receive(:run_cli) do
          File.write(File.join(a.extraction_dir, "deck.pptx.md"), "## Slide 1\n내용")
        end

        result = svc.call

        expect(result).to eq([ File.join(a.extraction_dir, "deck.pptx.md") ])
      end
    end

    it "returns [] for a missing source file" do
      a = att(content_type: "application/pdf", filename: "x.pdf", path: "/tmp/does-not-exist.pdf")
      expect(described_class.new(a).call).to eq([])
    end
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/agenda_extraction_service_spec.rb`
Expected: FAIL — `uninitialized constant AgendaExtractionService`

- [ ] **Step 3: 최소 구현**

```ruby
# backend/app/services/agenda_extraction_service.rb
# 비-텍스트 안건 첨부를 claude CLI(uv run --with <lib>)로 추출해 <file_path>.extracted/ 에 md 기록.
# 이미지는 Vision(Read)로 OCR. 명함 OCR(CardExtractionService)과 동일한 CLI shell-out 패턴.
class AgendaExtractionService
  class ExtractionUnavailable < StandardError; end

  CLI_TIMEOUT = (ENV["AGENDA_EXTRACTION_TIMEOUT"] || "300").to_i
  IMAGE_TYPES = %w[image/png image/jpeg image/gif image/webp].freeze

  def initialize(attachment)
    @attachment = attachment
  end

  # 추출 실행 → 기록된 md 경로 배열(정렬) 반환. 원본 없으면 [].
  def call
    return [] unless @attachment.file? && @attachment.file_path.present? && File.exist?(@attachment.file_path)

    dir = @attachment.extraction_dir
    FileUtils.mkdir_p(dir)
    run_cli(build_command(dir))
    Dir.glob(File.join(dir, "*.md")).sort
  end

  # content_type별 추출 지시문. (스펙 대상 — 분기 검증)
  def extraction_prompt(dir)
    base = File.basename(@attachment.original_filename.to_s)
    path = @attachment.file_path
    common = "추출 결과 markdown을 '#{dir}/' 폴더에 Write 하라. 임베디드 이미지는 무시(텍스트만). "

    if IMAGE_TYPES.include?(@attachment.content_type)
      "'#{path}' 이미지를 Read 도구로 열어 보이는 텍스트를 OCR 추출해 '#{dir}/#{base}.md' 로 Write 하라. " \
      "차트/도표는 텍스트·수치만 옮기고 그림 복원은 하지 마라."
    elsif xlsx?
      common +
      "'#{path}' 를 `uv run --with openpyxl python` 으로 열어 각 시트를 markdown 표로 추출하고 " \
      "시트별로 '#{base}.sheet1.md', '#{base}.sheet2.md' … 처럼 Write 하라. 네이티브 차트는 데이터표로."
    elsif pptx?
      common +
      "'#{path}' 를 `uv run --with python-pptx python` 으로 열어 슬라이드 텍스트·표를 markdown 으로 추출해 " \
      "'#{base}.md' 로 Write 하라. 네이티브 차트 객체는 카테고리+값을 표로 추출하라(그림 복원 금지)."
    elsif docx?
      common +
      "'#{path}' 를 `uv run --with python-docx python` 으로 열어 본문·표를 markdown 으로 추출해 '#{base}.md' 로 Write 하라."
    else # pdf 등
      common +
      "'#{path}' 를 `uv run --with pdfplumber python` 으로 열어 텍스트·표를 markdown 으로 추출해 '#{base}.md' 로 Write 하라. " \
      "Read 도구로 직접 읽어도 된다."
    end
  end

  private

  def xlsx?
    @attachment.content_type.to_s.include?("spreadsheet") || @attachment.content_type == "application/vnd.ms-excel"
  end

  def pptx?
    @attachment.content_type.to_s.include?("presentation") || @attachment.content_type == "application/vnd.ms-powerpoint"
  end

  def docx?
    @attachment.content_type.to_s.include?("word") || @attachment.content_type == "application/msword"
  end

  def build_command(dir)
    cli = ENV.fetch("CLAUDE_CLI_PATH", "claude")
    ensure_cli!(cli)
    model = ENV["VISION_LLM_MODEL"].presence || ENV["LLM_MODEL"].presence || "sonnet"
    [
      cli, "-p", extraction_prompt(dir),
      "--output-format", "text",
      "--allowedTools", "Read Bash Write",
      "--permission-mode", "bypassPermissions",
      "--model", model
    ]
  end

  def ensure_cli!(cli)
    return if cli.include?("/") && File.executable?(cli)
    found = ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).any? do |d|
      p = File.join(d, cli); File.executable?(p) && !File.directory?(p)
    end
    raise ExtractionUnavailable, "Claude CLI를 찾을 수 없습니다: '#{cli}'" unless found
  end

  def run_cli(cmd)
    require "open3"
    Open3.popen3(*cmd) do |stdin, stdout, stderr, wait_thr|
      stdin.close
      unless wait_thr.join(CLI_TIMEOUT)
        Process.kill("KILL", wait_thr.pid) rescue nil
        wait_thr.join
        raise ExtractionUnavailable, "추출 CLI 응답 시간 초과 (#{CLI_TIMEOUT}초)"
      end
      status = wait_thr.value
      raise ExtractionUnavailable, "추출 CLI 오류 (#{status&.exitstatus}): #{stderr.read.to_s.strip}" unless status&.success?
    end
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/agenda_extraction_service_spec.rb`
Expected: PASS (5 examples)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/agenda_extraction_service.rb backend/spec/services/agenda_extraction_service_spec.rb
git commit -m "feat(agenda): AgendaExtractionService (CLI uv-run extraction per content_type)"
```

---

## Task 3: AgendaExtractionJob — 추출 + RefJob 체이닝

**Files:**
- Create: `backend/app/jobs/agenda_extraction_job.rb`
- Test: `backend/spec/jobs/agenda_extraction_job_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

```ruby
# backend/spec/jobs/agenda_extraction_job_spec.rb
require "rails_helper"

RSpec.describe AgendaExtractionJob, type: :job do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }
  let(:att) do
    meeting.meeting_attachments.create!(
      kind: "file", category: "agenda", display_name: "d.pptx", original_filename: "d.pptx",
      content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      file_size: 3, file_path: "/tmp/d.pptx", uploaded_by_id: user.id, position: 1
    )
  end

  it "runs extraction then enqueues AgendaReferenceJob for the meeting" do
    expect_any_instance_of(AgendaExtractionService).to receive(:call).and_return([ "/tmp/d.pptx.extracted/d.pptx.md" ])
    expect(AgendaReferenceJob).to receive(:perform_later).with(meeting.id)

    described_class.perform_now(att.id)
  end

  it "still enqueues AgendaReferenceJob when extraction fails (partial reflect)" do
    allow_any_instance_of(AgendaExtractionService).to receive(:call)
      .and_raise(AgendaExtractionService::ExtractionUnavailable, "boom")
    expect(AgendaReferenceJob).to receive(:perform_later).with(meeting.id)

    expect { described_class.perform_now(att.id) }.not_to raise_error
  end

  it "no-ops for a missing attachment" do
    expect(AgendaReferenceJob).not_to receive(:perform_later)
    expect { described_class.perform_now(-1) }.not_to raise_error
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/jobs/agenda_extraction_job_spec.rb`
Expected: FAIL — `uninitialized constant AgendaExtractionJob`

- [ ] **Step 3: 최소 구현**

```ruby
# backend/app/jobs/agenda_extraction_job.rb
# 비-텍스트 안건 첨부를 추출(AgendaExtractionService)한 뒤, 회의 단위 압축 재계산(AgendaReferenceJob)을
# 체이닝한다. 추출 실패해도 RefJob 은 돌려 나머지 안건으로 부분 반영(무음손실 차단).
class AgendaExtractionJob < ApplicationJob
  queue_as :default

  def perform(attachment_id)
    attachment = MeetingAttachment.find_by(id: attachment_id)
    return unless attachment&.category == "agenda" && attachment.file?

    begin
      AgendaExtractionService.new(attachment).call
    rescue => e
      Rails.logger.error "[AgendaExtractionJob] attachment=#{attachment_id} error=#{e.class}: #{e.message}"
    end

    AgendaReferenceJob.perform_later(attachment.meeting_id)
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/jobs/agenda_extraction_job_spec.rb`
Expected: PASS (3 examples)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/jobs/agenda_extraction_job.rb backend/spec/jobs/agenda_extraction_job_spec.rb
git commit -m "feat(agenda): AgendaExtractionJob chains extraction into reference recompute"
```

---

## Task 4: AgendaReferenceJob — 추출 폴더 md 합산

**Files:**
- Modify: `backend/app/jobs/agenda_reference_job.rb`
- Test: `backend/spec/jobs/agenda_reference_job_extracted_spec.rb`

현재 `collect_agenda_text` 는 텍스트 첨부 원본만 읽는다. 모든 agenda 파일 첨부의 `extraction_dir/*.md` 도 합산해야 한다.

- [ ] **Step 1: 실패 테스트 작성**

```ruby
# backend/spec/jobs/agenda_reference_job_extracted_spec.rb
require "rails_helper"
require "tmpdir"

RSpec.describe AgendaReferenceJob, "extracted md collection" do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  it "includes extracted .md from a non-text attachment's extraction dir" do
    Dir.mktmpdir do |dir|
      pptx = File.join(dir, "deck.pptx"); File.write(pptx, "binary")
      att = meeting.meeting_attachments.create!(
        kind: "file", category: "agenda", display_name: "deck.pptx", original_filename: "deck.pptx",
        content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        file_size: 6, file_path: pptx, uploaded_by_id: user.id, position: 1
      )
      FileUtils.mkdir_p(att.extraction_dir)
      File.write(File.join(att.extraction_dir, "deck.pptx.md"), "## 슬라이드\n핵심 안건")

      captured = nil
      allow_any_instance_of(LlmService).to receive(:compress_agenda) { |_s, text, **| captured = text; "C" }

      described_class.perform_now(meeting.id)

      expect(captured).to include("핵심 안건")
    end
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/jobs/agenda_reference_job_extracted_spec.rb`
Expected: FAIL — `captured` nil (추출 md 미수집 → blank → compress 미호출)

- [ ] **Step 3: 최소 구현**

`agenda_reference_job.rb` 의 `collect_agenda_text` 교체:
```ruby
  # 안건 텍스트: 업로드 .md/.txt 원본 + 모든 agenda 파일 첨부의 추출폴더(.extracted/*.md) 를 합친다.
  def collect_agenda_text(meeting)
    atts = meeting.meeting_attachments
                  .where(category: "agenda", kind: "file")
                  .order(:position)

    parts = atts.flat_map do |att|
      pieces = []
      # 업로드된 텍스트 원본
      if AGENDA_TEXT_TYPES.include?(att.content_type)
        pieces << read_file(att.file_path)
      end
      # 비-텍스트 추출물
      if att.extraction_dir && File.directory?(att.extraction_dir)
        Dir.glob(File.join(att.extraction_dir, "*.md")).sort.each { |p| pieces << read_file(p) }
      end
      pieces
    end

    parts.compact_blank.join("\n\n---\n\n")
  end

  def read_file(path)
    return nil unless path.present? && File.exist?(path)
    File.read(path)
  rescue => e
    Rails.logger.warn "[AgendaReferenceJob] read failed #{path}: #{e.message}"
    nil
  end
```

기존 `read_attachment` private 메서드는 제거(위 `read_file` 로 대체). `AGENDA_TEXT_TYPES` 상수는 유지.

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/jobs/agenda_reference_job_extracted_spec.rb spec/jobs/agenda_reference_job_spec.rb`
Expected: PASS (기존 5 + 신규 1)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/jobs/agenda_reference_job.rb backend/spec/jobs/agenda_reference_job_extracted_spec.rb
git commit -m "feat(agenda): AgendaReferenceJob aggregates extracted .md from extraction dirs"
```

---

## Task 5: 컨트롤러 훅 — 비텍스트 agenda는 ExtractionJob

**Files:**
- Modify: `backend/app/controllers/api/v1/meeting_attachments_controller.rb`
- Test: `backend/spec/requests/api/v1/meeting_attachments_extraction_hook_spec.rb`

현재 agenda 파일 생성 시 항상 `AgendaReferenceJob`. 변경: **비텍스트 agenda 파일 생성 → `AgendaExtractionJob`**(체이닝이 RefJob 호출). 텍스트(md/txt)는 그대로 RefJob. 삭제·카테고리변경은 RefJob 유지.

- [ ] **Step 1: 실패 테스트 작성**

```ruby
# backend/spec/requests/api/v1/meeting_attachments_extraction_hook_spec.rb
require "rails_helper"
require "tmpdir"

RSpec.describe "Api::V1::MeetingAttachments extraction hook", type: :request do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }
  before { login_as(user) }

  around do |example|
    Dir.mktmpdir do |dir|
      prev = ENV["ATTACHMENTS_DIR"]; ENV["ATTACHMENTS_DIR"] = dir
      example.run
      ENV["ATTACHMENTS_DIR"] = prev
    end
  end

  def upload(content_type:, filename:, content: "bytes")
    Rack::Test::UploadedFile.new(StringIO.new(content), content_type, true, original_filename: filename)
  end

  it "enqueues AgendaExtractionJob (not RefJob directly) for a non-text agenda upload" do
    expect(AgendaExtractionJob).to receive(:perform_later)
    expect(AgendaReferenceJob).not_to receive(:perform_later)
    post "/api/v1/meetings/#{meeting.id}/attachments",
         params: { category: "agenda",
                   file: upload(content_type: "application/pdf", filename: "a.pdf", content: "%PDF-1.4") }
    expect(response).to have_http_status(:created)
  end

  it "enqueues AgendaReferenceJob directly for a text agenda upload" do
    expect(AgendaReferenceJob).to receive(:perform_later)
    expect(AgendaExtractionJob).not_to receive(:perform_later)
    post "/api/v1/meetings/#{meeting.id}/attachments",
         params: { category: "agenda", file: upload(content_type: "text/markdown", filename: "a.md") }
    expect(response).to have_http_status(:created)
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meeting_attachments_extraction_hook_spec.rb`
Expected: FAIL — 첫 예제에서 RefJob 이 호출됨(현재 코드)

- [ ] **Step 3: 최소 구현**

`create_file_attachment` 의 hook 교체:
```ruby
        if attachment.save
          CardExtractionJob.perform_later(attachment.id) if attachment.category == "business_card"
          enqueue_agenda_processing(attachment) if attachment.category == "agenda"
          render json: { attachment: attachment_json(attachment) }, status: :created
```

private 헬퍼 추가(기존 `recompute_agenda_reference!` 옆):
```ruby
      # 안건 파일: 텍스트(md/txt)는 바로 압축 재계산, 비텍스트는 추출 잡(추출 후 RefJob 체이닝).
      def enqueue_agenda_processing(attachment)
        if AgendaReferenceJob::AGENDA_TEXT_TYPES.include?(attachment.content_type)
          recompute_agenda_reference!
        else
          AgendaExtractionJob.perform_later(attachment.id)
        end
      end
```

(주의: 기존 create 의 `recompute_agenda_reference! if attachment.category == "agenda"` 줄은 위 `enqueue_agenda_processing` 호출로 대체 — 중복 호출 제거.)

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meeting_attachments_extraction_hook_spec.rb spec/requests/api/v1/meeting_attachments_agenda_hook_spec.rb`
Expected: PASS (신규 2 + 기존 4 — 단 기존 "agenda markdown 업로드→RefJob" 은 여전히 통과)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/controllers/api/v1/meeting_attachments_controller.rb backend/spec/requests/api/v1/meeting_attachments_extraction_hook_spec.rb
git commit -m "feat(agenda): route non-text agenda uploads through extraction job"
```

---

## Task 6: 전체 회귀 + rubocop

- [ ] **Step 1: 관련 + 전체 스위트**

Run: `cd backend && bundle exec rspec spec/services/agenda_extraction_service_spec.rb spec/jobs/agenda_extraction_job_spec.rb spec/jobs/agenda_reference_job_spec.rb spec/jobs/agenda_reference_job_extracted_spec.rb spec/models/meeting_attachment_extraction_spec.rb spec/requests/api/v1/meeting_attachments_extraction_hook_spec.rb spec/requests/api/v1/meeting_attachments_agenda_hook_spec.rb`
Expected: 전부 PASS

- [ ] **Step 2: rubocop**

Run: `cd backend && bundle exec rubocop app/services/agenda_extraction_service.rb app/jobs/agenda_extraction_job.rb app/jobs/agenda_reference_job.rb app/models/meeting_attachment.rb app/controllers/api/v1/meeting_attachments_controller.rb`
Expected: no offenses

- [ ] **Step 3: 전체 스위트(회귀)**

Run: `cd backend && bundle exec rspec`
Expected: 신규 추가분 외 회귀 0 (기존 사전존재 실패 `DefaultUserLookup` 1건은 무관).

---

## 배포 노트 (비코드)
- 배포 서버 claude CLI 샌드박스에 **`uv` 필요**(추출이 `uv run --with` 로 libs 설치·실행). 미존재 시 office 추출 실패(이미지·pdf-Read 는 동작). 배포 점검 항목.
- 첫 추출은 `uv` 가 패키지 다운로드(수초~수십초). 이후 캐시.

## 스코프 밖
임베디드 이미지 OCR, 차트 모양/순서도 흐름 복원, reference 카테고리, 프론트 변경.
