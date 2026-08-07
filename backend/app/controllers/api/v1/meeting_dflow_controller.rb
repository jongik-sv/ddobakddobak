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
                  DflowUploadService::FolderNameTooLongError,
                  with: :handle_upload_precondition_error
      rescue_from DflowUploadService::MeetingValidationError, with: :handle_meeting_validation_error

      # POST /api/v1/meetings/:id/dflow/upload  body { team?, title?, meeting?: {...} }
      # 응답 = 4필드 공통 상태 + D'Flow 편철 결과 에코(W19/W8) — folder_id/folder_path/folder_path_status.
      # meeting 옵션: tasks/dflow-meeting-select/artifacts/ddobak-meeting-select-design.md §2.2/§2.3.
      def upload
        return head :forbidden unless @meeting.editable_by?(current_user)

        meeting_option = parse_meeting_option
        return if performed? # 구조 검증 실패 시 이미 400 을 렌더했다

        resp = DflowUploadService.call(
          @meeting, current_user,
          team_override: params[:team].presence,
          title_override: params[:title].presence,
          meeting_option: meeting_option
        )
        render json: dflow_status_json(@meeting).merge(dflow_folder_echo_json(resp))
      end

      # GET /api/v1/meetings/:id/dflow/status
      # → { public_uid, dflow_synced_at, dflow_url, needs_resync }
      #   + (연결 시) exists_on_dflow
      #   + (존재 시) dflow_title, dflow_date — 재전송 시 덮어쓸 대상 미리보기(W17).
      #   + (존재 & 보관됨) dflow_archived — 보관분을 "연결 초기화"로 오진하지 않기 위함(W14/dflow-W24).
      #     `include_archived: true`로 보관분도 조회해야 exists_on_dflow가 보관을 "없음"으로
      #     뭉개지 않는다. `item["archived"]`가 true/false가 아니면(키 부재 또는 null — R1 이전
      #     D'Flow) dflow_archived 자체를 넣지 않는다 — false로 채우면 "보관 아님"을 단정하게 된다.
      #     이 필드들은 status 액션에서만 채운다(dflow_status_json 공용 헬퍼에 넣으면
      #     list_minutes 왕복이 없는 upload/link/claim까지 값 없는 필드가 따라붙거나
      #     왕복이 3번 늘어난다).
      def status
        json = dflow_status_json(@meeting)
        if @meeting.public_uid.present?
          resp = DflowClient.new.list_minutes(external_id: "ddobak:#{@meeting.public_uid}", include_archived: true)
          items = resp["items"]
          # items가 배열이 아니면(비정상 응답) Kernel#Array()도 Hash를 pair 배열로 바꿔버려
          # 위험하므로 is_a? 로만 판정한다. 배열이 아닐 때는 item = nil(= exists_on_dflow: false).
          item = items.is_a?(Array) ? items.first : nil
          json[:exists_on_dflow] = !item.nil?
          if item
            json[:dflow_title] = item["title"]
            json[:dflow_date] = item["date"]
            archived = item["archived"]
            json[:dflow_archived] = archived if archived == true || archived == false
          end
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

        # 순수 claim 시퀀스(발급 순서·external_id 조립·dflow_url 조립)는 DflowAutoLinkService#perform_claim
        # 과 공유 — DflowClaimer 단일 출처(인가는 여기 컨트롤러가 계속 담당).
        DflowClaimer.call(meeting: @meeting, minute_id: minute_id, user_email: current_user.email)

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
          needs_resync: meeting.dflow_needs_resync?,
          # 회의 연결 스냅샷(design §2.3) — 단순 nullable 컬럼이라 항상 포함(3값 규약 대상 아님).
          dflow_meeting_id: meeting.dflow_meeting_id,
          dflow_meeting_title: meeting.dflow_meeting_title,
          dflow_project_name: meeting.dflow_project_name
        }
      end

      # meeting 파라미터 구조 검증(design §2.3): mode 화이트리스트, link/create 필드 혼재 방어.
      # 통과하면 DflowUploadService#call 에 그대로 넘길 Hash 를 반환한다. 실패 시 400 을 렌더하고
      # nil 을 반환한다(호출부는 performed? 로 중단 여부를 판단).
      def parse_meeting_option
        raw = params[:meeting]
        return nil if raw.blank?

        permitted = raw.permit(:mode, :meeting_id, :project_id, :title, :date, :category,
                                display: %i[meeting_title project_name])
        mode = permitted[:mode].to_s

        unless DflowUploadService::MEETING_MODES.include?(mode)
          return render_meeting_validation_error(
            "meeting.mode 는 #{DflowUploadService::MEETING_MODES.join('/')} 중 하나여야 합니다"
          )
        end

        create_only_present = %i[project_id title date].any? { |k| permitted[k].present? } ||
                               permitted[:category].present?

        case mode
        when "link"
          if permitted[:meeting_id].blank?
            return render_meeting_validation_error("meeting.mode=link 에는 meeting_id 가 필요합니다")
          end
          if create_only_present
            return render_meeting_validation_error(
              "meeting.mode=link 에는 project_id/title/date/category 를 함께 보낼 수 없습니다"
            )
          end
        when "create"
          if permitted[:meeting_id].present?
            return render_meeting_validation_error("meeting.mode=create 에는 meeting_id 를 함께 보낼 수 없습니다")
          end
        when "unlink", "keep"
          if permitted[:meeting_id].present? || create_only_present
            return render_meeting_validation_error(
              "meeting.mode=#{mode} 에는 meeting_id/project_id/title/date/category 를 함께 보낼 수 없습니다"
            )
          end
        end

        {
          mode: mode,
          meeting_id: permitted[:meeting_id],
          project_id: permitted[:project_id],
          title: permitted[:title],
          date: permitted[:date],
          category: permitted[:category],
          display: (permitted[:display] || {}).to_h.symbolize_keys
        }
      end

      def render_meeting_validation_error(message)
        render json: { error: message, code: "validation_failed" }, status: :bad_request
        nil
      end

      # W19/W8: D'Flow 업로드 응답(DflowUploadService#call 이 그대로 돌려주는 파싱된 Hash, 문자열 키)에서
      # folder_id/folder_path/folder_path_status 만 꺼내 upload 응답에 얹는다. #dflow_status_json 에 넣지
      # 않는 이유는 그 헬퍼가 status/link/claim 에도 쓰여서 편철 정보 없는 응답까지 필드가 따라붙기
      # 때문(W9 의 DflowUploadResult/DflowMeetingStatus 타입 분리가 무너짐).
      #
      # 3값 규약(frontend/src/api/dflow.ts#DflowUploadResult) — 키 부재/null/[] 를 뭉개지 않는다:
      #   키 부재(구버전 D'Flow·아직 미에코)  → 우리 응답에도 키를 넣지 않는다(key? 로만 판정)
      #   null(미분류)                        → null 그대로
      #   []( 팀 루트 편철 성공)               → [] 그대로
      #
      # folder_path_status(W8, 계약 §4.3/§4c.2) — exact/truncated/partial/unclassified 4종.
      # 같은 key? 조건부 merge 패턴: 키 부재(구버전 D'Flow·아직 미에코)면 우리 응답에도 키를 넣지 않는다.
      def dflow_folder_echo_json(resp)
        json = {}
        json[:folder_id] = resp["folder_id"] if resp.key?("folder_id")
        json[:folder_path] = resp["folder_path"] if resp.key?("folder_path")
        json[:folder_path_status] = resp["folder_path_status"] if resp.key?("folder_path_status")
        json
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

      # meeting 연결 에러 매핑(design §2.2 매핑 테이블): 그 외 code는 기존 통신 에러 규약(502)을 유지한다.
      def handle_dflow_api_error(e)
        if e.code == "not_project_member"
          return render json: { error: "선택한 D'Flow 프로젝트의 멤버가 아닙니다.", code: "not_project_member" },
                        status: :forbidden
        end
        if e.code == "validation_failed" && e.message.to_s.include?("회의를 찾을 수 없습니다")
          return render json: {
            error: "연결하려던 회의가 D'Flow에서 삭제되었습니다. 연결을 해제하거나 다른 회의를 선택하세요.",
            code: "dflow_meeting_not_found"
          }, status: :unprocessable_entity
        end

        render json: { error: e.message, code: e.code || "dflow_api_error" }, status: :bad_gateway
      end

      def handle_meeting_validation_error(e)
        render json: { error: e.message, code: "meeting_validation_failed" }, status: :unprocessable_entity
      end

      def handle_upload_precondition_error(e)
        code = case e
        when DflowUploadService::NotEnabledError        then "dflow_not_enabled"
        when DflowUploadService::NotCompletedError      then "meeting_not_completed"
        when DflowUploadService::NotesBlankError        then "notes_blank"
        when DflowUploadService::TeamRequiredError      then "team_required"
        when DflowUploadService::BodyTooLongError       then "body_too_long"
        when DflowUploadService::FolderNameTooLongError then "folder_name_too_long"
        end
        render json: { error: e.message, code: code }, status: :unprocessable_entity
      end
    end
  end
end
