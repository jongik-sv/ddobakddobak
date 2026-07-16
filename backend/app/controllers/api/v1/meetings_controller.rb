module Api
  module V1
    class MeetingsController < ApplicationController
      include MeetingLookup
      include MeetingSerializable
      include TranscriptSerializable
      include AudioStorage
      include MeetingWriteGuard
      include RecorderConflictGuard
      include ProjectScoped

      before_action :authenticate_user!
      before_action :require_create_project!, only: %i[create upload_audio]
      before_action :set_meeting, only: %i[show update destroy start stop reopen pause resume reset_content summarize summary transcripts export export_prompt feedback update_notes regenerate_stt regenerate_notes re_diarize glossary reapply_glossary apply_glossary_entry lock unlock dismiss_schedule]
      before_action :authorize_meeting_control!, only: %i[update start stop reopen pause resume reset_content summarize update_notes regenerate_stt regenerate_notes re_diarize feedback reapply_glossary apply_glossary_entry dismiss_schedule]
      before_action :authorize_lock!, only: %i[lock unlock]
      # 잠긴 회의 변조 차단. lock/unlock 은 제외(아니면 영원히 못 풂). create/upload_audio/index/show/move_to_folder/scheduled 제외.
      before_action :reject_if_locked!, only: %i[update destroy start stop reopen pause resume reset_content summarize regenerate_stt re_diarize regenerate_notes update_notes feedback reapply_glossary apply_glossary_entry dismiss_schedule]
      # 단일 녹음 기기 락: 활성 recording 회의의 제어는 점유 기기에서만(다른 기기는 409).
      # start 는 원자 전이(액션 본문)가 충돌을 처리하므로 여기 목록엔 없다.
      # reset_content 는 활성 녹음(recording && 신선 하트비트)을 다른 기기가 초기화하지 못하게
      # 가드한다. 같은 기기·비녹음(pending/completed) 회의는 통과, stale 이면 heal 후 통과.
      before_action :reject_if_recorder_conflict!, only: %i[stop reopen pause resume reset_content]
      # 멈춘 화자분리-재실행 자가복구: 조회/재실행 시 stale 면 completed 로 되돌려 버튼이 다시 보이게 함
      before_action -> { @meeting&.heal_stale_re_diarize! }, only: %i[show re_diarize]
      # 비정상 종료(크래시/강제종료)로 recording 에 고정된 회의 자가복구: 조회 시 presence 부재면 종결.
      before_action -> { @meeting&.heal_stale_recording! }, only: %i[show]

      def index
        scope = Meeting.accessible_by(current_user)
                       .search_with_summary(params[:q])
                       .created_after(params[:date_from])
                       .created_before(params[:date_to])

        scope = scope.where(project_id: params[:project_id]) if params[:project_id].present?

        if params.key?(:folder_id)
          if params[:folder_id] == "null"
            scope = scope.where(folder_id: nil)
          else
            scope = scope.where(folder_id: params[:folder_id])
          end
        end

        # 중요 플래그 필터: show_all 이 truthy 가 아니면 기본 목록을 큐레이션한다.
        # 완료 회의만 important 필터로 거르고, 예약(pending)·진행중(recording/transcribing)은
        # important=false 라도 항상 노출한다 (방금 만든 회의/예약 회의가 기본 목록에서 사라지는 혼동 방지).
        # 검색·날짜·폴더·프로젝트 조건과는 AND 로 함께 적용된다.
        unless ActiveModel::Type::Boolean.new.cast(params[:show_all])
          scope = scope.where("meetings.important = ? OR meetings.status != ?", true, "completed")
        end

        # 사용자가 보는(접근가능·필터적용된) 녹음중 회의 중 비정상 종료된 것을 자가복구.
        # created_by 한정은 타신분 생성 stuck 회의(#213)를 놓쳤음 → 보이는 것 기준으로 청소.
        # recording 회의는 소수라 비용 작음. status_counts/페이지보다 먼저 실행해 카운트·뱃지 일관.
        scope.where(status: :recording).find_each(&:heal_stale_recording!)

        # 상태별 카운트는 status 필터 적용 전 스코프에서 계산 (탭 선택과 무관하게 정확)
        status_counts = scope.group(:status).count

        # 예약된 pending 회의 수 (대시보드 "대기중 = pending - scheduled_count", "예약중 = scheduled_count" 분리용).
        # status_counts 와 동일한 큐레이션 스코프 기준이라 일관. 별도 키로만 추가(status_counts 오염 금지).
        scheduled_count = scope.scheduled.pending.count

        # total은 status_counts에서 파생 — 별도 COUNT 쿼리(비싼 search/date WHERE 재실행) 제거.
        # by_status는 scope에 where(status:)만 더하므로 동일 집합이고, status는 NOT NULL이라
        # 필터 없을 때 그룹 합 == 전체. 값은 meetings.count와 동일.
        total = params[:status].present? ? (status_counts[params[:status]] || 0) : status_counts.values.sum

        meetings = scope.by_status(params[:status])
                        .includes(:creator, :tags, :meeting_attachments)
                        .order(created_at: :desc)
                        .limit(pagination_per)
                        .offset((pagination_page - 1) * pagination_per)

        render json: {
          meetings: meetings.map { |m| meeting_json(m) },
          meta: { total: total, page: pagination_page, per: pagination_per, status_counts: status_counts, scheduled_count: scheduled_count }
        }
      end

      # GET /api/v1/meetings/scheduled — 클라이언트 스케줄러 폴링용.
      # 접근가능 + 예약 + pending + 미dismiss 회의를 시간창 없이 반환한다(임박·놓침 모두).
      # 각 회의에 missed 플래그를 파생한다 — 예약 시각이 트리거 유예(SCHEDULE_TRIGGER_GRACE)까지
      # 지났을 때만 true. 유예 안은 아직 스케줄러가 자동시작을 시도하는 구간이라 missed 가 아니다.
      def scheduled
        missed_before = Meeting::SCHEDULE_TRIGGER_GRACE.ago
        meetings = Meeting.accessible_by(current_user)
                          .scheduled.pending.where(schedule_dismissed_at: nil)
                          .includes(:creator, :tags, :meeting_attachments)
                          .order(:scheduled_start_time)

        render json: {
          meetings: meetings.map { |m| meeting_json(m).merge(missed: m.scheduled_start_time < missed_before) }
        }
      end

      def create
        meeting = Meeting.new(
          title: params[:title],
          created_by_id: current_user.id,
          meeting_type: params[:meeting_type] || "general",
          folder_id: params[:folder_id],
          project_id: @create_project.id,
          shared: params.key?(:shared) ? ActiveModel::Type::Boolean.new.cast(params[:shared]) : true,
          previous_meeting_id: accessible_previous_meeting_id(params[:previous_meeting_id], params[:folder_id].presence&.to_i),
          **summary_options_for_create,
          **scheduling_attrs_for_create
        )
        apply_explicit_importance!(meeting)

        if meeting.save
          render json: { meeting: meeting_json(meeting) }, status: :created
        else
          render json: { errors: meeting.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def upload_audio
        audio_file = params[:audio]
        return render json: { error: "오디오 파일이 필요합니다" }, status: :unprocessable_entity unless audio_file.is_a?(ActionDispatch::Http::UploadedFile)

        # 파일 확장자 추출
        ext = File.extname(audio_file.original_filename).downcase.presence || ".webm"

        meeting = Meeting.new(
          title: params[:title].presence || "업로드된 회의",
          created_by_id: current_user.id,
          meeting_type: params[:meeting_type] || "general",
          folder_id: params[:folder_id],
          project_id: @create_project.id,
          previous_meeting_id: accessible_previous_meeting_id(params[:previous_meeting_id], params[:folder_id].presence&.to_i),
          shared: params.key?(:shared) ? ActiveModel::Type::Boolean.new.cast(params[:shared]) : true,
          status: :transcribing,
          source: "upload",
          started_at: Time.current,
          **summary_options_for_create
        )
        apply_explicit_importance!(meeting)
        meeting.save!

        storage_dir = Pathname.new(audio_dir)
        FileUtils.mkdir_p(storage_dir)
        audio_path = storage_dir.join("#{meeting.id}#{ext}").to_s

        File.open(audio_path, "wb") do |f|
          f.write(audio_file.read)
        end

        # MP4/M4A: moov atom을 파일 앞으로 이동하여 브라우저 스트리밍 재생 지원
        if %w[.m4a .mp4 .aac].include?(ext)
          faststart_path = "#{audio_path}.faststart#{ext}"
          if system("ffmpeg", "-y", "-i", audio_path, "-c", "copy", "-movflags", "+faststart", faststart_path, out: File::NULL, err: File::NULL)
            FileUtils.mv(faststart_path, audio_path)
          else
            FileUtils.rm_f(faststart_path)
          end
        end

        meeting.set_audio_file!(audio_path)

        # 백그라운드 처리 시작
        FileTranscriptionJob.perform_later(meeting.id)

        render json: { meeting: meeting_json(meeting) }, status: :created
      end

      def show
        render json: { meeting: meeting_json(@meeting, full: true) }
      end

      def update
        attrs = {}
        attrs[:title] = params[:title] if params.key?(:title)
        attrs[:folder_id] = params[:folder_id] if params.key?(:folder_id)
        attrs[:meeting_type] = params[:meeting_type] if params.key?(:meeting_type)
        attrs[:memo] = params[:memo] if params.key?(:memo)
        attrs[:brief_summary] = params[:brief_summary] if params.key?(:brief_summary)
        attrs[:attendees] = params[:attendees] if params.key?(:attendees)
        attrs[:expected_participants] = params[:expected_participants].presence&.to_i if params.key?(:expected_participants)
        attrs[:summary_verbosity] = params[:summary_verbosity] if params.key?(:summary_verbosity)
        if params.key?(:summary_interval_sec)
          # 음이 아닌 정수(문자열/숫자)만 반영. ""/null/음수/비숫자는 무시 — NOT NULL 컬럼이라 500 방지.
          interval = params[:summary_interval_sec]
          attrs[:summary_interval_sec] = interval.to_i if interval.to_s.match?(/\A\d+\z/)
        end
        attrs[:important] = ActiveModel::Type::Boolean.new.cast(params[:important]) if params.key?(:important)
        if params.key?(:summary_restructure)
          # cast 가 nil 을 주는 입력(""/null)은 무시 — NOT NULL 컬럼이라 500 으로 터진다
          restructure = ActiveModel::Type::Boolean.new.cast(params[:summary_restructure])
          attrs[:summary_restructure] = restructure unless restructure.nil?
        end
        # shared 변경은 소유자/admin 만 가능 (비소유 host 의 toggle 무시)
        attrs[:shared] = ActiveModel::Type::Boolean.new.cast(params[:shared]) if params.key?(:shared) && @meeting.editable_by?(current_user)
        # 이전 회의 참고: 접근 가능 + 같은 폴더만 허용. 빈 값/비접근/타폴더는 nil(해제)로 정규화.
        # 같은 요청에서 폴더도 옮기면 옮긴 폴더 기준, 아니면 현재 폴더 기준.
        if params.key?(:previous_meeting_id)
          target_folder = params.key?(:folder_id) ? params[:folder_id].presence&.to_i : @meeting.folder_id
          attrs[:previous_meeting_id] = accessible_previous_meeting_id(params[:previous_meeting_id], target_folder)
        end

        if params.key?(:tag_ids)
          tag_ids = Array(params[:tag_ids]).map(&:to_i)
          @meeting.tag_ids = tag_ids
        end

        # 예약 필드는 pending 회의에서만 편집 가능. 비pending(녹음중/완료 등)은 조용히 무시한다
        # — 이미 시작/종료된 회의에 stray scheduled_start_time 을 심어 자동시작 대상이 되는 것 방지.
        # create 의 parse/normalize 헬퍼를 재사용한다(중복 구현 금지).
        if @meeting.status == "pending" && params.key?(:scheduled_start_time)
          st = parse_scheduled_start_time(params[:scheduled_start_time])
          attrs[:scheduled_start_time] = st
          if st.nil?
            # 예약 해제: 부속 필드(모드·반복 규칙)도 함께 정리한다.
            attrs[:auto_start_mode] = nil
            attrs[:recurrence_rule] = nil
          else
            attrs[:auto_start_mode] = params[:auto_start_mode].presence if params.key?(:auto_start_mode)
            attrs[:recurrence_rule] = normalize_recurrence_rule(params[:recurrence_rule]) if params.key?(:recurrence_rule)
          end
          # 예약 시각 변경(설정·해제 모두): 놓침/닫힘 상태를 리셋해 다시 스케줄 대상이 되게 한다.
          attrs[:schedule_dismissed_at] = nil
        end

        if @meeting.update(attrs)
          render json: { meeting: meeting_json(@meeting) }
        else
          render json: { errors: @meeting.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def move_to_folder
        meeting_ids = params[:meeting_ids]
        return render json: { error: "meeting_ids is required" }, status: :unprocessable_entity if meeting_ids.blank?

        # 잠긴 회의가 하나라도 포함되면 일괄 이동 자체를 차단한다(부분 적용 방지).
        if Meeting.where(id: meeting_ids).where.not(locked_at: nil).exists?
          return render json: { error: "잠긴 회의입니다. 잠금을 해제한 뒤 다시 시도하세요." }, status: :forbidden
        end

        # 교차 프로젝트 이동 차단(권한 상승 방지): 대상 폴더의 프로젝트와 다른 프로젝트의
        # 회의를 그 폴더로 옮기려는 시도를 거부한다. editable_by 범위 내에서만 검사한다.
        if params[:folder_id].present?
          target = Folder.find_by(id: params[:folder_id])
          return render json: { error: "폴더를 찾을 수 없습니다" }, status: :not_found unless target
          if Meeting.editable_by(current_user).where(id: meeting_ids).where.not(project_id: target.project_id).exists?
            return render json: { error: "다른 프로젝트의 폴더로는 이동할 수 없습니다" }, status: :forbidden
          end
        end

        # update_all 은 콜백·인가를 우회하므로 editable_by 스코프가 유일한 방어선이다.
        # (남의 공유 회의를 일괄 폴더이동하는 것을 막는다.)
        meetings = Meeting.editable_by(current_user).where(id: meeting_ids)
        meetings.update_all(folder_id: params[:folder_id])
        render json: { updated: meetings.count }
      end

      def move_to_project
        meeting_ids = Array(params[:meeting_ids]).reject(&:blank?)
        return render json: { error: "meeting_ids is required" }, status: :unprocessable_entity if meeting_ids.blank?

        # 대상 프로젝트 멤버십/admin override 확인(require_project! 재사용: 실패 시 render 후 nil).
        target = require_project!(params[:target_project_id])
        return unless target

        # 잠긴 회의가 하나라도 포함되면 이동 차단(move_to_folder 패턴, 부분 적용 방지).
        if Meeting.where(id: meeting_ids).where.not(locked_at: nil).exists?
          return render json: { error: "잠긴 회의입니다. 잠금을 해제한 뒤 다시 시도하세요." }, status: :forbidden
        end

        # update_all 은 콜백·인가를 우회하므로 editable_by 스코프가 유일한 방어선이다.
        # folder_id: nil — 원본 폴더는 대상 프로젝트에 없으므로 분리(최상위 안착).
        meetings = Meeting.editable_by(current_user).where(id: meeting_ids)
        moved_count = meetings.update_all(project_id: target.id, folder_id: nil)
        render json: { moved: moved_count }
      end

      def destroy
        # 삭제는 소유자/admin 전용 (라이브 host 라도 남의 회의를 삭제할 수 없다).
        return render json: { error: "삭제 권한이 없습니다" }, status: :forbidden unless @meeting.editable_by?(current_user)

        Trash::SoftDeleter.call(@meeting, by: current_user)
        head :no_content
      end

      def start
        now = Time.current
        # pending→recording 원자 전이(heal_stale_recording! 의 원자 전이와 동일 패턴) —
        # 두 기기가 동시에 start 해도 UPDATE 승자 한 기기만 점유(recording_client_id)를 도장한다.
        # update_all 은 콜백·검증 우회(상태 전이엔 불필요) — updated_at 은 수동 갱신.
        changed = Meeting.where(id: @meeting.id, status: "pending").update_all(
          status: "recording",
          started_at: now,
          recording_client_id: current_client_id,
          recording_client_platform: current_client_platform,
          # 시작 직후 침묵으로 stale 오종결되지 않도록 즉시 presence 도장(하트비트 부재 방지).
          recorder_heartbeat_at: now,
          # 잔존 paused_at 정리 — reset_content→start 시퀀스로 "recording+paused" 유령 상태가
          # 남아 자동요약(paused_at: nil 게이트)이 건너뛰고 UI 에 일시정지 배지가 오표시되는 것 방지.
          paused_at: nil,
          updated_at: now
        )
        return render_start_transition_failure("Meeting is not in pending state") if changed.zero?

        @meeting.reload
        # 반복 시리즈: 시작 성공 후 다음 occurrence 를 미리 예약(미래 형제 없을 때만, 멱등).
        @meeting.materialize_next_occurrence! if @meeting.recurring?
        render json: { meeting: meeting_json(@meeting) }
      end

      def stop
        require_meeting_status!(@meeting, :recording?, "Meeting is not in recording state")
        return if performed?

        @meeting.update!(status: :completed, ended_at: Time.current, paused_at: nil)

        # 녹음 단일성 락 해제 (재시작/reopen 시 stale 락 방지)
        RecordingLock.clear(@meeting.id)

        # 참여자에게 녹음 종료 브로드캐스트
        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          { type: "recording_stopped", meeting_id: @meeting.id }
        )

        # 사용자가 최종 요약을 건너뛰었거나(skip_summary) 라이브 기록이 없으면 요약 job 미enqueue.
        skip = params[:skip_summary].to_s == "true"
        if @meeting.transcripts.exists?
          unless skip
            MeetingFinalizerJob.perform_later(@meeting.id)
            MeetingSummarizationJob.perform_later(@meeting.id, type: "final")
          end
          @meeting.reconcile_embeddings!
        end
        render json: { meeting: meeting_json(@meeting) }
      end

      def reopen
        now = Time.current
        # completed→recording 원자 전이 + 점유 기기 재도장 — reopen 한 기기가 새 recorder 다.
        # (기존엔 하트비트만 갱신해 이전 녹음 기기의 recording_client_id 가 남는 비대칭 →
        # 그 기기 외 전부 409 가 되는 락 오염.) 하트비트 도장 이유는 start 와 동일 — 안 찍으면
        # 옛(완료 시점) 하트비트로 다음 show/index 의 heal_stale_recording! 가 즉시 재종결(회귀).
        changed = Meeting.where(id: @meeting.id, status: "completed").update_all(
          status: "recording",
          ended_at: nil,
          recording_client_id: current_client_id,
          recording_client_platform: current_client_platform,
          recorder_heartbeat_at: now,
          # 방어적 정리 — 완료 회의에 paused_at 이 잔존했다면 recording 복귀 시 함께 비운다.
          paused_at: nil,
          updated_at: now
        )
        return render_start_transition_failure("Meeting is not completed") if changed.zero?

        render json: { meeting: meeting_json(@meeting.reload) }
      end

      def pause
        require_meeting_status!(@meeting, :recording?, "Meeting is not in recording state")
        return if performed?

        @meeting.update!(paused_at: Time.current)
        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          { type: "recording_paused", meeting_id: @meeting.id }
        )
        render json: { meeting: meeting_json(@meeting) }
      end

      def resume
        require_meeting_status!(@meeting, :recording?, "Meeting is not in recording state")
        return if performed?

        @meeting.update!(paused_at: nil)
        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          { type: "recording_resumed", meeting_id: @meeting.id }
        )
        render json: { meeting: meeting_json(@meeting) }
      end

      def reset_content
        @meeting.purge_transcription_content!(include_attachments: true)

        FileUtils.rm_f(@meeting.audio_file_path) if @meeting.audio_file_path.present?

        @meeting.update!(
          status: :pending,
          started_at: nil,
          ended_at: nil,
          last_refined_seq: 0,
          audio_file_path: nil,
          audio_duration_ms: nil,
          brief_summary: nil,
          last_reset_at: Time.current,
          last_user_edit_at: nil,
          # 녹음 기기 락 상태도 함께 정리 — 잔존 시 옛 기기가 락을 쥔 채 새 기기가 start 하면
          # 채널 audio_chunk 로 두 소스가 동시 유입하는 이중 녹음 창(window)이 열린다.
          paused_at: nil,
          recording_client_id: nil,
          recording_client_platform: nil,
          recorder_heartbeat_at: nil
        )

        # 인프로세스 락 해제(stop·heal_stale_recording! 과 동일) — 옛 기기 커넥션의 잔존 락 청소.
        RecordingLock.clear(@meeting.id)

        ActionCable.server.broadcast(@meeting.transcription_stream, {
          type: "meeting_reset"
        })

        render json: { meeting: meeting_json(@meeting) }
      end

      def summarize
        if @meeting.pending?
          render json: { error: "Meeting has not started yet" }, status: :unprocessable_entity
          return
        end

        unless @meeting.transcripts.exists?
          render json: { ok: true, skipped: "no_transcripts" }
          return
        end

        summary_type = @meeting.completed? ? "final" : "realtime"
        MeetingSummarizationJob.perform_later(@meeting.id, type: summary_type)
        render json: { ok: true }
      end

      def regenerate_stt
        # pending도 허용: 전사 실패 시 rescue가 pending+트랜스크립트 0건으로 리셋하므로
        # completed만 허용하면 실패한 회의를 UI/API 어디서도 복구할 수 없다
        unless @meeting.completed? || @meeting.pending?
          return render json: { error: "녹음/전사 진행 중에는 재생성할 수 없습니다" }, status: :unprocessable_entity
        end

        unless @meeting.audio_file_path.present? && File.exist?(@meeting.audio_file_path)
          return render json: { error: "오디오 파일이 없습니다" }, status: :unprocessable_entity
        end

        @meeting.purge_transcription_content!

        @meeting.update!(status: :transcribing, transcription_progress: 0, last_refined_seq: 0)
        FileTranscriptionJob.perform_later(@meeting.id)

        render json: { meeting: meeting_json(@meeting) }
      end

      def re_diarize
        unless @meeting.completed?
          return render json: { error: "완료된 회의에서만 화자분리를 재실행할 수 있습니다" }, status: :unprocessable_entity
        end
        unless @meeting.transcripts.exists?
          return render json: { error: "트랜스크립트가 없습니다" }, status: :unprocessable_entity
        end
        unless @meeting.audio_file_path.present? && File.exist?(@meeting.audio_file_path)
          return render json: { error: "오디오 파일이 없습니다" }, status: :unprocessable_entity
        end

        @meeting.update!(status: :transcribing, transcription_progress: 0, re_diarize_started_at: Time.current)
        ReDiarizeJob.perform_later(@meeting.id)
        render json: { meeting: meeting_json(@meeting) }
      end

      def regenerate_notes
        if @meeting.pending?
          return render json: { error: "아직 시작되지 않은 회의입니다" }, status: :unprocessable_entity
        end
        unless @meeting.transcripts.exists?
          return render json: { error: "트랜스크립트가 없습니다" }, status: :unprocessable_entity
        end

        @meeting.summaries.destroy_all
        @meeting.action_items.where(ai_generated: true).destroy_all
        @meeting.decisions.where(ai_generated: true).destroy_all

        MeetingSummarizationJob.perform_later(@meeting.id, type: "final")
        MeetingFinalizerJob.perform_later(@meeting.id)
        render json: { ok: true }
      end

      def summary
        summary = @meeting.active_summary

        if summary
          render json: serialize_summary_hash(summary)
        else
          render json: { key_points: [], decisions: [], discussion_details: [], action_items: [] }
        end
      end

      def feedback
        corrections = params[:corrections]
        return render json: { error: "Corrections are required" }, status: :unprocessable_entity if corrections.blank?

        corrections = corrections.map { |c| { from: c[:from].to_s, to: c[:to].to_s } }
                                 .reject { |c| c[:from].blank? }
        return render json: { error: "No valid corrections provided" }, status: :unprocessable_entity if corrections.empty?

        before_active_notes = @meeting.current_notes_markdown.to_s

        entries = corrections.map { |c| { from: c[:from], to: c[:to], match_type: "literal" } }
        corrected_count = MeetingGlossaryApplier.new(@meeting, entries).apply_all!
        @meeting.reconcile_embeddings!

        # D2=A: 적용한 교정을 회의 사전에 자동 영속(upsert). best-effort.
        persist_corrections_to_meeting_glossary(corrections)

        corrected_notes = @meeting.reload.current_notes_markdown.to_s
        if corrected_notes != before_active_notes
          @meeting.update!(last_user_edit_at: Time.current)
          @meeting.refresh_brief_summary!(corrected_notes)
          ActionCable.server.broadcast(@meeting.transcription_stream, {
            type: "meeting_notes_update",
            notes_markdown: corrected_notes
          })
        end

        render json: { notes_markdown: corrected_notes, corrected_transcripts: corrected_count }
      end

      def glossary
        folder = @meeting.folder
        render json: {
          meeting: { entries: @meeting.glossary_entries.order(:id).map { |e| glossary_entry_json(e) } },
          folder: folder && {
            folder: { id: folder.id, name: folder.name },
            entries: folder.glossary_entries.order(:id).map { |e| glossary_entry_json(e) }
          },
          ancestors: (folder ? folder.ancestor_records : []).map do |f|
            { folder: { id: f.id, name: f.name },
              entries: f.glossary_entries.order(:id).map { |e| glossary_entry_json(e) } }
          end,
          resolved: GlossaryResolver.for(@meeting)
        }
      end

      def reapply_glossary
        entries = GlossaryResolver.for(@meeting)
        before_active_notes = @meeting.current_notes_markdown.to_s
        corrected_count = MeetingGlossaryApplier.new(@meeting, entries).apply_all!
        @meeting.reconcile_embeddings!

        corrected_notes = @meeting.reload.current_notes_markdown.to_s
        if corrected_notes != before_active_notes
          @meeting.update!(last_user_edit_at: Time.current)
          @meeting.refresh_brief_summary!(corrected_notes)
          ActionCable.server.broadcast(@meeting.transcription_stream, {
            type: "meeting_notes_update",
            notes_markdown: corrected_notes
          })
        end

        render json: { notes_markdown: corrected_notes, corrected_transcripts: corrected_count }
      end

      def apply_glossary_entry
        entry = GlossaryEntry.find_by(id: params[:entry_id])
        unless entry && entry_in_meeting_scope?(entry)
          return render json: { error: "사전 항목을 찾을 수 없습니다" }, status: :not_found
        end
        unless entry.enabled
          return render json: { error: "비활성 항목입니다" }, status: :unprocessable_entity
        end

        payload = [{ from: entry.from_text, to: entry.to_text, match_type: entry.match_type }]
        before_active_notes = @meeting.current_notes_markdown.to_s
        corrected_count = MeetingGlossaryApplier.new(@meeting, payload).apply_all!
        @meeting.reconcile_embeddings!

        corrected_notes = @meeting.reload.current_notes_markdown.to_s
        if corrected_notes != before_active_notes
          @meeting.update!(last_user_edit_at: Time.current)
          @meeting.refresh_brief_summary!(corrected_notes)
          ActionCable.server.broadcast(@meeting.transcription_stream, {
            type: "meeting_notes_update",
            notes_markdown: corrected_notes
          })
        end

        render json: { notes_markdown: corrected_notes, corrected_transcripts: corrected_count }
      end

      def update_notes
        notes_markdown = params[:notes_markdown]
        return render json: { error: "notes_markdown is required" }, status: :unprocessable_entity if notes_markdown.nil?

        client_id = params[:client_id].presence

        summary = find_or_create_active_summary
        summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)
        @meeting.update!(last_user_edit_at: Time.current)
        @meeting.refresh_brief_summary!(notes_markdown)

        ActionCable.server.broadcast(@meeting.transcription_stream, {
          type: "meeting_notes_update",
          notes_markdown: notes_markdown,
          source: "user",
          client_id: client_id
        })

        render json: { notes_markdown: notes_markdown }
      end

      def transcripts
        page     = pagination_page
        per_page = [ (params[:per_page] || 50).to_i, 5000 ].min

        transcripts = @meeting.transcripts
                              .reorder(:started_at_ms)
                              .offset((page - 1) * per_page)
                              .limit(per_page)

        render json: {
          transcripts: transcripts.map { |t| transcript_json(t) },
          page: page,
          per_page: per_page,
          total: @meeting.transcripts.count
        }
      end

      def export
        include_summary    = boolean_param(:include_summary)
        include_memo       = boolean_param(:include_memo)
        include_transcript = boolean_param(:include_transcript)

        if params[:export_format] == "json"
          data = MeetingExportSerializer.new(
            @meeting,
            include_summary:    include_summary,
            include_memo:       include_memo,
            include_transcript: include_transcript
          ).call

          render json: data
        else
          markdown = MarkdownExporter.new(
            @meeting,
            include_summary:    include_summary,
            include_memo:       include_memo,
            include_transcript: include_transcript
          ).call

          filename = "meeting_#{@meeting.id}_#{Date.today}.md"

          send_data markdown,
            type:        "text/markdown; charset=utf-8",
            disposition: "attachment",
            filename:    filename
        end
      end

      def export_prompt
        transcripts = @meeting.transcripts.order(:sequence_number)
        if transcripts.empty?
          return render json: { error: "트랜스크립트가 없습니다" }, status: :unprocessable_entity
        end

        current_notes = @meeting.current_notes_markdown
        payload = Transcript.to_sidecar_payload(transcripts)
        sections_prompt = PromptTemplate.sections_prompt_for(@meeting.meeting_type)

        llm = LlmService.new(llm_config: current_user.effective_llm_config)
        result = llm.build_prompt(
          current_notes, payload,
          meeting_title: @meeting.title,
          sections_prompt: sections_prompt,
          attendees: @meeting.attendees,
          verbosity: @meeting.summary_verbosity,
          restructure: @meeting.summary_restructure
        )

        filename = "prompt_#{@meeting.id}_#{Date.today}.txt"
        send_data result["prompt"],
          type:        "text/plain; charset=utf-8",
          disposition: "attachment",
          filename:    filename
      end

      # POST /api/v1/meetings/:id/lock — 회의를 잠금(완전 읽기전용). 소유자/admin 만(authorize_lock!).
      def lock
        @meeting.update_column(:locked_at, Time.current)
        render json: { meeting: meeting_json(@meeting) }
      end

      # DELETE /api/v1/meetings/:id/lock — 잠금 해제. 소유자/admin 만(authorize_lock!).
      def unlock
        @meeting.update_column(:locked_at, nil)
        render json: { meeting: meeting_json(@meeting) }
      end

      # POST /api/v1/meetings/:id/dismiss_schedule — 놓친/예약 회의 안내 닫기.
      # schedule_dismissed_at 을 채워 scheduled 목록에서 숨긴다. 제어 권한·잠금 가드 적용.
      def dismiss_schedule
        @meeting.update!(schedule_dismissed_at: Time.current)
        render json: { meeting: meeting_json(@meeting) }
      end

      private

      # 잠금/해제 권한: 소유자·admin 만(editable_by?). 라이브 host 라도 잠금은 못 건다.
      def authorize_lock!
        return if @meeting.editable_by?(current_user)

        render json: { error: "권한이 없습니다" }, status: :forbidden
      end

      # 회의가 속할 프로젝트를 멤버십 검증과 함께 해석한다 (meetings.project_id 는 NOT NULL).
      # require_project! 가 project_id 누락(400)·미존재(404)·비멤버(403)를 직접 render 하며 halt 한다.
      # 비멤버가 남의 프로젝트에 회의를 만드는 IDOR 를 차단한다.
      def require_create_project!
        @create_project = require_project!(params[:project_id])
      end

      # 회의 생성 시 important 가 요청에 명시되면 값을 세팅하고 명시 플래그를 켠다.
      # (플래그가 켜져야 before_create :seed_importance_from_folder 가 폴더값으로 덮지 않는다.)
      # 파라미터에 없으면 손대지 않아 폴더 상속이 그대로 동작한다.
      def apply_explicit_importance!(meeting)
        return unless params.key?(:important)
        meeting.important = ActiveModel::Type::Boolean.new.cast(params[:important])
        meeting.important_explicitly_set = true
      end

      # 새 회의 요약 옵션: 파라미터 > 직전 회의 승계 > 기본(standard / 재구조화 ON)
      def summary_options_for_create
        last = Meeting.where(created_by_id: current_user.id).order(created_at: :desc).first
        restructure_param = ActiveModel::Type::Boolean.new.cast(params[:summary_restructure]) # ""/null → nil
        {
          summary_verbosity: params[:summary_verbosity].presence || last&.summary_verbosity || "standard",
          summary_restructure: if restructure_param.nil?
            last.nil? ? true : last.summary_restructure
          else
            restructure_param
          end
        }
      end

      # 예약 회의 생성 속성. 미지정 시 전부 nil — 즉시 회의(기존 경로)와 동일.
      # auto_start_mode 는 inclusion(allow_nil) 검증이라 ""(빈 문자열)는 422 → presence 로 nil 정규화.
      # recurrence_rule 은 JSON 문자열은 그대로, 해시/Parameters 는 .to_json 으로 text 저장.
      def scheduling_attrs_for_create
        {
          scheduled_start_time: parse_scheduled_start_time(params[:scheduled_start_time]),
          auto_start_mode: params[:auto_start_mode].presence,
          recurrence_rule: normalize_recurrence_rule(params[:recurrence_rule])
        }
      end

      def parse_scheduled_start_time(raw)
        return nil if raw.blank?
        Time.zone.parse(raw.to_s)
      rescue ArgumentError, TypeError
        nil
      end

      def normalize_recurrence_rule(raw)
        return nil if raw.blank?
        return raw if raw.is_a?(String)
        # ActionController::Parameters / Hash → JSON 텍스트
        (raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw).to_json
      end

      # 이전 회의 참고 id 정규화: 현재 사용자가 열람 가능 + 대상과 같은 폴더인 회의만 통과.
      # 그 외(빈 값·비접근·다른 폴더)는 nil. 셀렉터가 같은 폴더만 보여주므로 정상 경로는 통과,
      # 위변조·타폴더 id 만 걸러진다. target_folder_id 는 정규화된 정수 또는 nil(루트).
      def accessible_previous_meeting_id(raw, target_folder_id)
        return nil if raw.blank?
        id = raw.to_i
        candidate = Meeting.accessible_by(current_user).find_by(id: id)
        return nil unless candidate && candidate.folder_id == target_folder_id
        id
      end

      def pagination_page
        (params[:page] || 1).to_i
      end

      def pagination_per
        (params[:per] || 20).to_i
      end

      def require_meeting_status!(meeting, status_predicate, error_message)
        return if meeting.public_send(status_predicate)

        render json: { error: error_message }, status: :unprocessable_entity
      end

      # start/reopen 원자 전이 실패(0행) 처리: 리로드 후 다른 기기의 활성 녹음이면 기기 충돌(409),
      # 그 외(이미 completed/transcribing, stale, 같은 기기 중복 요청 등)는 기존 상태 검증 의미(422).
      def render_start_transition_failure(status_error_message)
        @meeting.reload
        return render_recorder_conflict if @meeting.recorder_active? && recorder_conflict?(@meeting)

        render json: { error: status_error_message }, status: :unprocessable_entity
      end

      # "false" 문자열만 false로 해석하고, 파라미터 미전달 시 true 반환
      def boolean_param(key)
        params.fetch(key, "true") != "false"
      end

      def latest_summary_type
        @meeting.completed? ? "final" : "realtime"
      end

      def find_or_create_active_summary
        @meeting.active_summary ||
          @meeting.summaries.build(summary_type: latest_summary_type)
      end

      # 엔트리가 이 회의의 캐스케이드(회의 자신 + 폴더 + 조상 폴더)에 속하는지 검증.
      def entry_in_meeting_scope?(entry)
        return true if entry.owner_type == "Meeting" && entry.owner_id == @meeting.id
        return false unless entry.owner_type == "Folder"
        folder = @meeting.folder
        return false unless folder
        folder_ids = [folder.id, *folder.ancestor_records.map(&:id)]
        folder_ids.include?(entry.owner_id)
      end

      def glossary_entry_json(entry)
        {
          id: entry.id,
          from_text: entry.from_text,
          to_text: entry.to_text,
          match_type: entry.match_type,
          enabled: entry.enabled,
          owner_type: entry.owner_type,
          owner_id: entry.owner_id
        }
      end

      def persist_corrections_to_meeting_glossary(corrections)
        corrections.each do |c|
          next if c[:from] == c[:to]
          entry = @meeting.glossary_entries.find_or_initialize_by(from_text: c[:from], match_type: "literal")
          entry.to_text = c[:to]
          entry.enabled = true
          entry.created_by_id ||= current_user.id
          entry.save # 검증 실패는 조용히 스킵(영속화는 부가 기능)
        end
      end
    end
  end
end
