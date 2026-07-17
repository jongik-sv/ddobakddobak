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
          #   - reset_all 아님(요약='선택 안함' 저장) → 요약 컬럼만 초기화.
          #     단, 요청에 챗 설정(chat_*)이 함께 오면 그 값을 반영한다 — 요약='선택 안함'이어도
          #     개인 챗 모델을 독립 저장할 수 있어야 하기 때문. 챗 키가 아예 없으면 기존 챗 보존
          #     (BUG #2: 챗 provider가 별도 설정돼 있을 때 조용히 지워지는 것을 막는다).
          if attrs[:llm_provider].blank?
            reset_all = ActiveModel::Type::Boolean.new.cast(params.dig(:llm_settings, :reset_all))
            ls = params.fetch(:llm_settings, {})

            if reset_all
              current_user.update!(
                llm_provider: nil, llm_api_key: nil, llm_model: nil, llm_base_url: nil,
                chat_llm_model: nil, chat_llm_provider: nil, chat_llm_api_key: nil, chat_llm_base_url: nil,
                llm_enabled: true
              )
            else
              # "선택 안함" 저장: provider만 비워 미설정 판정(llm_has_settings?)이 되게 하고,
              # model/base_url/api_key 컬럼은 보존한다 — 재선택("직접 입력") 시 프리필 가능하도록.
              # 단, 사용자가 해당 필드를 명시적으로 빈 값(""/null)으로 보낸 경우엔 그 의도를 반영해 지운다.
              base = { llm_provider: nil, llm_enabled: true }
              base[:llm_model]    = nil if ls.key?(:model)    && ls[:model].blank?
              base[:llm_base_url] = nil if ls.key?(:base_url) && ls[:base_url].blank?
              base[:llm_api_key]  = nil if ls.key?(:api_key)  && ls[:api_key].blank?

              chat_sent = %i[chat_provider chat_model chat_base_url chat_api_key].any? { |k| ls.key?(k) }
              chat = chat_sent ? attrs.slice(:chat_llm_provider, :chat_llm_model, :chat_llm_base_url, :chat_llm_api_key) : {}
              current_user.update!(base.merge(chat))
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

        # POST /api/v1/user/llm_settings/models
        # 클라우드 프로바이더(anthropic/openai)의 모델 목록을 프록시 조회한다(설정 UI '모델 새로고침').
        #   - 브라우저에서 직접 provider API 를 부르면 CORS 로 막히고 API 키가 노출되므로 서버 경유.
        #   - api_key 미전송(폼이 마스킹 상태)이면 저장된 개인 키로 폴백.
        #   - 실패해도 200 + 빈 목록 + error 로 응답 → 프론트는 하드코딩 추천목록으로 폴백.
        def models
          provider = params.require(:provider)
          return render json: { models: [] } unless %w[anthropic openai].include?(provider)

          base_url = params[:base_url].presence
          api_key  = params[:api_key].presence || saved_api_key_for(provider)
          list = LlmService.list_models(provider: provider, api_key: api_key, base_url: base_url)
          render json: { models: list }
        rescue ActionController::ParameterMissing => e
          render json: { error: "#{e.param}은(는) 필수입니다" }, status: :bad_request
        rescue => e
          Rails.logger.warn "[LlmSettings] 모델 목록 조회 실패: #{e.message}"
          render json: { models: [], error: "모델 목록을 불러오지 못했습니다" }
        end

        private

        # '모델 새로고침' 시 폼에 키가 없으면(마스킹된 기존 설정) 저장된 개인 키로 조회한다.
        # 요약/챗 중 provider 가 일치하는 슬롯의 키를 우선 쓰되, 없으면 아무 저장 키나 폴백.
        def saved_api_key_for(provider)
          if provider == current_user.llm_provider && current_user.llm_api_key.present?
            current_user.llm_api_key
          elsif provider == current_user.chat_llm_provider && current_user.chat_llm_api_key.present?
            current_user.chat_llm_api_key
          else
            current_user.llm_api_key.presence || current_user.chat_llm_api_key.presence
          end
        end

        def normalize_params
          p = params.require(:llm_settings).permit(
            :provider, :api_key, :model, :base_url,
            :chat_provider, :chat_api_key, :chat_model, :chat_base_url
          )

          attrs = {
            llm_provider: p[:provider],
            llm_model: p[:model],
            llm_base_url: p[:base_url].presence,
            chat_llm_provider: p[:chat_provider].presence
          }

          # provider 저장(빈값 아님) 시 개인 LLM을 (재)활성화한다.
          # 빈 provider 초기화 분기는 자체 update! 로 처리하므로 이 attrs 를 읽지 않는다.
          attrs[:llm_enabled] = true if p[:provider].present?

          # chat_model/chat_base_url: chat_provider가 비거나(=요약과 동일) 'server' 센티넬
          # (=AI챗 '선택 안함')로 전환되는 경우엔 값을 보존한다 — 이후 다시 provider를 고를 때
          # 프리필할 수 있도록. 사용자가 해당 필드를 명시적으로 빈 값으로 보낸 경우만 지운다.
          # (그 외, 실제 provider로의 전환/유지 시엔 기존과 동일하게 전송값을 그대로 반영한다.)
          chat_cleared = p[:chat_provider].blank? || p[:chat_provider] == ::User::CHAT_SERVER_SENTINEL
          if chat_cleared
            attrs[:chat_llm_model] =
              (p.key?(:chat_model) && p[:chat_model].blank?) ? nil : (p[:chat_model].presence || current_user.chat_llm_model)
            attrs[:chat_llm_base_url] =
              (p.key?(:chat_base_url) && p[:chat_base_url].blank?) ? nil : (p[:chat_base_url].presence || current_user.chat_llm_base_url)
          else
            attrs[:chat_llm_model] = p[:chat_model].presence
            attrs[:chat_llm_base_url] = p[:chat_base_url].presence
          end

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

          # chat_llm_api_key: chat_cleared(요약과 동일/선택 안함으로 전환) 시엔 명시적으로 빈 값을
          # 보낸 경우에만 지우고, 그 외(키 미전송)엔 보존한다. 실제 provider 전환 시엔 기존 규약
          # (chat_provider_changed 기준 stale key 정리, FIX 1)을 그대로 적용한다.
          chat_provider_changed = p[:chat_provider].present? && p[:chat_provider] != current_user.chat_llm_provider
          if p.key?(:chat_api_key) && p[:chat_api_key].present?
            attrs[:chat_llm_api_key] = p[:chat_api_key]
          elsif chat_cleared
            attrs[:chat_llm_api_key] = nil if p.key?(:chat_api_key) && p[:chat_api_key].blank?
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
