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
    # 스코프 루트 자체가 휴지통이면 빈 결과 → 컨트롤러 422. set_folder(컨트롤러)가
    # kept 를 필터하지 않아 trashed 폴더 ID로도 여기까지 도달 가능(T3 리뷰 E2E 실증).
    return [] if @folder.trashed?

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
    # 스코프 루트 자체가 휴지통이면 빈 결과 → 컨트롤러 422 (folder_scope_pairs 와 대칭).
    return [] if @project.trashed?

    @project.meetings.kept.includes(:folder).filter_map do |meeting|
      # 폴더 체인에 휴지통 폴더가 있으면 제외 — 폴더 스코프의 children.kept DFS와
      # 대칭 (kept 회의가 trashed 폴더 아래 남는 상태는 실재 가능: Trash::Restorer 선례)
      next if meeting.folder && ([meeting.folder] + meeting.folder.ancestor_records).any?(&:trashed?)

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
