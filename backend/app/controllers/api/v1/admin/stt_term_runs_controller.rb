module Api
  module V1
    module Admin
      # STT 용어 학습 실행 이력 — 목록·대기·상세(diff)·되돌리기·재실행·수동 분석·건너뛴 항목 등록.
      class SttTermRunsController < ApplicationController
        include SttTermLearningJson

        RUNS_LIMIT = 200
        PENDING_LIMIT = 50
        PENDING_GRACE = 10.minutes
        NO_AI_ORIGINAL_MESSAGE = "AI 원본이 없는 회의입니다".freeze

        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_run, only: %i[show revert rerun register_item]

        # GET /api/v1/admin/stt_term_learning/runs?status=
        def index
          scope = ::SttTermLearningRun.where(meeting_id: visible_meetings_scope.select(:id))
          scope = scope.where(status: params[:status]) if params[:status].present?
          runs = scope.includes(meeting: [ :project, :folder ]).order(id: :desc).limit(RUNS_LIMIT).to_a
          stats = item_stats(runs.map(&:id))
          render json: { runs: runs.map { |r| run_summary_json(r, stats) }, pending: pending_json }
        end

        # GET /api/v1/admin/stt_term_learning/runs/:id
        def show
          summary = @run.summary
          detail = run_summary_json(@run).merge(
            ai_generated_at: summary&.ai_generated_at,
            human_edited_at: summary&.human_edited_at,
            diff: ::SttTermLearning::LineDiff.ops(@run.ai_text, @run.human_text),
            items: @run.items.includes(:domain_file).order(:id).map { |i| run_item_json(i) }
          )
          render json: { run: detail }
        end

        # POST /api/v1/admin/stt_term_learning/runs/:id/revert
        def revert
          result = ::SttTermLearning::Reverter.new(@run).call
          render json: { run: run_summary_json(@run.reload), reverted: result[:reverted],
                         skipped_item_ids: result[:skipped_item_ids] }
        rescue ::SttTermLearning::Reverter::Error => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/admin/stt_term_learning/runs/:id/rerun — failed run 만. 같은 입력으로 새 queued run 을 만들어 enqueue.
        def rerun
          return render_learning_disabled unless learning_enabled?
          unless @run.status == "failed"
            return render json: { error: "실패(failed)한 실행만 다시 실행할 수 있습니다 (현재: #{@run.status})" },
                          status: :unprocessable_entity
          end

          if @run.input_digest.present? &&
             @run.meeting.stt_term_learning_runs.where(input_digest: @run.input_digest, status: %w[queued running]).exists?
            return render json: { error: "같은 입력의 실행이 이미 대기·진행 중입니다" }, status: :unprocessable_entity
          end

          run = @run.meeting.stt_term_learning_runs.create!(
            summary_id: @run.summary_id, trigger: @run.trigger, status: "queued",
            ai_text: @run.ai_text, human_text: @run.human_text, transcript_text: @run.transcript_text,
            input_digest: @run.input_digest
          )
          SttTermLearningJob.perform_later(run_id: run.id)
          render json: { run: run_summary_json(run) }, status: :accepted
        end

        # POST /api/v1/admin/stt_term_learning/meetings/:meeting_id/analyze — 관리자 "지금 다시 분석"
        def analyze
          meeting = visible_meetings_scope(::Meeting.kept).find(params[:meeting_id])
          return render_learning_disabled unless learning_enabled?

          run = ::SttTermLearning::Snapshot.manual!(meeting)
          return render(json: { error: NO_AI_ORIGINAL_MESSAGE }, status: :unprocessable_entity) unless run

          render json: { run: run_summary_json(run) }, status: :accepted
        end

        # POST /api/v1/admin/stt_term_learning/runs/:run_id/items/:id/register
        def register_item
          item = @run.items.find(params[:id])
          ::SttTermLearning::ManualRegistration.call(item)
          render json: { item: run_item_json(item.reload) }
        rescue ::SttTermLearning::ManualRegistration::Error => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        private

        def set_run
          @run = ::SttTermLearningRun.where(meeting_id: visible_meetings_scope.select(:id))
                                     .find(params[:run_id] || params[:id])
        end

        # 사람 편집 후 아직 run 이 없는 learnable final — 디바운스 대기 중인 학습. eta = 편집 시각 + idle_minutes.
        # eta 가 PENDING_GRACE 넘게 지난 행은 뺀다(잡이 스킵·중복 방지로 run 을 안 만든 편집이 영영 남지 않게).
        def pending_json
          idle = AppSettings.stt_term_learning["idle_minutes"].to_i.minutes
          cutoff = Time.current - idle - PENDING_GRACE
          later_run = ::SttTermLearningRun.where("stt_term_learning_runs.meeting_id = summaries.meeting_id")
                                          .where("stt_term_learning_runs.created_at >= summaries.human_edited_at")
          summaries = ::Summary.joins(:meeting)
                               .merge(visible_meetings_scope(::Meeting.kept))
                               .where(summary_type: "final")
                               .where.not(human_edited_at: nil)
                               .where("summaries.human_edited_at >= ?", cutoff)
                               .where.not(ai_notes_markdown: [ nil, "" ])
                               .where.not(later_run.arel.exists)
                               .includes(meeting: [ :project, :folder ])
                               .order(human_edited_at: :desc)
                               .limit(PENDING_LIMIT)
          summaries.map do |s|
            { meeting: meeting_ref(s.meeting), summary_id: s.id, human_edited_at: s.human_edited_at,
              eta: s.human_edited_at + idle }
          end
        end
      end
    end
  end
end
