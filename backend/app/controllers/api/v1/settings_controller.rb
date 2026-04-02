require "yaml"

module Api
  module V1
    class SettingsController < ApplicationController
      include TokenMasking

      before_action :authenticate_user!

      SETTINGS_PATH = Rails.root.join("..", "settings.yaml").to_s.freeze

      # ── STT ──

      def show
        info = SidecarClient.new.stt_engine_info
        render json: {
          stt_engine: info["current"],
          available_engines: info["available"],
          model_loaded: info["model_loaded"]
        }
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
        render json: {
          stt_engine: read_setting("stt", "engine") || "unknown",
          available_engines: %w[whisper_cpp],
          model_loaded: false,
          offline: true
        }
      end

      def update_stt
        engine = params.require(:engine)
        write_setting("stt", "engine", engine)
        sync_active_llm_to_env

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

      # ── LLM ──

      def llm
        cfg = load_settings
        llm_cfg = cfg["llm"] || {}
        active = llm_cfg["active_preset"] || "anthropic"
        presets = llm_cfg["presets"] || {}

        # 각 프리셋의 토큰을 마스킹하여 반환
        masked_presets = {}
        presets.each do |id, preset|
          masked_presets[id] = preset.merge(
            "auth_token_masked" => mask_token(preset["auth_token"].to_s)
          ).except("auth_token")
        end

        begin
          sidecar_result = SidecarClient.new.get_llm_settings
          render json: {
            active_preset: active,
            presets: masked_presets,
            sidecar: sidecar_result
          }
        rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError
          render json: {
            active_preset: active,
            presets: masked_presets,
            offline: true
          }
        end
      end

      def update_llm
        cfg = load_settings
        cfg["llm"] ||= {}
        llm_cfg = cfg["llm"]
        llm_cfg["presets"] ||= {}

        # 활성 프리셋 변경
        if params[:active_preset].present?
          llm_cfg["active_preset"] = params[:active_preset]
        end

        # 프리셋별 설정 업데이트
        if params[:preset_id].present? && params[:preset_data].present?
          preset_id = params[:preset_id]
          data = params[:preset_data].to_unsafe_h
          existing = llm_cfg["presets"][preset_id] || {}
          existing["provider"] = data["provider"] if data.key?("provider")
          existing["auth_token"] = data["auth_token"] if data.key?("auth_token") && data["auth_token"].present?
          existing["base_url"] = data["base_url"] if data.key?("base_url")
          existing["model"] = data["model"] if data.key?("model")
          existing["max_input_tokens"] = data["max_input_tokens"].to_i if data["max_input_tokens"].present?
          existing["max_output_tokens"] = data["max_output_tokens"].to_i if data["max_output_tokens"].present?
          llm_cfg["presets"][preset_id] = existing
        end

        save_settings(cfg)
        sync_active_llm_to_env

        # sidecar에도 반영 시도
        active_preset = llm_cfg["presets"][llm_cfg["active_preset"]] || {}
        llm_params = build_sidecar_llm_params(active_preset, llm_cfg)
        begin
          SidecarClient.new.update_llm_settings(llm_params)
        rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError
          # 무시 — settings.yaml에는 저장됨
        end

        llm  # 저장 후 최신 상태 반환
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

      # ── HuggingFace ──

      def hf
        token = read_setting("hf", "token") || ""
        begin
          result = SidecarClient.new.get_hf_settings
          render json: result
        rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError
          render json: {
            hf_token_masked: mask_token(token),
            has_token: token.present?,
            offline: true
          }
        end
      end

      def update_hf
        hf_token = params.require(:hf_token)
        write_setting("hf", "token", hf_token)
        sync_active_llm_to_env

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

      def app_settings
        cfg = load_settings
        result = {}

        # summary
        result["summary_interval_sec"] = cfg.dig("summary", "interval_sec") if cfg.dig("summary", "interval_sec")

        # languages
        result["selected_languages"] = cfg.dig("languages", "selected") if cfg.dig("languages", "selected")

        # diarization
        if (diar = cfg["diarization"])
          result["diarization_enabled"] = diar["enabled"] unless diar["enabled"].nil?
          %w[similarity_threshold merge_threshold max_embeddings_per_speaker].each do |k|
            result["diarization_#{k}"] = diar[k] if diar[k]
          end
        end

        # audio
        if (audio = cfg["audio"])
          %w[silence_threshold speech_threshold silence_duration_ms max_chunk_sec min_chunk_sec preroll_ms overlap_ms file_chunk_sec].each do |k|
            result["audio_#{k}"] = audio[k] if audio[k]
          end
        end

        render json: result
      end

      def update_app_settings
        cfg = load_settings

        # summary
        if params.key?(:summary_interval_sec)
          cfg["summary"] ||= {}
          cfg["summary"]["interval_sec"] = params[:summary_interval_sec].to_i
        end

        # languages
        if params.key?(:selected_languages)
          cfg["languages"] ||= {}
          langs = params[:selected_languages]
          cfg["languages"]["selected"] = langs.is_a?(Array) ? langs.map(&:to_s) : langs.to_s.split(",")
        end

        # diarization
        if params.key?(:diarization_enabled)
          cfg["diarization"] ||= {}
          cfg["diarization"]["enabled"] = ActiveModel::Type::Boolean.new.cast(params[:diarization_enabled])
        end
        %w[similarity_threshold merge_threshold max_embeddings_per_speaker].each do |k|
          if params.key?(:"diarization_#{k}")
            cfg["diarization"] ||= {}
            cfg["diarization"][k] = k.include?("threshold") ? params[:"diarization_#{k}"].to_f : params[:"diarization_#{k}"].to_i
          end
        end

        # audio
        %w[silence_threshold speech_threshold silence_duration_ms max_chunk_sec min_chunk_sec preroll_ms overlap_ms file_chunk_sec].each do |k|
          if params.key?(:"audio_#{k}")
            cfg["audio"] ||= {}
            cfg["audio"][k] = k.include?("threshold") ? params[:"audio_#{k}"].to_f : params[:"audio_#{k}"].to_i
          end
        end

        save_settings(cfg)
        sync_active_llm_to_env
        app_settings
      end

      private

      # ── YAML 읽기/쓰기 ──

      def load_settings
        return {} unless File.exist?(SETTINGS_PATH)
        YAML.safe_load(File.read(SETTINGS_PATH)) || {}
      rescue Psych::SyntaxError
        {}
      end

      def save_settings(cfg)
        File.write(SETTINGS_PATH, YAML.dump(cfg.deep_stringify_keys))
      end

      def read_setting(*keys)
        cfg = load_settings
        keys.reduce(cfg) { |c, k| c.is_a?(Hash) ? c[k.to_s] : nil }
      end

      def write_setting(*keys, value)
        cfg = load_settings
        target = cfg
        keys[0..-2].each { |k| target = (target[k.to_s] ||= {}) }
        target[keys.last.to_s] = value
        save_settings(cfg)
      end

      # ── ENV 동기화 (기존 코드 호환) ──

      def sync_active_llm_to_env
        cfg = load_settings
        llm = cfg["llm"] || {}
        active_id = llm["active_preset"]
        preset = llm.dig("presets", active_id) || {}
        provider = preset["provider"] || "anthropic"

        ENV["STT_ENGINE"] = cfg.dig("stt", "engine").to_s if cfg.dig("stt", "engine")
        ENV["HF_TOKEN"] = cfg.dig("hf", "token").to_s if cfg.dig("hf", "token")

        ENV["LLM_PROVIDER"] = provider
        ENV["LLM_MODEL"] = preset["model"].to_s if preset["model"]
        ENV["LLM_MAX_INPUT_TOKENS"] = (preset["max_input_tokens"] || 200_000).to_s
        ENV["LLM_MAX_OUTPUT_TOKENS"] = (preset["max_output_tokens"] || 10_000).to_s

        if provider == "openai"
          ENV["OPENAI_API_KEY"] = preset["auth_token"].to_s
          ENV["OPENAI_BASE_URL"] = preset["base_url"].to_s
        else
          ENV["ANTHROPIC_AUTH_TOKEN"] = preset["auth_token"].to_s
          ENV["ANTHROPIC_BASE_URL"] = preset["base_url"].to_s
        end

        # app settings
        ENV["SUMMARY_INTERVAL_SEC"] = cfg.dig("summary", "interval_sec").to_s if cfg.dig("summary", "interval_sec")
        if (langs = cfg.dig("languages", "selected"))
          ENV["SELECTED_LANGUAGES"] = langs.join(",")
        end
        if (diar = cfg["diarization"])
          ENV["DIARIZATION_ENABLED"] = diar["enabled"].to_s unless diar["enabled"].nil?
          %w[similarity_threshold merge_threshold max_embeddings_per_speaker].each do |k|
            ENV["DIARIZATION_#{k.upcase}"] = diar[k].to_s if diar[k]
          end
        end
        if (audio = cfg["audio"])
          %w[silence_threshold speech_threshold silence_duration_ms max_chunk_sec min_chunk_sec preroll_ms overlap_ms file_chunk_sec].each do |k|
            ENV["AUDIO_#{k.upcase}"] = audio[k].to_s if audio[k]
          end
        end
      end

      def build_sidecar_llm_params(preset, _llm_cfg)
        params = { provider: preset["provider"] }
        params[:auth_token] = preset["auth_token"] if preset["auth_token"].present?
        params[:base_url] = preset["base_url"] if preset["base_url"].present?
        params[:model] = preset["model"] if preset["model"].present?
        params[:max_input_tokens] = preset["max_input_tokens"] if preset["max_input_tokens"]
        params[:max_output_tokens] = preset["max_output_tokens"] if preset["max_output_tokens"]
        params
      end

    end
  end
end
