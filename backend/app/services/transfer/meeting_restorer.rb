module Transfer
  # 회의 1건을 나타내는 Hash + 주입된 의존성에서 새 Meeting 레코드와 모든 자식을 복원한다.
  #
  # MeetingImporter 에 의해 호출되지만, 의존성 주입 구조 덕분에 ProjectImporter 같은
  # 다른 임포터에서도 재사용 가능하다.
  #
  # 사용법:
  #   restorer = Transfer::MeetingRestorer.new(
  #     meeting_hash,
  #     user:                  current_user,
  #     project:               target_project,
  #     file_lookup:           staged_paths_hash,   # entry_name → staged_path (Hash or callable)
  #     folder_id:             folder&.id,           # nil = 루트
  #     previous_meeting_id:   nil,                  # 회의 단건 import 시 항상 nil
  #     tag_resolver:          ->(old_tag_id) { tag_map[old_tag_id] }
  #   )
  #   new_meeting = restorer.restore!
  #   restorer.copied_paths  # 롤백 시 정리할 storage/ 경로 목록
  #
  # 설계 원칙:
  #   - 파일 I/O(복사)만 수행. 트랜잭션 관리는 호출자(MeetingImporter).
  #   - copied_paths 는 외부로 노출해 호출자가 예외 시 정리한다.
  #   - file_lookup 은 Hash 또는 callable 을 허용한다:
  #       Hash    → file_lookup[entry_name]              (enumerate 가능)
  #       callable → file_lookup.call(entry_name)        (enumerate 불가)
  class MeetingRestorer
    attr_reader :copied_paths, :warnings

    # public_uid unique 충돌 시 result 에 담는 경고 메시지(§T6, 스펙 §3.4).
    PUBLIC_UID_CONFLICT_WARNING =
      "D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정".freeze

    # 전사는 회의당 수만 건까지 갈 수 있어 건당 insert 는 SQLite 변수 상한
    # (32766)을 넘길 수 없다. 11컬럼 기준 한 배치가 상한을 넘지 않도록 보수적으로 둔다.
    TRANSCRIPT_INSERT_BATCH_SIZE = 1000

    # @param meeting_hash [Hash]          MeetingSerializer#as_hash 와 동일 구조(문자열 키)
    # @param user [User]                  새 컨텐츠 소유자
    # @param project [Project]            대상 프로젝트
    # @param file_lookup [Hash, #call]    "audio/…" / "attachments/…" 엔트리명 → staged 경로
    # @param folder_id [Integer, nil]     대상 폴더 id. nil = 루트
    # @param previous_meeting_id [Integer, nil]  항상 nil (회의 단건 import)
    # @param tag_resolver [#call]         old_tag_id → Tag (nil 가능)
    def initialize(meeting_hash, user:, project:, file_lookup:, folder_id:,
                   previous_meeting_id: nil, tag_resolver:)
      @m                   = meeting_hash
      @user                = user
      @project             = project
      @file_lookup         = file_lookup
      @folder_id           = folder_id
      @previous_meeting_id = previous_meeting_id
      @tag_resolver        = tag_resolver
      @copied_paths        = []
      @warnings            = []
    end

    # 새 Meeting + 자식 컬렉션을 생성하고 Meeting を 반환한다.
    # 파일 복사(오디오·첨부)도 여기에서 수행.
    # @return [Meeting]
    def restore!
      attrs = sanitize(Meeting, @m)
      guard_public_uid_conflict!(attrs)
      attrs["project_id"]           = @project.id
      attrs["created_by_id"]        = @user.id
      attrs["folder_id"]            = @folder_id
      attrs["previous_meeting_id"]  = @previous_meeting_id
      attrs["locked_at"]            = nil  # locked: false
      attrs["audio_file_path"]      = nil  # 복사 후 채움
      # 라이프사이클 정상화: 복원본은 정적 스냅샷이므로 진행 중 상태를 제거한다.
      # 진행 중 회의가 export 되어 복원될 경우 SummarizationJob 등에 잡히지 않도록 방지.
      attrs["status"]                = "completed"
      attrs["recording_client_id"]   = nil
      attrs["recorder_heartbeat_at"] = nil
      attrs["paused_at"]             = nil

      meeting = Meeting.new(attrs)
      meeting.important_explicitly_set = true  # 폴더값 상속 콜백이 manifest 값을 덮지 않게
      meeting.save!

      copy_audio(meeting)
      restore_children(meeting)

      meeting
    end

    private

    # public_uid unique index 충돌 가드(T6, 스펙 §3.4).
    #
    # 같은 아카이브를 중복 import 하거나 복사 목적으로 import 하면 원본과 동일한
    # public_uid 가 로컬에 이미 존재해 create! 가 RecordNotUnique 로 전체 실패한다.
    # 예외를 잡는 대신 사전 존재 검사(Meeting.exists?)로 충돌을 감지해, 충돌 시
    # public_uid·dflow_synced_at·dflow_url 3필드를 null 로 복원하고 경고를 남긴다.
    # (서버 이동처럼 로컬에 해당 uid 가 없는 정상 케이스는 3필드 그대로 보존된다.)
    def guard_public_uid_conflict!(attrs)
      uid = attrs["public_uid"]
      return if uid.blank?
      return unless Meeting.exists?(public_uid: uid)

      attrs["public_uid"]      = nil
      attrs["dflow_synced_at"] = nil
      attrs["dflow_url"]       = nil
      @warnings << PUBLIC_UID_CONFLICT_WARNING
    end

    # ── 자식 복원 ──

    def restore_children(meeting)
      restore_transcripts(meeting)
      restore_summaries(meeting)
      restore_action_items(meeting)
      restore_decisions(meeting)
      restore_blocks(meeting)
      attachment_map = restore_attachments(meeting)
      restore_contacts(meeting, attachment_map)
      restore_bookmarks(meeting)
      restore_chat_messages(meeting)
      restore_glossary_entries(meeting)
      restore_taggings(meeting)
    end

    # 전사 복원: 건당 create! (35k건 ≈ 73k쿼리·117s) → 배치 insert_all 로 전환.
    # insert_all 주의점:
    #   - 검증·콜백·타임스탬프를 건너뛴다. created_at 을 직접 세팅한다
    #     (transcripts 에는 updated_at 컬럼이 없다 → column_names 로 방어).
    #   - 단일 insert_all 은 SQLite 변수 상한을 넘길 수 있어 배치로 분할한다.
    #   - after_save :fts_upsert 콜백이 건너뛰어지므로 FTS 색인을 벌크로 재구축한다.
    #   - meeting_id 는 새 회의 id 로, id 는 sanitize 가 제거해 DB 가 채운다(create! 와 동일).
    def restore_transcripts(meeting)
      now     = Time.current
      ts_cols = Transcript.column_names
      rows = (@m["transcripts"] || []).map do |t|
        row = sanitize(Transcript, t)
        row["meeting_id"]   = meeting.id
        row["created_at"] ||= now if ts_cols.include?("created_at")
        row["updated_at"] ||= now if ts_cols.include?("updated_at")
        row
      end
      return if rows.empty?

      rows.each_slice(TRANSCRIPT_INSERT_BATCH_SIZE) do |batch|
        Transcript.insert_all(batch)
      end

      reindex_transcripts_fts(meeting)
    end

    # insert_all 은 after_save :fts_upsert 콜백을 건너뛰므로 전사 FTS 색인을 벌크로 재구축.
    # 새로 삽입된 id 라 기존 FTS 행이 없으므로 DELETE 없이 INSERT…SELECT 한 번.
    # fts_upsert 와 동일하게, 색인 실패가 데이터 복원 자체를 중단시키지 않도록 경고만 남긴다.
    def reindex_transcripts_fts(meeting)
      conn = ActiveRecord::Base.connection
      conn.execute(ActiveRecord::Base.sanitize_sql_array([
        "INSERT INTO transcripts_fts(content, speaker_label, speaker_name, source_id) " \
        "SELECT content, speaker_label, speaker_name, id FROM transcripts WHERE meeting_id = ?",
        meeting.id
      ]))
    rescue => e
      Rails.logger.warn("MeetingRestorer: transcripts_fts reindex failed for meeting##{meeting.id}: #{e.message}")
    end

    def restore_summaries(meeting)
      (@m["summaries"] || []).each do |s|
        meeting.summaries.create!(sanitize(Summary, s).merge("meeting_id" => meeting.id))
      end
    end

    def restore_action_items(meeting)
      (@m["action_items"] || []).each do |a|
        attrs = sanitize(ActionItem, a)
        attrs["assignee_id"] = nil  # 범위 밖 유저 참조 제거
        meeting.action_items.create!(attrs.merge("meeting_id" => meeting.id))
      end
    end

    def restore_decisions(meeting)
      (@m["decisions"] || []).each do |d|
        meeting.decisions.create!(sanitize(Decision, d).merge("meeting_id" => meeting.id))
      end
    end

    # blocks: parent_block_id 자기참조 → 2-pass.
    # 1패스: parent_block_id=nil 로 전부 생성. 2패스: update_column 으로 계층 연결.
    def restore_blocks(meeting)
      block_map = {}
      (@m["blocks"] || []).each do |b|
        attrs = sanitize(Block, b)
        new_block = meeting.blocks.create!(attrs.merge(
          "meeting_id"     => meeting.id,
          "parent_block_id" => nil
        ))
        block_map[b["id"]] = new_block
      end
      (@m["blocks"] || []).each do |b|
        old_parent = b["parent_block_id"]
        next if old_parent.nil?
        child  = block_map[b["id"]]
        parent = block_map[old_parent]
        child.update_column(:parent_block_id, parent.id) if child && parent
      end
    end

    # attachments 복원. old_attachment_id → new_attachment 맵을 반환.
    # (contacts 의 source_attachment_id 리맵에 사용)
    def restore_attachments(meeting)
      attachment_map = {}
      (@m["attachments"] || []).each do |a|
        attrs = sanitize(MeetingAttachment, a)
        attrs["uploaded_by_id"] = @user.id
        attrs["file_path"]      = resolve_attachment_path(meeting, a)
        new_att = meeting.meeting_attachments.create!(attrs.merge("meeting_id" => meeting.id))
        attachment_map[a["id"]] = new_att
        # .extracted 디렉토리 복사
        copy_extracted_dir(a["file_path"], attrs["file_path"]) if a["kind"] == "file" && attrs["file_path"]
      end
      attachment_map
    end

    # contacts: source_attachment_id 를 새 첨부 id 로 리맵. (project_importer 는 nil 로 둠)
    def restore_contacts(meeting, attachment_map)
      (@m["contacts"] || []).each do |c|
        attrs = sanitize(MeetingContact, c)
        attrs["created_by_id"]        = @user.id
        old_src = c["source_attachment_id"]
        attrs["source_attachment_id"] = old_src ? attachment_map[old_src]&.id : nil
        meeting.meeting_contacts.create!(attrs.merge("meeting_id" => meeting.id))
      end
    end

    def restore_bookmarks(meeting)
      (@m["bookmarks"] || []).each do |b|
        meeting.meeting_bookmarks.create!(sanitize(MeetingBookmark, b).merge("meeting_id" => meeting.id))
      end
    end

    def restore_chat_messages(meeting)
      (@m["chat_messages"] || []).each do |cm|
        attrs = sanitize(ChatMessage, cm)
        attrs["user_id"] = @user.id
        meeting.chat_messages.create!(attrs.merge("meeting_id" => meeting.id))
      end
    end

    def restore_glossary_entries(meeting)
      (@m["glossary_entries"] || []).each do |g|
        attrs = sanitize(GlossaryEntry, g)
        attrs["owner_type"]    = "Meeting"
        attrs["owner_id"]      = meeting.id
        attrs["created_by_id"] = nil  # 범위 밖 유저 참조 제거
        GlossaryEntry.create!(attrs)
      end
    end

    def restore_taggings(meeting)
      (@m["tag_ids"] || []).each do |old_tag_id|
        tag = @tag_resolver.call(old_tag_id)
        next unless tag
        Tagging.find_or_create_by!(tag: tag, taggable: meeting)
      end
    end

    # ── 파일 복사 ──

    # 오디오: staged 파일을 storage/audio/<새id><ext> 로 복사.
    # staged 가 없으면(include_audio=false 등) audio_file_path=nil 유지.
    def copy_audio(meeting)
      old_id = @m["id"]
      prefix = "audio/#{old_id}."
      entry_name = entry_names_with_prefix(prefix).first
      return unless entry_name

      staged = lookup_file(entry_name)
      return unless staged

      ext = File.extname(entry_name).presence || ".mp3"
      FileUtils.mkdir_p(audio_dir)
      dest = File.join(audio_dir, "#{meeting.id}#{ext}")
      FileUtils.cp(staged, dest)
      @copied_paths << dest
      meeting.update_column(:audio_file_path, dest)
    end

    # 첨부 file_path 결정:
    #   kind=="link" → 원본 file_path 보존(바이트 없음이 정상).
    #   kind=="file" → staged 파일을 storage/attachments/ 로 복사하고 절대경로 반환.
    #                  staged 가 없으면 InvalidArchiveError 로 롤백.
    def resolve_attachment_path(meeting, attr_hash)
      basename = attr_hash["file_path"]
      return basename if attr_hash["kind"] == "link"

      staged = basename.present? ? lookup_file("attachments/#{File.basename(basename)}") : nil
      if staged.nil?
        raise Transfer::Archive::InvalidArchiveError,
              "첨부 파일 바이트가 아카이브에 없습니다: #{basename.inspect}"
      end
      copy_attachment_file(meeting, basename, staged)
    end

    def copy_attachment_file(meeting, basename, staged_path)
      sanitized = File.basename(basename).gsub(/[^\w.\-]/, "_").slice(0, 200)
      FileUtils.mkdir_p(attachments_dir)
      filename = "#{meeting.id}_#{SecureRandom.hex(8)}_#{sanitized}"
      dest = File.join(attachments_dir, filename)
      FileUtils.cp(staged_path, dest)
      @copied_paths << dest
      dest
    end

    # .extracted 디렉토리 내 파일을 새 첨부 경로 옆으로 복사.
    # MeetingAttachment#extraction_dir 규칙: <file_path>.extracted
    def copy_extracted_dir(original_basename, new_file_path)
      return unless original_basename.present? && new_file_path.present?

      base   = File.basename(original_basename)
      prefix = "attachments/#{base}.extracted/"

      entry_names_with_prefix(prefix).each do |entry_name|
        rel    = entry_name.delete_prefix(prefix)
        staged = lookup_file(entry_name)
        next unless staged

        dest = File.join("#{new_file_path}.extracted", rel)
        FileUtils.mkdir_p(File.dirname(dest))
        FileUtils.cp(staged, dest)
        @copied_paths << dest
      end
    end

    # ── file_lookup 유틸 ──

    # Hash 또는 callable 양쪽을 허용한다.
    def lookup_file(entry_name)
      @file_lookup.respond_to?(:call) ? @file_lookup.call(entry_name) : @file_lookup[entry_name]
    end

    # Hash 의 경우에만 prefix 로 엔트리명 열거 가능. callable 이면 빈 배열.
    def entry_names_with_prefix(prefix)
      @file_lookup.respond_to?(:keys) ? @file_lookup.keys.select { |k| k.start_with?(prefix) } : []
    end

    # ── 유틸 ──

    def sanitize(model_class, attrs)
      Transfer::Archive.sanitize(model_class, attrs || {})
    end

    def audio_dir
      @audio_dir ||= ENV.fetch("AUDIO_DIR") { Rails.root.join("storage", "audio").to_s }
    end

    def attachments_dir
      @attachments_dir ||= ENV.fetch("ATTACHMENTS_DIR") { Rails.root.join("storage", "attachments").to_s }
    end
  end
end
