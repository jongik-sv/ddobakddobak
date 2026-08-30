# /api/ext/v1 — 쓰기 액션(create/audio/summarize). meetings:write 스코프 전용.
# 읽기 액션(index/show/transcripts/summary)은 Ext::V1::MeetingsController(Task B) 소유.
class Ext::V1::MeetingWritesController < Ext::V1::BaseController
  include Ext::V1::MeetingWriteAuthorization
  include AudioStorage

  before_action -> { require_scope!("meetings:write") }
  before_action :set_writable_meeting!, only: %i[audio summarize]
  # 절단 가드는 인가 뒤, 잠금 가드 앞(meetings_audio_controller.rb:15-20과 동일 순서 —
  # 영구 거부인 절단이 일시적 409인 잠금에 가려지면 재시도 루프에 갇힌다).
  before_action :reject_if_meeting_redacted!, only: %i[audio summarize]
  before_action :reject_if_meeting_locked!, only: %i[audio summarize]

  # POST /api/ext/v1/meetings — 텍스트 전사 임포트 회의 생성.
  # body: { title, project_id, folder_id?, transcripts:[{speaker_name, content, started_at_ms?, ended_at_ms?}] }
  def create
    project = Project.find_by(id: params[:project_id])
    return render_error(:not_found, "not_found", "프로젝트를 찾을 수 없습니다") unless project
    unless ext_project_authorized?(project, current_api_user)
      return render_error(:forbidden, "forbidden", "이 프로젝트의 멤버가 아닙니다")
    end
    if api_token.project_ids.present? && !api_token.project_ids.include?(project.id)
      return render_error(:forbidden, "forbidden", "이 토큰은 이 프로젝트에 접근할 수 없습니다")
    end

    title = params[:title].to_s.strip
    return render_error(:unprocessable_entity, "invalid_title", "title은 필수입니다") if title.blank?

    folder, rendered = resolve_create_folder(project)
    return if rendered

    transcripts_param = params[:transcripts]
    transcripts_param = [] if transcripts_param.nil?
    unless transcripts_param.is_a?(Array)
      return render_error(:unprocessable_entity, "invalid_transcripts", "transcripts는 배열이어야 합니다")
    end
    normalized_transcripts, item_error = normalize_transcript_items(transcripts_param)
    return render_error(:unprocessable_entity, "invalid_transcripts", item_error) if item_error

    meeting = nil
    ActiveRecord::Base.transaction do
      # status: 브리프의 "완료 의미의 값" — Meeting.status enum(pending/recording/transcribing/
      # completed) 중 텍스트 전사를 통째로 들고 오는 이 경로에 대응하는 값은 completed뿐이다.
      # source: enum이 live/upload 둘뿐이라(§51) 실황 녹음이 아닌 이 경로는 upload로 정규화한다
      # (upload_audio 액션과 동일 관례).
      meeting = Meeting.create!(
        title: title,
        created_by_id: current_api_user.id,
        project_id: project.id,
        folder_id: folder&.id,
        status: "completed",
        source: "upload",
        started_at: Time.current,
        ended_at: Time.current
      )
      normalized_transcripts.each_with_index do |attrs, index|
        meeting.transcripts.create!(
          content: attrs[:content],
          speaker_name: attrs[:speaker_name],
          speaker_label: attrs[:speaker_name],
          started_at_ms: attrs[:started_at_ms],
          ended_at_ms: attrs[:ended_at_ms],
          sequence_number: index + 1
        )
      end
    end

    # FTS(transcripts_fts)는 Transcript의 after_save :fts_upsert 콜백이 생성 시점에 자동 처리한다
    # (건별 create!라 insert_all과 달리 콜백이 그대로 탄다) — 수동 재색인 불필요.
    # 임베딩은 Embeddable이 "content 변경 시 무효화"만 하고 최초 생성은 만들지 않으므로
    # (app/models/concerns/embeddable.rb 상단 주석), MeetingImporter#run!과 동일하게 여기서
    # 명시적으로 백필 잡을 건다.
    EmbedBackfillJob.perform_later(meeting_id: meeting.id) if meeting.transcripts.exists?

    audit!("meetings.create", meeting_id: meeting.id)
    render json: { meeting: meeting_create_json(meeting) }, status: :created
  rescue ActiveRecord::RecordInvalid => e
    render_error(:unprocessable_entity, "invalid_meeting", e.record.errors.full_messages.join(", "))
  end

  # POST /api/ext/v1/meetings/:id/audio — 오디오 업로드 → 기존 STT 파이프라인(FileTranscriptionJob).
  # multipart file 필수.
  def audio
    # recording/transcribing 중인 회의는 오디오 채널이 이미 점유돼 있다(라이브 녹음·진행 중인
    # 파일전사) — 그 상태에서 파일 오디오를 덮어쓰면 진행 중인 파이프라인과 충돌한다.
    if @meeting.recording? || @meeting.transcribing?
      return render_error(:unprocessable_entity, "invalid_state", "회의가 녹음·전사 진행 중이라 오디오를 받을 수 없습니다")
    end
    # ⭐ FileTranscriptionJob#store_transcripts(file_transcription_job.rb:164)는 sequence_number를
    # 항상 1부터 새로 매긴다(기존 max에서 이어붙이지 않는다) — 이미 전사가 있는 회의(예: 텍스트
    # 임포트로 만든 completed 회의)에 오디오를 올려 이 잡을 돌리면 중복 sequence_number가 생겨
    # 정렬(default_scope)·bulk_create 멱등키·기밀 절단(shift_remaining_transcripts!)의 전제가
    # 모두 깨진다. purge 후 진행(regenerate_stt와 동일)은 이 엔드포인트의 범위 밖(브리프에
    # 파기 지시 없음)이므로, 더 안전한 쪽인 거부를 택한다 — 전사가 아직 없는 회의만 허용.
    if @meeting.transcripts.exists?
      return render_error(:unprocessable_entity, "invalid_state", "이미 전사가 있는 회의에는 오디오를 첨부할 수 없습니다")
    end

    audio_file = params[:file]
    unless audio_file.is_a?(ActionDispatch::Http::UploadedFile)
      return render_error(:unprocessable_entity, "file_required", "file은 필수입니다")
    end

    audit!("meetings.audio", meeting_id: @meeting.id)

    ext = File.extname(audio_file.original_filename).downcase.presence || ".webm"
    storage_dir = Pathname.new(audio_dir)
    FileUtils.mkdir_p(storage_dir)
    audio_path = storage_dir.join("#{@meeting.id}#{ext}").to_s
    File.open(audio_path, "wb") { |f| f.write(audio_file.read) }

    # MP4/M4A: moov atom을 파일 앞으로 이동(upload_audio 액션과 동일 처리, meetings_controller.rb:174-182).
    if %w[.m4a .mp4 .aac].include?(ext)
      faststart_path = "#{audio_path}.faststart#{ext}"
      if system("ffmpeg", "-y", "-i", audio_path, "-c", "copy", "-movflags", "+faststart", faststart_path, out: File::NULL, err: File::NULL)
        FileUtils.mv(faststart_path, audio_path)
      else
        FileUtils.rm_f(faststart_path)
      end
    end

    @meeting.set_audio_file!(audio_path)
    @meeting.update!(status: :transcribing, source: "upload", started_at: @meeting.started_at || Time.current)
    FileTranscriptionJob.perform_later(@meeting.id)

    render json: { meeting: { id: @meeting.id, status: @meeting.status } }, status: :accepted
  end

  # POST /api/ext/v1/meetings/:id/summarize — 요약 재생성 트리거(MeetingSummarizationJob).
  # meetings_controller.rb#summarize와 동일 잡·동일 분기(pending/no-transcripts/final-vs-realtime)를
  # 재사용하되, summarizing?(진행 중) 이면 409로 조기 반환한다(중복 실행 방지 — 내부 API는
  # limits_concurrency로 잡 자체가 막지만, ext API는 그 전에 명시적 409로 알린다).
  def summarize
    if @meeting.summarizing?
      return render_error(:conflict, "summary_in_progress", "요약이 이미 진행 중입니다")
    end

    audit!("meetings.summarize", meeting_id: @meeting.id)

    # pending(아직 시작 안 함)은 내부 API와 동일하게 422 — "아직 요약할 회의가 아님"은 재시도로
    # 안 낫는 상태 오류이지 202(수리 접수) 대상이 아니다. summarize 외 나머지(스킵·정상 enqueue)는
    # 브리프 §34가 명시한 202로 통일한다.
    if @meeting.pending?
      return render_error(:unprocessable_entity, "not_started", "회의가 아직 시작되지 않았습니다")
    end
    unless @meeting.transcripts.exists?
      return render json: { ok: true, skipped: "no_transcripts" }, status: :accepted
    end

    summary_type = @meeting.completed? ? "final" : "realtime"
    MeetingSummarizationJob.perform_later(@meeting.id, type: summary_type)
    render json: { ok: true }, status: :accepted
  end

  private

  def ext_project_authorized?(project, user)
    (user.respond_to?(:admin?) && user.admin? && !project.blocks_admin_override?(user)) || project.member?(user)
  end

  # folder_id 검증: (a) 존재해야(아니면 422 — meetings_controller.rb#folder_in_project?는 "존재하지
  # 않으면 belongs_to에 맡긴다"지만, 여기서는 folder&.id로 이미 nil 정규화해 넘기므로 belongs_to가
  # 검증할 기회 자체가 없다 — 검증하지 않으면 존재하지 않는 folder_id가 조용히 폐기되고 폴더 없이
  # 201이 나간다. 그래서 존재 여부를 이 메서드가 직접 422로 거부한다),
  # (b) 프로젝트 소속이어야(아니면 422 — 다른 프로젝트 폴더 지정 차단),
  # (c) 토큰이 folder_ids로 제한돼 있으면 그 서브트리 안이어야(아니면 403 — scoped_meetings와
  # 동일 확장 규칙. 벗어난 폴더로 만들면 만든 본인 토큰으로도 그 회의를 다시 조회할 수 없다).
  # @return [Array(Folder|nil, Boolean)] [폴더, 이미 render했는가]
  def resolve_create_folder(project)
    return [ nil, false ] if params[:folder_id].blank?

    folder = Folder.find_by(id: params[:folder_id])
    unless folder
      render_error(:unprocessable_entity, "invalid_folder", "존재하지 않는 folder_id입니다")
      return [ nil, true ]
    end

    if folder.project_id != project.id
      render_error(:unprocessable_entity, "invalid_folder", "다른 프로젝트의 폴더로는 지정할 수 없습니다")
      return [ nil, true ]
    end

    if api_token.folder_ids.present?
      allowed = Folder.where(id: api_token.folder_ids).flat_map(&:subtree_ids).uniq
      unless allowed.include?(folder.id)
        render_error(:forbidden, "forbidden", "이 토큰은 이 폴더에 접근할 수 없습니다")
        return [ nil, true ]
      end
    end

    [ folder, false ]
  end

  # transcripts 배열의 각 항목을 검증·정규화한다.
  # - speaker_name·content는 필수(공백만이면 거부).
  # - started_at_ms/ended_at_ms: 스키마상 NOT NULL(transcripts.started_at_ms/ended_at_ms)이라
  #   기본값이 필요하다. 둘 다 주어지면 그대로 쓰고, 하나라도 없으면 "직전 항목 종료 시각부터
  #   1초짜리 발언"으로 합성해 이어붙인다(cursor) — 문서 전체가 항목 수만큼의 연속 타임라인을
  #   갖게 되어, 다운스트림(요약 시간대 라벨 등)이 기대하는 "겹치지 않고 증가하는 ms" 불변식을
  #   지킨다.
  # @return [Array(Array<Hash>, String|nil)] [정규화 배열, 에러 메시지(있으면 배열은 nil)]
  def normalize_transcript_items(items)
    cursor_ms = 0
    normalized = []
    items.each_with_index do |raw, index|
      unless raw.respond_to?(:[])
        return [ nil, "transcripts[#{index}]가 올바르지 않습니다" ]
      end

      speaker_name = raw[:speaker_name].to_s.strip
      return [ nil, "transcripts[#{index}].speaker_name은 필수입니다" ] if speaker_name.blank?

      content = raw[:content].to_s
      return [ nil, "transcripts[#{index}].content은 필수입니다" ] if content.blank?

      started_raw = raw[:started_at_ms]
      ended_raw = raw[:ended_at_ms]
      if started_raw.present? && ended_raw.present?
        started_ms = started_raw.to_i
        ended_ms = ended_raw.to_i
      else
        started_ms = cursor_ms
        ended_ms = cursor_ms + 1000
      end
      cursor_ms = ended_ms

      normalized << { speaker_name: speaker_name, content: content, started_at_ms: started_ms, ended_at_ms: ended_ms }
    end
    [ normalized, nil ]
  end

  def meeting_create_json(meeting)
    {
      id: meeting.id,
      title: meeting.title,
      status: meeting.status,
      project_id: meeting.project_id,
      folder_id: meeting.folder_id,
      created_at: meeting.created_at.iso8601
    }
  end
end
