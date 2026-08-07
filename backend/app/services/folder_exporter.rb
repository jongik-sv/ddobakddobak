require "rubygems/package"
require "zlib"

# 폴더 1개(서브트리 전체)를 .ddobak-folder.tgz(tar.gz, stdlib only)로 내보낸다.
#
# 엔트리:
#   speakers/<원본meeting_id>.json            회의별 sidecar SpeakerDB. 로스터가 비었거나 못 읽으면 없음
#   audio/<원본meeting_id>.<ext>              include_audio=true & 실제 파일 존재 시
#   attachments/<basename>                     첨부 파일이 실제 존재 시
#   attachments/<basename>.extracted/<rel>     .extracted 디렉토리가 존재 시 재귀 번들
#   manifest.json                              (필수·마지막) scope:"folder" + 폴더 서브트리·회의 목록·태그
#
# ⚠️ manifest.json 은 **마지막** 엔트리다(ProjectExporter 와 동일). tar 는 append-only 라
# 이미 쓴 엔트리를 되돌아가 고칠 수 없는데, manifest 의 speaker_db_degraded 표식은
# 로스터 수집이 끝나야 값이 정해지기 때문. FolderImporter 는 tar 를 끝까지 읽고 엔트리
# **이름**으로 고르므로 순서에 의존하지 않는다.
#
# 사용법:
#   exporter = FolderExporter.new(folder, include_audio: true)
#   exporter.write_to(io)   # StringIO / File 등 write 가능한 IO
#   exporter.filename       # 다운로드 파일명
class FolderExporter
  FORMAT_VERSION = 1

  # @param folder [Folder]
  # @param include_audio [Boolean] 오디오 파일 동봉 여부
  def initialize(folder, include_audio: true)
    @folder              = folder
    @include_audio       = include_audio
    @speaker_db_degraded = false # 로스터를 하나라도 놓쳤는가(아카이브 수준 표식)
  end

  # tar.gz 스트림을 io 에 작성한다.
  # @param io [IO] write 가능한 IO
  def write_to(io)
    gz  = Zlib::GzipWriter.new(io)
    tar = Gem::Package::TarWriter.new(gz)

    begin
      # 순서 고정: 로스터 → 오디오/첨부 → manifest.
      # manifest 가 마지막인 이유는 클래스 주석 참고(열화 표식은 로스터 수집 후에 확정).
      add_speaker_db_files(tar)
      add_files(tar)
      add_manifest(tar)
    ensure
      close_tar_then_gz(tar, gz, pending_error: $!)
    end
  end

  # 다운로드 파일명. <slug>-folder-YYYYMMDD.ddobak-folder.tgz
  # slug blank 시 "folder" 폴백 (meeting_exporter 패턴 동일).
  # @return [String]
  def filename
    slug = @folder.name.to_s.parameterize
    slug = "folder" if slug.blank?
    "#{slug}-folder-#{Date.current.strftime('%Y%m%d')}.ddobak-folder.tgz"
  end

  private

  # 폴더 서브트리: 인자 folder + 모든 하위 폴더(재귀 children).
  # DB FK는 parent_id 존재성만 보장하며 사이클(A→B→A)은 막지 못한다.
  # seen Set 으로 재방문 방지(사이클·무한재귀 억제).
  def folders
    @folders ||= collect_subtree(@folder, Set.new)
  end

  def collect_subtree(folder, seen)
    return [] if seen.include?(folder.id)
    seen << folder.id
    [folder] + folder.children.flat_map { |c| collect_subtree(c, seen) }
  end

  # 서브트리 내 전 폴더에 속한 회의들.
  def meetings
    @meetings ||= Meeting.where(folder_id: folders.map(&:id)).to_a
  end

  # 각 회의의 Transfer::MeetingSerializer 인스턴스.
  def serializers
    @serializers ||= meetings.map { |m| Transfer::MeetingSerializer.new(m) }
  end

  # 폴더들 tag_ids + 회의들 tag_ids 합집합의 Tag 레코드(중복 제거).
  def tags
    @tags ||= begin
      folder_tag_ids  = folders.flat_map { |f| f.taggings.map(&:tag_id) }
      meeting_tag_ids = serializers.flat_map { |s| s.tags.map(&:id) }
      tag_ids = (folder_tag_ids + meeting_tag_ids).uniq
      Tag.where(id: tag_ids).to_a
    end
  end

  # 매니페스트 Hash. 파일 바이너리는 포함하지 않는다(파일은 tar 엔트리).
  def manifest
    {
      format_version: FORMAT_VERSION,
      scope:          "folder",
      exported_at:    Time.current.iso8601,
      app_version:    app_version,
      include_audio:  @include_audio,
      # 키 문자열은 Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY 와 같아야 한다
      # (importer 가 그 상수로 읽는다).
      # write_to 를 거치지 않고 #manifest 만 호출하면 로스터 수집 자체가 없으므로 false.
      speaker_db_degraded: @speaker_db_degraded,
      folders:        folders.map { |f| serialize_folder(f) },
      meetings:       serializers.map(&:as_hash),
      tags:           tags.map(&:attributes)
    }
  end

  # 폴더 1건 + 소유 자식(glossary_entries · taggings). parent_id 원본 보존.
  def serialize_folder(folder)
    folder.attributes.merge(
      "glossary_entries" => folder.glossary_entries.map(&:attributes),
      "tag_ids"          => folder.taggings.map(&:tag_id)
    )
  end

  def add_manifest(tar)
    json  = JSON.pretty_generate(manifest)
    bytes = json.b
    tar.add_file_simple("manifest.json", 0o644, bytes.bytesize) do |entry|
      entry.write(bytes)
    end
  end

  # 서브트리 회의별 sidecar SpeakerDB(화자 임베딩·이름·next_num) 를
  # speakers/<원본meeting_id>.json 으로 번들. sidecar 다운/에러 시 해당 회의만 스킵
  # (export 전체를 실패시키지 않음 — Transfer::SpeakerDbTransfer 가 흡수). 단 **조용히**는
  # 아니다: 하나라도 놓치면 @speaker_db_degraded 로 기록해 manifest 표식 → import 경고까지 이어진다.
  #
  # Exporter 인스턴스를 한 export 동안 **공유**한다(ProjectExporter 와 동일). 회의마다 새로
  # 만들면 (1) circuit-break 가 작동하지 않아 "붙어는 있는데 응답 없음" 사이드카에서
  # 회의당 TIMEOUT(30초)을 전부 소모하고, (2) SidecarClient 도 매번 새로 만든다.
  # 로스터가 빈 회의는 tar 엔트리를 만들지 않는다(import 쪽 하위호환 경로가 처리).
  def add_speaker_db_files(tar)
    speaker_exporter = Transfer::SpeakerDbTransfer::Exporter.new

    meetings.each do |meeting|
      bytes = speaker_exporter.bytes_for(meeting.id)
      next if bytes.nil?

      entry_name = Transfer::SpeakerDbTransfer.entry_name(meeting.id)
      tar.add_file_simple(entry_name, 0o644, bytes.bytesize) { |entry| entry.write(bytes) }
    end

    @speaker_db_degraded = speaker_exporter.any_roster_dropped?
  end

  # include_audio=false 면 audio/ エントリを건너뛴다 (meeting_exporter 패턴 동일).
  def add_files(tar)
    serializers.each do |serializer|
      serializer.files.each do |file_entry|
        next if !@include_audio && file_entry[:tar_entry].start_with?("audio/")

        Transfer::Archive.add_file_streamed(tar, file_entry[:tar_entry], file_entry[:path])
      end
    end
  end

  # tar 끝 마커(1024 zero bytes)와 gzip 트레일러(CRC+ISIZE)를 **둘 다** 남긴다
  # (ProjectExporter/MeetingExporter#close_tar_then_gz 와 동일한 형태).
  #
  # ⚠️ tar.close 가 raise 하면 같은 ensure 안의 gz.finish 가 건너뛰어져 gzip 트레일러
  # 없는 스트림이 남는다(GzipReader 가 "unexpected end of file"). 그래서 close 실패를
  # 일단 잡아 gz.finish 를 보장한 뒤 다시 올린다. 다만 이미 진행 중인 예외가 있으면
  # 그쪽이 원인이므로 덮어쓰지 않는다(삼키면 잘린 아카이브가 200 으로 나간다).
  def close_tar_then_gz(tar, gz, pending_error: nil)
    close_error = nil
    begin
      # TarWriter#close 는 idempotent 하지 않다(check_closed → IOError) → closed? 가드.
      tar.close if tar && !tar.closed?
    rescue StandardError => e
      close_error = e
      Rails.logger.warn("FolderExporter: tar close failed: #{e.class}: #{e.message}")
    end

    # TarWriter#close 가 gz 를 닫지 않으므로 직접 finish. (io 는 호출자 소유)
    gz.finish if gz

    raise close_error if close_error && pending_error.nil?
  end

  def app_version
    @app_version ||= begin
      file = Rails.root.join("..", "VERSION")
      File.exist?(file) ? File.read(file).strip : nil
    rescue StandardError
      nil
    end
  end
end
