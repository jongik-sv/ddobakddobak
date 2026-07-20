module Api
  module V1
    # D'Flow(회의록 아카이브) 전송·연결 관리 + 조회 프록시(시크릿을 프런트에 노출하지 않기 위함).
    # 스펙: tasks/dflow-minutes-upload/artifacts/ddobak-dflow-sender-spec.md §3.3.
    class MeetingDflowController < ApplicationController
      UUID_RE = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/

      before_action :authenticate_user!
      before_action :set_meeting, only: %i[upload status link claim]

      # ── 에러 매핑(전 액션 공통 rescue) ──
      rescue_from DflowClient::UnknownUserError, with: :handle_dflow_unknown_user
      rescue_from DflowClient::LinkConflictError, with: :handle_dflow_link_conflict
      rescue_from DflowClient::AuthError, with: :handle_dflow_auth_error
      rescue_from DflowClient::ConnectionError, DflowClient::TimeoutError, with: :handle_dflow_connection_error
      rescue_from DflowClient::ApiError, with: :handle_dflow_api_error
      rescue_from DflowUploadService::NotEnabledError,
                  DflowUploadService::NotCompletedError,
                  DflowUploadService::NotesBlankError,
                  DflowUploadService::TeamRequiredError,
                  DflowUploadService::BodyTooLongError,
                  with: :handle_upload_precondition_error

      # POST /api/v1/meetings/:id/dflow/upload  body { team?, title? }
      def upload
        return head :forbidden unless @meeting.editable_by?(current_user)

        DflowUploadService.call(
          @meeting, current_user,
          team_override: params[:team].presence,
          title_override: params[:title].presence
        )
        render json: dflow_status_json(@meeting)
      end

      # GET /api/v1/meetings/:id/dflow/status
      # → { public_uid, dflow_synced_at, dflow_url, needs_resync } + (연결 시) exists_on_dflow
      def status
        json = dflow_status_json(@meeting)
        if @meeting.public_uid.present?
          resp = DflowClient.new.list_minutes(external_id: "ddobak:#{@meeting.public_uid}")
          json[:exists_on_dflow] = resp["items"].to_a.any?
        end
        render json: json
      end

      # PUT /api/v1/meetings/:id/dflow/link  body { public_uid: "..." | null }
      # 수동 입력/해제. null(또는 빈 값)이면 해제 + dflow_synced_at·dflow_url도 null.
      def link
        return head :forbidden unless @meeting.editable_by?(current_user)

        raw = params[:public_uid]
        if raw.blank?
          @meeting.update!(public_uid: nil, dflow_synced_at: nil, dflow_url: nil)
          return render json: dflow_status_json(@meeting)
        end

        uid = raw.to_s.strip
        unless uid.match?(UUID_RE)
          return render json: { error: "유효한 UUID 형식이 아닙니다", code: "invalid_uuid" }, status: :unprocessable_entity
        end

        if Meeting.where(public_uid: uid).where.not(id: @meeting.id).exists?
          return render json: { error: "다른 회의가 이미 이 식별자를 사용 중입니다", code: "public_uid_conflict" },
                        status: :unprocessable_entity
        end

        # 새 uid로 수동 연결 시 이전 전송 상태는 무효 — 재전송 전까지는 "동기화 안 됨"으로 취급한다.
        @meeting.update!(public_uid: uid, dflow_synced_at: nil, dflow_url: nil)
        render json: dflow_status_json(@meeting)
      end

      # POST /api/v1/meetings/:id/dflow/claim  body { minute_id: "<dflow uuid>" }
      # public_uid 없으면 발급·커밋 후 D'Flow 기존 레코드에 연결한다(계약 §4b).
      def claim
        return head :forbidden unless @meeting.editable_by?(current_user)

        minute_id = params[:minute_id].to_s
        if minute_id.blank?
          return render json: { error: "minute_id가 필요합니다", code: "validation_failed" },
                        status: :unprocessable_entity
        end

        # 발급 순서 불변 규칙(§1.2)은 Meeting#ensure_dflow_public_uid! 단일 소스에 위임한다
        # (DflowUploadService#call 과 로직 공유 — 두 곳에 흩어지면 한쪽만 수정될 위험이 있다).
        @meeting.ensure_dflow_public_uid!
        external_id = "ddobak:#{@meeting.public_uid}"

        dflow_client = DflowClient.new
        resp = dflow_client.link_minute(minute_id: minute_id, external_id: external_id, user_email: current_user.email)
        # link 응답(계약 §4b)엔 url 필드가 없어 upload 응답(§4.3)과 동일한 규칙으로 직접 조립한다.
        @meeting.update!(dflow_url: "#{dflow_client.base_url}/minutes/#{resp['id']}")

        render json: dflow_status_json(@meeting)
      end

      # GET /api/v1/dflow/minutes — D'Flow 조회 프록시. params passthrough.
      def minutes
        allowed = params.permit(:date_from, :date_to, :team, :linked, :page).to_h.compact_blank
        render json: DflowClient.new.list_minutes(allowed)
      end

      # GET /api/v1/dflow/meta — D'Flow 조회 프록시.
      def meta
        render json: DflowClient.new.meta(project_id: params[:project_id].presence)
      end

      private

      # 읽기 인가까지 포함(accessible_by) — 쓰기(upload/link/claim)는 각 액션에서 editable_by? 추가 검사.
      def set_meeting
        @meeting = Meeting.accessible_by(current_user).find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Meeting not found" }, status: :not_found
      end

      def dflow_status_json(meeting)
        {
          public_uid: meeting.public_uid,
          dflow_synced_at: meeting.dflow_synced_at,
          dflow_url: meeting.dflow_url,
          needs_resync: meeting.dflow_needs_resync?
        }
      end

      def handle_dflow_unknown_user(_e)
        render json: {
          error: "D'Flow에 동일 이메일(#{current_user&.email}) 계정이 없습니다. D'Flow 관리자에게 계정 생성을 요청하세요.",
          code: "dflow_unknown_user"
        }, status: :unprocessable_entity
      end

      def handle_dflow_link_conflict(e)
        render json: { error: e.message.presence || "이미 다른 식별자로 연결되어 있습니다", code: "dflow_link_conflict" },
               status: :conflict
      end

      def handle_dflow_auth_error(_e)
        render json: { error: "D'Flow 인증 실패 — 관리자에게 시크릿 확인 요청", code: "dflow_auth_error" },
               status: :bad_gateway
      end

      def handle_dflow_connection_error(_e)
        render json: { error: "D'Flow 서버에 연결할 수 없습니다", code: "dflow_connection_error" },
               status: :bad_gateway
      end

      def handle_dflow_api_error(e)
        render json: { error: e.message, code: e.code || "dflow_api_error" }, status: :bad_gateway
      end

      def handle_upload_precondition_error(e)
        code = case e
        when DflowUploadService::NotEnabledError    then "dflow_not_enabled"
        when DflowUploadService::NotCompletedError  then "meeting_not_completed"
        when DflowUploadService::NotesBlankError    then "notes_blank"
        when DflowUploadService::TeamRequiredError  then "team_required"
        when DflowUploadService::BodyTooLongError   then "body_too_long"
        end
        render json: { error: e.message, code: code }, status: :unprocessable_entity
      end
    end
  end
end
