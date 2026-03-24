module Api
  module V1
    class SettingsController < ApplicationController
      before_action :authenticate_user!

      def show
        info = SidecarClient.new.stt_engine_info
        render json: {
          stt_engine: info["current"],
          available_engines: info["available"],
          model_loaded: info["model_loaded"]
        }
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
        render json: {
          stt_engine: ENV.fetch("STT_ENGINE", "unknown"),
          available_engines: %w[mock whisper_cpp],
          model_loaded: false,
          offline: true
        }
      end

      def update_stt
        engine = params.require(:engine)
        result = SidecarClient.new.update_stt_engine(engine)
        render json: {
          stt_engine: result["stt_engine"],
          model_loaded: result["model_loaded"]
        }
      rescue SidecarClient::SidecarError => e
        render json: { error: e.message }, status: :unprocessable_entity
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
        render json: { error: e.message }, status: :service_unavailable
      end

      def llm
        result = SidecarClient.new.get_llm_settings
        render json: result
      rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError
        token = ENV.fetch("ANTHROPIC_AUTH_TOKEN", "")
        masked = token.length > 8 ? "#{token[0..3]}#{"*" * (token.length - 8)}#{token[-4..]}" : "****"
        render json: {
          auth_token_masked: masked,
          base_url: ENV.fetch("ANTHROPIC_BASE_URL", ""),
          model: ENV.fetch("LLM_MODEL", ""),
          offline: true
        }
      end

      def update_llm
        llm_params = {}
        llm_params[:auth_token] = params[:auth_token] if params[:auth_token].present?
        llm_params[:base_url] = params[:base_url] if params.key?(:base_url)
        llm_params[:model] = params[:model] if params[:model].present?

        # .env 파일에도 저장
        env_updates = {}
        env_updates["ANTHROPIC_AUTH_TOKEN"] = llm_params[:auth_token] if llm_params[:auth_token]
        env_updates["ANTHROPIC_BASE_URL"] = llm_params[:base_url] if llm_params.key?(:base_url)
        env_updates["LLM_MODEL"] = llm_params[:model] if llm_params[:model]
        update_env_file(env_updates) if env_updates.any?

        begin
          result = SidecarClient.new.update_llm_settings(llm_params)
          render json: result
        rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError
          token = ENV.fetch("ANTHROPIC_AUTH_TOKEN", "")
          token = llm_params[:auth_token] if llm_params[:auth_token]
          masked = token.length > 8 ? "#{token[0..3]}#{"*" * (token.length - 8)}#{token[-4..]}" : "****"
          render json: {
            auth_token_masked: masked,
            base_url: llm_params.fetch(:base_url, ENV.fetch("ANTHROPIC_BASE_URL", "")),
            model: llm_params.fetch(:model, ENV.fetch("LLM_MODEL", ""))
          }
        end
      end

      def hf
        result = SidecarClient.new.get_hf_settings
        render json: result
      rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError
        token = ENV.fetch("HF_TOKEN", "")
        masked = token.length > 8 ? "#{token[0..3]}#{"*" * (token.length - 8)}#{token[-4..]}" : "****"
        render json: {
          hf_token_masked: masked,
          has_token: token.present?,
          offline: true
        }
      end

      def update_hf
        hf_token = params.require(:hf_token)

        # .env 파일에도 저장
        update_env_file("HF_TOKEN" => hf_token)

        begin
          result = SidecarClient.new.update_hf_settings(hf_token)
          render json: result
        rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError
          masked = hf_token.length > 8 ? "#{hf_token[0..3]}#{"*" * (hf_token.length - 8)}#{hf_token[-4..]}" : "****"
          render json: {
            hf_token_masked: masked,
            has_token: true
          }
        end
      end

      private

      # .env 파일의 키=값을 업데이트한다 (없으면 추가)
      def update_env_file(updates)
        env_path = Rails.root.join("..", ".env")
        return unless File.exist?(env_path)

        lines = File.readlines(env_path)
        updates.each do |key, value|
          ENV[key.to_s] = value.to_s
          found = false
          lines.map! do |line|
            if line.match?(/\A#{Regexp.escape(key)}=/)
              found = true
              "#{key}=\"#{value}\"\n"
            else
              line
            end
          end
          lines << "#{key}=\"#{value}\"\n" unless found
        end
        File.write(env_path, lines.join)
      rescue StandardError
        # .env 쓰기 실패 시 무시 (런타임 ENV은 이미 업데이트됨)
      end
    end
  end
end
