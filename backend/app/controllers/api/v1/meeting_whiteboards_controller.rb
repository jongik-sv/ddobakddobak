module Api
  module V1
    # 서버 모드 화이트보드(design.md §11.3). 권한은 export 와 같은 읽기 인가(set_meeting).
    class MeetingWhiteboardsController < ApplicationController
      include MeetingLookup

      before_action :authenticate_user!
      before_action :set_meeting

      # POST /api/v1/meetings/:id/whiteboard — 클라이언트가 보낸 프롬프트·본문은 받지 않는다.
      def create
        unless server_claude_enabled?
          return render json: { error: "whiteboard_server_disabled" }, status: :forbidden
        end

        material = Whiteboard::Material.build(@meeting)
        return render json: { error: "no_summary" }, status: :unprocessable_entity unless material

        digest = material.digest
        outcome = decide_and_claim(digest)

        case outcome[:action]
        when :cached
          render json: { status: "done", digest: digest, board: outcome[:board] }
        when :running
          render json: { status: "running", digest: digest }, status: :accepted
        else
          # 커밋 후 enqueue — 잡이 먼저 떠서 옛 row 를 보는 일을 막는다.
          WhiteboardExportJob.perform_later(@meeting.id, digest, current_user.id, outcome[:token])
          render json: { status: "running", digest: digest }, status: :accepted
        end
      end

      # GET /api/v1/meetings/:id/whiteboard — web_mode 와 무관하게 조회 허용.
      def show
        wb = MeetingWhiteboard.find_by(meeting_id: @meeting.id)
        return render json: { status: "none", stale: false } unless wb

        current = Whiteboard::Material.build(@meeting)&.digest
        status = wb.status
        status = "error" if status == "running" && wb.updated_at <= STALE_RUNNING_AFTER.ago
        payload = { status: status, digest: wb.digest, stale: wb.digest != current }
        payload[:board] = wb.board if status == "done"
        if status == "error"
          if wb.status == "running" # 고착(잡 사망·재시작) — 저장은 하지 않고 보고만 한다
            payload[:error_kind] = "timeout"
            payload[:error_message] = Whiteboard::Failure::MESSAGES["timeout"]
          else
            payload[:error_kind] = wb.error_kind
            payload[:error_message] = wb.error_message
          end
        end
        render json: payload
      end

      private

      # running 이 이 시간을 넘기면 잡이 죽은 것으로 본다(잡 최대 2회 x 180초 = 6분 + 여유).
      STALE_RUNNING_AFTER = 7.minutes

      # 판정과 갱신을 row lock 안에서 원자적으로 수행한다(동시 POST 중복 enqueue·덮어쓰기 방지).
      # 반환: { action: :cached, board: } | { action: :running } | { action: :enqueue, token: }
      def decide_and_claim(digest)
        token = SecureRandom.hex(16)
        created = MeetingWhiteboard.create_or_find_by!(meeting_id: @meeting.id) do |r|
          r.assign_attributes(claim_attributes(digest, token))
        end
        return { action: :enqueue, token: token } if created.previously_new_record?

        created.with_lock do
          wb = created
          if wb.status == "done" && wb.digest == digest && (board = valid_cached_board(wb))
            { action: :cached, board: board }
          elsif wb.status == "running" && wb.digest == digest && wb.updated_at > STALE_RUNNING_AFTER.ago
            { action: :running }
          else
            wb.update!(claim_attributes(digest, token))
            { action: :enqueue, token: token }
          end
        end
      end

      def claim_attributes(digest, token)
        { status: "running", digest: digest, prompt_version: Whiteboard::Prompt::PROMPT_VERSION,
          board_json: nil, error_kind: nil, error_message: nil,
          requested_by_id: current_user.id, run_token: token }
      end

      # 저장된 보드가 현재 검증 규칙을 통과할 때만 캐시로 쓴다(과거 버전이 저장한 불량 보드는 미스).
      def valid_cached_board(wb)
        stored = wb.board
        return nil unless stored
        Whiteboard::Board.validate(stored)
        stored
      rescue Whiteboard::ValidationError
        nil
      end

      def server_claude_enabled?
        AppSettings.whiteboard_web_mode == "server_claude" && LlmService.claude_cli_available?
      end
    end
  end
end
