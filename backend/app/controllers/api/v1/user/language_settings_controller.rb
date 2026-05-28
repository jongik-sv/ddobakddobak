module Api
  module V1
    module User
      class LanguageSettingsController < ApplicationController
        before_action :authenticate_user!

        VALID_MODES = %w[single multi].freeze

        # GET /api/v1/user/language_settings
        def show
          render json: build_response
        end

        # PUT /api/v1/user/language_settings
        def update
          p = params.require(:language_settings).permit(:mode, languages: [])
          mode = p[:mode].to_s
          languages = Array(p[:languages]).map(&:to_s).map(&:strip).reject(&:blank?)

          unless VALID_MODES.include?(mode)
            return render json: { error: "mode는 #{VALID_MODES.join(', ')} 중 하나여야 합니다" },
                          status: :unprocessable_entity
          end

          current_user.update!(
            language_mode: mode,
            selected_languages: languages.presence&.join(",")
          )
          render json: build_response
        rescue ActiveRecord::RecordInvalid => e
          render json: { error: e.record.errors.full_messages.join(", ") },
                 status: :unprocessable_entity
        end

        private

        def build_response
          server_default = ::User.server_default_language_config

          {
            language_settings: {
              mode: current_user.language_mode,
              languages: current_user.selected_languages_list,
              configured: current_user.language_configured?
            },
            server_default: {
              mode: server_default[:mode],
              languages: server_default[:languages]
            }
          }
        end
      end
    end
  end
end
