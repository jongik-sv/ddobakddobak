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

        update_env_file("STT_ENGINE" => engine)

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
        provider = ENV.fetch("LLM_PROVIDER", "anthropic")
        token, base_url = llm_credentials_for(provider)
        render json: {
          provider: provider,
          auth_token_masked: mask_token(token),
          base_url: base_url,
          model: ENV.fetch("LLM_MODEL", ""),
          offline: true
        }
      end

      def update_llm
        provider = params[:provider]

        llm_params = {}
        llm_params[:provider] = provider if provider.present?
        llm_params[:auth_token] = params[:auth_token] if params[:auth_token].present?
        llm_params[:base_url] = params[:base_url] if params.key?(:base_url)
        llm_params[:model] = params[:model] if params[:model].present?

        effective_provider = provider.presence || ENV.fetch("LLM_PROVIDER", "anthropic")
        env_updates = {}
        env_updates["LLM_PROVIDER"] = effective_provider if provider.present?
        if llm_params[:auth_token]
          token_key, = llm_env_keys_for(effective_provider)
          env_updates[token_key] = llm_params[:auth_token]
        end
        if llm_params.key?(:base_url)
          _, url_key = llm_env_keys_for(effective_provider)
          env_updates[url_key] = llm_params[:base_url]
        end
        env_updates["LLM_MODEL"] = llm_params[:model] if llm_params[:model]
        update_env_file(env_updates) if env_updates.any?

        begin
          result = SidecarClient.new.update_llm_settings(llm_params)
          render json: result
        rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError
          token, base_url_fallback = llm_credentials_for(effective_provider)
          token = llm_params[:auth_token] if llm_params[:auth_token]
          render json: {
            provider: effective_provider,
            auth_token_masked: mask_token(token),
            base_url: llm_params.fetch(:base_url, base_url_fallback),
            model: llm_params.fetch(:model, ENV.fetch("LLM_MODEL", ""))
          }
        end
      end

      def test_llm
        test_params = {
          provider: params.require(:provider),
          model: params.require(:model)
        }
        test_params[:auth_token] = params[:auth_token] if params[:auth_token].present?
        test_params[:base_url] = params[:base_url] if params[:base_url].present?

        result = SidecarClient.new.test_llm_connection(test_params)
        render json: result
      rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
        render json: { success: false, error: e.message }, status: :service_unavailable
      end

      def hf
        result = SidecarClient.new.get_hf_settings
        render json: result
      rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError
        token = ENV.fetch("HF_TOKEN", "")
        render json: {
          hf_token_masked: mask_token(token),
          has_token: token.present?,
          offline: true
        }
      end

      def update_hf
        hf_token = params.require(:hf_token)

        update_env_file("HF_TOKEN" => hf_token)

        begin
          result = SidecarClient.new.update_hf_settings(hf_token)
          render json: result
        rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError
          render json: {
            hf_token_masked: mask_token(hf_token),
            has_token: true
          }
        end
      end

      # ── 앱 설정 (오디오/화자분리/요약 주기/언어) ──

      APP_SETTING_KEYS = {
        "SUMMARY_INTERVAL_SEC" => :to_i,
        "DIARIZATION_ENABLED" => nil,  # boolean
        "SELECTED_LANGUAGES" => nil,   # comma-separated
        "AUDIO_SILENCE_THRESHOLD" => :to_f,
        "AUDIO_SPEECH_THRESHOLD" => :to_f,
        "AUDIO_SILENCE_DURATION_MS" => :to_i,
        "AUDIO_MAX_CHUNK_SEC" => :to_i,
        "AUDIO_MIN_CHUNK_SEC" => :to_i,
        "AUDIO_PREROLL_MS" => :to_i,
        "AUDIO_OVERLAP_MS" => :to_i,
        "DIARIZATION_SIMILARITY_THRESHOLD" => :to_f,
        "DIARIZATION_MERGE_THRESHOLD" => :to_f,
        "DIARIZATION_MAX_EMBEDDINGS_PER_SPEAKER" => :to_i
      }.freeze

      def app_settings
        result = {}
        APP_SETTING_KEYS.each do |key, converter|
          val = ENV[key]
          next if val.nil? || val.empty?
          result[key.downcase] = case converter
                                 when :to_i then val.to_i
                                 when :to_f then val.to_f
                                 else val
                                 end
        end
        # boolean 변환
        result["diarization_enabled"] = result["diarization_enabled"] != "false" if result.key?("diarization_enabled")
        # 배열 변환
        result["selected_languages"] = result["selected_languages"].split(",") if result["selected_languages"].is_a?(String)
        render json: result
      end

      def update_app_settings
        updates = {}

        params.each do |key, value|
          env_key = key.to_s.upcase
          next unless APP_SETTING_KEYS.key?(env_key)

          str_value = if value.is_a?(Array)
                        value.join(",")
                      else
                        value.to_s
                      end
          updates[env_key] = str_value
        end

        update_env_file(updates) if updates.any?
        app_settings
      end

      private

      def mask_token(token)
        return "****" if token.blank? || token.length <= 8
        "#{token[0..3]}#{"*" * (token.length - 8)}#{token[-4..]}"
      end

      def llm_credentials_for(provider)
        if provider == "openai"
          [ENV.fetch("OPENAI_API_KEY", ""), ENV.fetch("OPENAI_BASE_URL", "")]
        else
          [ENV.fetch("ANTHROPIC_AUTH_TOKEN", ""), ENV.fetch("ANTHROPIC_BASE_URL", "")]
        end
      end

      def llm_env_keys_for(provider)
        if provider == "openai"
          %w[OPENAI_API_KEY OPENAI_BASE_URL]
        else
          %w[ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL]
        end
      end

      def update_env_file(updates)
        env_path = Rails.root.join("..", ".env")
        FileUtils.touch(env_path) unless File.exist?(env_path)

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
