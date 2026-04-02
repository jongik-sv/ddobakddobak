module Api
  module V1
    module User
      class LlmSettingsController < ApplicationController
        before_action :authenticate_user!

        VALID_PROVIDERS = %w[anthropic openai].freeze

        # GET /api/v1/user/llm_settings
        def show
          render json: build_response
        end

        # PUT /api/v1/user/llm_settings
        def update
          attrs = normalize_params

          # provider가 빈값이면 전체 초기화 (서버 기본값 폴백)
          if attrs[:llm_provider].blank?
            current_user.update!(
              llm_provider: nil,
              llm_api_key: nil,
              llm_model: nil,
              llm_base_url: nil
            )
            return render json: build_response
          end

          # provider 유효성 검증
          unless VALID_PROVIDERS.include?(attrs[:llm_provider])
            return render json: { error: "provider는 #{VALID_PROVIDERS.join(', ')} 중 하나여야 합니다" },
                          status: :unprocessable_entity
          end

          current_user.update!(attrs)
          render json: build_response
        rescue ActiveRecord::RecordInvalid => e
          render json: { error: e.record.errors.full_messages.join(", ") },
                 status: :unprocessable_entity
        end

        # POST /api/v1/user/llm_settings/test
        def test
          provider = params.require(:provider)
          model = params.require(:model)

          api_key = params[:api_key].presence || current_user.llm_api_key
          base_url = params[:base_url].presence

          test_params = {
            provider: provider,
            model: model,
            auth_token: api_key,
            base_url: base_url
          }.compact

          result = SidecarClient.new.test_llm_connection(test_params)
          render json: result
        rescue ActionController::ParameterMissing => e
          render json: { success: false, error: "#{e.param}은(는) 필수입니다" },
                 status: :bad_request
        rescue SidecarClient::SidecarError => e
          render json: { success: false, error: e.message },
                 status: :service_unavailable
        end

        private

        def normalize_params
          p = params.require(:llm_settings).permit(:provider, :api_key, :model, :base_url)

          attrs = {
            llm_provider: p[:provider],
            llm_model: p[:model],
            llm_base_url: p[:base_url].presence  # 빈 문자열 -> nil
          }

          # api_key 처리: 빈 문자열 → 기존 유지, nil → 삭제, 값 있으면 갱신
          empty_string = p.key?(:api_key) && p[:api_key] == ""
          attrs[:llm_api_key] = p[:api_key] if p.key?(:api_key) && !empty_string

          attrs
        end

        def build_response
          server_default = ::User.server_default_llm_config

          {
            llm_settings: {
              provider: current_user.llm_provider,
              api_key_masked: mask_api_key(current_user.llm_api_key),
              model: current_user.llm_model,
              base_url: current_user.llm_base_url,
              configured: current_user.llm_configured?
            },
            server_default: {
              provider: server_default[:provider],
              model: server_default[:model],
              has_key: server_default[:api_key].present?
            }
          }
        end

        def mask_api_key(key)
          return nil if key.blank?
          return "****" if key.length <= 8
          "#{key[0..3]}#{"*" * (key.length - 8)}#{key[-4..]}"
        end
      end
    end
  end
end
