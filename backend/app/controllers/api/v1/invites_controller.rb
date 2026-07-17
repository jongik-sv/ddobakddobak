module Api
  module V1
    class InvitesController < ApplicationController
      # 공개 엔드포인트 — 인증 불필요. (로그인 상태면 current_user 채워짐.)
      before_action :set_invite

      def show
        render json: { project: preview_json(@invite.project), valid: @invite.redeemable? }
      end

      def redeem
        return render json: { error: "만료되었거나 사용할 수 없는 초대입니다" }, status: :gone unless @invite.redeemable?

        # 가입 자격증명(email+password)이 오면 신규 가입 흐름.
        # 그렇지 않으면 현재 로그인 사용자를 합류시킨다.
        # (하이브리드 인증에서 current_user 는 로컬/loopback 폴백으로 항상 채워질 수 있어
        #  nil 검사만으로는 익명 여부를 신뢰할 수 없다 — 가입 의도=자격증명 제출로 판별.)
        if signup_requested?
          signup_and_join!
        else
          join!(current_user)
          @invite.consume!
          render json: { joined: true, project: preview_json(@invite.project) }, status: :ok
        end
      end

      private

      def signup_requested?
        params[:email].present? && params[:password].present?
      end

      def set_invite
        @invite = ProjectInvite.find_by(code: params[:code])
        render json: { error: "초대를 찾을 수 없습니다" }, status: :not_found unless @invite
      end

      def join!(user)
        ProjectMembership.find_or_create_by!(project: @invite.project, user: user) { |pm| pm.role = "member" }
      end

      # 비로그인 — 초대코드가 유효 가입 게이트. 계정 생성 + 합류 + JWT 발급.
      def signup_and_join!
        user = ::User.new(name: params[:name], email: params[:email], password: params[:password],
                           password_confirmation: params[:password_confirmation], role: "member")
        unless user.save
          return render json: { errors: user.errors.full_messages }, status: :unprocessable_entity
        end
        join!(user)
        @invite.consume!

        render json: JwtService.issue_session(user).merge(project: preview_json(@invite.project)), status: :created
      end

      def preview_json(p)
        { id: p.id, name: p.name, icon_type: p.icon_type, icon_value: p.icon_value, color: p.color }
      end
    end
  end
end
