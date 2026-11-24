module Api
  module V1
    module Admin
      # STT 용어 학습 관리자 — 레벨 트리·용어 인덱스·영향 회의 수·이동/삭제·설정.
      class SttTermLearningController < ApplicationController
        include SttTermLearningJson

        SETTINGS_KEYS = %w[enabled idle_minutes min_confidence].freeze

        before_action :authenticate_user!
        before_action :require_admin!

        # GET /api/v1/admin/stt_term_learning/projects — 프로젝트 선택기 옵션(관리자에게 보이는 프로젝트 전부)
        def projects
          list = ::SttTermLearning::AdminScope.projects(current_user).order(:id).map do |p|
            { id: p.id, name: p.name, personal: p.personal }
          end
          render json: { projects: list }
        end

        # GET /api/v1/admin/stt_term_learning/tree?project_id=
        def tree
          render json: ::SttTermLearning::TreeBuilder.new(current_user, project_id: scoped_project_id).call
        end

        # GET /api/v1/admin/stt_term_learning/terms?level_type=&level_id=&include_descendants=1
        def terms
          level = params[:level_type].present? ? level_from_ref(type: params[:level_type], id: params[:level_id]) : nil
          include_descendants = ::ActiveModel::Type::Boolean.new.cast(params[:include_descendants]) || false
          rows = ::SttTermLearning::TermIndex.new(current_user, project_id: scoped_project_id).rows(level: level, include_descendants: include_descendants)
          render json: { terms: rows }
        end

        # POST /api/v1/admin/stt_term_learning/impact { targets: [{ level: LevelRef, domain_file_id? }] }
        def impact
          counts = Array(params[:targets]).map do |t|
            level = level_from_ref(t[:level] || {})
            raise ActiveRecord::RecordNotFound, "레벨이 없습니다" if hidden_level?(level) # 숨김 레벨은 없는 것으로(404)
            ::SttTermLearning::ImpactCounter.count(level, domain_file_id: t[:domain_file_id].presence)
          end
          render json: { counts: counts }
        end

        # POST /api/v1/admin/stt_term_learning/moves { moves: [...] } → { moved, merged } / 422 { error }(전부 롤백)
        def moves
          moves = Array(params[:moves]).map do |m|
            ensure_visible_file!(m[:domain_file_id])
            target = level_from_ref(m[:target] || {})
            raise ::SttTermLearning::TermMover::Error, "이동할 수 없는 레벨입니다" if hidden_level?(target)
            { domain_file_id: m[:domain_file_id], term_keys: m[:term_keys].nil? ? nil : Array(m[:term_keys]).map(&:to_s),
              target: target, copy: m[:copy], merge_descendants: m[:merge_descendants] }
          end
          result = ::SttTermLearning::TermMover.new(actor: current_user).apply!(moves)
          render json: { moved: result[:moved], merged: result[:merged] }
        rescue ::SttTermLearning::TermMover::Error, ActiveRecord::RecordNotFound => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/admin/stt_term_learning/terms/delete { items: [{ domain_file_id, term_key }] } → { deleted }
        def delete_terms
          items = Array(params[:items]).map { |i| { domain_file_id: i[:domain_file_id], term_key: i[:term_key].to_s } }
          items.each { |i| ensure_visible_file!(i[:domain_file_id]) }
          deleted = ::SttTermLearning::TermMover.new(actor: current_user).delete!(items)
          render json: { deleted: deleted }
        rescue ::SttTermLearning::TermMover::Error, ActiveRecord::RecordNotFound => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # GET /api/v1/admin/stt_term_learning/settings
        def settings
          render json: AppSettings.stt_term_learning
        end

        # PUT /api/v1/admin/stt_term_learning/settings { enabled, idle_minutes, min_confidence } → 클램프 반영값
        # 허용 3키만 저장하고 enabled 는 불리언으로 캐스트한다(문자열 "false" 가 켜짐으로 읽히는 함정 방지).
        def update_settings
          attrs = SETTINGS_KEYS.each_with_object({}) do |k, h|
            next unless params.key?(k)
            h[k] = params[k]
          end
          if attrs.key?("enabled")
            enabled = ::ActiveModel::Type::Boolean.new.cast(attrs["enabled"])
            enabled.nil? ? attrs.delete("enabled") : attrs["enabled"] = enabled
          end
          render json: AppSettings.save_stt_term_learning!(attrs)
        end

        private

        # 관리자 화면 범위 밖(남의 personal 프로젝트 등)의 파일은 원본으로 쓰지 못한다 — TermMover 호출 전에 거른다.
        def ensure_visible_file!(domain_file_id)
          return if visible_file_ids.include?(domain_file_id.to_i)
          raise ::SttTermLearning::TermMover::Error, "이동할 수 없는 파일입니다"
        end
      end
    end
  end
end
