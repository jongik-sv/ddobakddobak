module Api
  module V1
    module User
      class LlmSettingsController < ApplicationController
        include TokenMasking

        before_action :authenticate_user!

        VALID_PROVIDERS = (%w[anthropic openai] + LlmService::CLI_PROVIDERS).freeze

        # GET /api/v1/user/llm_settings
        def show
          render json: build_response
        end

        # PUT /api/v1/user/llm_settings
        def update
          attrs = normalize_params

          # provider가 빈값이면 초기화 분기.
          #   - reset_all(전체 초기화 버튼) → 요약 + 챗 모두 초기화
          #   - reset_all 아님(요약='선택 안함' 저장) → 요약 컬럼만 초기화, 챗은 보존
          #     (BUG #2: 챗 provider가 별도 설정돼 있을 때 조용히 지워지는 것을 막는다)
          if attrs[:llm_provider].blank?
            reset_all = ActiveModel::Type::Boolean.new.cast(params.dig(:llm_settings, :reset_all))

            if reset_all
              current_user.update!(
                llm_provider: nil, llm_api_key: nil, llm_model: nil, llm_base_url: nil,
                chat_llm_model: nil, chat_llm_provider: nil, chat_llm_api_key: nil, chat_llm_base_url: nil,
                llm_enabled: true
              )
            else
              current_user.update!(
                llm_provider: nil, llm_api_key: nil, llm_model: nil, llm_base_url: nil,
                llm_enabled: true
              )
            end
            return render json: build_response
          end

          unless VALID_PROVIDERS.include?(attrs[:llm_provider])
            return render json: { error: "provider는 #{VALID_PROVIDERS.join(', ')} 중 하나여야 합니다" },
                          status: :unprocessable_entity
          end

          current_user.update!(attrs)
          render json: build_response
        rescue ActiveRecord::RecordInvalid => e
          render json: { error: e.record.errors.full_messages.join(", ") },
                 status: :unprocessable_entity
        rescue ActiveRecord::Encryption::Errors::Configuration => e
          # API 키 암호화 키(active_record_encryption)가 credentials에서 누락된 구성 사고 —
          # 그대로 두면 raw 500 이라 진단이 어렵다. 서버측 구성 문제임을 명확히 알려 재조사를 유도한다.
          Rails.logger.error "[LlmSettings] encryption config error: #{e.message}"
          render json: { error: "서버 암호화 설정 오류로 저장하지 못했습니다. 관리자에게 문의해 주세요." },
                 status: :service_unavailable
        end

        # PATCH /api/v1/user/llm_settings/toggle
        def toggle
          current_user.update!(llm_enabled: !current_user.llm_enabled)
          render json: build_response
        end

        # POST /api/v1/user/llm_settings/test
        def test
          provider = params.require(:provider)

          # CLI 프로바이더는 API 연결 테스트 불필요 (전역 test_llm 과 동일 처리)
          if LlmService::CLI_PROVIDERS.include?(provider)
            return render json: { "success" => true, "note" => "CLI 프로바이더는 별도 연결 테스트가 필요 없습니다." }
          end

          model = params.require(:model)
          api_key = params[:api_key].presence || current_user.llm_api_key
          base_url = params[:base_url].presence || current_user.llm_base_url

          llm_config = {
            provider: provider,
            model: model,
            auth_token: api_key,
            base_url: base_url
          }.compact

          result = LlmService.new(llm_config: llm_config).test_connection
          render json: result
        rescue ActionController::ParameterMissing => e
          render json: { success: false, error: "#{e.param}은(는) 필수입니다" },
                 status: :bad_request
        end

        private

        def normalize_params
          p = params.require(:llm_settings).permit(
            :provider, :api_key, :model, :base_url,
            :chat_provider, :chat_api_key, :chat_model, :chat_base_url
          )

          attrs = {
            llm_provider: p[:provider],
            llm_model: p[:model],
            llm_base_url: p[:base_url].presence,
            chat_llm_model: p[:chat_model].presence,
            chat_llm_provider: p[:chat_provider].presence,
            chat_llm_base_url: p[:chat_base_url].presence
          }

          # provider 저장(빈값 아님) 시 개인 LLM을 (재)활성화한다.
          # 빈 provider 초기화 분기는 자체 update! 로 처리하므로 이 attrs 를 읽지 않는다.
          attrs[:llm_enabled] = true if p[:provider].present?

          # api_key 처리:
          #   - 값 있으면 → 갱신
          #   - provider 전환(이전과 다른 provider) + 키 미전송 → 이전 키가 새 provider에 묶이는
          #     걸 막기 위해 nil 로 비운다 (FIX 1)
          #   - 명시적 nil → 삭제
          #   - 빈 문자열/미전송(동일 provider) → 기존 유지
          provider_changed = p[:provider].present? && p[:provider] != current_user.llm_provider
          if p.key?(:api_key) && p[:api_key].present?
            attrs[:llm_api_key] = p[:api_key]
          elsif provider_changed
            attrs[:llm_api_key] = nil
          elsif p.key?(:api_key) && p[:api_key] != ""
            attrs[:llm_api_key] = p[:api_key]
          end

          # chat_llm_api_key: 동일 규약(chat_provider 전환 기준)
          chat_provider_changed = p[:chat_provider].present? && p[:chat_provider] != current_user.chat_llm_provider
          if p.key?(:chat_api_key) && p[:chat_api_key].present?
            attrs[:chat_llm_api_key] = p[:chat_api_key]
          elsif chat_provider_changed
            attrs[:chat_llm_api_key] = nil
          elsif p.key?(:chat_api_key) && p[:chat_api_key] != ""
            attrs[:chat_llm_api_key] = p[:chat_api_key]
          end

          attrs
        end

        def build_response
          server_default = ::User.server_default_llm_config

          {
            llm_settings: {
              provider: current_user.llm_provider,
              api_key_masked: mask_token(current_user.llm_api_key),
              model: current_user.llm_model,
              base_url: current_user.llm_base_url,
              configured: current_user.llm_configured?,
              enabled: current_user.llm_enabled?,
              has_settings: current_user.llm_has_settings?,
              chat_provider: current_user.chat_llm_provider,
              chat_model: current_user.chat_llm_model,
              chat_base_url: current_user.chat_llm_base_url,
              chat_api_key_masked: mask_token(current_user.chat_llm_api_key),
              chat_configured: current_user.chat_llm_configured?,
              # 4-tier 카스케이드(개인챗>개인요약>전역챗>전역요약)로 실제 답변할 모델의 표시명.
              # FolderChatJob 과 동일한 effective_chat_llm_config 을 쓰므로 폴더챗 미리보기와 일치한다.
              effective_chat_model: LlmModelName.humanize(current_user.effective_chat_llm_config[:model])
            },
            server_default: {
              provider: server_default[:provider],
              model: server_default[:model],
              has_key: server_default[:api_key].present?
            }
          }
        end
      end
    end
  end
end
