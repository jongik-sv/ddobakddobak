module Api
  module V1
    module Admin
      # STT 오인식 기록 — 목록·검색·상태 변경(confirmed 면 도메인 등록).
      class SttMisrecognitionsController < ApplicationController
        include SttTermLearningJson

        LIST_LIMIT = 500
        MAX_MEETING_IDS = 20

        before_action :authenticate_user!
        before_action :require_stt_learning_manager!
        before_action :set_misrecognition, only: %i[update]

        # GET /api/v1/admin/stt_term_learning/misrecognitions?status=&q=&project_id=
        def index
          base = ::SttMisrecognition.where(project_id: scoped_project_id || visible_project_ids)
          scope = base
          scope = scope.where(status: params[:status]) if params[:status].present?
          if params[:q].present?
            pat = "%#{::SttMisrecognition.sanitize_sql_like(params[:q].to_s)}%"
            scope = scope.where("stt_misrecognitions.wrong LIKE ? ESCAPE '\\' OR stt_misrecognitions.correct LIKE ? ESCAPE '\\'",
                                pat, pat)
          end
          records = scope.includes(:project, last_meeting: [ :project, :folder ])
                         .order(Arel.sql("stt_misrecognitions.last_seen_at IS NULL"), last_seen_at: :desc, id: :desc)
                         .limit(LIST_LIMIT).to_a
          @latest_items = latest_items(records.map(&:id))
          @meeting_ids = meeting_ids_by_record(records.map(&:id))
          render json: {
            misrecognitions: records.map { |r| misrecognition_json(r) },
            counts: { total: base.count, undecided: base.undecided.count }
          }
        end

        # PATCH /api/v1/admin/stt_term_learning/misrecognitions/:id { status, correct? }
        # confirmed 로 바꾸면 ManualRegistration.register_pair! 로 등록한다(last_meeting 이 있으면 그 회의 체인,
        # 없으면 프로젝트 → 전역 체인). correct 변경과 등록은 한 트랜잭션이라 등록 실패 시 함께 롤백된다.
        def update
          status = params[:status].to_s
          unless ::SttMisrecognition::STATUSES.include?(status)
            return render json: { error: "올바르지 않은 상태입니다: #{status}" }, status: :unprocessable_entity
          end

          registered = nil
          ::ActiveRecord::Base.transaction do
            # 제외: 자동으로 넣었던 변형이 프롬프트에 계속 남지 않게, 바꾸기 전(correct 변경 전) 등록 위치에서 뺀다.
            exclude_registered_variant!(@record) if status == "excluded"
            if params.key?(:correct)
              correct = params[:correct].to_s.strip
              raise ::SttTermLearning::ManualRegistration::Error, "올바른 용어가 비어 있습니다" if correct.blank?
              @record.update!(correct: correct, correct_key: ::DomainFile.normalize_key(correct))
            end
            if status == "confirmed"
              r = ::SttTermLearning::ManualRegistration.register_pair!(@record, actor: current_user)
              # already_known 은 아무것도 쓰지 않았다 — 권한을 따지지 않는다.
              if r[:verdict] != "already_known"
                forbid_global_write! if r[:level]&.global? # 전역 줄에 합쳐졌다면(비 시스템 admin) 전체 롤백 후 403
                # 쓰기 권한 없는 파일이면 전체 롤백 후 403(이미 있는 용어에 합치려던 경우는 그 사유를 알린다)
                forbid_file_write!(r[:domain_file], existing_term: r[:verdict] == "merged_existing") if r[:domain_file]
              end
              registered = registered_from_result(r, @record)
            else
              @record.update!(status: status)
            end
          end
          @record.reload
          @latest_items = latest_items([ @record.id ])
          @meeting_ids = meeting_ids_by_record([ @record.id ])
          render json: { misrecognition: misrecognition_json(@record, registered: registered) }
        rescue ::SttTermLearning::ManualRegistration::Error, ActiveRecord::RecordInvalid => e
          render json: { error: e.message }, status: :unprocessable_entity
        rescue ActiveRecord::RecordNotUnique
          render json: { error: "같은 오인식 기록이 이미 있습니다" }, status: :unprocessable_entity
        end

        private

        def set_misrecognition
          @record = ::SttMisrecognition.where(project_id: visible_project_ids).find(params[:id])
        end

        def misrecognition_json(record, registered: nil)
          {
            id: record.id,
            wrong: record.wrong,
            correct: record.correct,
            status: record.status,
            hit_count: record.hit_count,
            meeting_ids: @meeting_ids[record.id] || [],
            registered: registered || registered_location(record),
            last_seen_at: record.last_seen_at
          }
        end

        # { misrecognition_id => 최신 적용(되돌리지 않은) item }
        def latest_items(ids)
          return {} if ids.empty?
          ::SttTermLearningItem.applied_live.where(misrecognition_id: ids).includes(:domain_file).order(id: :desc)
                               .each_with_object({}) { |i, h| h[i.misrecognition_id] ||= i }
        end

        # 그 기록을 만든 회의(item 의 run 회의 + first/last_meeting), 최신 순.
        def meeting_ids_by_record(ids)
          return {} if ids.empty?
          out = Hash.new { |h, k| h[k] = [] }
          ::SttTermLearningItem.joins(:run).where(misrecognition_id: ids).order(id: :desc)
                               .pluck(:misrecognition_id, "stt_term_learning_runs.meeting_id")
                               .each { |mid, meeting_id| out[mid] << meeting_id }
          ::SttMisrecognition.where(id: ids).pluck(:id, :last_meeting_id, :first_meeting_id).each do |id, last_id, first_id|
            out[id].concat([ last_id, first_id ].compact)
          end
          out.transform_values { |v| v.uniq.first(MAX_MEETING_IDS) }
        end

        # 지금 그 쌍이 등록된 위치. ⬆/⬇(moves) 버튼이 쓴다.
        def registered_location(record)
          file, level = registered_entry(record)
          file && location(file, record.correct_key, level)
        end

        # 지금 그 쌍(용어 줄 + 그 오인식 변형)이 있는 [파일, 레벨] | nil.
        #   1) 최신 적용 item 의 파일에 그 용어 줄이 있고 변형도 남아 있으면 거기.
        #   2) 아니면(register_pair! 등록분은 item 이 없다, 또는 이동됨) register_pair! 가 보는 체인을 따라 찾는다.
        def registered_entry(record)
          item = @latest_items[record.id]
          if item&.domain_file && variant_in?(item.domain_file, record)
            level = level_from_owner(item.level_owner_type, item.level_owner_id)
            return [ item.domain_file, level ] if level
          end
          return nil unless item || record.status == "confirmed"

          chain_for(record).each do |level|
            level.linked_files.each do |file|
              return [ file, level ] if variant_in?(file, record)
            end
          end
          nil
        end

        def variant_in?(file, record)
          entry = file.find_term(record.correct_key)
          entry && entry[:mispronunciations].any? { |m| ::DomainFile.normalize_key(m) == record.wrong_key }
        end

        # excluded 로 바꿀 때: 등록 위치(자동·사람 파일)에서 그 변형만 뺀다. 줄은 남긴다.
        # 단 자동 파일 줄이고 변형이 이것 하나뿐이면(이 쌍 때문에 생긴 새 줄) 줄 전체를 지운다.
        def exclude_registered_variant!(record)
          @latest_items = latest_items([ record.id ])
          file, level = registered_entry(record)
          return unless file
          forbid_global_write! if level&.global?
          forbid_file_write!(file, existing_term: true)

          variants = file.find_term(record.correct_key)[:mispronunciations].map { |m| ::DomainFile.normalize_key(m) }.uniq
          if file.stt_auto? && variants == [ record.wrong_key ]
            file.remove_term_line!(record.correct_key)
          else
            file.remove_mispronunciation!(record.correct_key, record.wrong_key)
          end
        end

        def registered_from_result(result, record)
          return nil unless result && result[:domain_file] && result[:level]
          location(result[:domain_file], ::DomainFile.normalize_key(record.correct), result[:level])
        end

        # auto: 자동 파일인가(사람 파일이면 화면이 ⬆ 전에 확인을 묻는다).
        def location(file, term_key, level)
          { domain_file_id: file.id, term_key: term_key, auto: file.stt_auto?, level: level_info(level) }
        end

        # ManualRegistration.register_pair! 와 같은 체인: 같은 프로젝트 last_meeting 이면 그 회의 체인, 아니면 프로젝트 → 전역.
        def chain_for(record)
          meeting = record.last_meeting
          if meeting && meeting.project_id == record.project_id
            ::SttTermLearning::LevelChain.for_meeting(meeting)
          elsif record.project
            ::SttTermLearning::LevelChain.upward_from(::SttTermLearning::Level.for(record.project))
          else
            []
          end
        end
      end
    end
  end
end
