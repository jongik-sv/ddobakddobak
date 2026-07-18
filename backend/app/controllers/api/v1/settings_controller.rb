require "yaml"

module Api
  module V1
    class SettingsController < ApplicationController
      include TokenMasking

      before_action :authenticate_user!
      before_action :require_admin!, only: %i[update_stt update_stt_file update_llm test_llm update_hf]

      SETTINGS_PATH = AppSettings::SETTINGS_PATH

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

      # ── STT (파일 재전사 / 배치) ──

      def stt_file
        info = SidecarClient.new.stt_file_engine_info
        render json: {
          file_engine: info["file_engine"],
          available_engines: info["available"]
        }
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
        render json: {
          file_engine: read_setting("stt", "file_engine") || "whisper_cpp",
          available_engines: %w[whisper_cpp mlx_whisper_turbo_beam_8bit]
        }
      end

      def update_stt_file
        engine = params.require(:engine)
        write_setting("stt", "file_engine", engine)

        result = SidecarClient.new.update_stt_file_engine(engine)
        render json: {
          file_engine: result["file_engine"],
          available_engines: result["available"]
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

        chat = llm_cfg["chat"]
        masked_chat =
          if chat.present?
            chat.merge("auth_token_masked" => mask_token(chat["auth_token"].to_s)).except("auth_token")
          end

        render json: {
          active_preset: active,
          chat_model: llm_cfg["chat_model"],
          chat: masked_chat,
          presets: masked_presets,
          active_profile_id: llm_cfg["active_profile_id"],
          chat_profile_id: llm_cfg["chat_profile_id"]
        }
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

        # 전역 AI Chat 모델 (active_preset 형제 필드). 빈 문자열은 nil 로 저장해 클리어한다.
        if params.key?(:chat_model)
          llm_cfg["chat_model"] = params[:chat_model].to_s.presence
        end

        # 전역 AI Chat 독립 설정 (llm.chat sub-hash). provider 빈값이면 독립 해제(삭제).
        if params.key?(:chat)
          chat_params = params[:chat].respond_to?(:to_unsafe_h) ? params[:chat].to_unsafe_h : (params[:chat] || {})
          if chat_params["provider"].to_s.present?
            existing_chat = llm_cfg["chat"] || {}
            existing_chat["preset_id"] = chat_params["preset_id"] if chat_params.key?("preset_id")
            existing_chat["provider"]  = chat_params["provider"]
            existing_chat["base_url"]  = chat_params["base_url"] if chat_params.key?("base_url")
            existing_chat["model"]     = chat_params["model"] if chat_params.key?("model")
            # 마스킹된 값 재전송 방지: present일 때만 키 갱신
            existing_chat["auth_token"] = chat_params["auth_token"] if chat_params["auth_token"].to_s.present?
            llm_cfg["chat"] = existing_chat
          else
            llm_cfg.delete("chat")
          end
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

        # 프로필 참조(서버 풀) — 값 검증 후 참조 저장, 실체화는 LlmProfileYamlSync가 담당
        %w[active_profile_id chat_profile_id].each do |key|
          next unless params.key?(key)
          raw = params[key]
          if raw.present?
            unless LlmProfile.server_pool.exists?(raw.to_i)
              return render json: { error: "유효하지 않은 프로필입니다" }, status: :unprocessable_entity
            end
            llm_cfg[key] = raw.to_i
          else
            llm_cfg.delete(key)
          end
        end

        LlmProfileYamlSync.apply!(cfg)

        save_settings(cfg)
        sync_active_llm_to_env

        llm  # 저장 후 최신 상태 반환
      end

      def test_llm
        provider = params.require(:provider)

        # CLI 프로바이더는 API 연결 테스트 불필요
        if LlmService::CLI_PROVIDERS.include?(provider)
          render json: { "success" => true, "note" => "CLI 프로바이더는 별도 연결 테스트가 필요 없습니다." }
          return
        end

        # 토큰이 없으면 저장된 프리셋에서 가져옴
        auth_token = params[:auth_token]
        if auth_token.blank? && params[:preset_id].present?
          stored = load_settings.dig("llm", "presets", params[:preset_id])
          auth_token = stored&.dig("auth_token")
        end

        if auth_token.blank? && params[:profile_id].present?
          auth_token = LlmProfile.server_pool.find_by(id: params[:profile_id])&.auth_token
        end

        llm_config = {
          provider: provider,
          model: params.require(:model),
          auth_token: auth_token,
          base_url: params[:base_url]
        }.compact

        result = LlmService.new(llm_config: llm_config).test_connection
        render json: result
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

        # NOTE: 회의 언어는 사용자별 설정(User#language_*)으로 이전됨.
        #       /api/v1/user/language_settings 사용. 여기(전역 config.yaml)서는 다루지 않음.

        # diarization
        if (diar = cfg["diarization"])
          result["diarization_enabled"] = diar["enabled"] unless diar["enabled"].nil?
          result["diarization_clustering_threshold"] = diar["clustering_threshold"] if diar["clustering_threshold"]
          result["diarization_ahc_threshold"] = diar["ahc_threshold"] if diar["ahc_threshold"]
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

        # NOTE: 회의 언어는 사용자별 설정(User#language_*)으로 이전됨.
        #       /api/v1/user/language_settings 사용. 전역 config.yaml에 저장하지 않음.

        # diarization
        if params.key?(:diarization_enabled)
          cfg["diarization"] ||= {}
          cfg["diarization"]["enabled"] = ActiveModel::Type::Boolean.new.cast(params[:diarization_enabled])
        end
        if params.key?(:diarization_clustering_threshold)
          cfg["diarization"] ||= {}
          cfg["diarization"]["clustering_threshold"] = params[:diarization_clustering_threshold].to_f.clamp(0.5, 0.8)
        end
        if params.key?(:diarization_ahc_threshold)
          cfg["diarization"] ||= {}
          cfg["diarization"]["ahc_threshold"] = params[:diarization_ahc_threshold].to_f.clamp(0.2, 0.8)
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
        AppSettings.load
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
        AppSettings.sync_env_from!(load_settings)
      end
    end
  end
end
